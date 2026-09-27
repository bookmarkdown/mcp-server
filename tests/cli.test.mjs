import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cliPath = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
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

  constructor() {
    this.#child = spawn(process.execPath, ['--import', 'tsx', cliPath, 'proxy'], {
      cwd: projectRoot,
      env: process.env,
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

test('requires exactly one daemon or proxy subcommand', async () => {
  for (const args of [[], ['browser'], ['proxy', 'extra'], ['--', 'proxy']]) {
    const result = await runCli(args);
    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Usage: bookmarkdown-mcp-server <daemon\|proxy>/);
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
  const proxy = new McpProxyProcess();
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