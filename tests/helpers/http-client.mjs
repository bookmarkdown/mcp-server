export class HttpTestClient {
  constructor(url, token) { this.url = url; this.token = token; this.nextId = 1; }
  async request(method, params = {}, signal) {
    const response = await fetch(this.url, {
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
