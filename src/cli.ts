#!/usr/bin/env node
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDaemon } from './daemon/service.js';
import { startProxyService } from './proxy/service.js';
import type { RuntimeMode } from './config.js';

export async function runCli(
  runtimeMode: RuntimeMode = 'production',
): Promise<void> {
  try {
    const [mode, ...extraArguments] = process.argv.slice(2);
    if (
      (mode !== 'daemon' && mode !== 'proxy') ||
      extraArguments.length > 0
    ) {
      throw new Error('Usage: bookmarkdown-mcp-server <daemon|proxy>.');
    }

    if (mode === 'daemon') {
      const result = await startDaemon({ runtimeMode });
      if (result.status === 'already_running') {
        console.error('BookMarkdown daemon is already running.');
        return;
      }

      console.error(
        `BookMarkdown daemon listening on ws://127.0.0.1:${result.daemon.webSocketPort} and \\\\.\\pipe\\${result.daemon.pipeName}.`,
      );
      return;
    }

    startProxyService();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown startup error.';
    console.error(`BookMarkdown MCP server failed to start: ${message}`);
    process.exitCode = 1;
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void runCli('production');
}