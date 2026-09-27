import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
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
const windowsOnly = {
  skip:
    process.platform === 'win32'
      ? false
      : 'Daemon bridge tests require Windows Named Pipes.',
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

async function reservePort() {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
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
      protocolVersion: '1',
      token,
      appId: 'bmd-extension',
      instanceId: options.instanceId ?? instanceId,
      extensionId: options.extensionId ?? selectedExtensionId,
      browser: 'chrome',
      capabilities: {
        operations: options.operations ?? ['browser.countOpenTabs'],
      },
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

test('fails daemon startup when the configured WebSocket port is occupied', windowsOnly, async () => {
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

test('routes a daemon tool call through the proposal-shaped WebSocket RPC', windowsOnly, async (t) => {
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
        protocolVersion: '1',
        token,
        appId: 'bmd-extension',
        instanceId,
        extensionId,
        browser: 'chrome',
        capabilities: { operations: ['browser.countOpenTabs'] },
      }),
    );
    const acknowledgement = JSON.parse(await acknowledgementPromise);
    assert.equal(acknowledgement.ok, true);
    assert.equal(acknowledgement.protocolVersion, '1');

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

test('routes allowlisted browser operations with exact payloads and validated results', windowsOnly, async (t) => {
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

test('rejects an operation the connected instance did not advertise', windowsOnly, async (t) => {
  const bridge = await startDaemonForTest(t);
  const extension = await connectExtension(bridge, { instanceId });

  await assert.rejects(
    bridge.client.call('browser.countOpenWindows', { instanceId }),
    { code: 'UNSUPPORTED_OPERATION' },
  );
  extension.socket.close();
});

test('rejects invalid pagination and mismatched tab-operation results', windowsOnly, async (t) => {
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
      tabs: [tab],
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

  test(`rejects invalid Origins in ${runtimeMode} mode`, windowsOnly, async (t) => {
    const bridge = await startDaemonForTest(t, {}, modeOptions);
    const invalidOrigins = [
      'https://example.com',
      `chrome-extension://${'q'.repeat(32)}`,
    ];

    for (const origin of invalidOrigins) {
      assert.equal(await getUpgradeStatus(bridge.port, origin), 403);
    }
  });

  test(`requires the pairing token and matching hello ID in ${runtimeMode} mode`, windowsOnly, async (t) => {
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

test('production rejects a valid extension ID outside its exact allowlist', windowsOnly, async (t) => {
  const bridge = await startDaemonForTest(t);
  assert.equal(
    await getUpgradeStatus(
      bridge.port,
      `chrome-extension://${unlistedExtensionId}`,
    ),
    403,
  );
});

test('authenticates hello and keeps probe connections out of the instance registry', windowsOnly, async (t) => {
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
    protocolVersion: '1',
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

test('matches out-of-order responses to the originating extension instance', windowsOnly, async (t) => {
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

test('aggregates live device counts using the proposal result shape', windowsOnly, async (t) => {
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
  assert.equal(result.instances[0].displayName, null);
  assert.equal(result.instances[0].countStatus, 'ok');
  assert.equal(result.instances[0].tabCount, 4);
  assert.deepEqual(result.instances[0].capabilities.operations, [
    'browser.countOpenTabs',
  ]);
  assert.equal(result.totalTabs, 4);
  assert.equal(result.complete, true);
});

test('bounds in-flight calls and settles pending requests on timeout or disconnect', windowsOnly, async (t) => {
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

test('cancels local waiting and ignores a late response without sending an unproposed cancel frame', windowsOnly, async (t) => {
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

test('rejects oversized WebSocket frames', windowsOnly, async (t) => {
  const bridge = await startDaemonForTest(t, { maxPayloadBytes: 4096 });
  const extension = await connectExtension(bridge, { instanceId });
  const closed = new Promise((resolve) => {
    extension.socket.once('close', (code) => resolve(code));
  });
  extension.socket.send('x'.repeat(5000));
  assert.equal(await closed, 1009);
});