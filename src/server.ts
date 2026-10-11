import { McpServer } from '@modelcontextprotocol/server';
import { asBridgeError } from './bridge/errors.js';
import type { BridgeService } from './bridge/service.js';
import { PACKAGE_VERSION } from './version.js';
import { toolCatalog } from './tools/catalog.js';
import type { ToolExecutor } from './tools/executor.js';

function toolError(error: unknown) {
  const normalizedError = asBridgeError(error);
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

  server.registerTool(toolCatalog.searchBookmarks.name, {
    description: toolCatalog.searchBookmarks.description,
    inputSchema: toolCatalog.searchBookmarks.inputSchema,
    outputSchema: toolCatalog.searchBookmarks.outputSchema,
    annotations: {readOnlyHint: true, destructiveHint: false, openWorldHint: false},
  }, async (args, context) => {
    try { return toolSuccess(await executor[toolCatalog.searchBookmarks.name](args, {signal: context.mcpReq.signal})); }
    catch (error) { return toolError(error); }
  });
  server.registerTool(toolCatalog.searchTags.name, {
    description: toolCatalog.searchTags.description,
    inputSchema: toolCatalog.searchTags.inputSchema,
    outputSchema: toolCatalog.searchTags.outputSchema,
    annotations: {readOnlyHint: true, destructiveHint: false, openWorldHint: false},
  }, async (args, context) => {
    try { return toolSuccess(await executor[toolCatalog.searchTags.name](args, {signal: context.mcpReq.signal})); }
    catch (error) { return toolError(error); }
  });

  server.registerTool(toolCatalog.createBookmark.name, {
    description: toolCatalog.createBookmark.description,
    inputSchema: toolCatalog.createBookmark.inputSchema,
    outputSchema: toolCatalog.createBookmark.outputSchema,
    annotations: toolCatalog.createBookmark.annotations,
  }, async (args, context) => {
    try {
      const result = await executor[toolCatalog.createBookmark.name](args, {signal: context.mcpReq.signal});
      return {...toolSuccess(result), isError: result.status !== 'success'};
    } catch (error) { return toolError(error); }
  });
  server.registerTool(toolCatalog.updateBookmark.name, {
    description: toolCatalog.updateBookmark.description,
    inputSchema: toolCatalog.updateBookmark.inputSchema,
    outputSchema: toolCatalog.updateBookmark.outputSchema,
    annotations: toolCatalog.updateBookmark.annotations,
  }, async (args, context) => {
    try {
      const result = await executor[toolCatalog.updateBookmark.name](args, {signal: context.mcpReq.signal});
      return {...toolSuccess(result), isError: result.status !== 'success'};
    } catch (error) { return toolError(error); }
  });
  server.registerTool(toolCatalog.deleteBookmark.name, {
    description: toolCatalog.deleteBookmark.description,
    inputSchema: toolCatalog.deleteBookmark.inputSchema,
    outputSchema: toolCatalog.deleteBookmark.outputSchema,
    annotations: toolCatalog.deleteBookmark.annotations,
  }, async (args, context) => {
    try {
      const result = await executor[toolCatalog.deleteBookmark.name](args, {signal: context.mcpReq.signal});
      return {...toolSuccess(result), isError: result.status !== 'success'};
    } catch (error) { return toolError(error); }
  });
  server.registerTool(toolCatalog.replaceBookmarkTags.name, {
    description: toolCatalog.replaceBookmarkTags.description,
    inputSchema: toolCatalog.replaceBookmarkTags.inputSchema,
    outputSchema: toolCatalog.replaceBookmarkTags.outputSchema,
    annotations: toolCatalog.replaceBookmarkTags.annotations,
  }, async (args, context) => {
    try {
      const result = await executor[toolCatalog.replaceBookmarkTags.name](args, {signal: context.mcpReq.signal});
      return {...toolSuccess(result), isError: result.status !== 'success'};
    } catch (error) { return toolError(error); }
  });
  server.registerTool(toolCatalog.setBookmarkTagMembership.name, {
    description: toolCatalog.setBookmarkTagMembership.description,
    inputSchema: toolCatalog.setBookmarkTagMembership.inputSchema,
    outputSchema: toolCatalog.setBookmarkTagMembership.outputSchema,
    annotations: toolCatalog.setBookmarkTagMembership.annotations,
  }, async (args, context) => {
    try {
      const result = await executor[toolCatalog.setBookmarkTagMembership.name](args, {signal: context.mcpReq.signal});
      return {...toolSuccess(result), isError: result.status !== 'success'};
    } catch (error) { return toolError(error); }
  });
  server.registerTool(toolCatalog.createTag.name, {
    description: toolCatalog.createTag.description,
    inputSchema: toolCatalog.createTag.inputSchema,
    outputSchema: toolCatalog.createTag.outputSchema,
    annotations: toolCatalog.createTag.annotations,
  }, async (args, context) => {
    try {
      const result = await executor[toolCatalog.createTag.name](args, {signal: context.mcpReq.signal});
      return {...toolSuccess(result), isError: result.status !== 'success'};
    } catch (error) { return toolError(error); }
  });
  server.registerTool(toolCatalog.createTagPath.name, {
    description: toolCatalog.createTagPath.description,
    inputSchema: toolCatalog.createTagPath.inputSchema,
    outputSchema: toolCatalog.createTagPath.outputSchema,
    annotations: toolCatalog.createTagPath.annotations,
  }, async (args, context) => {
    try {
      const result = await executor[toolCatalog.createTagPath.name](args, {signal: context.mcpReq.signal});
      return {...toolSuccess(result), isError: result.status !== 'success'};
    } catch (error) { return toolError(error); }
  });
  server.registerTool(toolCatalog.updateTag.name, {
    description: toolCatalog.updateTag.description,
    inputSchema: toolCatalog.updateTag.inputSchema,
    outputSchema: toolCatalog.updateTag.outputSchema,
    annotations: toolCatalog.updateTag.annotations,
  }, async (args, context) => {
    try {
      const result = await executor[toolCatalog.updateTag.name](args, {signal: context.mcpReq.signal});
      return {...toolSuccess(result), isError: result.status !== 'success'};
    } catch (error) { return toolError(error); }
  });
  server.registerTool(toolCatalog.previewDeleteTag.name, {
    description: toolCatalog.previewDeleteTag.description,
    inputSchema: toolCatalog.previewDeleteTag.inputSchema,
    outputSchema: toolCatalog.previewDeleteTag.outputSchema,
    annotations: toolCatalog.previewDeleteTag.annotations,
  }, async (args, context) => {
    try {
      const result = await executor[toolCatalog.previewDeleteTag.name](args, {signal: context.mcpReq.signal});
      return {...toolSuccess(result)};
    } catch (error) { return toolError(error); }
  });
  server.registerTool(toolCatalog.deleteTag.name, {
    description: toolCatalog.deleteTag.description,
    inputSchema: toolCatalog.deleteTag.inputSchema,
    outputSchema: toolCatalog.deleteTag.outputSchema,
    annotations: toolCatalog.deleteTag.annotations,
  }, async (args, context) => {
    try {
      const result = await executor[toolCatalog.deleteTag.name](args, {signal: context.mcpReq.signal});
      return {...toolSuccess(result), isError: result.status !== 'success'};
    } catch (error) { return toolError(error); }
  });

  return server;
}

