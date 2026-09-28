import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import type { Socket } from 'node:net';
import {
  DEFAULT_IPC_MAX_PAYLOAD_BYTES,
  IpcFrameDecoder,
  encodeIpcFrame,
} from './framing.js';
import { connectLocalPipe } from './transport.js';
import {
  IPC_PROTOCOL_VERSION,
  ipcCallRequestSchema,
  ipcHealthRequestSchema,
  ipcPackageVersionSchema,
  ipcServerMessageSchema,
  type IpcCallRequest,
  type IpcErrorCode,
  type IpcHealthStatus,
  type IpcHelloResponse,
  type IpcServerMessage,
} from './protocol.js';
import { toolCatalog, type ToolArguments, type ToolName, type ToolResult } from '../tools/catalog.js';
import type { ToolExecutor } from '../tools/executor.js';

const packageMetadata = createRequire(import.meta.url)('../../package.json') as {
  version: string;
};

export const DEFAULT_IPC_PIPE_NAME = 'bookmarkdown-mcp';
export const DEFAULT_IPC_REQUEST_TIMEOUT_MS = 5000;
export const DEFAULT_IPC_HANDSHAKE_TIMEOUT_MS = 5000;
export const DEFAULT_IPC_MAX_PENDING_REQUESTS = 32;
export const DEFAULT_IPC_CONNECTION_ATTEMPTS = 2;
export const DEFAULT_IPC_RECONNECT_DELAY_MS = 50;
export const PACKAGE_VERSION = ipcPackageVersionSchema.parse(
  packageMetadata.version,
);

const manualRestartMessage =
  'The running BookMarkdown daemon uses a different package or IPC protocol version. Stop and restart it manually with the matching package version.';

const errorMessages: Record<IpcErrorCode, string> = {
  DAEMON_UNAVAILABLE:
    'The local BookMarkdown daemon is unavailable. Start it manually and try again.',
  DAEMON_DISCONNECTED:
    'The daemon disconnected after the request was sent. Its outcome is unknown; the call was not retried.',
  DAEMON_VERSION_MISMATCH: manualRestartMessage,
  EXTENSION_NOT_CONNECTED:
    'No extension instance is connected to the local daemon.',
  UNSUPPORTED_OPERATION:
    'The extension does not support the requested browser operation.',
  REQUEST_TIMEOUT:
    'The daemon did not answer before the request timed out. The call was not retried.',
  EXTENSION_DISCONNECTED:
    'The extension disconnected before the request completed.',
  EXTENSION_OPERATION_FAILED: 'The extension reported that the operation failed.',
  REQUEST_CANCELLED: 'The MCP request was cancelled.',
  BRIDGE_BUSY: 'The daemon has reached its in-flight request limit.',
  INVALID_EXTENSION_RESPONSE: 'The daemon returned an invalid tool result.',
  INTERNAL_ERROR: 'The daemon could not complete the request.',
};

export class IpcClientError extends Error {
  public constructor(
    public readonly code: IpcErrorCode,
    message: string = errorMessages[code],
  ) {
    super(message);
    this.name = 'IpcClientError';
  }
}

export interface IpcClientOptions {
  pipeName?: string;
  packageVersion?: string;
  maxPayloadBytes?: number;
  maxPendingRequests?: number;
  requestTimeoutMs?: number;
  handshakeTimeoutMs?: number;
  connectionAttempts?: number;
  reconnectDelayMs?: number;
}

interface PendingResponse {
  kind: 'health' | 'call';
  resolve(value: unknown): void;
  reject(error: IpcClientError): void;
  timer: NodeJS.Timeout;
  signal?: AbortSignal;
  abortHandler?: () => void;
}

interface HelloPending {
  resolve(response: IpcHelloResponse): void;
  reject(error: IpcClientError): void;
  timer: NodeJS.Timeout;
}

export class IpcClient {
  readonly #pipeName: string;
  readonly #packageVersion: string;
  readonly #maxPayloadBytes: number;
  readonly #maxPendingRequests: number;
  readonly #requestTimeoutMs: number;
  readonly #handshakeTimeoutMs: number;
  readonly #connectionAttempts: number;
  readonly #reconnectDelayMs: number;
  #activeCalls = 0;
  #closed = false;
  #connection: IpcConnection | undefined;
  #connectionPromise: Promise<IpcConnection> | undefined;
  #connectionAbortController: AbortController | undefined;
  #connectionWaiters = 0;

