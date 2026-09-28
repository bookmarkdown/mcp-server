import { Buffer } from 'node:buffer';
import * as z from 'zod/v4';
import type { RawData } from 'ws';

export const PROTOCOL_VERSION = '2' as const;
export const APP_ID = 'bmd-extension' as const;
export const COUNT_OPEN_TABS_OPERATION = 'browser.countOpenTabs' as const;
export const COUNT_OPEN_WINDOWS_OPERATION = 'browser.countOpenWindows' as const;
export const LIST_TABS_OPERATION = 'browser.listTabs' as const;
export const OPEN_TAB_OPERATION = 'browser.openTab' as const;
export const CLOSE_TAB_OPERATION = 'browser.closeTab' as const;
export const MOVE_TAB_OPERATION = 'browser.moveTab' as const;

export const browserSafeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);

function boundedUtf8String(maxCharacters: number, maxBytes: number) {
  return z
    .string()
    .max(maxCharacters)
    .refine((value) => Buffer.byteLength(value, 'utf8') <= maxBytes);
}

export const browserTabTitleSchema = boundedUtf8String(512, 1024);
export const browserTabUrlSchema = boundedUtf8String(2048, 2048);

export const browserOpenTabUrlSchema = browserTabUrlSchema.refine((value) => {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}, 'URL must be an absolute, credential-free HTTP or HTTPS URL.');

export const countOpenTabsResultSchema = z
  .object({
    count: browserSafeIntegerSchema,
    countedAt: z.string().datetime(),
  })
  .strict();

export const countOpenWindowsResultSchema = countOpenTabsResultSchema;

export const browserTabSchema = z
  .object({
    tabId: browserSafeIntegerSchema,
    windowId: browserSafeIntegerSchema,
    active: z.boolean(),
    title: browserTabTitleSchema,
    url: browserTabUrlSchema,
  })
  .strict();

export const listTabsPayloadSchema = z
  .object({
    limit: z.number().int().min(1).max(10).default(10),
    offset: browserSafeIntegerSchema.default(0),
  })
  .strict();

export const listTabsResultSchema = z
  .object({
    tabs: z.array(browserTabSchema).max(10),
    nextOffset: browserSafeIntegerSchema.nullable(),
    queriedAt: z.string().datetime(),
  })
  .strict();

export const openTabPayloadSchema = z
  .object({
    url: browserOpenTabUrlSchema.optional(),
    windowId: browserSafeIntegerSchema.optional(),
  })
  .strict();

export const openTabResultSchema = z
  .object({
    tabId: browserSafeIntegerSchema,
    windowId: browserSafeIntegerSchema,
    url: browserTabUrlSchema,
  })
  .strict();

export const closeTabPayloadSchema = z
  .object({ tabId: browserSafeIntegerSchema })
  .strict();

export const closeTabResultSchema = z
  .object({
    tabId: browserSafeIntegerSchema,
    closed: z.literal(true),
  })
  .strict();

export const moveTabPayloadSchema = z
  .object({
    tabId: browserSafeIntegerSchema,
    targetWindowId: browserSafeIntegerSchema,
  })
  .strict();

export const moveTabResultSchema = z
  .object({
    tabId: browserSafeIntegerSchema,
    sourceWindowId: browserSafeIntegerSchema,
    targetWindowId: browserSafeIntegerSchema,
  })
  .strict();

export const browserOperationContracts = {
  [COUNT_OPEN_TABS_OPERATION]: {
    payload: z.object({}).strict(),
    result: countOpenTabsResultSchema,
  },
  [COUNT_OPEN_WINDOWS_OPERATION]: {
    payload: z.object({}).strict(),
    result: countOpenWindowsResultSchema,
  },
  [LIST_TABS_OPERATION]: {
    payload: listTabsPayloadSchema,
    result: listTabsResultSchema,
  },
  [OPEN_TAB_OPERATION]: {
    payload: openTabPayloadSchema,
    result: openTabResultSchema,
  },
  [CLOSE_TAB_OPERATION]: {
    payload: closeTabPayloadSchema,
    result: closeTabResultSchema,
  },
  [MOVE_TAB_OPERATION]: {
    payload: moveTabPayloadSchema,
    result: moveTabResultSchema,
  },
} as const;

