import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { IpcClient } from '../dist/ipc/client.js';
import { IPC_PROTOCOL_VERSION } from '../dist/ipc/protocol.js';
import { getLocalPipePath } from '../dist/ipc/transport.js';

const packageMetadata = createRequire(import.meta.url)('../package.json');
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const proxyServiceUrl = new URL('../src/proxy/service.ts', import.meta.url).href;
const localPackageVersion = packageMetadata.version;
const supportedPlatforms = {
  skip: !['win32', 'linux'].includes(process.platform)
    ? 'Proxy tests require Windows or Linux local IPC.'
    : false,
};

function uniquePipeName() {
  return `bookmarkdown-proxy-${process.pid}-${randomUUID()}`;
}

function pipePath(pipeName) {
  return getLocalPipePath(pipeName);
}

function encodeFrame(message) {
  const payload = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(payload.byteLength, 0);
  return Buffer.concat([header, payload]);
}

class EventQueue {
  #values = [];
  #waiters = [];

  push(value) {
    const waiter = this.#waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      waiter.resolve(value);
      return;
    }
    this.#values.push(value);
  }

  next(timeoutMs = 3000) {
    if (this.#values.length > 0) {
      return Promise.resolve(this.#values.shift());
    }
    return new Promise((resolve, reject) => {
      const waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.#waiters = this.#waiters.filter((current) => current !== waiter);
          reject(new Error('Timed out waiting for a fake daemon event.'));
        }, timeoutMs),
      };
      this.#waiters.push(waiter);
    });
  }
}

async function startFakeDaemon(t, pipeName, options = {}) {
  const sockets = new Set();
  const calls = [];
  const cancellations = [];
  const callEvents = new EventQueue();
  const cancellationEvents = new EventQueue();
  const connectionEvents = new EventQueue();
  let closePromise;

  const server = createServer((socket) => {
    sockets.add(socket);
    connectionEvents.push(socket);
    socket.once('close', () => sockets.delete(socket));
    socket.on('error', () => {});

    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.byteLength >= 4) {
        const payloadLength = buffer.readUInt32BE(0);
        if (buffer.byteLength < 4 + payloadLength) {
          return;
        }
        const payload = buffer.subarray(4, 4 + payloadLength);
        buffer = buffer.subarray(4 + payloadLength);

        let request;
        try {
          request = JSON.parse(payload.toString('utf8'));
        } catch {
          socket.destroy();
          return;
        }
        handleRequest(socket, request);
      }
    });
  });

  function write(socket, message) {
    if (!socket.destroyed) {
      socket.write(encodeFrame(message));
    }
  }

  function handleRequest(socket, request) {
    if (request.type === 'hello') {
      if (options.ignoreHello?.()) {
        return;
      }
      const protocolVersion = options.protocolVersion ?? IPC_PROTOCOL_VERSION;
      const packageVersion = options.packageVersion ?? localPackageVersion;
      const status =
        options.helloStatus ??
        (request.protocolVersion !== protocolVersion
          ? 'protocol_version_mismatch'
          : request.packageVersion !== packageVersion
            ? 'package_version_mismatch'
            : 'ready');
      write(socket, {
        type: 'hello.response',
        protocolVersion,
        packageVersion,
        status,
      });
      return;
    }

    if (request.type === 'health') {
      write(socket, {
        type: 'health.response',
        requestId: request.requestId,
        status: {
          protocolVersion: options.protocolVersion ?? IPC_PROTOCOL_VERSION,
          packageVersion: options.packageVersion ?? localPackageVersion,
          runtimeMode: options.runtimeMode ?? 'production',
          daemonStatus: options.daemonStatus ?? 'ready',
          extensionStatus: options.extensionStatus ?? 'connected',
        },
      });
      return;
    }

    if (request.type === 'call') {
      const call = {
        request,
        socket,
        respond(result) {
          write(socket, {
            type: 'response',
            requestId: request.requestId,
            ok: true,
            result,
          });
        },
        reject(code) {
          write(socket, {
            type: 'response',
            requestId: request.requestId,
            ok: false,
            error: { code },
          });
        },
      };
      calls.push(call);
      callEvents.push(call);
      if (options.onCall) {
        options.onCall(call);
      } else {
        call.respond(defaultResult(request));
      }
      return;
    }

    if (request.type === 'cancel') {
      const cancellation = { request, socket };
      cancellations.push(cancellation);
      cancellationEvents.push(cancellation);
      options.onCancel?.(cancellation);
      return;
    }

    socket.destroy();
  }

  const endpointPath = pipePath(pipeName);
  if (process.platform === 'linux') {
    await mkdir(dirname(endpointPath), { recursive: true, mode: 0o700 });
  }
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpointPath, resolve);
  });

  const daemon = {
    calls,
    cancellations,
    nextCall: () => callEvents.next(),
    nextCancellation: () => cancellationEvents.next(),
    nextConnection: () => connectionEvents.next(),
    close() {
      closePromise ??= new Promise((resolve, reject) => {
        for (const socket of sockets) {
          socket.destroy();
        }
        if (!server.listening) {
          resolve();
          return;
        }
        server.close((error) => (error ? reject(error) : resolve()));
      });
      return closePromise;
    },
  };

  t.after(() => daemon.close());
  return daemon;
}

