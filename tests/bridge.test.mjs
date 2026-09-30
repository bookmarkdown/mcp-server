import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer as createNetServer } from 'node:net';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { WebSocket } from 'ws';
import { IpcClient } from '../dist/ipc/client.js';
import { startDaemon } from '../dist/daemon/service.js';
import { connectLocalPipe } from '../dist/ipc/transport.js';

const extensionId = 'a'.repeat(32);
const secondExtensionId = 'b'.repeat(32);
const unlistedExtensionId = 'c'.repeat(32);
const token = '0123456789abcdef0123456789abcdef0123456789abcdef';
const instanceId = '7d8c2f92-12c8-4bd2-9701-12e602deaf01';
const secondInstanceId = '9f35a930-b515-47e3-8bb5-c454f8de8c55';
const supportedPlatforms = {
  skip: !['win32', 'linux', 'darwin'].includes(process.platform)
    ? 'Daemon bridge tests require Windows, Linux, or macOS local IPC.'
    : false,
};

function uniquePipeName() {
  return `bookmarkdown-bridge-${process.pid}-${randomUUID()}`;
}

function makeEnvironment(port, overrides = {}) {
  const environment = {
    BOOKMARKDOWN_BRIDGE_TOKEN: token,
    BOOKMARKDOWN_EXTENSION_IDS: `${extensionId},${secondExtensionId}`,
    BOOKMARKDOWN_WS_PORT: String(port),
    BOOKMARKDOWN_MAX_PAYLOAD_BYTES: '65536',
    BOOKMARKDOWN_MAX_PENDING_REQUESTS: '16',
    BOOKMARKDOWN_MAX_CONNECTIONS: '8',
    BOOKMARKDOWN_MAX_REGISTERED_INSTANCES: '64',
    BOOKMARKDOWN_REQUEST_TIMEOUT_MS: '1000',
    BOOKMARKDOWN_HELLO_TIMEOUT_MS: '1000',
  };
  const settingNames = {
    maxPayloadBytes: 'BOOKMARKDOWN_MAX_PAYLOAD_BYTES',
    maxPendingRequests: 'BOOKMARKDOWN_MAX_PENDING_REQUESTS',
    maxConnections: 'BOOKMARKDOWN_MAX_CONNECTIONS',
    maxRegisteredInstances: 'BOOKMARKDOWN_MAX_REGISTERED_INSTANCES',
    requestTimeoutMs: 'BOOKMARKDOWN_REQUEST_TIMEOUT_MS',
    helloTimeoutMs: 'BOOKMARKDOWN_HELLO_TIMEOUT_MS',
    host: 'BOOKMARKDOWN_WS_HOST',
    tlsCertFile: 'BOOKMARKDOWN_WS_TLS_CERT_FILE',
    tlsKeyFile: 'BOOKMARKDOWN_WS_TLS_KEY_FILE',
  };
  for (const [setting, value] of Object.entries(overrides)) {
    const environmentName = settingNames[setting];
    if (environmentName) {
      environment[environmentName] = String(value);
    }
  }
  return environment;
}

async function startDaemonForTest(t, overrides = {}, options = {}) {
  const port = await reservePort();
  const pipeName = uniquePipeName();
  const env = makeEnvironment(port, overrides);
  if (options.omitExtensionIds) {
    delete env.BOOKMARKDOWN_EXTENSION_IDS;
  }
  const daemonResult = await startDaemon({
    env,
    runtimeMode: options.runtimeMode,
    pipeName,
    signalTarget: new EventEmitter(),
    onLog: options.onLog,
  });
  assert.equal(daemonResult.status, 'started');
  if (daemonResult.status !== 'started') {
    throw new Error('Expected a newly started daemon.');
  }

  const client = new IpcClient({
    pipeName,
    connectionAttempts: 1,
    reconnectDelayMs: 0,
    handshakeTimeoutMs: 1000,
    requestTimeoutMs: 2000,
  });
  t.after(async () => {
    client.close();
    await daemonResult.daemon.close();
  });
  return { client, daemon: daemonResult.daemon, pipeName, port };
}

