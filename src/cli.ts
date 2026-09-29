#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startDaemon } from './daemon/service.js';
import { startProxyService } from './proxy/service.js';
import { getLocalPipePath } from './ipc/transport.js';
import type { RuntimeMode } from './config.js';

export async function runCli(
  runtimeMode: RuntimeMode = 'production',
): Promise<void> {
  try {
    const [requestedMode, ...extraArguments] = process.argv.slice(2);
    const mode = requestedMode ?? 'daemon';
    if (
      (mode !== 'daemon' && mode !== 'proxy') ||
      extraArguments.length > 0
    ) {
      throw new Error(
        'Usage: bookmarkdown-mcp-server [daemon|proxy] (defaults to daemon).',
      );
    }

    if (mode === 'daemon') {
      const result = await startDaemon({
        runtimeMode,
        pipeName: process.env.BOOKMARKDOWN_IPC_PIPE_NAME,
      });
      if (result.status === 'already_running') {
        console.error('BookMarkdown daemon is already running.');
        return;
      }

      console.error(
        `BookMarkdown daemon listening on ${result.daemon.webSocketUrl} and local IPC ${getLocalPipePath(result.daemon.pipeName)}.`,
      );
      return;
    }

    startProxyService({ pipeName: process.env.BOOKMARKDOWN_IPC_PIPE_NAME });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown startup error.';
    console.error(`BookMarkdown MCP server failed to start: ${message}`);
    process.exitCode = 1;
  }
}

function isExecutedFile(): boolean {
  const entrypoint = process.argv[1];
  if (!entrypoint) {
    return false;
  }

  try {
    return realpathSync(entrypoint) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isExecutedFile()) {
  void runCli('production');
}