export type BrowserOperation = keyof typeof browserOperationContracts;
export type BrowserOperationPayload<Operation extends BrowserOperation> =
  z.output<(typeof browserOperationContracts)[Operation]['payload']>;
export type BrowserOperationResult<Operation extends BrowserOperation> =
  z.output<(typeof browserOperationContracts)[Operation]['result']>;

export const extensionHelloSchema = z
  .object({
    type: z.literal('hello'),
    mode: z.literal('probe').optional(),
    protocolVersion: z.string().min(1).max(32),
    token: z.string().min(1).max(512),
    appId: z.string().min(1).max(64),
    instanceId: z.string().uuid(),
    displayName: z.string().min(1).max(64).regex(/^[\p{L}\p{N}]+(?:[ -][\p{L}\p{N}]+)*$/u).optional(),
    extensionId: z.string().regex(/^[a-p]{32}$/),
    browser: z.string().min(1).max(32),
    capabilities: z
      .object({
        operations: z.array(z.string().min(1).max(80)).max(64),
      })
      .strict(),
  })
  .strict();

export type ExtensionHello = z.infer<typeof extensionHelloSchema>;

export const browserRequestSchema = z.discriminatedUnion('operation', [
  z
    .object({
      type: z.literal('browser/request'),
      requestId: z.string().uuid(),
      operation: z.literal(COUNT_OPEN_TABS_OPERATION),
      payload: browserOperationContracts[COUNT_OPEN_TABS_OPERATION].payload,
    })
    .strict(),
  z
    .object({
      type: z.literal('browser/request'),
      requestId: z.string().uuid(),
      operation: z.literal(COUNT_OPEN_WINDOWS_OPERATION),
      payload: browserOperationContracts[COUNT_OPEN_WINDOWS_OPERATION].payload,
    })
    .strict(),
  z
    .object({
      type: z.literal('browser/request'),
      requestId: z.string().uuid(),
      operation: z.literal(LIST_TABS_OPERATION),
      payload: browserOperationContracts[LIST_TABS_OPERATION].payload,
    })
    .strict(),
  z
    .object({
      type: z.literal('browser/request'),
      requestId: z.string().uuid(),
      operation: z.literal(OPEN_TAB_OPERATION),
      payload: browserOperationContracts[OPEN_TAB_OPERATION].payload,
    })
    .strict(),
  z
    .object({
      type: z.literal('browser/request'),
      requestId: z.string().uuid(),
      operation: z.literal(CLOSE_TAB_OPERATION),
      payload: browserOperationContracts[CLOSE_TAB_OPERATION].payload,
    })
    .strict(),
  z
    .object({
      type: z.literal('browser/request'),
      requestId: z.string().uuid(),
      operation: z.literal(MOVE_TAB_OPERATION),
      payload: browserOperationContracts[MOVE_TAB_OPERATION].payload,
    })
    .strict(),
]);

export type BrowserRequest = z.infer<typeof browserRequestSchema>;

export const browserResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      type: z.literal('browser/response'),
      requestId: z.string().uuid(),
      ok: z.literal(true),
      data: z.record(z.string(), z.unknown()),
    })
    .strict(),
  z
    .object({
      type: z.literal('browser/response'),
      requestId: z.string().uuid(),
      ok: z.literal(false),
      error: z
        .object({
          name: z.string().min(1).max(128),
          message: z.string().max(1024),
          code: z.string().min(1).max(128),
        })
        .strict(),
    })
    .strict(),
]);

export type BrowserResponse = z.infer<typeof browserResponseSchema>;

export type CountOpenTabsResult = z.infer<typeof countOpenTabsResultSchema>;

export function rawDataToBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data);
  }
  return Buffer.from(data);
}