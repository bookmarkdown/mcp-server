import { randomUUID } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import { createRequire } from 'node:module';
import type { Socket } from 'node:net';
import { BridgeError } from '../bridge/errors.js';
import type { BridgeErrorCode } from '../bridge/errors.js';
import { BridgeService } from '../bridge/service.js';
import { parseBridgeConfig } from '../config.js';
import type { BridgeConfig, RuntimeMode } from '../config.js';
import { IpcFrameDecoder, encodeIpcFrame } from '../ipc/framing.js';
import {
  IPC_PROTOCOL_VERSION,
  ipcCallRequestSchema,
  ipcHealthResponseSchema,
  ipcHelloResponseSchema,
  ipcPackageVersionSchema,
  ipcRequestSchema,
  ipcServerMessageSchema,
  type IpcCallRequest,
  type IpcErrorCode,
  type IpcHealthRequest,
  type IpcHelloRequest,
} from '../ipc/protocol.js';
import {
  connectLocalPipe,
  listenLocalPipe,
  type LocalPipeServer,
} from '../ipc/transport.js';
import { toolCatalog } from '../tools/catalog.js';

const DEFAULT_PIPE_NAME = 'bookmarkdown-mcp';
const DEFAULT_SHUTDOWN_DRAIN_MS = 1000;
const MAX_SHUTDOWN_DRAIN_MS = 30_000;
const packageMetadata = createRequire(import.meta.url)('../../package.json') as {
  version: string;
};

export const DAEMON_PACKAGE_VERSION = ipcPackageVersionSchema.parse(
  packageMetadata.version,
);

type DaemonState = 'starting' | 'ready' | 'shutting_down' | 'closed';
type SignalTarget = Pick<EventEmitter, 'once' | 'off'>;

export interface DaemonStartOptions {
  env?: NodeJS.ProcessEnv;
  runtimeMode?: RuntimeMode;
  pipeName?: string;
  shutdownDrainMs?: number;
  signalTarget?: SignalTarget;
}

export type DaemonStartResult =
  | { status: 'started'; daemon: DaemonService }
  | { status: 'already_running' };

interface IpcClient {
  socket: Socket;
  decoder: IpcFrameDecoder;
  ready: boolean;
  closed: boolean;
  probeOnly: boolean;
  helloTimer: NodeJS.Timeout;
  pending: Map<string, AbortController>;
}

export class DaemonService {
  readonly #bridge: BridgeService;
  readonly #config: BridgeConfig;
  readonly #pipeName: string;
  readonly #shutdownDrainMs: number;
  readonly #signalTarget: SignalTarget;
  readonly #clients = new Set<IpcClient>();
  readonly #pendingCalls = new Set<AbortController>();
  readonly #pendingDrainWaiters = new Set<() => void>();
  #pipeServer: LocalPipeServer | undefined;
  #state: DaemonState = 'starting';
  #closePromise: Promise<void> | undefined;

  private constructor(
    bridge: BridgeService,
    config: BridgeConfig,
    pipeName: string,
    shutdownDrainMs: number,
    signalTarget: SignalTarget,
  ) {
    this.#bridge = bridge;
    this.#config = config;
    this.#pipeName = pipeName;
    this.#shutdownDrainMs = shutdownDrainMs;
    this.#signalTarget = signalTarget;
  }