  public readonly executor: ToolExecutor = {
    [toolCatalog.devicesList.name]: (args, { signal }) =>
      this.call(toolCatalog.devicesList.name, args, signal),
    [toolCatalog.countOpenTabs.name]: (args, { signal }) =>
      this.call(toolCatalog.countOpenTabs.name, args, signal),
    [toolCatalog.countOpenWindows.name]: (args, { signal }) =>
      this.call(toolCatalog.countOpenWindows.name, args, signal),
    [toolCatalog.listTabs.name]: (args, { signal }) =>
      this.call(toolCatalog.listTabs.name, args, signal),
    [toolCatalog.openTab.name]: (args, { signal }) =>
      this.call(toolCatalog.openTab.name, args, signal),
    [toolCatalog.closeTab.name]: (args, { signal }) =>
      this.call(toolCatalog.closeTab.name, args, signal),
    [toolCatalog.moveTab.name]: (args, { signal }) =>
      this.call(toolCatalog.moveTab.name, args, signal),
  };

  public constructor(options: IpcClientOptions = {}) {
    this.#pipeName = options.pipeName ?? DEFAULT_IPC_PIPE_NAME;
    this.#packageVersion = ipcPackageVersionSchema.parse(
      options.packageVersion ?? PACKAGE_VERSION,
    );
    this.#maxPayloadBytes = boundedInteger(
      options.maxPayloadBytes ?? DEFAULT_IPC_MAX_PAYLOAD_BYTES,
      1,
      1024 * 1024,
      'maxPayloadBytes',
    );
    this.#maxPendingRequests = boundedInteger(
      options.maxPendingRequests ?? DEFAULT_IPC_MAX_PENDING_REQUESTS,
      1,
      256,
      'maxPendingRequests',
    );
    this.#requestTimeoutMs = boundedInteger(
      options.requestTimeoutMs ?? DEFAULT_IPC_REQUEST_TIMEOUT_MS,
      100,
      60000,
      'requestTimeoutMs',
    );
    this.#handshakeTimeoutMs = boundedInteger(
      options.handshakeTimeoutMs ?? DEFAULT_IPC_HANDSHAKE_TIMEOUT_MS,
      250,
      30000,
      'handshakeTimeoutMs',
    );
    this.#connectionAttempts = boundedInteger(
      options.connectionAttempts ?? DEFAULT_IPC_CONNECTION_ATTEMPTS,
      1,
      3,
      'connectionAttempts',
    );
    this.#reconnectDelayMs = boundedInteger(
      options.reconnectDelayMs ?? DEFAULT_IPC_RECONNECT_DELAY_MS,
      0,
      1000,
      'reconnectDelayMs',
    );
  }

  public async call<Name extends ToolName>(
    toolName: Name,
    args: ToolArguments<Name>,
    signal?: AbortSignal,
  ): Promise<ToolResult<Name>> {
    if (this.#closed) {
      throw new IpcClientError('DAEMON_UNAVAILABLE');
    }
    if (signal?.aborted) {
      throw new IpcClientError('REQUEST_CANCELLED');
    }
    if (this.#activeCalls >= this.#maxPendingRequests) {
      throw new IpcClientError('BRIDGE_BUSY');
    }

    this.#activeCalls += 1;
    try {
      const connection = await this.#getReadyConnection(signal);
      if (signal?.aborted) {
        throw new IpcClientError('REQUEST_CANCELLED');
      }

      const request = ipcCallRequestSchema.parse({
        type: 'call',
        requestId: randomUUID(),
        toolName,
        arguments: args,
      });
      const result = await connection.call(
        request,
        this.#requestTimeoutMs,
        signal,
      );
      return parseToolResult(toolName, result);
    } finally {
      this.#activeCalls -= 1;
    }
  }

  public close(): void {
    if (this.#closed) {
      return;
    }

    this.#closed = true;
    this.#connectionAbortController?.abort();
    this.#connection?.close(new IpcClientError('REQUEST_CANCELLED'));
    this.#connection = undefined;
  }

  async #getReadyConnection(signal?: AbortSignal): Promise<IpcConnection> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= this.#connectionAttempts; attempt += 1) {
      if (signal?.aborted) {
        throw new IpcClientError('REQUEST_CANCELLED');
      }

      let connection: IpcConnection | undefined;
      try {
        connection = await this.#getConnection(signal);
        const health = await connection.health(
          this.#requestTimeoutMs,
          signal,
        );
        this.#validateHealth(health);
        return connection;
      } catch (error) {
        const clientError = signal?.aborted
          ? new IpcClientError('REQUEST_CANCELLED')
          : asIpcClientError(error, 'DAEMON_UNAVAILABLE');
        if (
          clientError.code === 'DAEMON_VERSION_MISMATCH' ||
          clientError.code === 'EXTENSION_NOT_CONNECTED' ||
          clientError.code === 'REQUEST_CANCELLED'
        ) {
          if (clientError.code === 'DAEMON_VERSION_MISMATCH' && connection) {
            this.#dropConnection(connection);
          }
          throw clientError;
        }

        lastError = clientError;
        if (connection) {
          this.#dropConnection(connection);
        }
        if (attempt < this.#connectionAttempts) {
          await delay(this.#reconnectDelayMs, signal);
        }
      }
    }

    if (signal?.aborted) {
      throw new IpcClientError('REQUEST_CANCELLED');
    }
    throw new IpcClientError(
      'DAEMON_UNAVAILABLE',
      lastError instanceof Error
        ? `${errorMessages.DAEMON_UNAVAILABLE} ${lastError.message}`
        : errorMessages.DAEMON_UNAVAILABLE,
    );
  }

  async #getConnection(signal?: AbortSignal): Promise<IpcConnection> {
    if (this.#closed) {
      throw new IpcClientError('DAEMON_UNAVAILABLE');
    }
    if (this.#connection?.isOpen) {
      return this.#connection;
    }
    if (!this.#connectionPromise) {
      const controller = new AbortController();
      this.#connectionAbortController = controller;
      this.#connectionPromise = this.#openConnection(controller.signal).finally(() => {
        if (this.#connectionAbortController === controller) {
          this.#connectionPromise = undefined;
          this.#connectionAbortController = undefined;
        }
      });
    }

    const connectionPromise = this.#connectionPromise;
    this.#connectionWaiters += 1;
    try {
      const connection = await waitForConnection(connectionPromise, signal);
      if (signal?.aborted) {
        throw new IpcClientError('REQUEST_CANCELLED');
      }
      return connection;
    } finally {
      this.#connectionWaiters -= 1;
      if (this.#connectionWaiters === 0 && this.#connectionPromise === connectionPromise) {
        this.#connectionAbortController?.abort();
      }
    }
  }

  async #openConnection(signal: AbortSignal): Promise<IpcConnection> {
    let connection: IpcConnection | undefined;
    try {
      const socket = await connectLocalPipe(this.#pipeName, {
        timeoutMs: Math.min(this.#requestTimeoutMs, this.#handshakeTimeoutMs),
        signal,
      });
      if (this.#closed || signal.aborted) {
        socket.destroy();
        throw new IpcClientError('DAEMON_UNAVAILABLE');
      }

      connection = new IpcConnection(
        socket,
        this.#maxPayloadBytes,
        (closedConnection) => {
          if (this.#connection === closedConnection) {
            this.#connection = undefined;
          }
        },
      );
      this.#connection = connection;
      const hello = await waitForConnection(
        connection.hello(this.#packageVersion, this.#handshakeTimeoutMs),
        signal,
      );
      this.#validateHello(hello);
      return connection;
    } catch (error) {
      if (connection) {
        this.#dropConnection(connection);
      }
      throw error;
    }
  }

  #validateHello(hello: IpcHelloResponse): void {
    if (
      hello.status !== 'ready' ||
      hello.protocolVersion !== IPC_PROTOCOL_VERSION ||
      hello.packageVersion !== this.#packageVersion
    ) {
      throw new IpcClientError('DAEMON_VERSION_MISMATCH', manualRestartMessage);
    }
  }

  #validateHealth(health: IpcHealthStatus): void {
    if (
      health.protocolVersion !== IPC_PROTOCOL_VERSION ||
      health.packageVersion !== this.#packageVersion
    ) {
      throw new IpcClientError('DAEMON_VERSION_MISMATCH', manualRestartMessage);
    }
    if (health.daemonStatus !== 'ready') {
      throw new IpcClientError('DAEMON_UNAVAILABLE');
    }
    if (health.extensionStatus !== 'connected') {
      throw new IpcClientError('EXTENSION_NOT_CONNECTED');
    }
  }

  #dropConnection(connection: IpcConnection): void {
    if (this.#connection === connection) {
      this.#connection = undefined;
    }
    connection.close(new IpcClientError('DAEMON_DISCONNECTED'));
  }
}

