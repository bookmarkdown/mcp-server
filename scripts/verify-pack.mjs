import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:net";
import { pathToFileURL } from "node:url";
import { HttpTestClient } from "../tests/helpers/http-client.mjs";

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error("Run package verification through npm run verify:pack.");
}

function runNpm(args) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    timeout: 120_000,
  });
  if (result.error) {
    throw result.error;
  }
  if (result.status !== 0) {
    throw new Error(
      `npm ${args.join(" ")} failed (${result.status ?? "signal"}):\n${result.stderr}\n${result.stdout}`,
    );
  }
  return result.stdout;
}

const temporaryDirectory = mkdtempSync(
  join(tmpdir(), "bookmarkdown-verify-pack-"),
);
let daemon;
let daemonExit;

try {
  const packOutput = runNpm([
    "pack",
    "--json",
    "--pack-destination",
    temporaryDirectory,
  ]);
  const jsonStart = packOutput.indexOf("[");
  if (jsonStart < 0) {
    throw new Error("npm pack did not return its JSON report.");
  }

  const [packReport] = JSON.parse(packOutput.slice(jsonStart));
  const packedPaths = new Set(packReport.files.map(({ path }) => path));
  const requiredPaths = [
    "dist/cli.js",
    "dist/daemon/service.js",
    "dist/http-config.js",
    "dist/settings.js",
    "dist/management/service.js",
    "dist/management/page.js",
    "dist/server.js",
    "dist/tools/catalog.js",
    "LICENSE",
    "README.md",
    "README.zh-TW.md",
  ];
  const missingPaths = requiredPaths.filter((path) => !packedPaths.has(path));

  if (missingPaths.length > 0) {
    throw new Error(`Package is missing required files: ${missingPaths.join(", ")}`);
  }

  const tarballPath = join(temporaryDirectory, packReport.filename);
  const installDirectory = join(temporaryDirectory, "install");
  mkdirSync(installDirectory);
  runNpm([
    "install",
    "--prefix",
    installDirectory,
    tarballPath,
    "--no-audit",
    "--no-fund",
    "--fetch-retries=0",
    "--fetch-timeout=10000",
  ]);

  const installedPackageDirectory = join(
    installDirectory,
    "node_modules",
    "@bookmarkdown",
    "mcp-server",
  );
  const installedPackage = JSON.parse(
    readFileSync(join(installedPackageDirectory, "package.json"), "utf8"),
  );
  if ([...packedPaths].some(path => path.startsWith('dist/ipc/') || path.startsWith('dist/proxy/'))) {
    throw new Error('Package contains retired IPC/proxy files.');
  }
  const reservePort = async () => {
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = server.address().port;
    await new Promise(resolve => server.close(resolve));
    return port > 10080 ? port : reservePort();
  };
  const httpPort = await reservePort();
  const wsPort = await reservePort();
  const token = randomBytes(32).toString('hex');
  daemon = spawn(process.execPath, [join(installedPackageDirectory, 'dist', 'cli.js'), 'daemon'], {
    cwd: installDirectory,
    env: { ...process.env, BOOKMARKDOWN_MCP_TOKEN: token, BOOKMARKDOWN_BRIDGE_TOKEN: token,
      BOOKMARKDOWN_CONFIG_FILE: join(installDirectory, 'config.json'),
      BOOKMARKDOWN_EXTENSION_IDS: 'a'.repeat(32), BOOKMARKDOWN_MCP_PORT: String(httpPort),
      BOOKMARKDOWN_WS_PORT: String(wsPort) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  daemon.stdout.on('data', chunk => { stdout += chunk; });
  daemon.stderr.on('data', chunk => { stderr += chunk; });
  daemonExit = new Promise(resolve => daemon.once('close', (code, signal) => resolve({ code, signal })));
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`HTTP daemon readiness timed out: ${stderr}`)), 5000);
    daemon.once('error', error => { clearTimeout(timer); reject(error); });
    daemon.once('close', () => { clearTimeout(timer); reject(new Error(`Daemon exited: ${stderr}`)); });
    daemon.stderr.on('data', () => {
      if (stderr.includes('BookMarkdown daemon listening')) { clearTimeout(timer); resolve(); }
    });
  });
  const client = new HttpTestClient(`http://127.0.0.1:${httpPort}/mcp`, token);
  const response = await client.initialize();
  if (response.serverInfo.name !== 'bookmarkdown-mcp-server' || response.serverInfo.version !== installedPackage.version)
    throw new Error('Unexpected MCP initialize result.');
  const { toolCatalog } = await import(pathToFileURL(join(installedPackageDirectory, 'dist/tools/catalog.js')).href);
  const advertisedTools = (await client.request('tools/list')).tools;
  assert.deepEqual(
    advertisedTools.map(({ name }) => name).sort(),
    Object.values(toolCatalog).map(({ name }) => name).sort(),
    'Installed daemon tool catalog does not match its declared tools.',
  );
  if (stdout || stderr.includes(token)) throw new Error('Daemon exposed protocol output or credentials.');
  daemon.kill('SIGINT');
  let exitTimer;
  const exit = await Promise.race([daemonExit, new Promise((_, reject) => {
    exitTimer = setTimeout(() => reject(new Error('Daemon shutdown timed out.')), 5000);
  })]).finally(() => clearTimeout(exitTimer));
  if (exit.code !== 0 && exit.signal !== 'SIGINT') throw new Error('Installed daemon failed to shut down.');

  console.log(
    `Verified npm package contents (${packReport.files.length} files) and initialized ${installedPackage.name}@${installedPackage.version}.`,
  );
} finally {
  if (daemon && daemon.exitCode === null && daemon.signalCode === null) {
    daemon.kill();
    await daemonExit;
  }
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