async function reservePort(host = '127.0.0.1') {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

function privateIpv4Address() {
  for (const interfaces of Object.values(networkInterfaces())) {
    const address = interfaces?.find((entry) =>
      entry &&
      !entry.internal &&
      (entry.family === 'IPv4' || entry.family === 4) &&
      isPrivateIpv4Address(entry.address),
    )?.address;
    if (address) {
      return address;
    }
  }
  return undefined;
}

function isPrivateIpv4Address(address) {
  const octets = address.split('.').map(Number);
  const [firstOctet, secondOctet] = octets;
  return firstOctet === 10 ||
    (firstOctet === 172 && secondOctet >= 16 && secondOctet <= 31) ||
    (firstOctet === 192 && secondOctet === 168);
}

function waitForOpen(socket) {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
    socket.once('unexpected-response', (_request, response) => {
      reject(new Error(`WebSocket upgrade rejected with ${response.statusCode}.`));
    });
  });
}

async function getUpgradeStatus(port, origin) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, { origin });
  const status = await new Promise((resolve) => {
    socket.once('unexpected-response', (_request, response) => {
      resolve(response.statusCode);
    });
    socket.once('error', () => resolve(0));
  });
  socket.terminate();
  return status;
}

function nextMessage(socket) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off('message', onMessage);
      socket.off('close', onClose);
      socket.off('error', onError);
    };
    const onMessage = (data, isBinary) => {
      cleanup();
      if (isBinary) {
        reject(new Error('Expected a text WebSocket frame.'));
      } else {
        resolve(data.toString());
      }
    };
    const onClose = () => {
      cleanup();
      reject(new Error('WebSocket closed before a message arrived.'));
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };
    socket.once('message', onMessage);
    socket.once('close', onClose);
    socket.once('error', onError);
  });
}

async function connectExtension(bridge, options = {}) {
  const selectedExtensionId = options.originExtensionId ?? extensionId;
  const socket = new WebSocket(`ws://127.0.0.1:${bridge.port}`, {
    origin: `chrome-extension://${selectedExtensionId}`,
  });
  await waitForOpen(socket);
  const helloPromise = nextMessage(socket);
  socket.send(
    JSON.stringify({
      type: 'hello',
          protocolVersion: '2',
      token,
      appId: 'bmd-extension',
      instanceId: options.instanceId ?? instanceId,
      extensionId: options.extensionId ?? selectedExtensionId,
      browser: 'chrome',
      capabilities: {
        operations: options.operations ?? ['browser.countOpenTabs'],
      },
      ...(options.mode ? {} : { displayName: options.displayName ?? 'otter-fox-panda' }),
      ...(options.mode ? { mode: options.mode } : {}),
      ...(options.token ? { token: options.token } : {}),
      ...(options.protocolVersion
        ? { protocolVersion: options.protocolVersion }
        : {}),
    }),
  );
  const acknowledgement = JSON.parse(await helloPromise);
  return { socket, acknowledgement };
}

function waitForClose(socket) {
  return new Promise((resolve) => {
    if (socket.readyState === WebSocket.CLOSED) {
      resolve();
      return;
    }
    socket.once('close', resolve);
  });
}

function countResponse(requestId, count) {
  return browserSuccessResponse(requestId, {
    count,
    countedAt: new Date().toISOString(),
  });
}

function browserSuccessResponse(requestId, data) {
  return JSON.stringify({
    type: 'browser/response',
    requestId,
    ok: true,
    data,
  });
}

