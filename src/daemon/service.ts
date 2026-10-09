import { timingSafeEqual } from 'node:crypto';
import type { EventEmitter } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import type { McpServer } from '@modelcontextprotocol/server';
import { BridgeService } from '../bridge/service.js';
import { parseBridgeConfig, type BridgeConfig, type RuntimeMode } from '../config.js';
import { parseHttpConfig, type HttpConfig } from '../http-config.js';
import { createBridgeExecutor, createMcpServer } from '../server.js';
import type { ToolExecutor } from '../tools/executor.js';
import { allowedHosts, allowedPeer, privateAddresses } from '../network.js';
import type { SettingsStore } from '../settings.js';
import { ManagementService } from '../management/service.js';
import { checkMcpConnection } from '../management/connection-check.js';

type SignalTarget = Pick<EventEmitter, 'once' | 'off'>;
type DaemonState = 'starting' | 'ready' | 'shutting_down' | 'closed';
export interface DaemonStartOptions {
  env?: NodeJS.ProcessEnv;
  runtimeMode?: RuntimeMode;
  shutdownDrainMs?: number;
  signalTarget?: SignalTarget;
  onLog?: (message: string) => void;
  settings?: SettingsStore;
}
export type DaemonStartResult = { status: 'started'; daemon: DaemonService };
interface ActiveRequest { controller: AbortController; server: McpServer; response: ServerResponse; }

