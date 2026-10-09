import * as z from 'zod/v4';
import {
  searchBookmarksPayloadSchema,
  searchBookmarksResultSchema,
  searchTagsPayloadSchema,
  searchTagsResultSchema,
  browserOpenTabUrlSchema,
  browserSafeIntegerSchema,
  closeTabResultSchema,
  countOpenTabsResultSchema,
  countOpenWindowsResultSchema,
  listTabsPayloadSchema,
  listTabsResultSchema,
  moveTabResultSchema,
  openTabResultSchema,
} from '../bridge/protocol.js';

export const countOpenTabsOutputSchema = countOpenTabsResultSchema;

export const devicesListTool = {
  name: 'devices.list',
  description: 'List extension instances known to this running bridge.',
  inputSchema: z
    .object({
      includeOffline: z.boolean().default(true),
      includeTabCounts: z.boolean().default(true),
    })
    .strict(),
  outputSchema: z
    .object({
      instances: z.array(
        z
          .object({
            appId: z.string(),
            instanceId: z.string(),
            extensionId: z.string(),
            browser: z.string(),
            status: z.enum(['online', 'offline']),
            lastSeen: z.string().datetime(),
            displayName: z.string().nullable(),
            capabilities: z
              .object({ operations: z.array(z.string()) })
              .strict(),
            countStatus: z.enum([
              'ok',
              'offline',
              'unsupported',
              'timeout',
              'error',
              'not_requested',
            ]),
            tabCount: z.number().int().nonnegative().nullable(),
            countedAt: z.string().datetime().optional(),
          })
          .strict(),
      ),
      totalTabs: z.number().int().nonnegative().nullable(),
      complete: z.boolean(),
      queriedAt: z.string().datetime(),
    })
    .strict(),
} as const;

export const countOpenTabsTool = {
  name: 'browser.countOpenTabs',
  description: 'Count normal-window tabs for one connected extension instance.',
  inputSchema: z.object({ instanceId: z.string().uuid() }).strict(),
  outputSchema: countOpenTabsOutputSchema,
} as const;

export const countOpenWindowsTool = {
  name: 'browser.countOpenWindows',
  description: 'Count normal browser windows for one connected extension instance.',
  inputSchema: z.object({ instanceId: z.string().uuid() }).strict(),
  outputSchema: countOpenWindowsResultSchema,
} as const;

export const listTabsTool = {
  name: 'browser.listTabs',
  description: 'List bounded tab metadata from normal windows for one connected extension instance.',
  inputSchema: z
    .object({
      instanceId: z.string().uuid(),
      limit: listTabsPayloadSchema.shape.limit,
      offset: listTabsPayloadSchema.shape.offset,
    })
    .strict(),
  outputSchema: listTabsResultSchema,
} as const;

export const openTabTool = {
  name: 'browser.openTab',
  description: 'Open a tab in a normal window, defaulting to about:blank.',
  inputSchema: z
    .object({
      instanceId: z.string().uuid(),
      url: browserOpenTabUrlSchema.optional(),
      windowId: browserSafeIntegerSchema.optional(),
    })
    .strict(),
  outputSchema: openTabResultSchema,
} as const;

export const closeTabTool = {
  name: 'browser.closeTab',
  description: 'Close one tab in a normal browser window.',
  inputSchema: z
    .object({
      instanceId: z.string().uuid(),
      tabId: browserSafeIntegerSchema,
    })
    .strict(),
  outputSchema: closeTabResultSchema,
} as const;

export const moveTabTool = {
  name: 'browser.moveTab',
  description: 'Move one tab between normal browser windows.',
  inputSchema: z
    .object({
      instanceId: z.string().uuid(),
      tabId: browserSafeIntegerSchema,
      targetWindowId: browserSafeIntegerSchema,
    })
    .strict(),
  outputSchema: moveTabResultSchema,
} as const;

export const searchBookmarksTool = {
  name: 'bookmarks.search',
  description: 'Search saved bookmarks in one extension instance. Extract actual tag names from the user request into keywords, or discover tag IDs with tags.search. Every keyword and tag ID is required (AND). Keywords match exact names including ancestors, ignoring case and width; selected IDs include descendants and distinguish same-named folders. No synonym expansion. Optional search matches title or URL. Returns bounded metadata with totalCount and nextOffset; truncated marks shortened fields. Follow nextOffset to retrieve more results.',
  inputSchema: searchBookmarksPayloadSchema.extend({instanceId: z.string().uuid()}).strict(),
  outputSchema: searchBookmarksResultSchema,
} as const;
export const searchTagsTool = {
  name: 'tags.search',
  description: 'Discover saved tag keywords and IDs in one extension instance before interpreting a natural-language bookmark request. Query is a case- and width-insensitive substring of the full ancestor path; empty query browses tags. Use the returned exact names or IDs in bookmarks.search. No synonym expansion. Returns at most 10 tags per page with totalCount and nextOffset. IDs remain usable when truncated marks a shortened name or path.',
  inputSchema: searchTagsPayloadSchema.extend({instanceId: z.string().uuid()}).strict(),
  outputSchema: searchTagsResultSchema,
} as const;

export const toolCatalog = {
  searchBookmarks: searchBookmarksTool,
  searchTags: searchTagsTool,
  devicesList: devicesListTool,
  countOpenTabs: countOpenTabsTool,
  countOpenWindows: countOpenWindowsTool,
  listTabs: listTabsTool,
  openTab: openTabTool,
  closeTab: closeTabTool,
  moveTab: moveTabTool,
} as const;

export type ToolDefinition = (typeof toolCatalog)[keyof typeof toolCatalog];
export type ToolName = ToolDefinition['name'];
export type ToolDefinitionFor<Name extends ToolName> = Extract<
  ToolDefinition,
  { name: Name }
>;
export type ToolArguments<Name extends ToolName> = z.output<
  ToolDefinitionFor<Name>['inputSchema']
>;
export type ToolResult<Name extends ToolName> = z.output<
  ToolDefinitionFor<Name>['outputSchema']
>;