test('logs connection guidance, probes, lifecycle and rejections without credentials', supportedPlatforms, async (t) => {
  const logs = [];
  let disconnected;
  const disconnectedPromise = new Promise((resolve) => { disconnected = resolve; });
  const { client, port } = await startDaemonForTest(t, {}, {
    onLog: (message) => {
      logs.push(message);
      if (message.startsWith('Extension disconnected:')) disconnected();
    },
  });
  const bridge = { port };
  assert.match(logs.join('\n'), new RegExp(`WebSocket URL: ws://127\\.0\\.0\\.1:${port}/`));
  assert.match(logs.join('\n'), /Pairing token: configured \(hidden\)/);
  assert.ok(logs.join('\n').includes(extensionId));
  assert.match(logs.join('\n'), /save, test the connection, then enable/);

  const probe = await connectExtension(bridge, { mode: 'probe', operations: [] });
  t.after(() => probe.socket.terminate());
  assert.equal(probe.acknowledgement.ok, true);
  assert.match(logs.join('\n'), /connection test succeeded/);
  await assert.rejects(
    client.call('devices.list', { includeOffline: true, includeTabCounts: false }),
    { code: 'EXTENSION_NOT_CONNECTED' },
  );
  assert.equal(logs.some((line) => line.startsWith('Extension connected:')), false);

  const connected = await connectExtension(bridge, { displayName: token });
  t.after(() => connected.socket.terminate());
  assert.equal(connected.acknowledgement.ok, true);
  assert.match(logs.join('\n'), /Extension connected: \[redacted\]/);
  connected.socket.close();
  await disconnectedPromise;
  assert.match(logs.join('\n'), /Extension disconnected:/);

  const rejectedToken = 'wrong-token-credential-that-must-not-be-logged';
  const rejected = await connectExtension(bridge, { token: rejectedToken });
  t.after(() => rejected.socket.terminate());
  assert.equal(rejected.acknowledgement.reason, 'unauthorized');
  assert.match(logs.join('\n'), /handshake rejected: unauthorized/);
  const incompatible = await connectExtension(bridge, { protocolVersion: '999' });
  t.after(() => incompatible.socket.terminate());
  assert.equal(incompatible.acknowledgement.reason, 'unsupported-protocol-version');
  assert.match(logs.join('\n'), /compatible protocol versions/);
  assert.equal(await getUpgradeStatus(port, 'https://example.com'), 403);
  assert.match(logs.join('\n'), /Check the WebSocket URL and BOOKMARKDOWN_EXTENSION_IDS/);
  assert.equal(logs.join('\n').includes(token), false);
  assert.equal(logs.join('\n').includes(rejectedToken), false);
});

test('fails daemon startup when the configured WebSocket port is occupied', supportedPlatforms, async () => {
  const occupied = createNetServer();
  await new Promise((resolve, reject) => {
    occupied.once('error', reject);
    occupied.listen(0, '127.0.0.1', resolve);
  });
  const address = occupied.address();
  assert.ok(address && typeof address !== 'string');
  const pipeName = uniquePipeName();

  try {
    await assert.rejects(
      startDaemon({
        env: makeEnvironment(address.port),
        pipeName,
        signalTarget: new EventEmitter(),
      }),
      /EADDRINUSE|already in use/i,
    );
    await assert.rejects(connectLocalPipe(pipeName));
    assert.equal(occupied.listening, true);
  } finally {
    await new Promise((resolve) => occupied.close(resolve));
  }
});

test('rejects wildcard and unencrypted LAN WebSocket bindings', supportedPlatforms, async () => {
  const port = await reservePort();
  const signalTarget = new EventEmitter();
  await assert.rejects(
    startDaemon({
      env: makeEnvironment(port, { host: '0.0.0.0' }),
      pipeName: uniquePipeName(),
      signalTarget,
    }),
    /BOOKMARKDOWN_WS_HOST must be 127\.0\.0\.1 or a private RFC1918 IPv4 address/,
  );
  await assert.rejects(
    startDaemon({
      env: makeEnvironment(port, { host: '192.168.1.10' }),
      pipeName: uniquePipeName(),
      signalTarget,
    }),
    /LAN WebSocket bindings require a TLS certificate and private key/,
  );
});

