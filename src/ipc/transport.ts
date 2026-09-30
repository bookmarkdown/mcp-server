import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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

  if (process.platform === 'win32') {
    return `${pipePrefix}${pipeName}`;
  }
  if (process.platform !== 'linux' && process.platform !== 'darwin') {
    throw new Error('Local IPC transport is supported on Windows, Linux, and macOS only.');
  }

  const nameHash = createHash('sha256').update(pipeName).digest('hex').slice(0, 16);
  // macOS TMPDIR can exceed sun_path's 104-byte limit; use a short, private
  // per-user directory under /tmp instead. Linux keeps its existing endpoint.
  const runtimeRoot = process.platform === 'darwin' ? '/tmp' : tmpdir();
  const unixSocketPathLimit = process.platform === 'darwin' ? 104 : 108;
  const socketPath = join(runtimeRoot, `bookmarkdown-${currentUserId()}`, `${nameHash}.sock`);
  if (Buffer.byteLength(socketPath, 'utf8') >= unixSocketPathLimit) {
    throw new RangeError('The local IPC runtime path is too long for a Unix domain socket.');
  }
  return socketPath;
}

export async function listenLocalPipe(
  pipeName: string,
  onConnection: LocalPipeConnectionHandler,
  onError: LocalPipeErrorHandler,
): Promise<LocalPipeServer> {
  const endpointPath = getLocalPipePath(pipeName);
  if (process.platform !== 'win32') {
    await prepareUnixSocketPath(endpointPath);
  }

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
    server.listen(endpointPath);
  });

  if (process.platform !== 'win32') {
    try {
      await chmod(endpointPath, 0o600);
    } catch (error) {
      await new Promise<void>((resolve, reject) => {
        server.close((closeError) => closeError ? reject(closeError) : resolve());
      });
      throw error;
    }
  }

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
  const endpointPath = getLocalPipePath(pipeName);
  const timeoutMs = options.timeoutMs ?? 5000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw new RangeError('Local IPC connect timeout must be between 1 and 30000 milliseconds.');
  }
  if (options.signal?.aborted) {
    throw new DOMException('Local IPC connect cancelled.', 'AbortError');
  }

  const socket = createConnection(endpointPath);
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
      new DOMException('Local IPC connect cancelled.', 'AbortError'),
    );
    const timer = setTimeout(() => handleError(
      new Error('Local IPC connect timed out.'),
    ), timeoutMs);

    socket.once('connect', handleConnect);
    socket.once('error', handleError);
    options.signal?.addEventListener('abort', handleAbort, { once: true });
    if (options.signal?.aborted) {
      handleAbort();
    }
  });
}

async function prepareUnixSocketPath(socketPath: string): Promise<void> {
  const directoryPath = dirname(socketPath);
  const uid = currentUserId();
  try {
    await mkdir(directoryPath, { mode: 0o700 });
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') {
      throw error;
    }
  }

  let directoryStats = await lstat(directoryPath);
  if (!directoryStats.isDirectory() || directoryStats.uid !== uid) {
    throw new Error('The local IPC runtime directory must be owned by the current user.');
  }
  if ((directoryStats.mode & 0o777) !== 0o700) {
    await chmod(directoryPath, 0o700);
    directoryStats = await lstat(directoryPath);
  }
  if ((directoryStats.mode & 0o777) !== 0o700) {
    throw new Error('The local IPC runtime directory must have mode 0700.');
  }

  await removeStaleUnixSocket(socketPath, uid);
}

async function removeStaleUnixSocket(socketPath: string, uid: number): Promise<void> {
  let originalStats;
  try {
    originalStats = await lstat(socketPath);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return;
    }
    throw error;
  }
  if (!originalStats.isSocket() || originalStats.uid !== uid) {
    throw new Error('The local IPC endpoint path is not a socket owned by the current user.');
  }

  if (await isUnixSocketActive(socketPath)) {
    const error = new Error('The local IPC endpoint is already in use.') as NodeJS.ErrnoException;
    error.code = 'EADDRINUSE';
    throw error;
  }

  let currentStats;
  try {
    currentStats = await lstat(socketPath);
  } catch (error) {
    if (errorCode(error) === 'ENOENT') {
      return;
    }
    throw error;
  }
  if (
    currentStats.isSocket() &&
    currentStats.uid === uid &&
    currentStats.dev === originalStats.dev &&
    currentStats.ino === originalStats.ino
  ) {
    await unlink(socketPath);
  }
}

function isUnixSocketActive(socketPath: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath);
    let settled = false;
    const finish = (active: boolean, error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) {
        reject(error);
      } else {
        resolve(active);
      }
    };
    const timer = setTimeout(() => {
      finish(false, new Error('Unable to verify the existing local IPC endpoint.'));
    }, 1000);

    socket.once('connect', () => finish(true));
    socket.once('error', (error) => {
      if (errorCode(error) === 'ECONNREFUSED' || errorCode(error) === 'ENOENT') {
        finish(false);
      } else {
        finish(false, error);
      }
    });
  });
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

function currentUserId(): number {
  if (typeof process.getuid !== 'function') {
    throw new Error('The Unix IPC transport requires the current user ID.');
  }
  return process.getuid();
}

function toError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error('Local IPC connection handler failed.');
}
