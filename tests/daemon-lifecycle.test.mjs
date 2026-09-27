import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import test from 'node:test';
import { WebSocket } from 'ws';
import { DAEMON_PACKAGE_VERSION, startDaemon } from '../dist/daemon/service.js';
import {
  IPC_PROTOCOL_VERSION,
  ipcMessageSchema,
} from '../dist/ipc/protocol.js';
import {
  DEFAULT_IPC_MAX_PAYLOAD_BYTES,
  IpcFrameDecoder,
  encodeIpcFrame,
} from '../dist/ipc/framing.js';
import {
  connectLocalPipe,
} from '../dist/ipc/transport.js';

const windowsOnly = {
  skip:
    process.platform === 'win32'
      ? false
      : 'Daemon lifecycle tests require Windows Named Pipes.',
};
const extensionId = 'a'.repeat(32);
const token = '0123456789abcdef0123456789abcdef0123456789abcdef';
function uniquePipeName() {
  return `bookmarkdown-daemon-${process.pid}-${randomUUID()}`;
}

function makeEnvironment(port, overrides = {}) {
  return {
    BOOKMARKDOWN_BRIDGE_TOKEN: token,
    BOOKMARKDOWN_EXTENSION_IDS: extensionId,
    BOOKMARKDOWN_WS_PORT: String(port),
    BOOKMARKDOWN_MAX_CONNECTIONS: '2',
    BOOKMARKDOWN_MAX_PENDING_REQUESTS: '1',
    BOOKMARKDOWN_REQUEST_TIMEOUT_MS: '2000',
    BOOKMARKDOWN_HELLO_TIMEOUT_MS: '1000',
    ...overrides,
  };
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

async function listenAt(server, port = 0) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return address.port;
}

