import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer as createNetServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { WebSocket } from 'ws';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const daemonServiceUrl = new URL('../dist/daemon/service.js', import.meta.url).href;
const proxyServiceUrl = new URL('../dist/proxy/service.js', import.meta.url).href;
const windowsOnly = {
  skip:
    process.platform === 'win32'
      ? false
      : 'Daemon/proxy process tests require Windows Named Pipes.',
};
const extensionId = 'a'.repeat(32);
const secondExtensionId = 'b'.repeat(32);
const token = '0123456789abcdef0123456789abcdef0123456789abcdef';
const firstInstanceId = '7d8c2f92-12c8-4bd2-9701-12e602deaf01';
const secondInstanceId = '9f35a930-b515-47e3-8bb5-c454f8de8c55';

function uniquePipeName() {
  return `bookmarkdown-e2e-${process.pid}-${randomUUID()}`;
}

function makeDaemonEnvironment(port, overrides = {}) {
  return {
    ...process.env,
    BOOKMARKDOWN_BRIDGE_TOKEN: token,
    BOOKMARKDOWN_EXTENSION_IDS: `${extensionId},${secondExtensionId}`,
    BOOKMARKDOWN_WS_PORT: String(port),
    BOOKMARKDOWN_HELLO_TIMEOUT_MS: '1000',
    BOOKMARKDOWN_REQUEST_TIMEOUT_MS: '2000',
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

async function assertPortCanBeRebound(port) {
  const server = createNetServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

class CapturedProcess {
  #stderrWaiters = [];
  #exit;

  stdout = '';
  stderr = '';

  constructor(child, onStdout) {
    this.child = child;
    child.stdout.on('data', (chunk) => {
      const text = chunk.toString('utf8');
      this.stdout += text;
      onStdout?.(chunk);
    });
    child.stderr.on('data', (chunk) => {
      this.stderr += chunk.toString('utf8');
      this.#resolveStderrWaiters();
    });
    this.#exit = new Promise((resolve) => {
      child.once('close', (code, signal) => {
        this.#rejectStderrWaiters(
          new Error(`Process exited (${code ?? signal}). ${this.stderr}`),
        );
        resolve({ code, signal });
      });
    });
  }

  waitForStderr(pattern, timeoutMs = 5000) {
    if (pattern.test(this.stderr)) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const waiter = { pattern, resolve, reject, timer: undefined };
      waiter.timer = setTimeout(() => {
        this.#stderrWaiters = this.#stderrWaiters.filter(
          (current) => current !== waiter,
        );
        reject(new Error(`Timed out waiting for stderr to match ${pattern}.`));
      }, timeoutMs);
      this.#stderrWaiters.push(waiter);
    });
  }

  async waitForExit(timeoutMs = 5000) {
    let timer;
    try {
      return await Promise.race([
        this.#exit,
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Process did not exit before the deadline.')),
            timeoutMs,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  async stop(signal = 'SIGTERM') {
    if (this.child.exitCode !== null || this.child.signalCode !== null) {
      await this.#exit;
      return;
    }
    this.child.kill(signal);
    await this.waitForExit();
  }

  #resolveStderrWaiters() {
    this.#stderrWaiters = this.#stderrWaiters.filter((waiter) => {
      if (!waiter.pattern.test(this.stderr)) {
        return true;
      }
      clearTimeout(waiter.timer);
      waiter.resolve();
      return false;
    });
  }

  #rejectStderrWaiters(error) {
    for (const waiter of this.#stderrWaiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    this.#stderrWaiters = [];
  }
}