test('serves an authenticated WSS bridge on a private LAN address', {
  skip: process.platform !== 'linux',
}, async (t) => {
  const host = privateIpv4Address();
  if (!host) {
    t.skip('No private IPv4 interface is available.');
    return;
  }

  const certificateDirectory = await mkdtemp(join(tmpdir(), 'bmd-wss-test-'));
  const certificateFile = join(certificateDirectory, 'cert.pem');
  const privateKeyFile = join(certificateDirectory, 'key.pem');
  let daemon;
  let socket;
  t.after(async () => {
    socket?.terminate();
    await daemon?.close();
    await rm(certificateDirectory, { recursive: true, force: true });
  });
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
    '-keyout', privateKeyFile,
    '-out', certificateFile,
    '-days', '1',
    '-subj', '/CN=BookMarkdown test',
  ], { stdio: 'ignore' });

  const port = await reservePort(host);
  const env = makeEnvironment(port, {
    host,
    tlsCertFile: certificateFile,
    tlsKeyFile: privateKeyFile,
  });
  const result = await startDaemon({
    env,
    pipeName: uniquePipeName(),
    signalTarget: new EventEmitter(),
  });
  assert.equal(result.status, 'started');
  if (result.status !== 'started') {
    throw new Error('Expected a newly started daemon.');
  }
  daemon = result.daemon;

  socket = new WebSocket(daemon.webSocketUrl, {
    origin: `chrome-extension://${extensionId}`,
    rejectUnauthorized: false,
  });
  await waitForOpen(socket);
  const acknowledgement = nextMessage(socket);
  socket.send(JSON.stringify({
    type: 'hello',
    protocolVersion: '2',
    token,
    appId: 'bmd-extension',
    instanceId,
    displayName: 'otter-fox-panda',
    extensionId,
    browser: 'chrome',
    capabilities: { operations: ['browser.countOpenTabs'] },
  }));
  assert.equal(JSON.parse(await acknowledgement).ok, true);
});

test('routes a daemon tool call through the proposal-shaped WebSocket RPC', supportedPlatforms, async (t) => {
  const bridge = await startDaemonForTest(t);
  let socket;

  try {
    const extension = new WebSocket(`ws://127.0.0.1:${bridge.port}`, {
      origin: `chrome-extension://${extensionId}`,
    });
    socket = extension;
    await waitForOpen(extension);
    const acknowledgementPromise = nextMessage(extension);
    extension.send(
      JSON.stringify({
        type: 'hello',
            protocolVersion: '2',
        token,
        appId: 'bmd-extension',
        instanceId,
            displayName: 'otter-fox-panda',
        extensionId,
        browser: 'chrome',
        capabilities: { operations: ['browser.countOpenTabs'] },
      }),
    );
    const acknowledgement = JSON.parse(await acknowledgementPromise);
    assert.equal(acknowledgement.ok, true);
    assert.equal(acknowledgement.protocolVersion, '2');

    const call = bridge.client.call('browser.countOpenTabs', { instanceId });
    const request = JSON.parse(await nextMessage(extension));
    assert.equal(request.type, 'browser/request');
    assert.equal(request.operation, 'browser.countOpenTabs');
    assert.deepEqual(request.payload, {});
    extension.send(countResponse(request.requestId, 5));

    const count = await call;
    assert.equal(count.count, 5);
    assert.ok(Number.isFinite(Date.parse(count.countedAt)));
  } finally {
    socket?.close();
  }
});

test('routes allowlisted browser operations with exact payloads and validated results', supportedPlatforms, async (t) => {
  const bridge = await startDaemonForTest(t);
  const operations = [
    'browser.countOpenTabs',
    'browser.countOpenWindows',
    'browser.listTabs',
    'browser.openTab',
    'browser.closeTab',
    'browser.moveTab',
  ];
  const extension = await connectExtension(bridge, { instanceId, operations });
  const countedAt = new Date().toISOString();
  const tab = {
    tabId: 12,
    windowId: 7,
    active: true,
    title: 'Example',
    url: 'https://example.invalid/',
  };
  const cases = [
    {
      toolName: 'browser.countOpenTabs',
      arguments: { instanceId },
      operation: 'browser.countOpenTabs',
      payload: {},
      result: { count: 5, countedAt },
    },
    {
      toolName: 'browser.countOpenWindows',
      arguments: { instanceId },
      operation: 'browser.countOpenWindows',
      payload: {},
      result: { count: 2, countedAt },
    },
    {
      toolName: 'browser.listTabs',
      arguments: { instanceId, limit: 2, offset: 4 },
      operation: 'browser.listTabs',
      payload: { limit: 2, offset: 4 },
      result: {
        tabs: [tab, { ...tab, tabId: 13, active: false }],
        nextOffset: 6,
        queriedAt: countedAt,
      },
    },
    {
      toolName: 'browser.openTab',
      arguments: {
        instanceId,
        url: 'https://example.invalid/new',
        windowId: 7,
      },
      operation: 'browser.openTab',
      payload: { url: 'https://example.invalid/new', windowId: 7 },
      result: { tabId: 14, windowId: 7, url: 'https://example.invalid/new' },
    },
    {
      toolName: 'browser.openTab',
      arguments: { instanceId },
      operation: 'browser.openTab',
      payload: {},
      result: { tabId: 15, windowId: 7, url: 'about:blank' },
    },
    {
      toolName: 'browser.closeTab',
      arguments: { instanceId, tabId: 12 },
      operation: 'browser.closeTab',
      payload: { tabId: 12 },
      result: { tabId: 12, closed: true },
    },
    {
      toolName: 'browser.moveTab',
      arguments: { instanceId, tabId: 12, targetWindowId: 9 },
      operation: 'browser.moveTab',
      payload: { tabId: 12, targetWindowId: 9 },
      result: { tabId: 12, sourceWindowId: 7, targetWindowId: 9 },
    },
  ];

  for (const callCase of cases) {
    const pending = bridge.client.call(callCase.toolName, callCase.arguments);
    const request = JSON.parse(await nextMessage(extension.socket));
    assert.equal(request.type, 'browser/request');
    assert.equal(request.operation, callCase.operation);
    assert.deepEqual(request.payload, callCase.payload);
    extension.socket.send(browserSuccessResponse(request.requestId, callCase.result));
    assert.deepEqual(await pending, callCase.result);
  }
});