class IpcConnection {
  readonly #socket: Socket;
  readonly #decoder: IpcFrameDecoder;
  readonly #maxPayloadBytes: number;
  readonly #onClosed: (connection: IpcConnection) => void;
  readonly #pending = new Map<string, PendingResponse>();
  #active = true;
  #helloPending: HelloPending | undefined;

  public constructor(
    socket: Socket,
    maxPayloadBytes: number,
    onClosed: (connection: IpcConnection) => void,
  ) {
    this.#socket = socket;
    this.#decoder = new IpcFrameDecoder(maxPayloadBytes);
    this.#maxPayloadBytes = maxPayloadBytes;
    this.#onClosed = onClosed;
    this.#socket.on('data', this.#onData);
    this.#socket.on('error', this.#onSocketError);
    this.#socket.once('close', this.#onSocketClose);
  }

  public get isOpen(): boolean {
    return this.#active && !this.#socket.destroyed;
  }

  public hello(
    packageVersion: string,
    timeoutMs: number,
  ): Promise<IpcHelloResponse> {
    return new Promise<IpcHelloResponse>((resolve, reject) => {
      if (!this.isOpen) {
        reject(new IpcClientError('DAEMON_DISCONNECTED'));
        return;
      }

      const pending: HelloPending = {
        resolve: (response) => {
          clearTimeout(pending.timer);
          if (this.#helloPending === pending) {
            this.#helloPending = undefined;
          }
          resolve(response);
        },
        reject: (error) => {
          clearTimeout(pending.timer);
          if (this.#helloPending === pending) {
            this.#helloPending = undefined;
          }
          reject(error);
        },
        timer: setTimeout(() => {
          pending.reject(new IpcClientError('DAEMON_UNAVAILABLE'));
        }, timeoutMs),
      };
      this.#helloPending = pending;

      try {
        this.#write({
          type: 'hello',
          protocolVersion: IPC_PROTOCOL_VERSION,
          packageVersion,
        });
      } catch (error) {
        pending.reject(asIpcClientError(error, 'DAEMON_DISCONNECTED'));
      }
    });
  }

  public health(
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<IpcHealthStatus> {
    const request = ipcHealthRequestSchema.parse({
      type: 'health',
      requestId: randomUUID(),
    });
    return this.#request<IpcHealthStatus>(
      'health',
      request.requestId,
      request,
      timeoutMs,
      signal,
    );
  }

  public call(
    request: IpcCallRequest,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<unknown> {
    return this.#request<unknown>(
      'call',
      request.requestId,
      request,
      timeoutMs,
      signal,
    );
  }

  public close(reason = new IpcClientError('DAEMON_DISCONNECTED')): void {
    this.#fail(reason);
  }

  #request<Result>(
    kind: PendingResponse['kind'],
    requestId: string,
    message: unknown,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<Result> {
    return new Promise<Result>((resolve, reject) => {
      if (!this.isOpen) {
        reject(new IpcClientError('DAEMON_DISCONNECTED'));
        return;
      }

      let dispatched = false;
      const pending: PendingResponse = {
        kind,
        resolve: (value) => resolve(value as Result),
        reject,
        timer: setTimeout(() => {
          if (kind === 'call') {
            this.#writeCancel(requestId);
          }
          this.#rejectPending(
            requestId,
            new IpcClientError('REQUEST_TIMEOUT'),
          );
        }, timeoutMs),
        ...(signal ? { signal } : {}),
      };
      this.#pending.set(requestId, pending);

      if (signal) {
        pending.abortHandler = () => {
          if (kind === 'call' && dispatched) {
            this.#writeCancel(requestId);
          }
          this.#rejectPending(
            requestId,
            new IpcClientError('REQUEST_CANCELLED'),
          );
        };
        signal.addEventListener('abort', pending.abortHandler, { once: true });
        if (signal.aborted) {
          this.#rejectPending(
            requestId,
            new IpcClientError('REQUEST_CANCELLED'),
          );
          return;
        }
      }

      try {
        this.#write(message);
        dispatched = true;
      } catch (error) {
        this.#rejectPending(
          requestId,
          asIpcClientError(error, 'DAEMON_DISCONNECTED'),
        );
      }
    });
  }

  #writeCancel(requestId: string): void {
    try {
      this.#write({ type: 'cancel', requestId });
    } catch {
      // The request is already being settled locally; a lost cancel is best-effort.
    }
  }

  #write(message: unknown): void {
    if (!this.isOpen) {
      throw new IpcClientError('DAEMON_DISCONNECTED');
    }
    this.#socket.write(encodeIpcFrame(message, this.#maxPayloadBytes));
  }

  #onData = (chunk: Buffer): void => {
    let messages: unknown[];
    try {
      messages = this.#decoder.push(chunk);
    } catch {
      this.#fail(
        new IpcClientError(
          'DAEMON_DISCONNECTED',
          'The daemon sent an invalid IPC frame and the connection was closed.',
        ),
      );
      return;
    }

    for (const message of messages) {
      const parsed = ipcServerMessageSchema.safeParse(message);
      if (!parsed.success) {
        this.#fail(
          new IpcClientError(
            'DAEMON_VERSION_MISMATCH',
            'The daemon returned an IPC message this package does not support. Stop and restart it manually with the matching package version.',
          ),
        );
        return;
      }
      this.#receive(parsed.data);
      if (!this.#active) {
        return;
      }
    }
  };

  #onSocketError = (): void => {
    this.#fail(new IpcClientError('DAEMON_DISCONNECTED'));
  };

  #onSocketClose = (): void => {
    this.#fail(new IpcClientError('DAEMON_DISCONNECTED'), false);
  };

  #receive(message: IpcServerMessage): void {
    if (message.type === 'hello.response') {
      if (!this.#helloPending) {
        this.#fail(new IpcClientError('DAEMON_VERSION_MISMATCH'));
        return;
      }
      this.#helloPending.resolve(message);
      return;
    }

    const pending = this.#pending.get(message.requestId);
    if (!pending) {
      return;
    }

    if (message.type === 'health.response') {
      if (pending.kind !== 'health') {
        this.#fail(new IpcClientError('DAEMON_VERSION_MISMATCH'));
        return;
      }
      this.#resolvePending(message.requestId, message.status);
      return;
    }

    if (pending.kind !== 'call') {
      this.#fail(new IpcClientError('DAEMON_VERSION_MISMATCH'));
      return;
    }
    if (message.ok) {
      this.#resolvePending(message.requestId, message.result);
    } else {
      this.#rejectPending(
        message.requestId,
        new IpcClientError(message.error.code),
      );
    }
  }

  #resolvePending(requestId: string, value: unknown): void {
    const pending = this.#takePending(requestId);
    pending?.resolve(value);
  }

  #rejectPending(requestId: string, error: IpcClientError): void {
    const pending = this.#takePending(requestId);
    pending?.reject(error);
  }

  #takePending(requestId: string): PendingResponse | undefined {
    const pending = this.#pending.get(requestId);
    if (!pending) {
      return undefined;
    }
    this.#pending.delete(requestId);
    clearTimeout(pending.timer);
    if (pending.signal && pending.abortHandler) {
      pending.signal.removeEventListener('abort', pending.abortHandler);
    }
    return pending;
  }

  #fail(
    error: IpcClientError,
    destroySocket = true,
  ): void {
    if (!this.#active) {
      return;
    }
    this.#active = false;
    this.#onClosed(this);

    const helloPending = this.#helloPending;
    this.#helloPending = undefined;
    helloPending?.reject(error);

    for (const requestId of this.#pending.keys()) {
      this.#rejectPending(requestId, error);
    }
    if (destroySocket && !this.#socket.destroyed) {
      this.#socket.destroy();
    }
  }
}