async function closeServer(server) {
  if (!server.listening) {
    return;
  }
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

function createIpcClient(socket) {
  const decoder = new IpcFrameDecoder(DEFAULT_IPC_MAX_PAYLOAD_BYTES);
  const messages = [];
  const waiters = [];
  let failure;

  const fail = (error) => {
    failure ??= error;
    for (const waiter of waiters.splice(0)) {
      waiter.reject(failure);
    }
  };

  socket.on('data', (chunk) => {
    try {
      for (const message of decoder.push(chunk)) {
        assert.equal(ipcMessageSchema.safeParse(message).success, true);
        const waiter = waiters.shift();
        if (waiter) {
          waiter.resolve(message);
        } else {
          messages.push(message);
        }
      }
    } catch (error) {
      fail(error);
      socket.destroy();
    }
  });
  socket.on('error', fail);
  socket.once('close', () => fail(new Error('IPC connection closed.')));

  return {
    socket,
    send(message) {
      socket.write(encodeIpcFrame(message));
    },
    next() {
      if (messages.length > 0) {
        return Promise.resolve(messages.shift());
      }
      if (failure) {
        return Promise.reject(failure);
      }
      return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
    },
  };
}

async function connectDaemon(pipeName, hello = {}) {
  const client = createIpcClient(await connectLocalPipe(pipeName));
  client.send({
    type: 'hello',
    protocolVersion: IPC_PROTOCOL_VERSION,
    packageVersion: DAEMON_PACKAGE_VERSION,
    ...hello,
  });
  const helloResponse = await client.next();
  return { ...client, helloResponse };
}

async function waitForClose(socket) {
  if (socket.destroyed) {
    return;
  }
  await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Socket did not close within the test deadline.')),
      2000,
    );
    socket.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function waitForCondition(condition) {
  const deadline = Date.now() + 2000;
  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error('Condition was not reached within the test deadline.');
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
}

async function closeSocket(socket) {
  if (socket.destroyed) {
    return;
  }
  const closed = waitForClose(socket);
  socket.destroy();
  await closed;
}

async function startTestDaemon(t, overrides = {}, options = {}) {
  const port = await reservePort();
  const pipeName = options.pipeName ?? uniquePipeName();
  const env = makeEnvironment(port, overrides);
  const signalTarget = new EventEmitter();
  const result = await startDaemon({
    env,
    runtimeMode: options.runtimeMode,
    pipeName,
    signalTarget,
    shutdownDrainMs: options.shutdownDrainMs,
  });
  assert.equal(result.status, 'started');
  if (result.status !== 'started') {
    throw new Error('Expected a newly started daemon.');
  }
  t.after(() => result.daemon.close());
  return { daemon: result.daemon, env, pipeName, port, signalTarget };
}

function waitForWebSocketOpen(socket) {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
}

function nextWebSocketMessage(socket) {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off('message', onMessage);
      socket.off('close', onClose);
      socket.off('error', onError);
    };
    const onMessage = (data, isBinary) => {
      cleanup();
      if (isBinary) {
        reject(new Error('Expected a text WebSocket message.'));
      } else {
        resolve(JSON.parse(data.toString()));
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

async function connectExtension(port) {
  const instanceId = randomUUID();
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, {
    origin: `chrome-extension://${extensionId}`,
  });
  await waitForWebSocketOpen(socket);
  const acknowledgement = nextWebSocketMessage(socket);
  socket.send(
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
  assert.equal((await acknowledgement).ok, true);
  return { socket, instanceId };
}

function countTabsResponse(requestId) {
  return {
    type: 'browser/response',
    requestId,
    ok: true,
    data: { count: 5, countedAt: new Date().toISOString() },
  };
}

test(
  'starts both listeners and serves hello, health, and tools/call',
  windowsOnly,
  async (t) => {
    const { daemon, pipeName, port } = await startTestDaemon(t);
    assert.equal(daemon.status, 'ready');
    assert.equal(daemon.webSocketPort, port);

    const client = await connectDaemon(pipeName);
    t.after(() => closeSocket(client.socket));
    assert.deepEqual(client.helloResponse, {
      type: 'hello.response',
      protocolVersion: IPC_PROTOCOL_VERSION,
      packageVersion: DAEMON_PACKAGE_VERSION,
      status: 'ready',
    });

    const healthRequestId = randomUUID();
    client.send({ type: 'health', requestId: healthRequestId });
    assert.deepEqual(await client.next(), {
      type: 'health.response',
      requestId: healthRequestId,
      status: {
        protocolVersion: IPC_PROTOCOL_VERSION,
        packageVersion: DAEMON_PACKAGE_VERSION,
        runtimeMode: 'production',
        daemonStatus: 'ready',
        extensionStatus: 'not_connected',
      },
    });

    const requestId = randomUUID();
    client.send({
      type: 'call',
      requestId,
      toolName: 'devices.list',
      arguments: { includeOffline: false, includeTabCounts: false },
    });
    assert.deepEqual(await client.next(), {
      type: 'response',
      requestId,
      ok: false,
      error: { code: 'EXTENSION_NOT_CONNECTED' },
    });
  },
);

test(
  'rejects invalid startup and rolls back listeners on WebSocket or IPC failure',
  windowsOnly,
  async () => {
    await assert.rejects(
      startDaemon({
        env: {},
        pipeName: uniquePipeName(),
        signalTarget: new EventEmitter(),
      }),
      /BOOKMARKDOWN_BRIDGE_TOKEN is required/,
    );

    const ipcFailurePort = await reservePort();
    await assert.rejects(
      startDaemon({
        env: makeEnvironment(ipcFailurePort),
        pipeName: 'invalid/pipe/name',
        signalTarget: new EventEmitter(),
      }),
      /Named pipe names must start with a letter or digit/,
    );
    const rebound = createNetServer();
    await listenAt(rebound, ipcFailurePort);
    await closeServer(rebound);

    const occupied = createNetServer();
    const occupiedPort = await listenAt(occupied);
    const pipeName = uniquePipeName();
    try {
      await assert.rejects(
        startDaemon({
          env: makeEnvironment(occupiedPort),
          pipeName,
          signalTarget: new EventEmitter(),
        }),
        /EADDRINUSE|already in use/i,
      );
      await assert.rejects(connectLocalPipe(pipeName));
      assert.equal(occupied.listening, true);
    } finally {
      await closeServer(occupied);
    }
  },
);

test(
  'reports version mismatches and detects a healthy duplicate at client capacity',
  windowsOnly,
  async (t) => {
    const { daemon, env, pipeName, signalTarget } = await startTestDaemon(t, {
      BOOKMARKDOWN_MAX_CONNECTIONS: '1',
    });
    const client = await connectDaemon(pipeName);
    t.after(() => closeSocket(client.socket));

    const packageMismatch = await connectDaemon(pipeName, {
      packageVersion: '99.0.0',
    });
    assert.equal(packageMismatch.helloResponse.status, 'package_version_mismatch');
    await waitForClose(packageMismatch.socket);

    const protocolMismatch = await connectDaemon(pipeName, {
      protocolVersion: IPC_PROTOCOL_VERSION + 1,
    });
    assert.equal(protocolMismatch.helloResponse.status, 'protocol_version_mismatch');
    await waitForClose(protocolMismatch.socket);

    const duplicate = await startDaemon({ env, pipeName, signalTarget });
    assert.deepEqual(duplicate, { status: 'already_running' });
    assert.equal(daemon.status, 'ready');
    await waitForCondition(() => daemon.clientCount === 1);

    const overCapacity = await connectDaemon(pipeName);
    const overCapacityId = randomUUID();
    overCapacity.send({
      type: 'call',
      requestId: overCapacityId,
      toolName: 'devices.list',
      arguments: { includeOffline: false, includeTabCounts: false },
    });
    assert.deepEqual(await overCapacity.next(), {
      type: 'response',
      requestId: overCapacityId,
      ok: false,
      error: { code: 'BRIDGE_BUSY' },
    });
    await waitForClose(overCapacity.socket);
    await waitForCondition(() => daemon.clientCount === 1);

    const reservedProbe = await connectLocalPipe(pipeName);
    await waitForCondition(() => daemon.clientCount === 2);
    const overflow = await connectLocalPipe(pipeName).catch(() => undefined);
    if (overflow) {
      await waitForClose(overflow);
    }
    assert.equal(daemon.clientCount, 2);
    await closeSocket(reservedProbe);
  },
);

test(
  'does not treat a healthy daemon in another runtime mode as a duplicate',
  windowsOnly,
  async (t) => {
    const { daemon, env, pipeName } = await startTestDaemon(t, {}, {
      runtimeMode: 'development',
    });
    const client = await connectDaemon(pipeName);
    t.after(() => closeSocket(client.socket));
    const healthRequestId = randomUUID();
    client.send({ type: 'health', requestId: healthRequestId });
    assert.deepEqual(await client.next(), {
      type: 'health.response',
      requestId: healthRequestId,
      status: {
        protocolVersion: IPC_PROTOCOL_VERSION,
        packageVersion: DAEMON_PACKAGE_VERSION,
        runtimeMode: 'development',
        daemonStatus: 'ready',
        extensionStatus: 'not_connected',
      },
    });

    await assert.rejects(
      startDaemon({
        env,
        runtimeMode: 'production',
        pipeName,
        signalTarget: new EventEmitter(),
      }),
      /EADDRINUSE|already in use/i,
    );
    assert.equal(daemon.status, 'ready');
  },
);

test(
  'bounds pending calls, supports cancellation, and drains on SIGINT',
  windowsOnly,
  async (t) => {
    const { daemon, pipeName, port, signalTarget } = await startTestDaemon(t, {
      BOOKMARKDOWN_MAX_PENDING_REQUESTS: '1',
    });
    const client = await connectDaemon(pipeName);
    t.after(() => closeSocket(client.socket));
    const { socket: extension, instanceId } = await connectExtension(port);
    t.after(
      () =>
        new Promise((resolve) => {
          if (extension.readyState === WebSocket.CLOSED) {
            resolve();
          } else {
            extension.once('close', resolve);
            extension.terminate();
          }
        }),
    );

    const cancelledId = randomUUID();
    client.send({
      type: 'call',
      requestId: cancelledId,
      toolName: 'browser.countOpenTabs',
      arguments: { instanceId },
    });
    const browserRequest = await nextWebSocketMessage(extension);

    const busyId = randomUUID();
    client.send({
      type: 'call',
      requestId: busyId,
      toolName: 'browser.countOpenTabs',
      arguments: { instanceId },
    });
    assert.deepEqual(await client.next(), {
      type: 'response',
      requestId: busyId,
      ok: false,
      error: { code: 'BRIDGE_BUSY' },
    });

    const cancelledResponse = client.next();
    client.send({ type: 'cancel', requestId: cancelledId });
    assert.deepEqual(await cancelledResponse, {
      type: 'response',
      requestId: cancelledId,
      ok: false,
      error: { code: 'REQUEST_CANCELLED' },
    });
    extension.send(JSON.stringify(countTabsResponse(browserRequest.requestId)));
    await waitForCondition(() => daemon.pendingCallCount === 0);

    const drainedId = randomUUID();
    const drainedResponse = client.next();
    client.send({
      type: 'call',
      requestId: drainedId,
      toolName: 'browser.countOpenTabs',
      arguments: { instanceId },
    });
    const drainedBrowserRequest = await nextWebSocketMessage(extension);

    signalTarget.emit('SIGINT');
    const shutdownStartedAt = Date.now();
    const shutdown = daemon.close();
    extension.send(
      JSON.stringify(countTabsResponse(drainedBrowserRequest.requestId)),
    );
    const drained = await drainedResponse;
    assert.equal(drained.type, 'response');
    assert.equal(drained.requestId, drainedId);
    assert.equal(drained.ok, true);
    assert.equal(drained.result.count, 5);
    assert.ok(Number.isFinite(Date.parse(drained.result.countedAt)));
    await shutdown;
    assert.ok(Date.now() - shutdownStartedAt < 2000);
    assert.equal(daemon.status, 'closed');
    assert.equal(daemon.clientCount, 0);
    assert.equal(daemon.pendingCallCount, 0);
    await assert.rejects(connectLocalPipe(pipeName));

    const rebound = createNetServer();
    await listenAt(rebound, port);
    await closeServer(rebound);
  },
);