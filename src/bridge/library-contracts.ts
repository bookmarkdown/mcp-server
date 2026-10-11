import * as z from 'zod/v4';

const id = z.number().int().positive().safe();
const tagIds = z.array(id).max(500);
const bookmarkInput = z.object({
  contentUrl: z.string().min(1).max(8192), title: z.string().max(4096),
  description: z.string().max(8192), tagIds: tagIds.optional(),
}).strict();
const tagInput = z.object({name: z.string().min(1).max(2048), color: z.string().max(64), parentId: id.nullable()}).strict();
// Keep the whole encoded payload inside the extension's request limit, including escapes.
const bounded = <T extends z.ZodObject>(schema: T) => schema.refine(
  value => Buffer.byteLength(JSON.stringify(value), 'utf8') <= 12_000, 'Library payload exceeds 12000 bytes',
);
export const libraryMutationResultSchema = z.object({
  status: z.enum(['success', 'duplicate', 'invalid', 'conflict']),
  value: z.object({id}).strict().optional(), field: z.string().max(128).optional(),
  message: z.string().max(1024).optional(),
}).strict().refine(result => {
  if (result.status === 'success') return result.value !== undefined && result.field === undefined && result.message === undefined;
  if (result.status === 'duplicate') return Object.keys(result).length === 1;
  if (result.status === 'invalid') return result.value === undefined && result.field !== undefined && result.message !== undefined;
  return result.value === undefined && result.field === undefined && result.message !== undefined;
}, 'Invalid mutation result');
const count = z.number().int().nonnegative().safe();
const previewResult = z.object({directChildCount: count, descendantTagCount: count,
  directBookmarkCount: count, subtreeBookmarkCount: count}).strict();

export const libraryOperationContracts = {
  'bookmarks.create': {payload: bounded(z.object({input: bookmarkInput}).strict()), result: libraryMutationResultSchema},
  'bookmarks.update': {payload: bounded(z.object({id, input: bookmarkInput}).strict()), result: libraryMutationResultSchema},
  'bookmarks.delete': {payload: bounded(z.object({id}).strict()), result: libraryMutationResultSchema},
  'bookmarks.replaceTags': {payload: bounded(z.object({bookmarkId: id, tagIds}).strict()), result: libraryMutationResultSchema},
  'bookmarks.setTagMembership': {payload: bounded(z.object({bookmarkId: id, tagId: id, assigned: z.boolean()}).strict()), result: libraryMutationResultSchema},
  'tags.create': {payload: bounded(z.object({input: tagInput}).strict()), result: libraryMutationResultSchema},
  'tags.createPath': {payload: bounded(z.object({input: z.object({path: z.string().min(1).max(8192), color: z.string().max(64)}).strict()}).strict()), result: libraryMutationResultSchema},
  'tags.update': {payload: bounded(z.object({id, input: tagInput}).strict()), result: libraryMutationResultSchema},
  'tags.previewDelete': {payload: bounded(z.object({id}).strict()), result: previewResult},
  'tags.delete': {payload: bounded(z.object({id, strategy: z.enum(['subtree', 'promote'])}).strict()), result: libraryMutationResultSchema},
} as const;
export type LibraryOperation = keyof typeof libraryOperationContracts;
export const libraryRequestSchemas = [
  z.object({type: z.literal('browser/request'), requestId: z.string().uuid(), operation: z.literal('bookmarks.create'), payload: libraryOperationContracts['bookmarks.create'].payload}).strict(),
  z.object({type: z.literal('browser/request'), requestId: z.string().uuid(), operation: z.literal('bookmarks.update'), payload: libraryOperationContracts['bookmarks.update'].payload}).strict(),
  z.object({type: z.literal('browser/request'), requestId: z.string().uuid(), operation: z.literal('bookmarks.delete'), payload: libraryOperationContracts['bookmarks.delete'].payload}).strict(),
  z.object({type: z.literal('browser/request'), requestId: z.string().uuid(), operation: z.literal('bookmarks.replaceTags'), payload: libraryOperationContracts['bookmarks.replaceTags'].payload}).strict(),
  z.object({type: z.literal('browser/request'), requestId: z.string().uuid(), operation: z.literal('bookmarks.setTagMembership'), payload: libraryOperationContracts['bookmarks.setTagMembership'].payload}).strict(),
  z.object({type: z.literal('browser/request'), requestId: z.string().uuid(), operation: z.literal('tags.create'), payload: libraryOperationContracts['tags.create'].payload}).strict(),
  z.object({type: z.literal('browser/request'), requestId: z.string().uuid(), operation: z.literal('tags.createPath'), payload: libraryOperationContracts['tags.createPath'].payload}).strict(),
  z.object({type: z.literal('browser/request'), requestId: z.string().uuid(), operation: z.literal('tags.update'), payload: libraryOperationContracts['tags.update'].payload}).strict(),
  z.object({type: z.literal('browser/request'), requestId: z.string().uuid(), operation: z.literal('tags.previewDelete'), payload: libraryOperationContracts['tags.previewDelete'].payload}).strict(),
  z.object({type: z.literal('browser/request'), requestId: z.string().uuid(), operation: z.literal('tags.delete'), payload: libraryOperationContracts['tags.delete'].payload}).strict(),
] as const;
