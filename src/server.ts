import { McpServer } from '@modelcontextprotocol/server';
import { asBridgeError } from './bridge/errors.js';
import type { BridgeService } from './bridge/service.js';
import { IpcClientError, PACKAGE_VERSION } from './ipc/client.js';
import { toolCatalog } from './tools/catalog.js';
import type { ToolExecutor } from './tools/executor.js';

function toolError(error: unknown) {
  const normalizedError =
    error instanceof IpcClientError ? error : asBridgeError(error);
  return {
    isError: true,
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify({
          error: {
            code: normalizedError.code,
            message: normalizedError.message,
          },
        }),
      },
    ],
  };
}

function toolSuccess(value: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}

export function createMcpServer(
  source: BridgeService | ToolExecutor,
): McpServer {
  const server = new McpServer({
    name: 'bookmarkdown-mcp-server',
    version: PACKAGE_VERSION,
  });
  const executor = isToolExecutor(source)
    ? source
    : createBridgeExecutor(source);

  server.registerTool(
    toolCatalog.devicesList.name,
    {
      description: toolCatalog.devicesList.description,
      inputSchema: toolCatalog.devicesList.inputSchema,
      outputSchema: toolCatalog.devicesList.outputSchema,
    },
    async ({ includeOffline, includeTabCounts }, context) => {
      try {
        const result = await executor[toolCatalog.devicesList.name](
          { includeOffline, includeTabCounts },
          { signal: context.mcpReq.signal },
        );
        return toolSuccess(result);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    toolCatalog.countOpenTabs.name,
    {
      description: toolCatalog.countOpenTabs.description,
      inputSchema: toolCatalog.countOpenTabs.inputSchema,
      outputSchema: toolCatalog.countOpenTabs.outputSchema,
    },
    async ({ instanceId }, context) => {
      try {
        const result = await executor[toolCatalog.countOpenTabs.name](
          { instanceId },
          { signal: context.mcpReq.signal },
        );
        return toolSuccess(result);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    toolCatalog.countOpenWindows.name,
    {
      description: toolCatalog.countOpenWindows.description,
      inputSchema: toolCatalog.countOpenWindows.inputSchema,
      outputSchema: toolCatalog.countOpenWindows.outputSchema,
    },
    async ({ instanceId }, context) => {
      try {
        const result = await executor[toolCatalog.countOpenWindows.name](
          { instanceId },
          { signal: context.mcpReq.signal },
        );
        return toolSuccess(result);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    toolCatalog.listTabs.name,
    {
      description: toolCatalog.listTabs.description,
      inputSchema: toolCatalog.listTabs.inputSchema,
      outputSchema: toolCatalog.listTabs.outputSchema,
    },
    async ({ instanceId, limit, offset }, context) => {
      try {
        const result = await executor[toolCatalog.listTabs.name](
          { instanceId, limit, offset },
          { signal: context.mcpReq.signal },
        );
        return toolSuccess(result);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    toolCatalog.openTab.name,
    {
      description: toolCatalog.openTab.description,
      inputSchema: toolCatalog.openTab.inputSchema,
      outputSchema: toolCatalog.openTab.outputSchema,
    },
    async ({ instanceId, url, windowId }, context) => {
      try {
        const result = await executor[toolCatalog.openTab.name](
          { instanceId, url, windowId },
          { signal: context.mcpReq.signal },
        );
        return toolSuccess(result);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    toolCatalog.closeTab.name,
    {
      description: toolCatalog.closeTab.description,
      inputSchema: toolCatalog.closeTab.inputSchema,
      outputSchema: toolCatalog.closeTab.outputSchema,
    },
    async ({ instanceId, tabId }, context) => {
      try {
        const result = await executor[toolCatalog.closeTab.name](
          { instanceId, tabId },
          { signal: context.mcpReq.signal },
        );
        return toolSuccess(result);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  server.registerTool(
    toolCatalog.moveTab.name,
    {
      description: toolCatalog.moveTab.description,
      inputSchema: toolCatalog.moveTab.inputSchema,
      outputSchema: toolCatalog.moveTab.outputSchema,
    },
    async ({ instanceId, tabId, targetWindowId }, context) => {
      try {
        const result = await executor[toolCatalog.moveTab.name](
          { instanceId, tabId, targetWindowId },
          { signal: context.mcpReq.signal },
        );
        return toolSuccess(result);
      } catch (error) {
        return toolError(error);
      }
    },
  );

  return server;
}

function isToolExecutor(
  source: BridgeService | ToolExecutor,
): source is ToolExecutor {
  return Object.values(toolCatalog).every(
    ({ name }) => typeof (source as ToolExecutor)[name] === 'function',
  );
}

function createBridgeExecutor(bridge: BridgeService): ToolExecutor {
  return {
    [toolCatalog.devicesList.name]: (args, { signal }) =>
      bridge.devicesList(args, signal),
    [toolCatalog.countOpenTabs.name]: (args, { signal }) =>
      bridge.countOpenTabs(args.instanceId, signal),
    [toolCatalog.countOpenWindows.name]: (args, { signal }) =>
      bridge.countOpenWindows(args.instanceId, signal),
    [toolCatalog.listTabs.name]: (args, { signal }) =>
      bridge.listTabs(
        args.instanceId,
        { limit: args.limit, offset: args.offset },
        signal,
      ),
    [toolCatalog.openTab.name]: (args, { signal }) =>
      bridge.openTab(
        args.instanceId,
        { url: args.url, windowId: args.windowId },
        signal,
      ),
    [toolCatalog.closeTab.name]: (args, { signal }) =>
      bridge.closeTab(args.instanceId, args.tabId, signal),
    [toolCatalog.moveTab.name]: (args, { signal }) =>
      bridge.moveTab(args.instanceId, args.tabId, args.targetWindowId, signal),
  };
}