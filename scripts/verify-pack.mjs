import { spawnSync } from "node:child_process";

const result = spawnSync("npm pack --dry-run --json", {
  encoding: "utf8",
  shell: true,
});

if (result.status !== 0) {
  process.stderr.write(result.stderr);
  process.exit(result.status ?? 1);
}

const jsonStart = result.stdout.indexOf("[");
if (jsonStart < 0) {
  throw new Error("npm pack did not return its JSON report.");
}

const [packReport] = JSON.parse(result.stdout.slice(jsonStart));
const packedPaths = new Set(packReport.files.map(({ path }) => path));
const requiredPaths = [
  "dist/cli.js",
  "dist/daemon/service.js",
  "dist/ipc/transport.js",
  "README.md",
  "README.zh-TW.md",
];
const missingPaths = requiredPaths.filter((path) => !packedPaths.has(path));

if (missingPaths.length > 0) {
  throw new Error(`Package is missing required files: ${missingPaths.join(", ")}`);
}

console.log(`Verified npm package contents (${packReport.files.length} files).`);