export class DaemonService {
  readonly #httpServer = createServer((req, res) => {
    void this.#handleRequest(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    });
  });
  readonly #active = new Set<ActiveRequest>();
  readonly #drainWaiters = new Set<() => void>();
  #state: DaemonState = 'starting';
  #closePromise: Promise<void> | undefined;
  #management: ManagementService | undefined;

  private constructor(
    private readonly bridge: BridgeService,
    private readonly config: BridgeConfig,
    private readonly httpConfig: HttpConfig,
    private readonly shutdownDrainMs: number,
    private readonly signalTarget: SignalTarget,
  ) {}

  public static async start(options: DaemonStartOptions = {}): Promise<DaemonStartResult> {
    const env = options.env ?? process.env;
    const result = parseBridgeConfig(env, options.runtimeMode ?? 'production');
    if (!result.ok) throw new Error(result.reason);
    const httpConfig = parseHttpConfig(env);
    const drain = options.shutdownDrainMs ?? 1000;
    if (!Number.isSafeInteger(drain) || drain < 0 || drain > 30_000)
      throw new RangeError('Shutdown drain must be an integer between 0 and 30000 milliseconds.');
    const log = (message: string) => options.onLog?.(
      message.replaceAll(result.config.token, '[redacted]').replaceAll(httpConfig.token, '[redacted]'),
    );
    const bridge = await BridgeService.createStrict(result.config, log);
    const daemon = new DaemonService(bridge, result.config, httpConfig, drain, options.signalTarget ?? process);
    if (options.settings) daemon.#management = new ManagementService(options.settings, httpConfig.port,
      { mcpToken: httpConfig.token, bridgeToken: result.config.token }, () => ({
        mcpUrl: daemon.mcpUrl, webSocketUrl: daemon.webSocketUrl,
        runtimeMode: result.config.runtimeMode, allowlistEnabled: result.config.extensionIds.length > 0,
        environmentOnly: {
          webSocketHost: result.config.host, webSocketTls: Boolean(result.config.tlsCertFile),
          maxPayloadBytes: result.config.maxPayloadBytes, maxRegisteredInstances: result.config.maxRegisteredInstances,
          helloTimeoutMs: result.config.helloTimeoutMs,
        },
        devices: bridge.instances,
        lanEndpoints: httpConfig.host === '0.0.0.0' ? privateAddresses().map((address) => ({
          mcpUrl: `http://${address}:${httpConfig.port}/mcp`,
          webSocketUrl: `${result.config.tlsCertFile ? 'wss' : 'ws'}://${result.config.host === '0.0.0.0' ? address : result.config.host}:${bridge.port}/`,
        })) : [],
      }), async (instanceId) => {
        const registered = instanceId && bridge.instances.some(device => device.instanceId === instanceId && device.status === 'online');
        return checkMcpConnection(daemon.mcpUrl, httpConfig.token, registered ? instanceId : undefined);
      });
    try {
      await new Promise<void>((resolve, reject) => {
        daemon.#httpServer.once('error', reject);
        daemon.#httpServer.listen(httpConfig.port, httpConfig.host, () => {
          daemon.#httpServer.off('error', reject);
          resolve();
        });
      });
      daemon.#httpServer.on('error', () => { void daemon.close().catch(() => { process.exitCode = 1; }); });
      daemon.#state = 'ready';
      daemon.signalTarget.once('SIGINT', daemon.#onSignal);
      daemon.signalTarget.once('SIGTERM', daemon.#onSignal);
      log([
        ...(options.settings ? [`Open local settings: http://127.0.0.1:${httpConfig.port}/`, `Configuration file: ${options.settings.path}`] : []),
        `MCP Streamable HTTP URL: ${daemon.mcpUrl}`,
        'MCP authorization: Bearer BOOKMARKDOWN_MCP_TOKEN (hidden).',
        'Extension connection settings:',
        `  WebSocket URL: ${daemon.webSocketUrl}`,
        '  Pairing token: configured (hidden); use the same BOOKMARKDOWN_BRIDGE_TOKEN in the extension.',
        `  Allowed extension IDs: ${result.config.runtimeMode === 'production' && result.config.extensionIds.length ? result.config.extensionIds.join(', ') : 'any compatible Chrome extension with a valid pairing token'}`,
        'Open BMD > Settings > MCP, enter the URL and pairing token, save, test the connection, then enable it.',
        ...(result.config.tlsCertFile ? ['The browser must trust the server TLS certificate before connecting.'] : []),
        'Waiting for an extension connection...',
      ].join('\n'));
      return { status: 'started', daemon };
    } catch (error) {
      await daemon.close();
      throw error;
    }
  }

  public get status(): DaemonState { return this.#state; }
  public get mcpUrl(): string { return `http://127.0.0.1:${this.httpConfig.port}/mcp`; }
  public get webSocketPort(): number | undefined { return this.bridge.port; }
  public get webSocketUrl(): string {
    return `${this.config.tlsCertFile ? 'wss' : 'ws'}://${this.config.host === '0.0.0.0' ? '127.0.0.1' : this.config.host}:${this.bridge.port}/`;
  }
  public get pendingRequestCount(): number { return this.#active.size; }

  async #handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (this.#management && (req.url === '/' || req.url?.startsWith('/assets/') || req.url?.startsWith('/api/'))) {
      await this.#management.handle(req, res); return;
    }
    const hosts = allowedHosts(this.httpConfig.host, this.httpConfig.port);
    if (!allowedPeer(req.socket.remoteAddress) || !hosts.includes(req.headers.host ?? '') ||
        (req.headers.origin !== undefined && req.headers.origin !== `http://${req.headers.host}`)) {
      res.writeHead(403).end(); return;
    }
    const expected = Buffer.from(`Bearer ${this.httpConfig.token}`);
    const actual = Buffer.from(req.headers.authorization ?? '');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      res.writeHead(401, { 'WWW-Authenticate': 'Bearer', 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }).end(
        this.#management && req.method === 'GET'
          ? `這是供 agent 呼叫的 MCP HTTP 端點，需要 Bearer token。\n請在啟動 server 的電腦開啟設定頁：http://127.0.0.1:${this.httpConfig.port}/\n`
          : 'MCP authorization requires a valid Bearer token.\n',
      ); return;
    }
    if (req.url !== '/mcp') { res.writeHead(404).end(); return; }
    // Stateless Streamable HTTP: JSON responses, no resumable SSE sessions.
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }).end(); return; }
    if (this.#state !== 'ready' || this.#active.size >= this.config.maxPendingRequests) {
      res.writeHead(503, { 'Retry-After': '1' }).end(); return;
    }
    const controller = new AbortController();
    const executor = createBridgeExecutor(this.bridge);
    const guarded = Object.fromEntries(Object.entries(executor).map(([name, execute]) => [name,
      (args: never, context: { signal?: AbortSignal }) => execute(args, {
        signal: context.signal ? AbortSignal.any([context.signal, controller.signal]) : controller.signal,
      }),
    ])) as ToolExecutor;
    const server = createMcpServer(guarded);
    const transport = new NodeStreamableHTTPServerTransport({
      sessionIdGenerator: undefined, enableJsonResponse: true,
      maxRequestBodySize: this.config.maxPayloadBytes,
    });
    const active = { controller, server, response: res };
    this.#active.add(active);
    const abort = () => { if (!res.writableFinished) controller.abort(); };
    res.once('close', abort);
    // The adapter can return after end() but before the response is flushed.
    // Keep the request in the drain set until finish/close, so shutdown cannot
    // destroy its socket while a successful JSON reply is still being written.
    const responseFinished = new Promise<void>(resolve => {
      const finish = () => { res.off('finish', finish); res.off('close', finish); resolve(); };
      res.once('finish', finish);
      res.once('close', finish);
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res);
      await responseFinished;
    } finally {
      controller.abort();
      res.off('close', abort);
      try { await server.close(); } finally {
        this.#active.delete(active);
        if (this.#active.size === 0) for (const resolve of this.#drainWaiters) resolve();
      }
    }
  }

  public close(): Promise<void> {
    if (this.#closePromise) return this.#closePromise;
    this.#state = 'shutting_down';
    this.signalTarget.off('SIGINT', this.#onSignal);
    this.signalTarget.off('SIGTERM', this.#onSignal);
    this.#closePromise = this.#shutdown();
    return this.#closePromise;
  }
  async #shutdown(): Promise<void> {
    const stopped = new Promise<void>((resolve) => this.#httpServer.close(() => resolve()));
    if (this.#active.size) await new Promise<void>((resolve) => {
      const finish = () => { clearTimeout(timer); this.#drainWaiters.delete(finish); resolve(); };
      const timer = setTimeout(finish, this.shutdownDrainMs);
      this.#drainWaiters.add(finish);
    });
    const forceHttpClose = this.#active.size > 0;
    for (const active of this.#active) { active.controller.abort(); active.response.destroy(); }
    const results = await Promise.allSettled([
      ...[...this.#active].map((active) => active.server.close()), this.bridge.close(),
    ]);
    // close() already ends idle sockets gracefully. Forced destruction after a
    // successful drain can reset a reply still travelling to the client.
    if (forceHttpClose) this.#httpServer.closeAllConnections();
    await stopped;
    this.#state = 'closed';
    const errors = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (errors.length) throw new AggregateError(errors.map((r) => r.reason), 'Daemon shutdown was incomplete.');
  }
  readonly #onSignal = () => { void this.close().catch(() => { process.exitCode = 1; }); };
}
export function startDaemon(options: DaemonStartOptions = {}): Promise<DaemonStartResult> {
  return DaemonService.start(options);
}
