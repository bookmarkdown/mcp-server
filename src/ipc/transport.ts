import { createConnection, createServer, type Socket } from 'node:net';

const pipeNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const pipePrefix = '\\\\.\\pipe\\';

export type LocalPipeConnectionHandler = (socket: Socket) => void;
export type LocalPipeErrorHandler = (error: Error) => void;

export interface LocalPipeServer {
  close(): Promise<void>;
}

export function getLocalPipePath(pipeName: string): string {
  if (!pipeNamePattern.test(pipeName)) {
    throw new TypeError(
      'Named pipe names must start with a letter or digit and contain only letters, digits, periods, underscores, or hyphens.',
    );
  }

  return `${pipePrefix}${pipeName}`;
}

export async function listenLocalPipe(
  pipeName: string,
  onConnection: LocalPipeConnectionHandler,
  onError: LocalPipeErrorHandler,
): Promise<LocalPipeServer> {
  assertWindows();

  const activeSockets = new Set<Socket>();
  let listening = false;
  let closePromise: Promise<void> | undefined;

  const server = createServer((socket) => {
    activeSockets.add(socket);
    socket.once('close', () => activeSockets.delete(socket));

    try {
      onConnection(socket);
    } catch (error) {
      socket.destroy();
      onError(toError(error));
    }
  });

  await new Promise<void>((resolve, reject) => {
    const handleListening = () => {
      listening = true;
      resolve();
    };
    const handleServerError = (error: Error) => {
      if (!listening) {
        server.off('listening', handleListening);
        reject(error);
        return;
      }
      onError(error);
    };

    server.on('error', handleServerError);
    server.once('listening', handleListening);
    server.listen(getLocalPipePath(pipeName));
  });

  return {
    close(): Promise<void> {
      if (closePromise) {
        return closePromise;
      }

      closePromise = new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve();
          }
        });
        for (const socket of activeSockets) {
          socket.destroy();
        }
      });

      return closePromise;
    },
  };
}

export interface LocalPipeConnectOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

export async function connectLocalPipe(
  pipeName: string,
  options: LocalPipeConnectOptions = {},
): Promise<Socket> {
  assertWindows();
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw new RangeError('Named Pipe connect timeout must be between 1 and 30000 milliseconds.');
  }
  if (options.signal?.aborted) {
    throw new DOMException('Named Pipe connect cancelled.', 'AbortError');
  }

  const socket = createConnection(getLocalPipePath(pipeName));
  return new Promise<Socket>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', handleAbort);
      socket.off('connect', handleConnect);
      socket.off('error', handleError);
    };
    const handleConnect = () => {
      cleanup();
      resolve(socket);
    };
    const handleError = (error: Error) => {
      cleanup();
      socket.destroy();
      reject(error);
    };
    const handleAbort = () => handleError(
      new DOMException('Named Pipe connect cancelled.', 'AbortError'),
    );
    const timer = setTimeout(() => handleError(
      new Error('Named Pipe connect timed out.'),
    ), timeoutMs);

    socket.once('connect', handleConnect);
    socket.once('error', handleError);
    options.signal?.addEventListener('abort', handleAbort, { once: true });
    if (options.signal?.aborted) {
      handleAbort();
    }
  });
}

function assertWindows(): void {
  if (process.platform !== 'win32') {
    throw new Error('Local Named Pipe transport is supported on Windows only.');
  }
}

function toError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error('Local Named Pipe connection handler failed.');
}