test('rejects an operation the connected instance did not advertise', supportedPlatforms, async (t) => {
  const bridge = await startDaemonForTest(t);
  const extension = await connectExtension(bridge, { instanceId });

  await assert.rejects(
    bridge.client.call('browser.countOpenWindows', { instanceId }),
    { code: 'UNSUPPORTED_OPERATION' },
  );
  extension.socket.close();
});

test('rejects invalid pagination and mismatched tab-operation results', supportedPlatforms, async (t) => {
  const bridge = await startDaemonForTest(t);
  const extension = await connectExtension(bridge, {
    instanceId,
    operations: [
      'browser.listTabs',
      'browser.openTab',
      'browser.closeTab',
      'browser.moveTab',
    ],
  });
  const queriedAt = new Date().toISOString();
  const tab = {
    tabId: 12,
    windowId: 7,
    active: true,
    title: 'Example',
    url: 'https://example.invalid/',
  };

  const listTabs = bridge.client.call('browser.listTabs', {
    instanceId,
    limit: 2,
    offset: 4,
  });
  const listRequest = JSON.parse(await nextMessage(extension.socket));
  extension.socket.send(
    browserSuccessResponse(listRequest.requestId, {
          tabs: [tab, { ...tab, tabId: 13, active: false }],
      nextOffset: 5,
      queriedAt,
    }),
  );
  await assert.rejects(listTabs, { code: 'INVALID_EXTENSION_RESPONSE' });

  const closeTab = bridge.client.call('browser.closeTab', { instanceId, tabId: 12 });
  const closeRequest = JSON.parse(await nextMessage(extension.socket));
  extension.socket.send(
    browserSuccessResponse(closeRequest.requestId, { tabId: 13, closed: true }),
  );
  await assert.rejects(closeTab, { code: 'INVALID_EXTENSION_RESPONSE' });

  const openTab = bridge.client.call('browser.openTab', {
    instanceId,
    url: 'https://example.invalid/',
    windowId: 7,
  });
  const openRequest = JSON.parse(await nextMessage(extension.socket));
  extension.socket.send(
    browserSuccessResponse(openRequest.requestId, {
      tabId: 14,
      windowId: 8,
      url: 'https://example.invalid/',
    }),
  );
  await assert.rejects(openTab, { code: 'INVALID_EXTENSION_RESPONSE' });

  const moveTab = bridge.client.call('browser.moveTab', {
    instanceId,
    tabId: 12,
    targetWindowId: 9,
  });
  const moveRequest = JSON.parse(await nextMessage(extension.socket));
  extension.socket.send(
    browserSuccessResponse(moveRequest.requestId, {
      tabId: 12,
      sourceWindowId: 9,
      targetWindowId: 9,
    }),
  );
  await assert.rejects(moveTab, { code: 'INVALID_EXTENSION_RESPONSE' });
  extension.socket.close();
});

