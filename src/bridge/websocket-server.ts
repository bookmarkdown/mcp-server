import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type Server as HttpServer,
  type ServerResponse,
} from 'node:http';
import {
  createServer as createHttpsServer,
  type Server as HttpsServer,
} from 'node:https';
import type { Duplex } from 'node:stream';
import { WebSocket, WebSocketServer } from 'ws';
import type { BridgeConfig } from '../config.js';
import { ConnectionManager } from './connection-manager.js';
import {
  APP_ID,
  extensionHelloSchema,
  PROTOCOL_VERSION,
  rawDataToBuffer,
} from './protocol.js';

export class WebSocketBridgeServer {
  readonly #httpServer: HttpServer | HttpsServer;
  readonly #webSocketServer: WebSocketServer;
  readonly #extensionIds: Set<string>;
  #boundPort: number | undefined;

  public constructor(
    private readonly config: BridgeConfig,
    private readonly connections: ConnectionManager,
    private readonly onLog?: (message: string) => void,
  ) {
    this.#extensionIds = new Set(config.extensionIds);
    this.#webSocketServer = new WebSocketServer({
      noServer: true,
      maxPayload: config.maxPayloadBytes,
      perMessageDeflate: false,
    });
    const requestHandler = (_request: IncomingMessage, response: ServerResponse) => {
      response.writeHead(404, { connection: 'close' });
      response.end();
    };
    const tlsOptions = config.tlsCertFile && config.tlsKeyFile
      ? {
          cert: readFileSync(config.tlsCertFile),
          key: readFileSync(config.tlsKeyFile),
          minVersion: 'TLSv1.2' as const,
        }
      : undefined;
    this.#httpServer = tlsOptions
      ? createHttpsServer(tlsOptions, requestHandler)
      : createHttpServer(requestHandler);

    this.#httpServer.on('upgrade', (request, socket, head) => {
      const extensionId = this.#extensionIdFromOrigin(request.headers.origin);
      const expectedHost = `${this.config.host}:${this.#boundPort}`;
      if (
        request.url !== '/' ||
        request.headers.host !== expectedHost ||
        extensionId === undefined
      ) {
        this.onLog?.('Extension connection rejected: invalid Host, path, or Origin. Check the WebSocket URL and BOOKMARKDOWN_EXTENSION_IDS allowlist.');
        this.#rejectUpgrade(socket, 403, 'Forbidden');
        return;
      }

      if (this.#webSocketServer.clients.size >= this.config.maxConnections) {
        this.onLog?.('Extension connection rejected: connection limit reached.');
        this.#rejectUpgrade(socket, 503, 'Service Unavailable');
        return;
      }

      socket.on('error', () => {});
      this.#webSocketServer.handleUpgrade(request, socket, head, (webSocket) => {
        this.#webSocketServer.emit('connection', webSocket, request);
      });
    });

    this.#webSocketServer.on(
      'connection',
      (socket: WebSocket, request: IncomingMessage) => {
        const extensionId = this.#extensionIdFromOrigin(request.headers.origin);
        if (extensionId) {
          this.#handleConnection(socket, extensionId);
        } else {
          socket.close(1008, 'origin-not-allowed');
        }
      },
    );
  }

  public get port(): number | undefined {
    return this.#boundPort;
  }

  // 在設定的位址啟動 WebSocket 使用的 HTTP(S) listener。
  public async listen(): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      this.#httpServer.once('error', onError);
      this.#httpServer.listen(this.config.port, this.config.host, () => {
        this.#httpServer.off('error', onError);
        resolve();
      });
    });

    const address = this.#httpServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('The WebSocket listener did not expose a TCP address.');
    }

    this.#boundPort = address.port;
    return address.port;
  }

  // 中止 WebSocket 連線並關閉 HTTP 連線，避免 daemon 關閉時留下 listener。
  public async close(): Promise<void> {
    if (!this.#httpServer.listening) {
      return;
    }

    for (const client of this.#webSocketServer.clients) {
      client.terminate();
    }

    await new Promise<void>((resolve, reject) => {
      this.#httpServer.close((error) => error ? reject(error) : resolve());
      this.#httpServer.closeAllConnections();
    });
  }

  // 驗證 Origin 的 Chrome extension ID 格式；正式模式還必須在允許清單中。
  #extensionIdFromOrigin(origin: string | string[] | undefined): string | undefined {
    if (typeof origin !== 'string') {
      return undefined;
    }

    const match = /^chrome-extension:\/\/([a-p]{32})$/.exec(origin);
    if (
      !match ||
      (this.config.runtimeMode === 'production' &&
        !this.#extensionIds.has(match[1]))
    ) {
      return undefined;
    }

    return match[1];
  }

  #rejectUpgrade(
    socket: Duplex,
    status: 403 | 503,
    reason: string,
  ): void {
    socket.end(
      `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
    );
  }

  // 等待 extension hello，檢查訊息格式並限制握手等待時間。
  #handleConnection(socket: WebSocket, originExtensionId: string): void {
    socket.on('error', () => {});
    let finished = false;
    const finish = () => {
      if (finished) {
        return false;
      }
      finished = true;
      clearTimeout(timeout);
      return true;
    };

    const timeout = setTimeout(() => {
      if (finish()) {
        this.#rejectHello(socket, 'hello-timeout');
      }
    }, this.config.helloTimeoutMs);

    socket.once('close', finish);
    socket.once('message', (data, isBinary) => {
      if (!finish()) {
        return;
      }
      if (isBinary) {
        this.#rejectHello(socket, 'invalid-hello');
        return;
      }

      let value: unknown;
      try {
        value = JSON.parse(rawDataToBuffer(data).toString('utf8')) as unknown;
      } catch {
        this.#rejectHello(socket, 'invalid-hello');
        return;
      }

      const parsed = extensionHelloSchema.safeParse(value);
      if (!parsed.success) {
        this.#rejectHello(socket, 'invalid-hello');
        return;
      }

      this.#authenticate(socket, originExtensionId, parsed.data);
    });
  }

  // 驗證配對資訊、協定與 extension 身分；通過後才註冊連線或回覆 probe。
  #authenticate(
    socket: WebSocket,
    originExtensionId: string,
    hello: ReturnType<typeof extensionHelloSchema.parse>,
  ): void {
    if (!this.#tokensMatch(hello.token, this.config.token)) {
      this.#rejectHello(socket, 'unauthorized', hello.mode);
      return;
    }
    if (hello.protocolVersion !== PROTOCOL_VERSION) {
      this.#rejectHello(socket, 'unsupported-protocol-version', hello.mode);
      return;
    }
    if (hello.appId !== APP_ID || hello.browser !== 'chrome') {
      this.#rejectHello(socket, 'unsupported-client', hello.mode);
      return;
    }
    if (
      hello.extensionId !== originExtensionId ||
      (this.config.runtimeMode === 'production' &&
        !this.#extensionIds.has(hello.extensionId))
    ) {
      this.#rejectHello(socket, 'extension-id-mismatch', hello.mode);
      return;
    }
    if (hello.mode === 'probe') {
      if (hello.capabilities.operations.length !== 0) {
        this.#rejectHello(socket, 'invalid-probe', 'probe');
        return;
      }
      this.#sendProbeAck(socket);
      return;
    }

    if (hello.displayName === undefined) {
      this.#rejectHello(socket, 'invalid-hello');
      return;
    }

    const registration = this.connections.register(socket, hello);
    if (!registration.ok) {
      this.#rejectHello(socket, registration.reason);
      return;
    }

    const identity = `${registration.displayName ?? hello.instanceId} (${hello.instanceId})`;
    socket.once('close', () => {
      this.onLog?.(`Extension disconnected: ${identity}.`);
    });

    socket.send(
      JSON.stringify({
        type: 'hello-ack',
        ok: true,
        protocolVersion: PROTOCOL_VERSION,
        connectionId: registration.connectionId,
        displayName: registration.displayName,
      }),
      (error) => {
        if (error) {
          socket.terminate();
          return;
        }
        this.onLog?.(`Extension connected: ${identity}; protocol ${PROTOCOL_VERSION}.`);
      },
    );
  }

  #sendProbeAck(socket: WebSocket): void {
    socket.send(
      JSON.stringify({
        type: 'hello-ack',
        mode: 'probe',
        ok: true,
        protocolVersion: PROTOCOL_VERSION,
      }),
      (error) => {
        if (error) {
          socket.terminate();
          return;
        }
        this.onLog?.(`Extension connection test succeeded; protocol ${PROTOCOL_VERSION}. No persistent connection was registered.`);
        socket.close(1000, 'probe-complete');
      },
    );
  }

  #rejectHello(
    socket: WebSocket,
    reason: string,
    mode?: 'probe',
  ): void {
    const hint = reason === 'unauthorized'
      ? ' Check that the extension pairing token matches BOOKMARKDOWN_BRIDGE_TOKEN.'
      : reason === 'unsupported-protocol-version'
        ? ' Update the server and extension to compatible protocol versions.'
        : reason === 'extension-id-mismatch'
          ? ' Check the extension ID and BOOKMARKDOWN_EXTENSION_IDS allowlist.'
          : '';
    this.onLog?.(`Extension handshake rejected: ${reason}.${hint}`);
    if (socket.readyState !== WebSocket.OPEN) {
      socket.terminate();
      return;
    }

    socket.send(
      JSON.stringify({
        type: 'hello-ack',
        ...(mode ? { mode } : {}),
        ok: false,
        protocolVersion: PROTOCOL_VERSION,
        reason,
      }),
      () => socket.close(1008, reason),
    );
  }

  // 先檢查長度，再以固定時間比較 token，避免一般字串比較提早洩漏差異。
  #tokensMatch(provided: string, expected: string): boolean {
    const providedBytes = Buffer.from(provided, 'utf8');
    const expectedBytes = Buffer.from(expected, 'utf8');
    return (
      providedBytes.length === expectedBytes.length &&
      timingSafeEqual(providedBytes, expectedBytes)
    );
  }
}
