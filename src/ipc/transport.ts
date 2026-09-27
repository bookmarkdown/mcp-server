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

export async function connectLocalPipe(pipeName: string): Promise<Socket> {
  assertWindows();

  const socket = createConnection(getLocalPipePath(pipeName));
  return new Promise<Socket>((resolve, reject) => {
    const handleConnect = () => {
      socket.off('error', handleError);
      resolve(socket);
    };
    const handleError = (error: Error) => {
      socket.off('connect', handleConnect);
      socket.destroy();
      reject(error);
    };

    socket.once('connect', handleConnect);
    socket.once('error', handleError);
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