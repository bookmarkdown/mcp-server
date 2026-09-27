import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { IpcClient, type IpcClientOptions } from '../ipc/client.js';
import { createMcpServer } from '../server.js';

export interface ProxyServiceHandle {
  close(): Promise<void>;
}

export function startProxyService(
  options: IpcClientOptions = {},
): ProxyServiceHandle {
  const client = new IpcClient(options);
  const stdio = serveStdio(() => createMcpServer(client.executor));
  let shutdown: Promise<void> | undefined;

  const close = (): Promise<void> => {
    shutdown ??= Promise.allSettled([
      Promise.resolve().then(() => stdio.close()),
      Promise.resolve().then(() => client.close()),
    ]).then(() => undefined);
    return shutdown;
  };
  const onStdinClosed = () => {
    void close();
  };
  const onSignal = () => {
    void close().finally(() => process.stdin.destroy());
  };

  process.stdin.once('end', onStdinClosed);
  process.stdin.once('close', onStdinClosed);
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  return { close };
}