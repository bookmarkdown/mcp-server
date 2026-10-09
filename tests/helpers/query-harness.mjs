import {randomBytes} from 'node:crypto';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export async function createQueryHarness({extensionId, distDirectory} = {}) {
  const dist = distDirectory ? pathToFileURL(resolve(distDirectory) + '/').href : new URL('../../dist/', import.meta.url).href;
  const {createBridgeService} = await import(new URL('bridge/service.js', dist));
  const {createMcpServer} = await import(new URL('server.js', dist));
  const reserve = createServer();
  await new Promise((yes, no) => { reserve.once('error', no); reserve.listen(0, '127.0.0.1', yes); });
  const port = reserve.address().port;
  await new Promise((yes, no) => reserve.close((error) => error ? no(error) : yes()));
  const token = randomBytes(24).toString('hex');
  const bridge = await createBridgeService({ok: true, config: {
    runtimeMode: 'production', host: '127.0.0.1', port, token,
    extensionIds: [extensionId ?? 'a'.repeat(32)], maxPayloadBytes: 65536, maxPendingRequests: 32,
    maxConnections: 8, maxRegisteredInstances: 64, requestTimeoutMs: 2000, helloTimeoutMs: 2000,
  }});
  if (!bridge.available) throw new Error('Query test bridge failed to start.');
  const server = createMcpServer(bridge);
  const pending = new Map();
  let id = 0;
  const transport = {
    async start() {},
    async send(message) {
      if ('id' in message) pending.get(message.id)?.(message);
    },
    async close() { transport.onclose?.(); },
    onmessage: undefined, onclose: undefined, onerror: undefined,
  };
  await server.connect(transport);
  const request = (method, params = {}) => new Promise((yes, no) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); no(new Error('MCP test request timed out.')); }, 5000);
    pending.set(requestId, (response) => {
      clearTimeout(timer); pending.delete(requestId);
      if (response.error) no(new Error(JSON.stringify(response.error)));
      else yes(response.result);
    });
    transport.onmessage({jsonrpc: '2.0', id: requestId, method, params});
  });
  await request('initialize', {protocolVersion: '2025-11-25', capabilities: {}, clientInfo: {name: 'query-test', version: '1.0.0'}});
  transport.onmessage({jsonrpc: '2.0', method: 'notifications/initialized'});
  return {
    bridge, token, endpoint: `ws://127.0.0.1:${port}/`, request,
    async call(name, args = {}) {
      const result = await request('tools/call', {name, arguments: args});
      if (result.isError) throw new Error(result.content[0].text);
      return result.structuredContent;
    },
    async close() { await server.close(); await bridge.close(); },
  };
}