function startDaemonProcess(pipeName, env) {
  const bootstrap = `
    import { startDaemon } from ${JSON.stringify(daemonServiceUrl)};
    try {
      const result = await startDaemon({ env: process.env, pipeName: ${JSON.stringify(pipeName)} });
      if (result.status === 'started') {
        console.error('DAEMON_READY');
      } else {
        console.error('DAEMON_ALREADY_RUNNING');
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : 'Daemon startup failed.');
      process.exitCode = 1;
    }
  `;
  const child = spawn(
    process.execPath,
    ['--input-type=module', '--eval', bootstrap],
    { cwd: projectRoot, env, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  return new CapturedProcess(child);
}

class McpProxyProcess {
  #child;
  #capture;
  #buffer = '';
  #nextId = 1;
  #pending = new Map();
  #protocolError;

  constructor(pipeName) {
    const bootstrap = `import { startProxyService } from ${JSON.stringify(proxyServiceUrl)}; startProxyService({ pipeName: ${JSON.stringify(pipeName)} });`;
    this.#child = spawn(
      process.execPath,
      ['--input-type=module', '--eval', bootstrap],
      {
        cwd: projectRoot,
        env: process.env,
        stdio: ['pipe', 'pipe', 'pipe'],
      },
    );
    this.#capture = new CapturedProcess(this.#child, (chunk) =>
      this.#onStdout(chunk),
    );
    this.#child.on('error', (error) => this.#rejectAll(error));
    this.#child.once('close', (code, signal) => {
      this.#rejectAll(
        new Error(
          `MCP proxy exited (${code ?? signal}). stderr: ${this.#capture.stderr}`,
        ),
      );
    });
  }

  get stdout() {
    return this.#capture.stdout;
  }

  get stderr() {
    return this.#capture.stderr;
  }

  initialize() {
    return this.request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'daemon-proxy-test', version: '1.0.0' },
    }).then((result) => {
      this.notify('notifications/initialized', {});
      return result;
    });
  }

  request(method, params) {
    const id = this.#nextId++;
    const response = new Promise((resolve, reject) => {
      const pending = {
        resolve: (message) => {
          clearTimeout(pending.timer);
          resolve(message);
        },
        reject: (error) => {
          clearTimeout(pending.timer);
          reject(error);
        },
        timer: setTimeout(() => {
          this.#pending.delete(id);
          reject(new Error(`MCP request ${method} timed out.`));
        }, 5000),
      };
      this.#pending.set(id, pending);
    });
    this.#child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`,
      (error) => {
        if (error) {
          this.#pending.get(id)?.reject(error);
          this.#pending.delete(id);
        }
      },
    );
    return response.then((message) => {
      if (message.error) {
        throw new Error(message.error.message ?? 'MCP request failed.');
      }
      return message.result;
    });
  }

  notify(method, params) {
    this.#child.stdin.write(
      `${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`,
    );
  }

  assertProtocolOnlyStdout() {
    assert.equal(this.#protocolError, undefined, String(this.#protocolError));
    const lines = this.stdout.split('\n').filter(Boolean);
    assert.ok(lines.length > 0, 'expected MCP frames on proxy stdout');
    for (const line of lines) {
      assert.equal(JSON.parse(line).jsonrpc, '2.0');
    }
  }

  async close() {
    if (this.#child.exitCode !== null || this.#child.signalCode !== null) {
      await this.#capture.waitForExit();
      return;
    }
    this.#child.stdin.end();
    try {
      await this.#capture.waitForExit();
    } catch (error) {
      this.#child.kill();
      throw error;
    }
  }

  #onStdout(chunk) {
    this.#buffer += chunk.toString('utf8');
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
          throw new Error('Proxy stdout contained a non-MCP frame.');
        }
      } catch (error) {
        this.#protocolError = error;
        this.#rejectAll(error);
        return;
      }
      const pending = this.#pending.get(message.id);
      if (pending) {
        this.#pending.delete(message.id);
        pending.resolve(message);
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

function startProxyProcess(pipeName) {
  return new McpProxyProcess(pipeName);
}

function waitForWebSocketOpen(socket) {
  return new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
    socket.once('unexpected-response', (_request, response) => {
      reject(new Error(`WebSocket upgrade rejected with ${response.statusCode}.`));
    });
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
        resolve(JSON.parse(data.toString('utf8')));
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

async function connectExtension(port, selectedExtensionId, instanceId) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}`, {
    origin: `chrome-extension://${selectedExtensionId}`,
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
      extensionId: selectedExtensionId,
      browser: 'chrome',
      capabilities: { operations: ['browser.countOpenTabs'] },
    }),
  );
  assert.equal((await acknowledgement).ok, true);
  return socket;
}

function countResponse(requestId, count) {
  return {
    type: 'browser/response',
    requestId,
    ok: true,
    data: { count, countedAt: new Date().toISOString() },
  };
}

function readToolValue(result) {
  assert.notEqual(result.isError, true, result.content?.[0]?.text);
  return JSON.parse(result.content[0].text);
}

function assertToolError(result, code) {
  assert.equal(result.isError, true);
  assert.equal(JSON.parse(result.content[0].text).error.code, code);
}

