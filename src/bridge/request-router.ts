import { randomUUID } from 'node:crypto';
import { BridgeError } from './errors.js';
import { ConnectionManager } from './connection-manager.js';
import {
  browserOperationContracts,
  browserRequestSchema,
  COUNT_OPEN_TABS_OPERATION,
  type BrowserOperation,
  type BrowserOperationPayload,
  type BrowserOperationResult,
  type BrowserRequest,
  type BrowserResponse,
} from './protocol.js';

interface PendingRequest {
  connectionId: string;
  operation: BrowserOperation;
  resolve: (value: unknown) => void;
  reject: (error: BridgeError) => void;
  timer: NodeJS.Timeout;
  signal?: AbortSignal;
  onAbort?: () => void;
}

export class RequestRouter {
  readonly #pending = new Map<string, PendingRequest>();

  public constructor(
    private readonly connections: ConnectionManager,
    private readonly maxPendingRequests: number,
    private readonly timeoutMs: number,
  ) {}

  public get pendingCount(): number {
    return this.#pending.size;
  }

  public requestBrowserOperation<Operation extends BrowserOperation>(
    instanceId: string,
    operation: Operation,
    payload: BrowserOperationPayload<Operation>,
    signal?: AbortSignal,
  ): Promise<BrowserOperationResult<Operation>> {
    const instance = this.connections.getConnectedInstance(instanceId);
    if (!instance) {
      return Promise.reject(new BridgeError('EXTENSION_NOT_CONNECTED'));
    }
    if (!instance.operations.includes(operation)) {
      return Promise.reject(new BridgeError('UNSUPPORTED_OPERATION'));
    }
    if (this.#pending.size >= this.maxPendingRequests) {
      return Promise.reject(new BridgeError('BRIDGE_BUSY'));
    }
    if (signal?.aborted) {
      return Promise.reject(new BridgeError('REQUEST_CANCELLED'));
    }

    const request: BrowserRequest = browserRequestSchema.parse({
      type: 'browser/request',
      requestId: randomUUID(),
      operation,
      payload,
    });
    const requestId = request.requestId;

    return new Promise<BrowserOperationResult<Operation>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#settle(requestId, { error: new BridgeError('REQUEST_TIMEOUT') });
      }, this.timeoutMs);
      const onAbort = signal
        ? () => {
            this.#settle(requestId, {
              error: new BridgeError('REQUEST_CANCELLED'),
            });
          }
        : undefined;
      const pending: PendingRequest = {
        connectionId: instance.connectionId,
        operation,
        resolve: (value) =>
          resolve(value as BrowserOperationResult<Operation>),
        reject,
        timer,
        signal,
        onAbort,
      };

      this.#pending.set(requestId, pending);
      if (signal && onAbort) {
        signal.addEventListener('abort', onAbort, { once: true });
      }

      void this.connections.send(instance.connectionId, request).catch(() => {
        this.#settle(requestId, {
          error: new BridgeError('EXTENSION_DISCONNECTED'),
        });
      });
    });
  }

  public requestCountOpenTabs(
    instanceId: string,
    signal?: AbortSignal,
  ): Promise<BrowserOperationResult<typeof COUNT_OPEN_TABS_OPERATION>> {
    return this.requestBrowserOperation(
      instanceId,
      COUNT_OPEN_TABS_OPERATION,
      {},
      signal,
    );
  }

  public handleResponse(connectionId: string, response: BrowserResponse): void {
    const pending = this.#pending.get(response.requestId);
    if (!pending || pending.connectionId !== connectionId) {
      return;
    }

    if (response.ok) {
      const parsed = browserOperationContracts[pending.operation].result.safeParse(
        response.data,
      );
      if (!parsed.success) {
        this.#settle(response.requestId, {
          error: new BridgeError('INVALID_EXTENSION_RESPONSE'),
        });
        return;
      }
      this.#settle(response.requestId, { value: parsed.data });
      return;
    }

    this.#settle(response.requestId, {
      error: new BridgeError('EXTENSION_OPERATION_FAILED'),
    });
  }

  public handleDisconnect(connectionId: string, error: BridgeError): void {
    for (const [requestId, pending] of this.#pending) {
      if (pending.connectionId === connectionId) {
        this.#settle(requestId, { error });
      }
    }
  }

  public close(): void {
    for (const requestId of this.#pending.keys()) {
      this.#settle(requestId, {
        error: new BridgeError('BRIDGE_UNAVAILABLE'),
      });
    }
  }

  #settle(
    requestId: string,
    result: { value: unknown } | { error: BridgeError },
  ): void {
    const pending = this.#pending.get(requestId);
    if (!pending) {
      return;
    }

    this.#pending.delete(requestId);
    clearTimeout(pending.timer);
    if (pending.signal && pending.onAbort) {
      pending.signal.removeEventListener('abort', pending.onAbort);
    }

    if ('error' in result) {
      pending.reject(result.error);
    } else {
      pending.resolve(result.value);
    }
  }
}