function defaultResult(request) {
  if (request.toolName === 'browser.countOpenTabs') {
    const count = Number.parseInt(request.arguments.instanceId.slice(-1), 16);
    return { count, countedAt: new Date().toISOString() };
  }
  if (request.toolName === 'browser.countOpenWindows') {
    return { count: 2, countedAt: new Date().toISOString() };
  }
  if (request.toolName === 'browser.listTabs') {
    return { tabs: [], nextOffset: null, queriedAt: new Date().toISOString() };
  }
  if (request.toolName === 'browser.openTab') {
    return {
      tabId: 42,
      windowId: request.arguments.windowId ?? 2,
      url: request.arguments.url ?? 'about:blank',
    };
  }
  if (request.toolName === 'browser.closeTab') {
    return { tabId: request.arguments.tabId, closed: true };
  }
  if (request.toolName === 'browser.moveTab') {
    return {
      tabId: request.arguments.tabId,
      sourceWindowId: request.arguments.targetWindowId + 1,
      targetWindowId: request.arguments.targetWindowId,
    };
  }
  return {
    instances: [],
    totalTabs: 0,
    complete: true,
    queriedAt: new Date().toISOString(),
  };
}

function startProxyClient(pipeName, options = {}) {
  const bootstrap = `import { startProxyService } from ${JSON.stringify(proxyServiceUrl)}; startProxyService(${JSON.stringify({ pipeName, ...options })});`;
  return new McpStdioClient(bootstrap);
}

class McpStdioClient {
  #child;
  #buffer = '';
  #nextId = 1;
  #pending = new Map();

  stdout = '';
  stderr = '';
  protocolError;