function parseToolResult<Name extends ToolName>(
  toolName: Name,
  value: unknown,
): ToolResult<Name> {
  const outputSchemas = {
    [toolCatalog.devicesList.name]: toolCatalog.devicesList.outputSchema,
    [toolCatalog.countOpenTabs.name]: toolCatalog.countOpenTabs.outputSchema,
    [toolCatalog.countOpenWindows.name]: toolCatalog.countOpenWindows.outputSchema,
    [toolCatalog.listTabs.name]: toolCatalog.listTabs.outputSchema,
    [toolCatalog.openTab.name]: toolCatalog.openTab.outputSchema,
    [toolCatalog.closeTab.name]: toolCatalog.closeTab.outputSchema,
    [toolCatalog.moveTab.name]: toolCatalog.moveTab.outputSchema,
  };
  const result = outputSchemas[toolName].safeParse(value);
  if (!result.success) {
    throw new IpcClientError('INVALID_EXTENSION_RESPONSE');
  }
  return result.data as ToolResult<Name>;
}

function asIpcClientError(
  error: unknown,
  fallbackCode: IpcErrorCode,
): IpcClientError {
  return error instanceof IpcClientError
    ? error
    : new IpcClientError(fallbackCode);
}

function boundedInteger(
  value: number,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new RangeError(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

function waitForConnection<Result>(
  promise: Promise<Result>,
  signal?: AbortSignal,
): Promise<Result> {
  if (!signal) {
    return promise;
  }
  if (signal.aborted) {
    return Promise.reject(new IpcClientError('REQUEST_CANCELLED'));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new IpcClientError('REQUEST_CANCELLED'));
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener('abort', onAbort);
    });
  });
}

async function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    throw new IpcClientError('REQUEST_CANCELLED');
  }
  if (milliseconds === 0) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, milliseconds);
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(new IpcClientError('REQUEST_CANCELLED'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}