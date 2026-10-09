import type { BridgeConfig, BridgeConfigResult } from '../config.js';
import { defaultBridgeLimits } from '../config.js';
import { ConnectionManager, type InstanceSnapshot } from './connection-manager.js';
import { BridgeError } from './errors.js';
import { RequestRouter } from './request-router.js';
import {
  CLOSE_TAB_OPERATION,
  COUNT_OPEN_TABS_OPERATION,
  COUNT_OPEN_WINDOWS_OPERATION,
  LIST_TABS_OPERATION,
  MOVE_TAB_OPERATION,
  OPEN_TAB_OPERATION,
  countOpenTabsResultSchema,
  type BrowserOperation,
  type BrowserOperationPayload,
  type BrowserOperationResult,
  type CountOpenTabsResult,
} from './protocol.js';
import { WebSocketBridgeServer } from './websocket-server.js';

export interface DeviceListOptions {
  includeOffline: boolean;
  includeTabCounts: boolean;
}

interface DeviceListInstance extends Omit<InstanceSnapshot, 'operations'> {
  capabilities: { operations: string[] };
  countStatus: 'ok' | 'offline' | 'unsupported' | 'timeout' | 'error' | 'not_requested';
  tabCount: number | null;
  countedAt?: string;
}

export interface DeviceListResult {
  instances: DeviceListInstance[];
  totalTabs: number | null;
  complete: boolean;
  queriedAt: string;
}

export class BridgeService {
  readonly #connections: ConnectionManager;
  readonly #router: RequestRouter;
  #webSocketServer: WebSocketBridgeServer | undefined;
  #disabledReason: string | undefined;