  constructor(bootstrap) {
    this.#child = spawn(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '--eval', bootstrap],
      {
        cwd: projectRoot,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    this.#child.stdout.on('data', (chunk) => this.#onStdout(chunk));
    this.#child.stderr.on('data', (chunk) => {
      this.stderr += chunk.toString('utf8');
    });
    this.#child.on('error', (error) => this.#rejectAll(error));
    this.#child.on('close', (code, signal) => {
      this.#rejectAll(
        new Error(
          `MCP process exited (${code ?? signal}). stderr: ${this.stderr}`,
        ),
      );
    });
  }

  initialize() {
    return this.request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'proxy-test-client', version: '1.0.0' },
    }).then((result) => {
      this.notify('notifications/initialized', {});
      return result;
    });
  }

  request(method, params) {
    return this.beginRequest(method, params).response;
  }

  beginRequest(method, params) {
    const id = this.#nextId++;
    let resolveResponse;
    let rejectResponse;
    const response = new Promise((resolve, reject) => {
      resolveResponse = resolve;
      rejectResponse = reject;
    });
    response.catch(() => {});
    this.#pending.set(id, { resolve: resolveResponse, reject: rejectResponse });

    this.#child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`,
      (error) => {
        if (error) {
          const pending = this.#pending.get(id);
          if (pending) {
            this.#pending.delete(id);
            pending.reject(error);
          }
        }
      },
    );
    return { id, response };
  }

  notify(method, params) {
    this.#child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`,
    );
  }

  assertProtocolOnlyStdout() {
    assert.equal(this.protocolError, undefined, String(this.protocolError));
    const lines = this.stdout.split('\n').filter(Boolean);
    assert.ok(lines.length > 0, 'expected MCP protocol frames on stdout');
    for (const line of lines) {
      const message = JSON.parse(line);
      assert.equal(message.jsonrpc, '2.0');
    }
  }

  async close() {
    if (this.#child.exitCode !== null || this.#child.signalCode !== null) {
      return;
    }
    const exited = new Promise((resolve) => {
      this.#child.once('exit', resolve);
    });
    this.#child.stdin.end();
    let timer;
    try {
      await Promise.race([
        exited,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            this.#child.kill();
            reject(new Error('MCP proxy did not exit after stdio EOF.'));
          }, 5000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  #onStdout(chunk) {
    const text = chunk.toString('utf8');
    this.stdout += text;
    this.#buffer += text;
    for (;;) {
      const newline = this.#buffer.indexOf('\n');
      if (newline < 0) {
        return;
      }
      const line = this.#buffer.slice(0, newline).replace(/\r$/, '');
      this.#buffer = this.#buffer.slice(newline + 1);
      if (line.length === 0) {
        continue;
      }
      let message;
      try {
        message = JSON.parse(line);
        if (message.jsonrpc !== '2.0') {
          throw new Error('stdout contained a non-JSON-RPC frame.');
        }
      } catch (error) {
        this.protocolError = error;
        this.#rejectAll(error);
        return;
      }

      const pending = this.#pending.get(message.id);
      if (pending) {
        this.#pending.delete(message.id);
        if (message.error) {
          pending.reject(new Error(message.error.message ?? 'MCP request failed.'));
        } else {
          pending.resolve(message.result);
        }
      }
    }
  }

  #rejectAll(error) {
    for (const pending of this.#pending.values()) {
      pending.reject(error);
    }
    this.#pending.clear();
  }
}

function startCountCall(client, instanceId) {
  return client.beginRequest('tools/call', {
    name: 'browser.countOpenTabs',
    arguments: { instanceId },
  });
}

function readToolValue(result) {
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  return JSON.parse(result.content[0].text);
}

function assertToolError(result, code) {
  assert.equal(result.isError, true);
  const error = JSON.parse(result.content[0].text).error;
  assert.equal(error.code, code);
  return error.message;
}

test(
  'initializes and lists the shared browser catalog offline with MCP-only stdout',
  supportedPlatforms,
  async (t) => {
    const client = startProxyClient(uniquePipeName());
    t.after(() => client.close());

    const initialized = await client.initialize();
    const listed = await client.request('tools/list', {});

    assert.equal(initialized.serverInfo.version, localPackageVersion);
    assert.deepEqual(
      listed.tools.map((tool) => tool.name).sort(),
      [
        'browser.closeTab',
        'browser.countOpenTabs',
        'browser.countOpenWindows',
        'browser.listTabs',
        'browser.moveTab',
        'browser.openTab',
        'devices.list',
      ],
    );
    client.assertProtocolOnlyStdout();
  },
);

test(
  'forwards new browser tools through MCP and validates their IPC results',
  supportedPlatforms,
  async (t) => {
    const pipeName = uniquePipeName();
    const daemon = await startFakeDaemon(t, pipeName);
    const client = startProxyClient(pipeName);
    t.after(() => client.close());
    await client.initialize();

    const instanceId = '00000000-0000-4000-8000-000000000001';
    const calls = [
      {
        name: 'browser.countOpenWindows',
        arguments: { instanceId },
        expected: { count: 2 },
      },
      {
        name: 'browser.listTabs',
        arguments: { instanceId },
        expected: { tabs: [], nextOffset: null },
      },
      {
        name: 'browser.openTab',
        arguments: {
          instanceId,
          url: 'https://example.invalid/',
          windowId: 3,
        },
        expected: {
          tabId: 42,
          windowId: 3,
          url: 'https://example.invalid/',
        },
      },
      {
        name: 'browser.closeTab',
        arguments: { instanceId, tabId: 42 },
        expected: { tabId: 42, closed: true },
      },
      {
        name: 'browser.moveTab',
        arguments: { instanceId, tabId: 42, targetWindowId: 3 },
        expected: { tabId: 42, sourceWindowId: 4, targetWindowId: 3 },
      },
    ];

    for (const call of calls) {
      const result = readToolValue(
        await client.request('tools/call', {
          name: call.name,
          arguments: call.arguments,
        }),
      );
      for (const [key, value] of Object.entries(call.expected)) {
        assert.deepEqual(result[key], value);
      }
    }

    assert.deepEqual(
      daemon.calls.map(({ request }) => request.toolName),
      calls.map(({ name }) => name),
    );
    assert.deepEqual(daemon.calls[1].request.arguments, {
      instanceId,
      limit: 10,
      offset: 0,
    });
    assert.equal(daemon.calls.length, calls.length);
  },
);

