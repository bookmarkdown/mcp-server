import {Agent, request as httpRequest} from 'node:http';

// Disposable daemon tests must not share Undici's process-wide connection pool.
// Consume the entire response before resolving; no request is automatically replayed.
export async function freshFetch(url, options = {}) {
  const agent = new Agent({keepAlive: true});
  const requestSite = new Error('HTTP test request originated here.');
  try { return await new Promise((resolve, reject) => {
    const req = httpRequest(url, {agent, method: options.method ?? 'GET',
      headers: options.headers, signal: options.signal}, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => {
        const headers = new Headers();
        for (let i = 0; i < res.rawHeaders.length; i += 2) headers.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
        resolve(new Response([204, 205, 304].includes(res.statusCode) ? null : Buffer.concat(chunks),
          {status: res.statusCode, headers}));
      });
    });
    req.on('error', reject);
    req.end(options.body);
  }); } catch (error) {
    error.stack += '\n' + requestSite.stack;
    throw error;
  } finally { agent.destroy(); }
}

export class HttpTestClient {
  constructor(url, token) { this.url = url; this.token = token; this.nextId = 1; }
  async request(method, params = {}, signal) {
    const response = await freshFetch(this.url, {
      method: 'POST', signal,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': '2025-11-25' },
      body: JSON.stringify({ jsonrpc: '2.0', id: this.nextId++, method, params }),
    });
    if (!response.ok) throw Object.assign(new Error(`HTTP ${response.status}`), { code: response.status === 503 ? 'BRIDGE_BUSY' : 'HTTP_ERROR' });
    const message = await response.json();
    if (message.error) throw Object.assign(new Error(message.error.message), { code: message.error.code });
    return message.result;
  }
  initialize() {
    return this.request('initialize', { protocolVersion: '2025-11-25', capabilities: {},
      clientInfo: { name: 'http-test', version: '1.0.0' } });
  }
  async call(name, args, signal) {
    let result;
    try { result = await this.request('tools/call', { name, arguments: args }, signal); }
    catch (error) {
      if (signal?.aborted) throw Object.assign(new Error('Cancelled'), { code: 'REQUEST_CANCELLED' });
      throw error;
    }
    if (result.isError) throw Object.assign(new Error('Tool failed'), JSON.parse(result.content[0].text).error);
    return result.structuredContent;
  }
  close() {}
}
