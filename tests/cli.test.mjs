import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createConnection, createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { getLocalPipePath } from '../dist/ipc/transport.js';

const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const builtCliPath = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const devCliPath = fileURLToPath(new URL('../src/dev.ts', import.meta.url));
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const cliToken = '0123456789abcdef0123456789abcdef';

function runCli(args, env = {}, entrypoint = cliPath) {
  const childEnv = { ...process.env, ...env };
  if (env.BOOKMARKDOWN_EXTENSION_IDS === null) {
    delete childEnv.BOOKMARKDOWN_EXTENSION_IDS;
  }
  const child = spawn(process.execPath, ['--import', 'tsx', entrypoint, ...args], {
    cwd: projectRoot,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => {
    stdout += chunk.toString('utf8');
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk.toString('utf8');
  });

  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

class McpProxyProcess {
  #child;
  #buffer = '';
  #nextId = 1;
  #pending = new Map();
  #exit;

  stdout = '';
  stderr = '';

  constructor(env = {}) {
    this.#child = spawn(process.execPath, ['--import', 'tsx', cliPath, 'proxy'], {
      cwd: projectRoot,
      env: { ...process.env, ...env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.#child.stdout.on('data', (chunk) => this.#onStdout(chunk));
    this.#child.stderr.on('data', (chunk) => {
      this.stderr += chunk.toString('utf8');
    });
    this.#child.on('error', (error) => this.#rejectAll(error));
    this.#exit = new Promise((resolve) => {
      this.#child.once('close', (code, signal) => {
        this.#rejectAll(
          new Error(`MCP proxy exited (${code ?? signal}). ${this.stderr}`),
        );
        resolve({ code, signal });
      });
    });
  }

  initialize() {
    return this.request('initialize', {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'cli-test-client', version: '1.0.0' },
    }).then((result) => {
      this.notify('notifications/initialized', {});
      return result;
    });
  }

  request(method, params) {
    const id = this.#nextId++;
    const response = new Promise((resolve, reject) => {
      this.#pending.set(id, { resolve, reject });
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

  async close() {
    if (this.#child.exitCode !== null || this.#child.signalCode !== null) {
      await this.#exit;
      return;
    }
    this.#child.stdin.end();
    let timer;
    try {
      await Promise.race([
        this.#exit,
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            this.#child.kill();
            reject(new Error('MCP proxy did not exit after stdin closed.'));
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
        assert.equal(message.jsonrpc, '2.0');
      } catch (error) {
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

test('defaults to daemon when no subcommand is provided', async () => {
  const result = await runCli([], {
    BOOKMARKDOWN_BRIDGE_TOKEN: '',
    BOOKMARKDOWN_EXTENSION_IDS: '',
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /BOOKMARKDOWN_BRIDGE_TOKEN is required/);
  assert.doesNotMatch(result.stderr, /Usage:/);
  assert.equal(result.stdout, '');
});

test('rejects invalid or extra subcommand arguments', async () => {
  for (const args of [['browser'], ['proxy', 'extra'], ['--', 'proxy']]) {
    const result = await runCli(args);
    assert.notEqual(result.code, 0);
    assert.match(
      result.stderr,
      /Usage: bookmarkdown-mcp-server \[daemon\|proxy\] \(defaults to daemon\)/,
    );
    assert.equal(result.stdout, '');
  }
});

test('dispatches daemon mode to daemon startup and reports invalid configuration', async () => {
  const result = await runCli(['daemon'], {
    BOOKMARKDOWN_BRIDGE_TOKEN: '',
    BOOKMARKDOWN_EXTENSION_IDS: '',
  });
  assert.equal(result.code, 1);
  assert.match(result.stderr, /BOOKMARKDOWN_BRIDGE_TOKEN is required/);
  assert.doesNotMatch(result.stderr, /Usage:/);
  assert.equal(result.stdout, '');
});

test(
  'runs the CLI through a symlinked npm bin entry on Linux',
  {
    skip: process.platform !== 'linux'
      ? 'npm uses symlinked bin entries on Linux'
      : false,
  },
  async (t) => {
    const tempDir = mkdtempSync(join(tmpdir(), 'bookmarkdown-cli-'));
    t.after(() => rmSync(tempDir, { recursive: true, force: true }));
    const symlinkPath = join(tempDir, 'bookmarkdown-mcp-server');
    symlinkSync(builtCliPath, symlinkPath);

    const result = await runCli(['browser'], {}, symlinkPath);

    assert.notEqual(result.code, 0);
    assert.match(
      result.stderr,
      /Usage: bookmarkdown-mcp-server \[daemon\|proxy\] \(defaults to daemon\)/,
    );
    assert.equal(result.stdout, '');
  },
);

test('keeps package defaults in production and routes the dev entrypoint explicitly', async (t) => {
  const packageMetadata = JSON.parse(
    readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
  );
  assert.equal(packageMetadata.bin['bookmarkdown-mcp-server'], './dist/cli.js');
  assert.equal(packageMetadata.scripts.start, 'node dist/cli.js');
  assert.equal(packageMetadata.scripts.dev, 'tsx src/dev.ts');

  const production = await runCli(
    ['daemon'],
    {
      BOOKMARKDOWN_BRIDGE_TOKEN: cliToken,
      BOOKMARKDOWN_EXTENSION_IDS: null,
      NODE_ENV: 'development',
    },
  );
  assert.equal(production.code, 1);
  assert.match(production.stderr, /BOOKMARKDOWN_EXTENSION_IDS must contain/);

  const occupied = createNetServer();
  await new Promise((resolve, reject) => {
    occupied.once('error', reject);
    occupied.listen(0, '127.0.0.1', resolve);
  });
  const address = occupied.address();
  assert.ok(address && typeof address !== 'string');
  t.after(() => new Promise((resolve) => occupied.close(resolve)));

  const development = await runCli(
    ['daemon'],
    {
      BOOKMARKDOWN_BRIDGE_TOKEN: cliToken,
      BOOKMARKDOWN_EXTENSION_IDS: null,
      BOOKMARKDOWN_WS_PORT: String(address.port),
      NODE_ENV: 'production',
    },
    devCliPath,
  );
  assert.equal(development.code, 1);
  assert.match(development.stderr, /EADDRINUSE|already in use/i);
  assert.doesNotMatch(development.stderr, /BOOKMARKDOWN_EXTENSION_IDS/);
});

test('dispatches proxy mode without a daemon and keeps MCP on stdout', async (t) => {
  const proxy = new McpProxyProcess({
    BOOKMARKDOWN_IPC_PIPE_NAME: `bookmarkdown-cli-${process.pid}-${randomUUID()}`,
  });
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
  const unavailable = await proxy.request('tools/call', {
    name: 'devices.list',
    arguments: {},
  });
  assert.equal(unavailable.isError, true);
  assert.equal(
    JSON.parse(unavailable.content[0].text).error.code,
    'DAEMON_UNAVAILABLE',
  );
  assert.equal(proxy.stderr.includes('listening'), false);
  for (const line of proxy.stdout.split('\n').filter(Boolean)) {
    assert.equal(JSON.parse(line).jsonrpc, '2.0');
  }
});

test('starts the built daemon CLI and releases its listeners on shutdown', {
  skip: !['win32', 'linux'].includes(process.platform),
}, async (t) => {
  const reserved = createNetServer();
  await new Promise((resolve, reject) => {
    reserved.once('error', reject);
    reserved.listen(0, '127.0.0.1', resolve);
  });
  const address = reserved.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise((resolve) => reserved.close(resolve));

  const pipeName = `bookmarkdown-cli-${process.pid}-${randomUUID()}`;
  const child = spawn(process.execPath, [builtCliPath, 'daemon'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      BOOKMARKDOWN_BRIDGE_TOKEN: cliToken,
      BOOKMARKDOWN_EXTENSION_IDS: 'a'.repeat(32),
      BOOKMARKDOWN_WS_PORT: String(address.port),
      BOOKMARKDOWN_IPC_PIPE_NAME: pipeName,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
  const exited = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })));
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  });
  let readyTimer;
  try {
    await Promise.race([
      new Promise((resolve, reject) => {
        child.stderr.on('data', (chunk) => {
          stderr += chunk.toString('utf8');
          if (/BookMarkdown daemon listening/.test(stderr)) resolve();
        });
        child.once('close', () => reject(new Error(`Daemon exited before readiness: ${stderr}`)));
      }),
      new Promise((_, reject) => {
        readyTimer = setTimeout(() => reject(new Error(`Daemon startup timed out: ${stderr}`)), 5000);
      }),
    ]);
  } finally {
    clearTimeout(readyTimer);
  }
  assert.equal(stdout, '');
  assert.equal(stderr.includes(cliToken), false);
  assert.ok(stderr.includes(getLocalPipePath(pipeName)));
  assert.equal(child.kill('SIGINT'), true);
  let exitTimer;
  try {
    const exit = await Promise.race([
      exited,
      new Promise((_, reject) => {
        exitTimer = setTimeout(() => reject(new Error('Daemon shutdown timed out.')), 5000);
      }),
    ]);
    assert.ok(exit.code === 0 || exit.signal === 'SIGINT');
  } finally {
    clearTimeout(exitTimer);
  }
  const rebound = createNetServer();
  await new Promise((resolve, reject) => {
    rebound.once('error', reject);
    rebound.listen(address.port, '127.0.0.1', resolve);
  });
  await new Promise((resolve) => rebound.close(resolve));
  await assert.rejects(new Promise((resolve, reject) => {
    const socket = createConnection(`\\\\.\\pipe\\${pipeName}`);
    socket.once('connect', () => { socket.destroy(); resolve(); });
    socket.once('error', reject);
  }));
});