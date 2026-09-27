import { timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type Server } from 'node:http';
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

const LOOPBACK_HOST = '127.0.0.1';

export class LoopbackWebSocketServer {
  readonly #httpServer: Server;
  readonly #webSocketServer: WebSocketServer;
  readonly #extensionIds: Set<string>;
  #boundPort: number | undefined;

  public constructor(
    private readonly config: BridgeConfig,
    private readonly connections: ConnectionManager,
  ) {
    this.#extensionIds = new Set(config.extensionIds);
    this.#webSocketServer = new WebSocketServer({
      noServer: true,
      maxPayload: config.maxPayloadBytes,
      perMessageDeflate: false,
    });
    this.#httpServer = createServer((_request, response) => {
      response.writeHead(404, { connection: 'close' });
      response.end();
    });

    this.#httpServer.on('upgrade', (request, socket, head) => {
      const extensionId = this.#extensionIdFromOrigin(request.headers.origin);
      const expectedHost = `127.0.0.1:${this.#boundPort}`;
      if (
        request.url !== '/' ||
        request.headers.host !== expectedHost ||
        extensionId === undefined
      ) {
        this.#rejectUpgrade(socket, 403, 'Forbidden');
        return;
      }

      if (this.#webSocketServer.clients.size >= this.config.maxConnections) {
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

  public async listen(): Promise<number> {
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      this.#httpServer.once('error', onError);
      this.#httpServer.listen(this.config.port, LOOPBACK_HOST, () => {
        this.#httpServer.off('error', onError);
        resolve();
      });
    });

    const address = this.#httpServer.address();
    if (!address || typeof address === 'string') {
      throw new Error('The loopback WebSocket listener did not expose a TCP address.');
    }

    this.#boundPort = address.port;
    return address.port;
  }

  public async close(): Promise<void> {
    if (!this.#httpServer.listening) {
      return;
    }

    for (const client of this.#webSocketServer.clients) {
      client.terminate();
    }

    await new Promise<void>((resolve) => {
      this.#httpServer.close(() => resolve());
    });
  }

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

    const registration = this.connections.register(socket, hello);
    if (!registration.ok) {
      this.#rejectHello(socket, registration.reason);
      return;
    }

    socket.send(
      JSON.stringify({
        type: 'hello-ack',
        ok: true,
        protocolVersion: PROTOCOL_VERSION,
        connectionId: registration.connectionId,
      }),
      (error) => {
        if (error) {
          socket.terminate();
        }
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
        socket.close(1000, 'probe-complete');
      },
    );
  }

  #rejectHello(
    socket: WebSocket,
    reason: string,
    mode?: 'probe',
  ): void {
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

  #tokensMatch(provided: string, expected: string): boolean {
    const providedBytes = Buffer.from(provided, 'utf8');
    const expectedBytes = Buffer.from(expected, 'utf8');
    return (
      providedBytes.length === expectedBytes.length &&
      timingSafeEqual(providedBytes, expectedBytes)
    );
  }
}