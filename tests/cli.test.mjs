import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const cliPath = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const builtCliPath = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const devCliPath = fileURLToPath(new URL('../dist/dev.js', import.meta.url));
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const cliToken = '0123456789abcdef0123456789abcdef';

function runCli(args, env = {}, entrypoint = cliPath) {
  const childEnv = { ...process.env, ...env };
  if (env.BOOKMARKDOWN_EXTENSION_IDS === null) {
    delete childEnv.BOOKMARKDOWN_EXTENSION_IDS;
  }
  const child = spawn(process.execPath, [entrypoint, ...args], {
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
  for (const args of [['browser'], ['proxy'], ['daemon', 'extra'], ['--', 'proxy']]) {
    const result = await runCli(args);
    assert.notEqual(result.code, 0);
    assert.match(
      result.stderr,
      /Usage: bookmarkdown-mcp-server \[daemon\] \(defaults to daemon\)/,
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
  'runs the CLI through a symlinked npm bin entry on Linux and macOS',
  {
    skip: !['linux', 'darwin'].includes(process.platform)
      ? 'npm uses symlinked bin entries on Linux and macOS'
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
      /Usage: bookmarkdown-mcp-server \[daemon\] \(defaults to daemon\)/,
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
      BOOKMARKDOWN_MCP_TOKEN: cliToken,
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
      BOOKMARKDOWN_MCP_TOKEN: cliToken,
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

test('starts the built daemon CLI and releases its listeners on shutdown', {
  skip: !['win32', 'linux', 'darwin'].includes(process.platform),
}, async (t) => {
  const reserved = createNetServer();
  await new Promise((resolve, reject) => {
    reserved.once('error', reject);
    reserved.listen(0, '127.0.0.1', resolve);
  });
  const address = reserved.address();
  assert.ok(address && typeof address !== 'string');
  await new Promise((resolve) => reserved.close(resolve));

  const httpReserved = createNetServer();
  await new Promise(resolve => httpReserved.listen(0, '127.0.0.1', resolve));
  const httpPort = httpReserved.address().port;
  await new Promise(resolve => httpReserved.close(resolve));
  const child = spawn(process.execPath, [builtCliPath, 'daemon'], {
    cwd: projectRoot,
    env: {
      ...process.env,
      BOOKMARKDOWN_BRIDGE_TOKEN: cliToken,
      BOOKMARKDOWN_MCP_TOKEN: cliToken,
      BOOKMARKDOWN_EXTENSION_IDS: 'a'.repeat(32),
      BOOKMARKDOWN_WS_PORT: String(address.port),
      BOOKMARKDOWN_MCP_PORT: String(httpPort),
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
  assert.ok(stderr.includes(`http://127.0.0.1:${httpPort}/mcp`));
  assert.ok(stderr.includes(`WebSocket URL: ws://127.0.0.1:${address.port}/`));
  assert.match(stderr, /Pairing token: configured \(hidden\)/);
  assert.match(stderr, /Waiting for an extension connection/);
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
  await assert.rejects(fetch(`http://127.0.0.1:${httpPort}/mcp`));
});
