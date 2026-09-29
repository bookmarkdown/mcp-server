import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error("Run package verification through npm run verify:pack.");
}

function runNpm(args) {
  const result = spawnSync(process.execPath, [npmCli, ...args], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
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
let proxy;
let proxyExit;

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
    "dist/ipc/transport.js",
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
  const binPath = join(
    installDirectory,
    "node_modules",
    ".bin",
    `bookmarkdown-mcp-server${process.platform === "win32" ? ".cmd" : ""}`,
  );
  proxy = spawn(binPath, ["proxy"], {
    cwd: installDirectory,
    env: {
      ...process.env,
      BOOKMARKDOWN_IPC_PIPE_NAME: `bookmarkdown-package-smoke-${process.pid}-${randomUUID()}`,
    },
    shell: process.platform === "win32",
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  let buffer = "";
  proxyExit = new Promise((resolve) => {
    proxy.once("close", (code, signal) => resolve({ code, signal }));
  });
  proxy.stdout.setEncoding("utf8");
  proxy.stderr.setEncoding("utf8");
  proxy.stdout.on("data", (chunk) => {
    stdout += chunk;
    buffer += chunk;
  });
  proxy.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  let resolveInitialize;
  let rejectInitialize;
  let initializeSettled = false;
  const initializeResponse = new Promise((resolve, reject) => {
    resolveInitialize = resolve;
    rejectInitialize = reject;
  });
  const settleInitialize = (callback, value) => {
    if (initializeSettled) {
      return;
    }
    initializeSettled = true;
    clearTimeout(initializeTimer);
    callback(value);
  };
  const initializeTimer = setTimeout(() => {
    proxy.kill();
    settleInitialize(
      rejectInitialize,
      new Error(`MCP initialize timed out. stderr: ${stderr}`),
    );
  }, 5000);
  proxy.once("error", (error) => settleInitialize(rejectInitialize, error));
  proxy.once("close", (code, signal) => {
    if (!initializeSettled) {
      settleInitialize(
        rejectInitialize,
        new Error(`Proxy exited before MCP initialize (${code ?? signal}). ${stderr}`),
      );
    }
  });
  proxy.stdout.on("data", () => {
    for (;;) {
      const newline = buffer.indexOf("\n");
      if (newline < 0) {
        return;
      }
      const line = buffer.slice(0, newline).replace(/\r$/, "");
      buffer = buffer.slice(newline + 1);
      if (!line) {
        continue;
      }
      let message;
      try {
        message = JSON.parse(line);
      } catch (error) {
        settleInitialize(rejectInitialize, error);
        return;
      }
      if (message.id === 1) {
        settleInitialize(resolveInitialize, message);
        return;
      }
    }
  });
  proxy.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-11-25",
        capabilities: {},
        clientInfo: { name: "package-smoke", version: "1.0.0" },
      },
    })}\n`,
  );

  const response = await initializeResponse;
  if (
    response.jsonrpc !== "2.0" ||
    response.error ||
    response.result?.serverInfo?.name !== "bookmarkdown-mcp-server" ||
    response.result.serverInfo.version !== installedPackage.version
  ) {
    throw new Error(`Unexpected MCP initialize response: ${JSON.stringify(response)}`);
  }

  proxy.stdin.write(
    `${JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
      params: {},
    })}\n`,
  );
  proxy.stdin.end();
  let exitTimer;
  const exit = await Promise.race([
    proxyExit,
    new Promise((_, reject) => {
      exitTimer = setTimeout(() => {
        proxy.kill();
        reject(new Error("Installed MCP proxy did not exit after stdin EOF."));
      }, 5000);
    }),
  ]).finally(() => clearTimeout(exitTimer));
  if (exit.code !== 0) {
    throw new Error(`Installed MCP proxy exited (${exit.code ?? exit.signal}). ${stderr}`);
  }

  const protocolLines = stdout.split(/\r?\n/).filter(Boolean);
  if (protocolLines.length === 0) {
    throw new Error("Installed MCP proxy did not write protocol output.");
  }
  for (const line of protocolLines) {
    if (JSON.parse(line).jsonrpc !== "2.0") {
      throw new Error("Installed MCP proxy wrote non-JSON-RPC output to stdout.");
    }
  }

  console.log(
    `Verified npm package contents (${packReport.files.length} files) and initialized ${installedPackage.name}@${installedPackage.version}.`,
  );
} finally {
  if (proxy && proxy.exitCode === null && proxy.signalCode === null) {
    proxy.kill();
    await proxyExit;
  }
  rmSync(temporaryDirectory, { recursive: true, force: true });
}