for (const runtimeMode of ['production', 'development']) {
  const modeOptions = {
    runtimeMode,
    omitExtensionIds: runtimeMode === 'development',
  };

  test(`rejects invalid Origins in ${runtimeMode} mode`, supportedPlatforms, async (t) => {
    const bridge = await startDaemonForTest(t, {}, modeOptions);
    const invalidOrigins = [
      'https://example.com',
      `chrome-extension://${'q'.repeat(32)}`,
    ];

    for (const origin of invalidOrigins) {
      assert.equal(await getUpgradeStatus(bridge.port, origin), 403);
    }
  });

  test(`requires the pairing token and matching hello ID in ${runtimeMode} mode`, supportedPlatforms, async (t) => {
    const bridge = await startDaemonForTest(t, {}, modeOptions);
    const originExtensionId =
      runtimeMode === 'development' ? unlistedExtensionId : extensionId;
    const invalidToken = await connectExtension(bridge, {
      originExtensionId,
      token: 'not-the-pairing-token',
    });
    assert.equal(invalidToken.acknowledgement.ok, false);
    assert.equal(invalidToken.acknowledgement.reason, 'unauthorized');
    await waitForClose(invalidToken.socket);

    const mismatchedExtensionId =
      originExtensionId === extensionId ? secondExtensionId : extensionId;
    const mismatchedHello = await connectExtension(bridge, {
      originExtensionId,
      extensionId: mismatchedExtensionId,
    });
    assert.equal(mismatchedHello.acknowledgement.ok, false);
    assert.equal(mismatchedHello.acknowledgement.reason, 'extension-id-mismatch');
    await waitForClose(mismatchedHello.socket);

    const accepted = await connectExtension(bridge, { originExtensionId });
    assert.equal(accepted.acknowledgement.ok, true);
    accepted.socket.close();
    await waitForClose(accepted.socket);
  });
}

test('production rejects a valid extension ID outside its exact allowlist', supportedPlatforms, async (t) => {
  const bridge = await startDaemonForTest(t);
  assert.equal(
    await getUpgradeStatus(
      bridge.port,
      `chrome-extension://${unlistedExtensionId}`,
    ),
    403,
  );
});

test('authenticates hello and keeps probe connections out of the instance registry', supportedPlatforms, async (t) => {
  const bridge = await startDaemonForTest(t);
  const invalid = await connectExtension(bridge, { token: 'not-the-pairing-token' });
  assert.equal(invalid.acknowledgement.ok, false);
  assert.equal(invalid.acknowledgement.reason, 'unauthorized');
  assert.equal(JSON.stringify(invalid.acknowledgement).includes(token), false);

  const probe = await connectExtension(bridge, {
    mode: 'probe',
    operations: [],
    instanceId: secondInstanceId,
  });
  assert.deepEqual(probe.acknowledgement, {
    type: 'hello-ack',
    mode: 'probe',
    ok: true,
    protocolVersion: '2',
  });
  await waitForClose(probe.socket);
  await assert.rejects(
    bridge.client.call('devices.list', {
      includeOffline: true,
      includeTabCounts: false,
    }),
    { code: 'EXTENSION_NOT_CONNECTED' },
  );
});

test('matches out-of-order responses to the originating extension instance', supportedPlatforms, async (t) => {
  const bridge = await startDaemonForTest(t);
  const first = await connectExtension(bridge, { instanceId });
  const second = await connectExtension(bridge, {
    instanceId: secondInstanceId,
    originExtensionId: secondExtensionId,
  });
  assert.equal(first.acknowledgement.ok, true);
  assert.equal(second.acknowledgement.ok, true);

  const firstResult = bridge.client.call('browser.countOpenTabs', { instanceId });
  const firstRequest = JSON.parse(await nextMessage(first.socket));
  const secondResult = bridge.client.call('browser.countOpenTabs', {
    instanceId: secondInstanceId,
  });
  const secondRequest = JSON.parse(await nextMessage(second.socket));

  second.socket.send(countResponse(secondRequest.requestId, 9));
  first.socket.send(countResponse(firstRequest.requestId, 3));
  assert.equal((await firstResult).count, 3);
  assert.equal((await secondResult).count, 9);
});