  private constructor(config?: BridgeConfig) {
    this.#connections = new ConnectionManager(
      config?.maxPayloadBytes ?? defaultBridgeLimits.maxPayloadBytes,
      config?.maxRegisteredInstances ?? 64,
    );
    this.#router = new RequestRouter(
      this.#connections,
      config?.maxPendingRequests ?? defaultBridgeLimits.maxPendingRequests,
      config?.requestTimeoutMs ?? defaultBridgeLimits.requestTimeoutMs,
    );
    this.#connections.setHandlers({
      onResponse: (connectionId, response) =>
        this.#router.handleResponse(connectionId, response),
      onDisconnect: (connectionId, error) =>
        this.#router.handleDisconnect(connectionId, error),
    });
  }

  public static async create(
    configResult: BridgeConfigResult,
  ): Promise<BridgeService> {
    const service = new BridgeService(configResult.ok ? configResult.config : undefined);
    if (!configResult.ok) {
      service.#disabledReason = configResult.reason;
      return service;
    }

    const webSocketServer = new WebSocketBridgeServer(
      configResult.config,
      service.#connections,
    );
    try {
      await webSocketServer.listen();
      service.#webSocketServer = webSocketServer;
    } catch (error) {
      await webSocketServer.close();
      service.#disabledReason = service.#listenFailureMessage(
        configResult.config,
        error,
      );
    }

    return service;
  }

  public static async createStrict(
    config: BridgeConfig,
    onLog?: (message: string) => void,
  ): Promise<BridgeService> {
    const service = new BridgeService(config);
    const webSocketServer = new WebSocketBridgeServer(
      config,
      service.#connections,
      onLog,
    );

    try {
      await webSocketServer.listen();
      service.#webSocketServer = webSocketServer;
      return service;
    } catch (error) {
      const cleanup = await Promise.allSettled([
        webSocketServer.close(),
        service.close(),
      ]);
      const cleanupError = cleanup.find(
        (result): result is PromiseRejectedResult =>
          result.status === 'rejected',
      );
      if (cleanupError) {
        throw new AggregateError(
          [error, cleanupError.reason],
          'WebSocket bridge startup failed and rollback was incomplete.',
        );
      }
      throw error;
    }
  }

  public get available(): boolean {
    return this.#webSocketServer !== undefined;
  }

  public get port(): number | undefined {
    return this.#webSocketServer?.port;
  }

  public get unavailableReason(): string | undefined {
    return this.#disabledReason;
  }

  public get hasConnectedExtension(): boolean {
    return this.#connections
      .listInstances()
      .some((instance) => instance.status === 'online');
  }

  public get instances(): InstanceSnapshot[] { return this.#connections.listInstances(); }

  public async countOpenTabs(
    instanceId: string,
    signal?: AbortSignal,
  ): Promise<CountOpenTabsResult> {
    this.#assertAvailable();
    const response = await this.#router.requestCountOpenTabs(instanceId, signal);
    const parsed = countOpenTabsResultSchema.safeParse(response);
    if (!parsed.success) {
      throw new BridgeError('INVALID_EXTENSION_RESPONSE');
    }
    return parsed.data;
  }

  public countOpenWindows(
    instanceId: string,
    signal?: AbortSignal,
  ): Promise<BrowserOperationResult<typeof COUNT_OPEN_WINDOWS_OPERATION>> {
    return this.#requestBrowserOperation(
      instanceId,
      COUNT_OPEN_WINDOWS_OPERATION,
      {},
      signal,
    );
  }

  public async listTabs(
    instanceId: string,
    options: BrowserOperationPayload<typeof LIST_TABS_OPERATION>,
    signal?: AbortSignal,
  ): Promise<BrowserOperationResult<typeof LIST_TABS_OPERATION>> {
    const result = await this.#requestBrowserOperation(
      instanceId,
      LIST_TABS_OPERATION,
      options,
      signal,
    );
    const expectedNextOffset = options.offset + result.tabs.length;
    if (
      result.tabs.length > options.limit ||
      (result.nextOffset !== null &&
        (result.tabs.length !== options.limit ||
          !Number.isSafeInteger(expectedNextOffset) ||
          result.nextOffset !== expectedNextOffset))
    ) {
      throw new BridgeError('INVALID_EXTENSION_RESPONSE');
    }
    return result;
  }

  public async openTab(
    instanceId: string,
    payload: BrowserOperationPayload<typeof OPEN_TAB_OPERATION>,
    signal?: AbortSignal,
  ): Promise<BrowserOperationResult<typeof OPEN_TAB_OPERATION>> {
    const result = await this.#requestBrowserOperation(
      instanceId,
      OPEN_TAB_OPERATION,
      payload,
      signal,
    );
    if (
      (payload.windowId !== undefined && result.windowId !== payload.windowId) ||
      (payload.url === undefined && result.url !== 'about:blank')
    ) {
      throw new BridgeError('INVALID_EXTENSION_RESPONSE');
    }
    return result;
  }

  public async closeTab(
    instanceId: string,
    tabId: number,
    signal?: AbortSignal,
  ): Promise<BrowserOperationResult<typeof CLOSE_TAB_OPERATION>> {
    const result = await this.#requestBrowserOperation(
      instanceId,
      CLOSE_TAB_OPERATION,
      { tabId },
      signal,
    );
    if (result.tabId !== tabId) {
      throw new BridgeError('INVALID_EXTENSION_RESPONSE');
    }
    return result;
  }

  public async moveTab(
    instanceId: string,
    tabId: number,
    targetWindowId: number,
    signal?: AbortSignal,
  ): Promise<BrowserOperationResult<typeof MOVE_TAB_OPERATION>> {
    const result = await this.#requestBrowserOperation(
      instanceId,
      MOVE_TAB_OPERATION,
      { tabId, targetWindowId },
      signal,
    );
    if (
      result.tabId !== tabId ||
      result.targetWindowId !== targetWindowId ||
      result.sourceWindowId === targetWindowId
    ) {
      throw new BridgeError('INVALID_EXTENSION_RESPONSE');
    }
    return result;
  }

  public async devicesList(
    options: DeviceListOptions,
    signal?: AbortSignal,
  ): Promise<DeviceListResult> {
    this.#assertAvailable();

    const knownInstances = this.#connections.listInstances();
    const instances = knownInstances.filter(
      (instance) => options.includeOffline || instance.status === 'online',
    );
    if (instances.length === 0) {
      throw new BridgeError('EXTENSION_NOT_CONNECTED');
    }

    let complete = true;
    const listedInstances = await Promise.all(
      instances.map(async (instance): Promise<DeviceListInstance> => {
        const { operations, ...instanceDetails } = instance;
        const base = {
          ...instanceDetails,
          capabilities: { operations: [...operations] },
          tabCount: null,
        };

        if (instance.status === 'offline') {
          complete = false;
          return { ...base, countStatus: 'offline' };
        }
        if (!options.includeTabCounts) {
          return { ...base, countStatus: 'not_requested' };
        }
        if (!operations.includes('browser.countOpenTabs')) {
          complete = false;
          return { ...base, countStatus: 'unsupported' };
        }

        try {
          const result = await this.countOpenTabs(instance.instanceId, signal);
          return {
            ...base,
            countStatus: 'ok',
            tabCount: result.count,
            countedAt: result.countedAt,
          };
        } catch (error) {
          if (error instanceof BridgeError && error.code === 'REQUEST_CANCELLED') {
            throw error;
          }
          complete = false;
          return {
            ...base,
            countStatus: this.#countFailureStatus(error),
          };
        }
      }),
    );

    const totalTabs = options.includeTabCounts
      ? listedInstances.reduce((total, instance) => total + (instance.tabCount ?? 0), 0)
      : null;

    return {
      instances: listedInstances,
      totalTabs,
      complete,
      queriedAt: new Date().toISOString(),
    };
  }

  public async close(): Promise<void> {
    this.#router.close();
    this.#connections.closeAll();
    await this.#webSocketServer?.close();
    this.#webSocketServer = undefined;
  }

  #assertAvailable(): void {
    if (!this.available) {
      throw new BridgeError(
        'BRIDGE_UNAVAILABLE',
        this.#disabledReason ?? 'The local WebSocket bridge is unavailable.',
      );
    }
  }

  #requestBrowserOperation<Operation extends BrowserOperation>(
    instanceId: string,
    operation: Operation,
    payload: BrowserOperationPayload<Operation>,
    signal?: AbortSignal,
  ): Promise<BrowserOperationResult<Operation>> {
    this.#assertAvailable();
    return this.#router.requestBrowserOperation(
      instanceId,
      operation,
      payload,
      signal,
    );
  }

  #listenFailureMessage(config: BridgeConfig, error: unknown): string {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'EADDRINUSE'
    ) {
      return `WebSocket bridge port ${config.port} is already in use; no alternate port was tried.`;
    }
    return `WebSocket bridge could not bind to ${config.host}:${config.port}.`;
  }

  #countFailureStatus(
    error: unknown,
  ): DeviceListInstance['countStatus'] {
    if (!(error instanceof BridgeError)) {
      return 'error';
    }
    if (error.code === 'REQUEST_TIMEOUT') {
      return 'timeout';
    }
    if (error.code === 'EXTENSION_NOT_CONNECTED' || error.code === 'EXTENSION_DISCONNECTED') {
      return 'offline';
    }
    if (error.code === 'UNSUPPORTED_OPERATION') {
      return 'unsupported';
    }
    return 'error';
  }
}

export async function createBridgeService(
  configResult: BridgeConfigResult,
): Promise<BridgeService> {
  return BridgeService.create(configResult);
}