  public static async start(
    options: DaemonStartOptions = {},
  ): Promise<DaemonStartResult> {
    const configResult = parseBridgeConfig(
      options.env ?? process.env,
      options.runtimeMode === undefined ? 'production' : options.runtimeMode,
    );
    if (!configResult.ok) {
      throw new Error(configResult.reason);
    }

    const shutdownDrainMs =
      options.shutdownDrainMs ?? DEFAULT_SHUTDOWN_DRAIN_MS;
    if (
      !Number.isSafeInteger(shutdownDrainMs) ||
      shutdownDrainMs < 0 ||
      shutdownDrainMs > MAX_SHUTDOWN_DRAIN_MS
    ) {
      throw new RangeError(
        `Shutdown drain must be an integer between 0 and ${MAX_SHUTDOWN_DRAIN_MS} milliseconds.`,
      );
    }

    const pipeName = options.pipeName ?? DEFAULT_PIPE_NAME;
    if (
      await probeExistingDaemon(
        pipeName,
        configResult.config,
        DAEMON_PACKAGE_VERSION,
      )
    ) {
      return { status: 'already_running' };
    }

    const bridge = await BridgeService.createStrict(configResult.config);
    const daemon = new DaemonService(
      bridge,
      configResult.config,
      pipeName,
      shutdownDrainMs,
      options.signalTarget ?? process,
    );

    try {
      daemon.#pipeServer = await listenLocalPipe(
        pipeName,
        (socket) => daemon.#acceptClient(socket),
        (error) => daemon.#handlePipeError(error),
      );
      daemon.#state = 'ready';
      daemon.#installSignalHandlers();
      return { status: 'started', daemon };
    } catch (error) {
      daemon.#state = 'closed';
      try {
        await bridge.close();
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          'Daemon startup failed and WebSocket rollback was incomplete.',
        );
      }
      throw error;
    }
  }

  public get status(): DaemonState {
    return this.#state;
  }

  public get pipeName(): string {
    return this.#pipeName;
  }

  public get webSocketPort(): number | undefined {
    return this.#bridge.port;
  }

  public get clientCount(): number {
    return this.#clients.size;
  }

  public get pendingCallCount(): number {
    return this.#pendingCalls.size;
  }

  public close(): Promise<void> {
    if (this.#closePromise) {
      return this.#closePromise;
    }
    if (this.#state === 'closed') {
      return Promise.resolve();
    }

    this.#state = 'shutting_down';
    this.#removeSignalHandlers();
    this.#closePromise = this.#shutdown();
    return this.#closePromise;
  }

  async #shutdown(): Promise<void> {
    await this.#drainPendingCalls();
    for (const controller of this.#pendingCalls) {
      controller.abort();
    }
    for (const client of [...this.#clients]) {
      this.#dropClient(client);
    }

    const results = await Promise.allSettled([
      this.#pipeServer?.close() ?? Promise.resolve(),
      this.#bridge.close(),
    ]);
    for (const client of [...this.#clients]) {
      this.#dropClient(client);
    }
    await this.#drainPendingCalls();
    this.#pipeServer = undefined;
    this.#state = 'closed';
    this.#notifyPendingDrained();

    const errors = results
      .filter((result): result is PromiseRejectedResult => result.status === 'rejected')
      .map((result) => result.reason);
    if (errors.length > 0) {
      throw new AggregateError(errors, 'Daemon shutdown was incomplete.');
    }
  }

  #acceptClient(socket: Socket): void {
    if (
      this.#state !== 'ready' ||
      this.#clients.size >= this.#config.maxConnections + 1
    ) {
      socket.destroy();
      return;
    }

    const client: IpcClient = {
      socket,
      decoder: new IpcFrameDecoder(this.#config.maxPayloadBytes),
      ready: false,
      closed: false,
      probeOnly: this.#clients.size >= this.#config.maxConnections,
      helloTimer: setTimeout(() => this.#dropClient(client), this.#config.helloTimeoutMs),
      pending: new Map(),
    };
    client.helloTimer.unref();
    this.#clients.add(client);

    socket.on('data', (chunk) => this.#handleData(client, chunk));
    socket.on('error', () => this.#removeClient(client));
    socket.once('close', () => this.#removeClient(client));
  }

  #handleData(client: IpcClient, chunk: Buffer): void {
    let messages: unknown[];
    try {
      messages = client.decoder.push(chunk);
    } catch {
      this.#dropClient(client);
      return;
    }

    for (const message of messages) {
      if (client.closed) {
        return;
      }
      const parsed = ipcRequestSchema.safeParse(message);
      if (!parsed.success) {
        this.#dropClient(client);
        return;
      }
      this.#handleRequest(client, parsed.data);
    }
  }

  #handleRequest(
    client: IpcClient,
    request: ReturnType<typeof ipcRequestSchema.parse>,
  ): void {
    if (!client.ready) {
      if (request.type !== 'hello') {
        this.#dropClient(client);
        return;
      }
      this.#handleHello(client, request);
      return;
    }

    if (request.type === 'hello') {
      this.#dropClient(client);
      return;
    }
    if (request.type === 'health') {
      this.#handleHealth(client, request, client.probeOnly);
      return;
    }
    if (client.probeOnly) {
      if (request.type === 'call') {
        this.#sendFailure(client, request.requestId, 'BRIDGE_BUSY', true);
      }
      if (request.type !== 'call') {
        client.socket.end();
      }
      return;
    }
    if (request.type === 'cancel') {
      client.pending.get(request.requestId)?.abort();
      return;
    }
    this.#dispatchCall(client, request);
  }

  #handleHello(client: IpcClient, request: IpcHelloRequest): void {
    clearTimeout(client.helloTimer);
    const status =
      request.protocolVersion !== IPC_PROTOCOL_VERSION
        ? 'protocol_version_mismatch'
        : request.packageVersion !== DAEMON_PACKAGE_VERSION
          ? 'package_version_mismatch'
          : 'ready';
    const sent = this.#send(
      client,
      {
        type: 'hello.response',
        protocolVersion: IPC_PROTOCOL_VERSION,
        packageVersion: DAEMON_PACKAGE_VERSION,
        status,
      },
      status !== 'ready',
    );

    if (!sent) {
      return;
    }
    if (status === 'ready') {
      client.ready = true;
    }
  }

  #handleHealth(
    client: IpcClient,
    request: IpcHealthRequest,
    endAfterResponse = false,
  ): void {
    this.#send(
      client,
      {
        type: 'health.response',
        requestId: request.requestId,
        status: {
          protocolVersion: IPC_PROTOCOL_VERSION,
          packageVersion: DAEMON_PACKAGE_VERSION,
          runtimeMode: this.#config.runtimeMode,
          daemonStatus:
            this.#state === 'shutting_down' ? 'shutting_down' : 'ready',
          extensionStatus: this.#bridge.hasConnectedExtension
            ? 'connected'
            : 'not_connected',
        },
      },
      endAfterResponse,
    );
  }

  #dispatchCall(client: IpcClient, request: IpcCallRequest): void {
    if (this.#state !== 'ready') {
      this.#sendFailure(client, request.requestId, 'DAEMON_UNAVAILABLE');
      return;
    }
    if (client.pending.has(request.requestId)) {
      this.#dropClient(client);
      return;
    }
    if (this.#pendingCalls.size >= this.#config.maxPendingRequests) {
      this.#sendFailure(client, request.requestId, 'BRIDGE_BUSY');
      return;
    }

    const controller = new AbortController();
    client.pending.set(request.requestId, controller);
    this.#pendingCalls.add(controller);
    void this.#executeCall(request, controller.signal)
      .then((result) => {
        this.#send(client, {
          type: 'response',
          requestId: request.requestId,
          ok: true,
          result,
        });
      })
      .catch((error: unknown) => {
        this.#sendFailure(
          client,
          request.requestId,
          toIpcErrorCode(error),
        );
      })
      .finally(() => {
        client.pending.delete(request.requestId);
        this.#pendingCalls.delete(controller);
        this.#notifyPendingDrained();
      });
  }

  async #executeCall(
    request: IpcCallRequest,
    signal: AbortSignal,
  ): Promise<unknown> {
    switch (request.toolName) {
      case 'devices.list': {
        const args = toolCatalog.devicesList.inputSchema.parse(request.arguments);
        const result = await this.#bridge.devicesList(
          {
            includeOffline: args.includeOffline,
            includeTabCounts: args.includeTabCounts,
          },
          signal,
        );
        const parsed = toolCatalog.devicesList.outputSchema.safeParse(result);
        if (!parsed.success) {
          throw new BridgeError('INVALID_EXTENSION_RESPONSE');
        }
        return parsed.data;
      }
      case 'browser.countOpenTabs': {
        const args = toolCatalog.countOpenTabs.inputSchema.parse(request.arguments);
        const result = await this.#bridge.countOpenTabs(args.instanceId, signal);
        const parsed = toolCatalog.countOpenTabs.outputSchema.safeParse(result);
        if (!parsed.success) {
          throw new BridgeError('INVALID_EXTENSION_RESPONSE');
        }
        return parsed.data;
      }
      case 'browser.countOpenWindows': {
        const args = toolCatalog.countOpenWindows.inputSchema.parse(request.arguments);
        const result = await this.#bridge.countOpenWindows(args.instanceId, signal);
        const parsed = toolCatalog.countOpenWindows.outputSchema.safeParse(result);
        if (!parsed.success) {
          throw new BridgeError('INVALID_EXTENSION_RESPONSE');
        }
        return parsed.data;
      }
      case 'browser.listTabs': {
        const args = toolCatalog.listTabs.inputSchema.parse(request.arguments);
        const result = await this.#bridge.listTabs(
          args.instanceId,
          { limit: args.limit, offset: args.offset },
          signal,
        );
        const parsed = toolCatalog.listTabs.outputSchema.safeParse(result);
        if (!parsed.success) {
          throw new BridgeError('INVALID_EXTENSION_RESPONSE');
        }
        return parsed.data;
      }
      case 'browser.openTab': {
        const args = toolCatalog.openTab.inputSchema.parse(request.arguments);
        const result = await this.#bridge.openTab(
          args.instanceId,
          { url: args.url, windowId: args.windowId },
          signal,
        );
        const parsed = toolCatalog.openTab.outputSchema.safeParse(result);
        if (!parsed.success) {
          throw new BridgeError('INVALID_EXTENSION_RESPONSE');
        }
        return parsed.data;
      }
      case 'browser.closeTab': {
        const args = toolCatalog.closeTab.inputSchema.parse(request.arguments);
        const result = await this.#bridge.closeTab(
          args.instanceId,
          args.tabId,
          signal,
        );
        const parsed = toolCatalog.closeTab.outputSchema.safeParse(result);
        if (!parsed.success) {
          throw new BridgeError('INVALID_EXTENSION_RESPONSE');
        }
        return parsed.data;
      }
      case 'browser.moveTab': {
        const args = toolCatalog.moveTab.inputSchema.parse(request.arguments);
        const result = await this.#bridge.moveTab(
          args.instanceId,
          args.tabId,
          args.targetWindowId,
          signal,
        );
        const parsed = toolCatalog.moveTab.outputSchema.safeParse(result);
        if (!parsed.success) {
          throw new BridgeError('INVALID_EXTENSION_RESPONSE');
        }
        return parsed.data;
      }
    }
  }

  #sendFailure(
    client: IpcClient,
    requestId: string,
    code: IpcErrorCode,
    endAfterResponse = false,
  ): void {
    this.#send(
      client,
      {
        type: 'response',
        requestId,
        ok: false,
        error: { code },
      },
      endAfterResponse,
    );
  }

  #send(
    client: IpcClient,
    message: unknown,
    endAfterResponse = false,
  ): boolean {
    if (client.closed || client.socket.destroyed || client.socket.writableEnded) {
      return false;
    }

    const parsed = ipcServerMessageSchema.safeParse(message);
    if (!parsed.success) {
      this.#dropClient(client);
      return false;
    }

    try {
      const frame = encodeIpcFrame(
        parsed.data,
        this.#config.maxPayloadBytes,
      );
      if (endAfterResponse) {
        client.socket.end(frame);
      } else {
        client.socket.write(frame);
      }
      return true;
    } catch {
      if (parsed.data.type === 'response' && parsed.data.ok) {
        this.#sendFailure(
          client,
          parsed.data.requestId,
          'INTERNAL_ERROR',
        );
        return false;
      }
      this.#dropClient(client);
      return false;
    }
  }

  #dropClient(client: IpcClient): void {
    this.#removeClient(client);
    if (!client.socket.destroyed) {
      client.socket.destroy();
    }
  }

  #removeClient(client: IpcClient): void {
    if (client.closed) {
      return;
    }
    client.closed = true;
    clearTimeout(client.helloTimer);
    this.#clients.delete(client);
    for (const controller of client.pending.values()) {
      controller.abort();
    }
  }

  #drainPendingCalls(): Promise<void> {
    if (this.#pendingCalls.size === 0) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      let timer: NodeJS.Timeout;
      const finish = () => {
        clearTimeout(timer);
        this.#pendingDrainWaiters.delete(finish);
        resolve();
      };
      timer = setTimeout(finish, this.#shutdownDrainMs);
      timer.unref();
      this.#pendingDrainWaiters.add(finish);
      if (this.#pendingCalls.size === 0) {
        finish();
      }
    });
  }

  #notifyPendingDrained(): void {
    if (this.#pendingCalls.size !== 0) {
      return;
    }
    for (const resolve of [...this.#pendingDrainWaiters]) {
      resolve();
    }
  }

  #installSignalHandlers(): void {
    this.#signalTarget.once('SIGINT', this.#onSignal);
    this.#signalTarget.once('SIGTERM', this.#onSignal);
  }

  #removeSignalHandlers(): void {
    this.#signalTarget.off('SIGINT', this.#onSignal);
    this.#signalTarget.off('SIGTERM', this.#onSignal);
  }

  readonly #onSignal = (): void => {
    void this.close().catch(() => {
      process.exitCode = 1;
      process.stderr.write('Daemon shutdown failed.\n');
    });
  };

  readonly #handlePipeError = (_error: Error): void => {
    if (this.#state !== 'ready') {
      return;
    }
    process.exitCode = 1;
    process.stderr.write('The local daemon IPC endpoint failed.\n');
    void this.close().catch(() => {
      process.exitCode = 1;
      process.stderr.write('Daemon shutdown failed.\n');
    });
  };
}

