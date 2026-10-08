import { lanEnabled } from './network.js';
export interface HttpConfig { host: string; port: number; token: string; }
export function parseHttpConfig(env: NodeJS.ProcessEnv): HttpConfig {
  const rawPort = env.BOOKMARKDOWN_MCP_PORT ?? '38472';
  const port = Number(rawPort);
  if (!/^\d+$/.test(rawPort) || !Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new Error('BOOKMARKDOWN_MCP_PORT must be an integer between 1 and 65535.');
  const token = env.BOOKMARKDOWN_MCP_TOKEN;
  if (!token || token.length < 32 || token.length > 512 || !/^[\x21-\x7e]+$/.test(token))
    throw new Error('BOOKMARKDOWN_MCP_TOKEN must contain between 32 and 512 printable ASCII bytes without spaces.');
  return { host: lanEnabled(env) ? '0.0.0.0' : '127.0.0.1', port, token };
}