test(
  'returns unavailable offline and reconnects on a later call without restarting the proxy',
  supportedPlatforms,
  async (t) => {
    const pipeName = uniquePipeName();
    const client = startProxyClient(pipeName);
    t.after(() => client.close());
    await client.initialize();

    const unavailable = await client.request('tools/call', {
      name: 'devices.list',
      arguments: {},
    });
    assertToolError(unavailable, 'DAEMON_UNAVAILABLE');

    const daemon = await startFakeDaemon(t, pipeName);
    const recovered = await client.request('tools/call', {
      name: 'devices.list',
      arguments: {},
    });
    assert.deepEqual(readToolValue(recovered).instances, []);
    assert.equal(daemon.calls.length, 1);
    client.assertProtocolOnlyStdout();
  },
);

test(
  'connects to a development daemon without imposing a proxy runtime mode',
  supportedPlatforms,
  async (t) => {
    const pipeName = uniquePipeName();
    const daemon = await startFakeDaemon(t, pipeName, {
      runtimeMode: 'development',
    });
    const client = startProxyClient(pipeName);
    t.after(() => client.close());
    await client.initialize();

    const result = await client.request('tools/call', {
      name: 'devices.list',
      arguments: {},
    });
    assert.deepEqual(readToolValue(result).instances, []);
    assert.equal(daemon.calls.length, 1);
  },
);

test(
  'distinguishes an offline extension from an unavailable daemon',
  supportedPlatforms,
  async (t) => {
    const pipeName = uniquePipeName();
    const daemon = await startFakeDaemon(t, pipeName, {
      extensionStatus: 'not_connected',
    });
    const client = startProxyClient(pipeName);
    t.after(() => client.close());
    await client.initialize();

    const result = await client.request('tools/call', {
      name: 'devices.list',
      arguments: {},
    });

    assertToolError(result, 'EXTENSION_NOT_CONNECTED');
    assert.equal(daemon.calls.length, 0);
  },
);

test(
  'forwards cancellation and clears the pending call for later work',
  supportedPlatforms,
  async (t) => {
    const pipeName = uniquePipeName();
    const daemon = await startFakeDaemon(t, pipeName, {
      onCall(call) {
        if (daemon.calls.length > 1) {
          call.respond(defaultResult(call.request));
        }
      },
      onCancel({ request, socket }) {
        socket.write(
          encodeFrame({
            type: 'response',
            requestId: request.requestId,
            ok: false,
            error: { code: 'REQUEST_CANCELLED' },
          }),
        );
      },
    });
    const client = startProxyClient(pipeName);
    t.after(() => client.close());
    await client.initialize();

    const pending = startCountCall(client, '00000000-0000-4000-8000-000000000001');
    const dispatched = await daemon.nextCall();
    client.notify('notifications/cancelled', {
      requestId: pending.id,
      reason: 'test cancellation',
    });
    await daemon.nextCancellation();
    assert.equal(dispatched.request.type, 'call');
    let timer;
    try {
      const outcome = await Promise.race([
        pending.response.then(() => 'response'),
        new Promise((resolve) => { timer = setTimeout(() => resolve('suppressed'), 150); }),
      ]);
      assert.equal(outcome, 'suppressed');
    } finally {
      clearTimeout(timer);
    }
    const next = await client.request('tools/call', {
      name: 'browser.countOpenTabs',
      arguments: { instanceId: '00000000-0000-4000-8000-000000000002' },
    });
    assert.equal(readToolValue(next).count, 2);
    assert.equal(daemon.calls.length, 2);
  },
);