export function startDaemon(
  options: DaemonStartOptions = {},
): Promise<DaemonStartResult> {
  return DaemonService.start(options);
}

async function probeExistingDaemon(
  pipeName: string,
  config: BridgeConfig,
  packageVersion: string,
): Promise<boolean> {
  let socket: Socket;
  try {
    socket = await connectLocalPipe(pipeName, { timeoutMs: config.helloTimeoutMs });
  } catch (error) {
    if (error instanceof TypeError) {
      throw error;
    }
    if (error instanceof Error && 'code' in error &&
      (error.code === 'ENOENT' || error.code === 'ECONNREFUSED')) {
      return false;
    }
    throw new Error('Unable to establish a bounded connection to the local daemon.');
  }

  return new Promise((resolve, reject) => {
    const decoder = new IpcFrameDecoder(config.maxPayloadBytes);
    const healthRequestId = randomUUID();
    let phase: 'hello' | 'health' = 'hello';
    let settled = false;
    const timer = setTimeout(
      () => finish(false, true),
      config.helloTimeoutMs * 2,
    );
    timer.unref();

    const finish = (healthy: boolean, timedOut = false) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
      socket.destroy();
      if (timedOut) {
        reject(new Error('Local daemon health probe timed out.'));
      } else {
        resolve(healthy);
      }
    };
    const onError = () => finish(false);
    const onClose = () => finish(false);
    const onData = (chunk: Buffer) => {
      let messages: unknown[];
      try {
        messages = decoder.push(chunk);
      } catch {
        finish(false);
        return;
      }

      for (const message of messages) {
        if (phase === 'hello') {
          const response = ipcHelloResponseSchema.safeParse(message);
          if (
            !response.success ||
            response.data.status !== 'ready' ||
            response.data.protocolVersion !== IPC_PROTOCOL_VERSION ||
            response.data.packageVersion !== packageVersion
          ) {
            finish(false);
            return;
          }

          phase = 'health';
          try {
            socket.write(
              encodeIpcFrame(
                { type: 'health', requestId: healthRequestId },
                config.maxPayloadBytes,
              ),
            );
          } catch {
            finish(false);
            return;
          }
          continue;
        }

        const response = ipcHealthResponseSchema.safeParse(message);
        finish(
          response.success &&
            response.data.requestId === healthRequestId &&
            response.data.status.protocolVersion === IPC_PROTOCOL_VERSION &&
            response.data.status.packageVersion === packageVersion &&
            response.data.status.runtimeMode === config.runtimeMode &&
            response.data.status.daemonStatus === 'ready',
        );
        return;
      }
    };

    socket.on('data', onData);
    socket.once('error', onError);
    socket.once('close', onClose);
    try {
      socket.write(
        encodeIpcFrame(
          {
            type: 'hello',
            protocolVersion: IPC_PROTOCOL_VERSION,
            packageVersion,
          },
          config.maxPayloadBytes,
        ),
      );
    } catch {
      finish(false);
    }
  });
}

function toIpcErrorCode(error: unknown): IpcErrorCode {
  if (!(error instanceof BridgeError)) {
    return 'INTERNAL_ERROR';
  }

  const bridgeCode: BridgeErrorCode = error.code;
  switch (bridgeCode) {
    case 'BRIDGE_UNAVAILABLE':
      return 'DAEMON_UNAVAILABLE';
    case 'EXTENSION_NOT_CONNECTED':
    case 'UNSUPPORTED_OPERATION':
    case 'REQUEST_TIMEOUT':
    case 'EXTENSION_DISCONNECTED':
    case 'EXTENSION_OPERATION_FAILED':
    case 'REQUEST_CANCELLED':
    case 'BRIDGE_BUSY':
    case 'INVALID_EXTENSION_RESPONSE':
    case 'INTERNAL_ERROR':
      return bridgeCode;
  }
}