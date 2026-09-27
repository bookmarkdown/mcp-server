import { randomUUID } from 'node:crypto';
import { WebSocket, type RawData } from 'ws';
import { BridgeError } from './errors.js';
import {
  browserResponseSchema,
  rawDataToBuffer,
  type BrowserResponse,
  type ExtensionHello,
} from './protocol.js';

export interface InstanceSnapshot {
  appId: string;
  instanceId: string;
  extensionId: string;
  browser: string;
  status: 'online' | 'offline';
  lastSeen: string;
  operations: string[];
}

export interface ConnectedInstance extends InstanceSnapshot {
  connectionId: string;
}

interface ConnectionRecord extends Omit<ConnectedInstance, 'status'> {
  socket: WebSocket | null;
}

export interface ConnectionManagerHandlers {
  onResponse?: (connectionId: string, response: BrowserResponse) => void;
  onDisconnect?: (connectionId: string, error: BridgeError) => void;
}

export class ConnectionManager {
  readonly #instances = new Map<string, ConnectionRecord>();
  readonly #connections = new Map<string, ConnectionRecord>();
  #handlers: ConnectionManagerHandlers = {};

  public constructor(
    private readonly maxPayloadBytes: number,
    private readonly maxRegisteredInstances: number,
  ) {}

  public setHandlers(handlers: ConnectionManagerHandlers): void {
    this.#handlers = handlers;
  }

  public register(
    socket: WebSocket,
    hello: ExtensionHello,
  ): { ok: true; connectionId: string } | { ok: false; reason: string } {
    const instanceKey = this.#instanceKey(hello.appId, hello.instanceId);
    const previous = this.#instances.get(instanceKey);
    if (previous && previous.extensionId !== hello.extensionId) {
      return { ok: false, reason: 'instance-identity-conflict' };
    }
    if (!previous && this.#instances.size >= this.maxRegisteredInstances) {
      return { ok: false, reason: 'instance-limit-reached' };
    }

    if (previous?.socket) {
      const previousSocket = previous.socket;
      this.#disconnect(previous, new BridgeError('EXTENSION_DISCONNECTED'));
      if (previousSocket.readyState === WebSocket.OPEN) {
        previousSocket.close(4001, 'replaced');
      }
    }

    const connectionId = randomUUID();
    const record: ConnectionRecord = {
      appId: hello.appId,
      instanceId: hello.instanceId,
      extensionId: hello.extensionId,
      browser: hello.browser,
      connectionId,
      lastSeen: new Date().toISOString(),
      operations: [...new Set(hello.capabilities.operations)],
      socket,
    };

    this.#instances.set(instanceKey, record);
    this.#connections.set(connectionId, record);

    socket.on('message', (data, isBinary) => this.#receive(record, data, isBinary));
    socket.once('close', () => {
      this.#disconnect(record, new BridgeError('EXTENSION_DISCONNECTED'));
    });
    socket.once('error', () => {
      this.#disconnect(record, new BridgeError('EXTENSION_DISCONNECTED'));
    });

    return { ok: true, connectionId };
  }

  public getConnectedInstance(instanceId: string): ConnectedInstance | undefined {
    const record = this.#instances.get(this.#instanceKey('bmd-extension', instanceId));
    if (!record?.socket || record.socket.readyState !== WebSocket.OPEN) {
      return undefined;
    }

    return {
      appId: record.appId,
      instanceId: record.instanceId,
      extensionId: record.extensionId,
      browser: record.browser,
      status: 'online',
      lastSeen: record.lastSeen,
      operations: [...record.operations],
      connectionId: record.connectionId,
    };
  }

  public listInstances(): InstanceSnapshot[] {
    return [...this.#instances.values()].map((record) => ({
      appId: record.appId,
      instanceId: record.instanceId,
      extensionId: record.extensionId,
      browser: record.browser,
      status:
        record.socket?.readyState === WebSocket.OPEN ? 'online' : 'offline',
      lastSeen: record.lastSeen,
      operations: [...record.operations],
    }));
  }

  public send(connectionId: string, request: unknown): Promise<void> {
    const record = this.#connections.get(connectionId);
    const socket = record?.socket;
    if (!record || !socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new BridgeError('EXTENSION_DISCONNECTED'));
    }

    const encoded = JSON.stringify(request);
    if (Buffer.byteLength(encoded, 'utf8') > this.maxPayloadBytes) {
      return Promise.reject(new BridgeError('BRIDGE_BUSY'));
    }

    return new Promise((resolve, reject) => {
      socket.send(encoded, (error) => {
        if (error) {
          const bridgeError = new BridgeError('EXTENSION_DISCONNECTED');
          this.#disconnect(record, bridgeError);
          reject(bridgeError);
          return;
        }
        resolve();
      });
    });
  }

  public closeAll(): void {
    for (const record of [...this.#connections.values()]) {
      const socket = record.socket;
      this.#disconnect(record, new BridgeError('BRIDGE_UNAVAILABLE'));
      if (socket?.readyState === WebSocket.OPEN) {
        socket.close(1001, 'server-shutdown');
      }
    }
  }

  #receive(
    record: ConnectionRecord,
    data: RawData,
    isBinary: boolean,
  ): void {
    if (this.#connections.get(record.connectionId) !== record) {
      return;
    }
    if (isBinary) {
      this.#closeInvalidConnection(record);
      return;
    }

    let message: unknown;
    try {
      message = JSON.parse(rawDataToBuffer(data).toString('utf8')) as unknown;
    } catch {
      this.#closeInvalidConnection(record);
      return;
    }

    const parsed = browserResponseSchema.safeParse(message);
    if (!parsed.success) {
      this.#closeInvalidConnection(record);
      return;
    }

    record.lastSeen = new Date().toISOString();
    this.#handlers.onResponse?.(record.connectionId, parsed.data);
  }

  #closeInvalidConnection(record: ConnectionRecord): void {
    const socket = record.socket;
    this.#disconnect(record, new BridgeError('INVALID_EXTENSION_RESPONSE'));
    if (socket?.readyState === WebSocket.OPEN) {
      socket.close(1008, 'invalid-message');
    }
  }

  #disconnect(record: ConnectionRecord, error: BridgeError): void {
    if (this.#connections.get(record.connectionId) !== record) {
      return;
    }

    this.#connections.delete(record.connectionId);
    record.socket = null;
    this.#handlers.onDisconnect?.(record.connectionId, error);
  }

  #instanceKey(appId: string, instanceId: string): string {
    return `${appId}\u0000${instanceId}`;
  }
}