test('ignores a valid response ID sent from the wrong extension socket', supportedPlatforms, async (t) => {
  const bridge = await startDaemonForTest(t);
  const first = await connectExtension(bridge, { instanceId });
  const second = await connectExtension(bridge, {
    instanceId: secondInstanceId,
    originExtensionId: secondExtensionId,
  });
  t.after(() => { first.socket.terminate(); second.socket.terminate(); });
  const pending = bridge.client.call('browser.countOpenTabs', { instanceId });
  const request = JSON.parse(await nextMessage(first.socket));
  second.socket.send(countResponse(request.requestId, 99));
  const other = bridge.client.call('browser.countOpenTabs', { instanceId: secondInstanceId });
  const otherRequest = JSON.parse(await nextMessage(second.socket));
  second.socket.send(countResponse(otherRequest.requestId, 2));
  assert.equal((await other).count, 2);
  let timer;
  try {
    assert.equal(await Promise.race([
      pending.then(() => 'settled'),
      new Promise((resolve) => { timer = setTimeout(() => resolve('pending'), 50); }),
    ]), 'pending');
  } finally {
    clearTimeout(timer);
  }
  first.socket.send(countResponse(request.requestId, 3));
  assert.equal((await pending).count, 3);
});

test('never replays open, close, or move after timeout, cancellation, or late replies', supportedPlatforms, async (t) => {
  const bridge = await startDaemonForTest(t, { requestTimeoutMs: 100 });
  const operations = ['browser.openTab', 'browser.closeTab', 'browser.moveTab'];
  const extension = await connectExtension(bridge, { instanceId, operations });
  t.after(() => extension.socket.terminate());
  const frames = [];
  extension.socket.on('message', (data) => {
    const frame = JSON.parse(data.toString('utf8'));
    if (frame.type === 'browser/request') frames.push(frame);
  });
  const cases = [
    { name: 'browser.openTab', args: { instanceId, url: 'https://example.invalid/private' }, result: { tabId: 12, windowId: 7, url: 'https://example.invalid/private' } },
    { name: 'browser.closeTab', args: { instanceId, tabId: 12 }, result: { tabId: 12, closed: true } },
    { name: 'browser.moveTab', args: { instanceId, tabId: 12, targetWindowId: 9 }, result: { tabId: 12, sourceWindowId: 7, targetWindowId: 9 } },
  ];

  for (const operation of cases) {
    const before = frames.length;
    const timed = bridge.client.call(operation.name, operation.args);
    const timeoutAssertion = assert.rejects(timed, { code: 'REQUEST_TIMEOUT' });
    const timedFrame = JSON.parse(await nextMessage(extension.socket));
    assert.equal(timedFrame.operation, operation.name);
    await timeoutAssertion;
    extension.socket.send(browserSuccessResponse(timedFrame.requestId, operation.result));

    const controller = new AbortController();
    const cancelled = bridge.client.call(operation.name, operation.args, controller.signal);
    const cancelAssertion = assert.rejects(cancelled, { code: 'REQUEST_CANCELLED' });
    const cancelledFrame = JSON.parse(await nextMessage(extension.socket));
    controller.abort();
    await cancelAssertion;
    extension.socket.send(browserSuccessResponse(cancelledFrame.requestId, operation.result));

    const recovered = bridge.client.call(operation.name, operation.args);
    const recoveryFrame = JSON.parse(await nextMessage(extension.socket));
    assert.notEqual(recoveryFrame.requestId, timedFrame.requestId);
    assert.notEqual(recoveryFrame.requestId, cancelledFrame.requestId);
    extension.socket.send(browserSuccessResponse(recoveryFrame.requestId, operation.result));
    assert.deepEqual(await recovered, operation.result);
    assert.equal(frames.length - before, 3);
  }
});