test('times out a dispatched call, ignores its late reply, and serves a later call', supportedPlatforms, async (t) => {
  const pipeName = uniquePipeName();
  const daemon = await startFakeDaemon(t, pipeName, {
    onCall(call) {
      if (daemon.calls.length > 1) call.respond(defaultResult(call.request));
    },
  });
  const client = startProxyClient(pipeName, { requestTimeoutMs: 100, connectionAttempts: 1 });
  t.after(() => client.close());
  await client.initialize();

  const first = startCountCall(client, '00000000-0000-4000-8000-000000000001');
  const dispatched = await daemon.nextCall();
  assertToolError(await first.response, 'REQUEST_TIMEOUT');
  dispatched.respond({ count: 99, countedAt: new Date().toISOString() });
  const recovered = await client.request('tools/call', {
    name: 'browser.countOpenTabs',
    arguments: { instanceId: '00000000-0000-4000-8000-000000000002' },
  });
  assert.equal(readToolValue(recovered).count, 2);
  assert.equal(daemon.calls.length, 2);
  client.assertProtocolOnlyStdout();
});

test('keeps errors and cancellations isolated across proxy sessions', supportedPlatforms, async (t) => {
  const pipeName = uniquePipeName();
  const daemon = await startFakeDaemon(t, pipeName, { onCall() {} });
  const first = startProxyClient(pipeName);
  const second = startProxyClient(pipeName);
  t.after(async () => Promise.all([first.close(), second.close()]));
  await Promise.all([first.initialize(), second.initialize()]);

  const cancelled = startCountCall(first, '00000000-0000-4000-8000-000000000001');
  const firstCall = await daemon.nextCall();
  const rejected = startCountCall(second, '00000000-0000-4000-8000-000000000002');
  const secondCall = await daemon.nextCall();
  assert.notEqual(firstCall.socket, secondCall.socket);
  secondCall.reject('EXTENSION_OPERATION_FAILED');
  assertToolError(await rejected.response, 'EXTENSION_OPERATION_FAILED');
  first.notify('notifications/cancelled', { requestId: cancelled.id, reason: 'test cancellation' });
  const cancellation = await daemon.nextCancellation();
  assert.equal(cancellation.socket, firstCall.socket);
  assert.equal(cancellation.request.requestId, firstCall.request.requestId);
  firstCall.reject('REQUEST_CANCELLED');

  const later = startCountCall(second, '00000000-0000-4000-8000-000000000003');
  const laterCall = await daemon.nextCall();
  laterCall.respond(defaultResult(laterCall.request));
  assert.equal(readToolValue(await later.response).count, 3);
  assert.equal(daemon.calls.length, 3);
  first.assertProtocolOnlyStdout();
  second.assertProtocolOnlyStdout();
});

test(
  'does not replay a side-effecting call after dispatch disconnect',
  supportedPlatforms,
  async (t) => {
    const pipeName = uniquePipeName();
    const daemon = await startFakeDaemon(t, pipeName, {
      onCall(call) {
        if (daemon.calls.length === 1) {
          call.socket.destroy();
        } else {
          call.respond(defaultResult(call.request));
        }
      },
    });
    const client = startProxyClient(pipeName);
    t.after(() => client.close());
    await client.initialize();

    const disconnected = await client.request('tools/call', {
      name: 'browser.openTab',
      arguments: {
        instanceId: '00000000-0000-4000-8000-000000000001',
        url: 'https://example.invalid/',
      },
    });
    assertToolError(disconnected, 'DAEMON_DISCONNECTED');
    assert.equal(daemon.calls.length, 1);

    const later = await client.request('tools/call', {
      name: 'browser.openTab',
      arguments: {
        instanceId: '00000000-0000-4000-8000-000000000002',
        url: 'https://example.invalid/next',
      },
    });
    assert.equal(readToolValue(later).url, 'https://example.invalid/next');
    assert.equal(daemon.calls.length, 2);
    assert.equal(client.stderr.includes('example.invalid'), false);
    client.assertProtocolOnlyStdout();
  },
);

