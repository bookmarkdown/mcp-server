import * as z from 'zod/v4';
const id = z.number().int().nonnegative().safe();
const cursor = z.string().regex(/^[0-9a-f-]{36}:\d{1,7}$/);
const info = {nextCursor: cursor.nullable(), capturedAt: z.string().datetime(), expiresAt: z.string().datetime()};
const search = z.object({limit: z.number().int().min(1).max(10).default(10), cursor: cursor.optional(),
  windowId: id.optional(), domain: z.string().regex(/^[a-zA-Z0-9.-]{1,253}$/).optional(), search: z.string().max(256).optional(),
}).strict().refine(p => !p.cursor || (p.windowId === undefined && p.domain === undefined && p.search === undefined), 'Continuation cannot change filters');
const read = z.object({tabId: id, mode: z.enum(['excerpt', 'text']).default('excerpt'),
  maxChars: z.number().int().min(256).max(8000).optional(), cursor: cursor.optional(),
}).strict();
const bounded = <T extends z.ZodObject>(schema: T) => schema.refine(value => Buffer.byteLength(JSON.stringify(value), 'utf8') <= 48000, 'Response too large');
export const readingContracts = {
  'browser.searchTabs': {payload: search, result: bounded(z.object({...info, totalCount: id.max(5000),
    tabs: z.array(z.object({tabId: id, windowId: id, active: z.boolean(), title: z.string().max(512), url: z.string().max(2048), truncated: z.boolean()}).strict()).max(10),
  }).strict())},
  'browser.readTabContent': {payload: read, result: bounded(z.object({...info, tabId: id, mode: z.enum(['excerpt','text']),
    url: z.string().max(8192).url(), title: z.string().max(512), description: z.string().max(1024),
    headings: z.array(z.string().max(256)).max(20), text: z.string().max(8000), sourceTruncated: z.boolean(), truncated: z.boolean(),
  }).strict())},
} as const;
export type ReadingOperation = keyof typeof readingContracts;
export const readingRequestSchemas = [
  z.object({type: z.literal('browser/request'), requestId: z.string().uuid(), operation: z.literal('browser.searchTabs'), payload: search}).strict(),
  z.object({type: z.literal('browser/request'), requestId: z.string().uuid(), operation: z.literal('browser.readTabContent'), payload: read}).strict(),
] as const;