test(
  'recovers when the daemon starts after a proxy without restarting the proxy',
  windowsOnly,
  async (t) => {
    const pipeName = uniquePipeName();
    const port = await reservePort();
    const proxy = startProxyProcess(pipeName);
    t.after(() => proxy.close());

    const initialized = await proxy.initialize();
    assert.equal(initialized.serverInfo.name, 'bookmarkdown-mcp-server');
    const listed = await proxy.request('tools/list', {});
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
    const offline = await proxy.request('tools/call', {
      name: 'browser.countOpenTabs',
      arguments: { instanceId: firstInstanceId },
    });
    assertToolError(offline, 'DAEMON_UNAVAILABLE');

    const daemon = startDaemonProcess(
      pipeName,
      makeDaemonEnvironment(port),
    );
    t.after(() => daemon.stop());
    await daemon.waitForStderr(/DAEMON_READY/);
    assert.equal(daemon.stdout, '');

    const extension = await connectExtension(
      port,
      extensionId,
      firstInstanceId,
    );
    t.after(() => extension.terminate());
    const call = proxy.request('tools/call', {
      name: 'browser.countOpenTabs',
      arguments: { instanceId: firstInstanceId },
    });
    const request = await nextWebSocketMessage(extension);
    assert.equal(request.operation, 'browser.countOpenTabs');
    extension.send(JSON.stringify(countResponse(request.requestId, 5)));
    assert.equal(readToolValue(await call).count, 5);

    proxy.assertProtocolOnlyStdout();
    assert.equal(proxy.stderr.includes(token), false);
    assert.equal(daemon.stderr.includes(token), false);
  },
);

test(
  'routes concurrent calls from multiple proxy processes to their own instances',
  windowsOnly,
  async (t) => {
    const pipeName = uniquePipeName();
    const port = await reservePort();
    const daemon = startDaemonProcess(
      pipeName,
      makeDaemonEnvironment(port),
    );
    t.after(() => daemon.stop());
    await daemon.waitForStderr(/DAEMON_READY/);

    const firstExtension = await connectExtension(
      port,
      extensionId,
      firstInstanceId,
    );
    const secondExtension = await connectExtension(
      port,
      secondExtensionId,
      secondInstanceId,
    );
    const firstProxy = startProxyProcess(pipeName);
    const secondProxy = startProxyProcess(pipeName);
    t.after(async () => {
      firstExtension.terminate();
      secondExtension.terminate();
      await Promise.all([firstProxy.close(), secondProxy.close()]);
    });
    await Promise.all([firstProxy.initialize(), secondProxy.initialize()]);

    const firstCall = firstProxy.request('tools/call', {
      name: 'browser.countOpenTabs',
      arguments: { instanceId: firstInstanceId },
    });
    const secondCall = secondProxy.request('tools/call', {
      name: 'browser.countOpenTabs',
      arguments: { instanceId: secondInstanceId },
    });
    const [firstRequest, secondRequest] = await Promise.all([
      nextWebSocketMessage(firstExtension),
      nextWebSocketMessage(secondExtension),
    ]);
    secondExtension.send(
      JSON.stringify(countResponse(secondRequest.requestId, 9)),
    );
    firstExtension.send(
      JSON.stringify(countResponse(firstRequest.requestId, 3)),
    );

    const [firstResult, secondResult] = await Promise.all([
      firstCall,
      secondCall,
    ]);
    assert.equal(readToolValue(firstResult).count, 3);
    assert.equal(readToolValue(secondResult).count, 9);
    firstProxy.assertProtocolOnlyStdout();
    secondProxy.assertProtocolOnlyStdout();
    assert.equal(daemon.stdout, '');
    assert.equal(daemon.stderr.includes(token), false);
  },
);

test(
  'rolls back the WebSocket listener when daemon IPC startup fails',
  windowsOnly,
  async () => {
    const port = await reservePort();
    const daemon = startDaemonProcess(
      'invalid/pipe/name',
      makeDaemonEnvironment(port),
    );
    const exit = await daemon.waitForExit();

    assert.equal(exit.code, 1);
    assert.match(daemon.stderr, /Named pipe names must start with a letter or digit/);
    assert.equal(daemon.stdout, '');
    await assertPortCanBeRebound(port);
  },
);