#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { startDaemon } from './daemon/service.js';
import type { RuntimeMode } from './config.js';
import { SettingsStore } from './settings.js';

export async function runCli(
  runtimeMode: RuntimeMode = 'production',
): Promise<void> {
  try {
    const [requestedMode, ...extraArguments] = process.argv.slice(2);
    const mode = requestedMode ?? 'daemon';
    if (
      mode !== 'daemon' ||
      extraArguments.length > 0
    ) {
      throw new Error(
        'Usage: bookmarkdown-mcp-server [daemon] (defaults to daemon).',
      );
    }

    const settings = await SettingsStore.load();
    const result = await startDaemon({
      env: settings.effectiveEnv(), settings,
      runtimeMode,
      onLog: (message) => console.error(message),
    });
    console.error(
      `BookMarkdown daemon listening on ${result.daemon.mcpUrl} and ${result.daemon.webSocketUrl}.\n` +
      `Open the settings page in your browser: ${new URL('/', result.daemon.mcpUrl).href}`,
    );
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