test(
  'reports version mismatch with manual restart guidance and recovers only with a matching daemon',
  supportedPlatforms,
  async (t) => {
    const pipeName = uniquePipeName();
    const client = startProxyClient(pipeName);
    t.after(() => client.close());
    await client.initialize();
    const oldDaemon = await startFakeDaemon(t, pipeName, {
      packageVersion: '0.0.9',
    });

    const mismatch = await client.request('tools/call', {
      name: 'devices.list',
      arguments: {},
    });
    const mismatchMessage = assertToolError(
      mismatch,
      'DAEMON_VERSION_MISMATCH',
    );
    assert.match(mismatchMessage, /stop and restart.*manually.*matching package version/i);
    assert.equal(oldDaemon.calls.length, 0);
    await oldDaemon.close();

    const unavailable = await client.request('tools/call', {
      name: 'devices.list',
      arguments: {},
    });
    assertToolError(unavailable, 'DAEMON_UNAVAILABLE');

    const matchingDaemon = await startFakeDaemon(t, pipeName);
    const recovered = await client.request('tools/call', {
      name: 'devices.list',
      arguments: {},
    });
    assert.deepEqual(readToolValue(recovered).instances, []);
    assert.equal(matchingDaemon.calls.length, 1);
  },
);

test(
  'keeps concurrent calls from separate proxy sessions isolated',
  supportedPlatforms,
  async (t) => {
    const pipeName = uniquePipeName();
    const daemon = await startFakeDaemon(t, pipeName);
    const first = startProxyClient(pipeName);
    const second = startProxyClient(pipeName);
    t.after(async () => Promise.all([first.close(), second.close()]));
    await Promise.all([first.initialize(), second.initialize()]);

    const [firstResult, secondResult] = await Promise.all([
      first.request('tools/call', {
        name: 'browser.countOpenTabs',
        arguments: { instanceId: '00000000-0000-4000-8000-000000000001' },
      }),
      second.request('tools/call', {
        name: 'browser.countOpenTabs',
        arguments: { instanceId: '00000000-0000-4000-8000-000000000002' },
      }),
    ]);

    assert.equal(readToolValue(firstResult).count, 1);
    assert.equal(readToolValue(secondResult).count, 2);
    assert.equal(daemon.calls.length, 2);
  },
);

test('bounds an unresponsive pre-hello daemon and recovers without dispatching the first call', supportedPlatforms, async (t) => {
  const pipeName = uniquePipeName();
  let stalled = true;
  const daemon = await startFakeDaemon(t, pipeName, { ignoreHello: () => stalled });
  const client = startProxyClient(pipeName, {
    handshakeTimeoutMs: 250,
    requestTimeoutMs: 250,
    connectionAttempts: 1,
  });
  t.after(() => client.close());
  await client.initialize();

  const startedAt = Date.now();
  const pending = client.request('tools/call', { name: 'devices.list', arguments: {} });
  const socket = await daemon.nextConnection();
  assertToolError(await pending, 'DAEMON_UNAVAILABLE');
  assert.ok(Date.now() - startedAt < 1500);
  assert.equal(socket.destroyed, true);
  assert.equal(daemon.calls.length, 0);

  stalled = false;
  const recovered = await client.request('tools/call', { name: 'devices.list', arguments: {} });
  assert.deepEqual(readToolValue(recovered).instances, []);
  assert.equal(daemon.calls.length, 1);
});

test('cancels a pre-hello proxy call and closes the establishing socket', supportedPlatforms, async (t) => {
  const pipeName = uniquePipeName();
  const daemon = await startFakeDaemon(t, pipeName, { ignoreHello: () => true });
  const client = new IpcClient({
    pipeName,
    handshakeTimeoutMs: 1000,
    connectionAttempts: 1,
  });
  t.after(() => client.close());

  const controller = new AbortController();
  const pending = client.call('devices.list', { includeOffline: false, includeTabCounts: false }, controller.signal);
  const socket = await daemon.nextConnection();
  const closed = new Promise((resolve) => socket.once('close', resolve));
  controller.abort();
  await assert.rejects(pending, { code: 'REQUEST_CANCELLED' });
  await closed;
  assert.equal(socket.destroyed, true);
  assert.equal(daemon.calls.length, 0);
});