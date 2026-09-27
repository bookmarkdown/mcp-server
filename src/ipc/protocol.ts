import * as z from 'zod/v4';
import { toolCatalog } from '../tools/catalog.js';

export const IPC_PROTOCOL_VERSION = 3 as const;

const packageVersionPattern =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;

export const ipcProtocolVersionSchema = z
  .number()
  .int()
  .min(1)
  .max(0x7fffffff);

export const ipcPackageVersionSchema = z
  .string()
  .min(5)
  .max(128)
  .regex(packageVersionPattern);

export const ipcRequestIdSchema = z.string().uuid();

export const ipcHelloRequestSchema = z
  .object({
    type: z.literal('hello'),
    protocolVersion: ipcProtocolVersionSchema,
    packageVersion: ipcPackageVersionSchema,
  })
  .strict();

export const ipcHelloResponseSchema = z
  .object({
    type: z.literal('hello.response'),
    protocolVersion: ipcProtocolVersionSchema,
    packageVersion: ipcPackageVersionSchema,
    status: z.enum([
      'ready',
      'protocol_version_mismatch',
      'package_version_mismatch',
    ]),
  })
  .strict();

export const ipcHealthRequestSchema = z
  .object({
    type: z.literal('health'),
    requestId: ipcRequestIdSchema,
  })
  .strict();

export const ipcHealthStatusSchema = z
  .object({
    protocolVersion: ipcProtocolVersionSchema,
    packageVersion: ipcPackageVersionSchema,
    runtimeMode: z.enum(['development', 'production']),
    daemonStatus: z.enum(['ready', 'shutting_down']),
    extensionStatus: z.enum(['connected', 'not_connected']),
  })
  .strict();

export const ipcHealthResponseSchema = z
  .object({
    type: z.literal('health.response'),
    requestId: ipcRequestIdSchema,
    status: ipcHealthStatusSchema,
  })
  .strict();

export const ipcCallRequestSchema = z.discriminatedUnion('toolName', [
  z
    .object({
      type: z.literal('call'),
      requestId: ipcRequestIdSchema,
      toolName: z.literal('devices.list'),
      arguments: toolCatalog.devicesList.inputSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('call'),
      requestId: ipcRequestIdSchema,
      toolName: z.literal('browser.countOpenTabs'),
      arguments: toolCatalog.countOpenTabs.inputSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('call'),
      requestId: ipcRequestIdSchema,
      toolName: z.literal('browser.countOpenWindows'),
      arguments: toolCatalog.countOpenWindows.inputSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('call'),
      requestId: ipcRequestIdSchema,
      toolName: z.literal('browser.listTabs'),
      arguments: toolCatalog.listTabs.inputSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('call'),
      requestId: ipcRequestIdSchema,
      toolName: z.literal('browser.openTab'),
      arguments: toolCatalog.openTab.inputSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('call'),
      requestId: ipcRequestIdSchema,
      toolName: z.literal('browser.closeTab'),
      arguments: toolCatalog.closeTab.inputSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('call'),
      requestId: ipcRequestIdSchema,
      toolName: z.literal('browser.moveTab'),
      arguments: toolCatalog.moveTab.inputSchema,
    })
    .strict(),
]);

export const ipcCancelRequestSchema = z
  .object({
    type: z.literal('cancel'),
    requestId: ipcRequestIdSchema,
  })
  .strict();

export const IPC_ERROR_CODES = [
  'DAEMON_UNAVAILABLE',
  'DAEMON_DISCONNECTED',
  'DAEMON_VERSION_MISMATCH',
  'EXTENSION_NOT_CONNECTED',
  'UNSUPPORTED_OPERATION',
  'REQUEST_TIMEOUT',
  'EXTENSION_DISCONNECTED',
  'EXTENSION_OPERATION_FAILED',
  'REQUEST_CANCELLED',
  'BRIDGE_BUSY',
  'INVALID_EXTENSION_RESPONSE',
  'INTERNAL_ERROR',
] as const;

export const ipcErrorCodeSchema = z.enum(IPC_ERROR_CODES);

export const ipcErrorSchema = z
  .object({
    code: ipcErrorCodeSchema,
  })
  .strict();

export const ipcResponseSchema = z.discriminatedUnion('ok', [
  z
    .object({
      type: z.literal('response'),
      requestId: ipcRequestIdSchema,
      ok: z.literal(true),
      result: z.json(),
    })
    .strict(),
  z
    .object({
      type: z.literal('response'),
      requestId: ipcRequestIdSchema,
      ok: z.literal(false),
      error: ipcErrorSchema,
    })
    .strict(),
]);

export const ipcRequestSchema = z.union([
  ipcHelloRequestSchema,
  ipcHealthRequestSchema,
  ipcCallRequestSchema,
  ipcCancelRequestSchema,
]);

export const ipcServerMessageSchema = z.union([
  ipcHelloResponseSchema,
  ipcHealthResponseSchema,
  ipcResponseSchema,
]);

export const ipcMessageSchema = z.union([
  ipcRequestSchema,
  ipcServerMessageSchema,
]);

export type IpcHelloRequest = z.infer<typeof ipcHelloRequestSchema>;
export type IpcHelloResponse = z.infer<typeof ipcHelloResponseSchema>;
export type IpcHealthRequest = z.infer<typeof ipcHealthRequestSchema>;
export type IpcHealthStatus = z.infer<typeof ipcHealthStatusSchema>;
export type IpcHealthResponse = z.infer<typeof ipcHealthResponseSchema>;
export type IpcCallRequest = z.infer<typeof ipcCallRequestSchema>;
export type IpcCancelRequest = z.infer<typeof ipcCancelRequestSchema>;
export type IpcErrorCode = z.infer<typeof ipcErrorCodeSchema>;
export type IpcError = z.infer<typeof ipcErrorSchema>;
export type IpcResponse = z.infer<typeof ipcResponseSchema>;
export type IpcRequest = z.infer<typeof ipcRequestSchema>;
export type IpcServerMessage = z.infer<typeof ipcServerMessageSchema>;
export type IpcMessage = z.infer<typeof ipcMessageSchema>;