function isToolExecutor(
  source: BridgeService | ToolExecutor,
): source is ToolExecutor {
  return Object.values(toolCatalog).every(
    ({ name }) => typeof (source as ToolExecutor)[name] === 'function',
  );
}

export function createBridgeExecutor(bridge: BridgeService): ToolExecutor {
  return {
    [toolCatalog.createBookmark.name]: ({instanceId, ...payload}, {signal}) => bridge.libraryOperation(instanceId, 'bookmarks.create', payload, signal),
    [toolCatalog.updateBookmark.name]: ({instanceId, ...payload}, {signal}) => bridge.libraryOperation(instanceId, 'bookmarks.update', payload, signal),
    [toolCatalog.deleteBookmark.name]: ({instanceId, ...payload}, {signal}) => bridge.libraryOperation(instanceId, 'bookmarks.delete', payload, signal),
    [toolCatalog.replaceBookmarkTags.name]: ({instanceId, ...payload}, {signal}) => bridge.libraryOperation(instanceId, 'bookmarks.replaceTags', payload, signal),
    [toolCatalog.setBookmarkTagMembership.name]: ({instanceId, ...payload}, {signal}) => bridge.libraryOperation(instanceId, 'bookmarks.setTagMembership', payload, signal),
    [toolCatalog.createTag.name]: ({instanceId, ...payload}, {signal}) => bridge.libraryOperation(instanceId, 'tags.create', payload, signal),
    [toolCatalog.createTagPath.name]: ({instanceId, ...payload}, {signal}) => bridge.libraryOperation(instanceId, 'tags.createPath', payload, signal),
    [toolCatalog.updateTag.name]: ({instanceId, ...payload}, {signal}) => bridge.libraryOperation(instanceId, 'tags.update', payload, signal),
    [toolCatalog.previewDeleteTag.name]: ({instanceId, ...payload}, {signal}) => bridge.libraryOperation(instanceId, 'tags.previewDelete', payload, signal),
    [toolCatalog.deleteTag.name]: ({instanceId, ...payload}, {signal}) => bridge.libraryOperation(instanceId, 'tags.delete', payload, signal),
    [toolCatalog.searchBookmarks.name]: ({instanceId, ...payload}, {signal}) => bridge.searchBookmarks(instanceId, payload, signal),
    [toolCatalog.searchTags.name]: ({instanceId, ...payload}, {signal}) => bridge.searchTags(instanceId, payload, signal),
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