test('aggregates live device counts using the proposal result shape', supportedPlatforms, async (t) => {
  const bridge = await startDaemonForTest(t);
  const extension = await connectExtension(bridge, { instanceId });
  const list = bridge.client.call('devices.list', {
    includeOffline: true,
    includeTabCounts: true,
  });
  const request = JSON.parse(await nextMessage(extension.socket));
  extension.socket.send(countResponse(request.requestId, 4));

  const result = await list;
  assert.equal(result.instances.length, 1);
  assert.equal(result.instances[0].instanceId, instanceId);
  assert.equal(result.instances[0].status, 'online');
  assert.equal(result.instances[0].displayName, 'otter-fox-panda');
  assert.equal(result.instances[0].countStatus, 'ok');
  assert.equal(result.instances[0].tabCount, 4);
  assert.deepEqual(result.instances[0].capabilities.operations, [
    'browser.countOpenTabs',
  ]);
  assert.equal(result.totalTabs, 4);
  assert.equal(result.complete, true);
});

test('assigns unique device aliases and lists the assigned alias with each UUID', supportedPlatforms, async (t) => {
  const bridge = await startDaemonForTest(t);
  const first = await connectExtension(bridge, { displayName: '工作桌機 2' });
  const second = await connectExtension(bridge, {
    instanceId: secondInstanceId,
    originExtensionId: secondExtensionId,
    displayName: '工作桌機 2',
  });
  t.after(() => { first.socket.terminate(); second.socket.terminate(); });

  assert.equal(first.acknowledgement.displayName, '工作桌機 2');
  assert.equal(second.acknowledgement.displayName, '工作桌機 2-2');

  const result = await bridge.client.call('devices.list', {
    includeOffline: true,
    includeTabCounts: false,
  });
  assert.deepEqual(
    result.instances.map(({instanceId: id, displayName}) => ({instanceId: id, displayName})),
    [
      {instanceId, displayName: '工作桌機 2'},
      {instanceId: secondInstanceId, displayName: '工作桌機 2-2'},
    ],
  );
});

test('bounds in-flight calls and settles pending requests on timeout or disconnect', supportedPlatforms, async (t) => {
  const bridge = await startDaemonForTest(t, {
    maxPendingRequests: 1,
    requestTimeoutMs: 100,
  });
  const extension = await connectExtension(bridge, { instanceId });
  const timedRequest = bridge.client.call('browser.countOpenTabs', { instanceId });
  const timeoutAssertion = assert.rejects(timedRequest, { code: 'REQUEST_TIMEOUT' });
  await nextMessage(extension.socket);
  await assert.rejects(
    bridge.client.call('browser.countOpenTabs', { instanceId }),
    { code: 'BRIDGE_BUSY' },
  );
  await timeoutAssertion;

  const disconnectedRequest = bridge.client.call('browser.countOpenTabs', {
    instanceId,
  });
  const disconnectAssertion = assert.rejects(disconnectedRequest, {
    code: 'EXTENSION_DISCONNECTED',
  });
  await nextMessage(extension.socket);
  const closed = waitForClose(extension.socket);
  extension.socket.close();
  await closed;
  await disconnectAssertion;
});

test('cancels local waiting and ignores a late response without sending an unproposed cancel frame', supportedPlatforms, async (t) => {
  const bridge = await startDaemonForTest(t);
  const extension = await connectExtension(bridge, { instanceId });
  const controller = new AbortController();
  const cancelledRequest = bridge.client.call(
    'browser.countOpenTabs',
    { instanceId },
    controller.signal,
  );
  const cancellationAssertion = assert.rejects(cancelledRequest, {
    code: 'REQUEST_CANCELLED',
  });
  const cancelledFrame = JSON.parse(await nextMessage(extension.socket));
  controller.abort();
  await cancellationAssertion;

  const nextRequestPromise = bridge.client.call('browser.countOpenTabs', {
    instanceId,
  });
  const nextFrame = JSON.parse(await nextMessage(extension.socket));
  extension.socket.send(countResponse(cancelledFrame.requestId, 99));
  extension.socket.send(countResponse(nextFrame.requestId, 6));
  assert.equal((await nextRequestPromise).count, 6);
});

test('rejects oversized WebSocket frames', supportedPlatforms, async (t) => {
  const bridge = await startDaemonForTest(t, { maxPayloadBytes: 4096 });
  const extension = await connectExtension(bridge, { instanceId });
  const closed = new Promise((resolve) => {
    extension.socket.once('close', (code) => resolve(code));
  });
  extension.socket.send('x'.repeat(5000));
  assert.equal(await closed, 1009);
});
