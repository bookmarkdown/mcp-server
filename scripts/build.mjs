import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
// A clean build prevents retired IPC/proxy files from shipping in npm packages.
rmSync(fileURLToPath(new URL('../dist', import.meta.url)), { recursive: true, force: true });
const result = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url)), '-p', 'tsconfig.json'], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
