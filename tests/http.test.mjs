import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createServer, request } from 'node:http';
import test from 'node:test';
import { startDaemon } from '../dist/daemon/service.js';
import { parseHttpConfig } from '../dist/http-config.js';
import { HttpTestClient, freshFetch as fetch } from './helpers/http-client.mjs';
const token = 'abcdef0123456789abcdef0123456789abcdef0123456789';
async function reservePort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port > 10080 ? port : reservePort();
}
async function start(t, overrides = {}, options = {}) {
  const env = { BOOKMARKDOWN_BRIDGE_TOKEN: token, BOOKMARKDOWN_MCP_TOKEN: token,
    BOOKMARKDOWN_EXTENSION_IDS: 'a'.repeat(32), BOOKMARKDOWN_WS_PORT: String(await reservePort()),
    BOOKMARKDOWN_MCP_PORT: String(await reservePort()), ...overrides };
  const { daemon } = await startDaemon({ env, signalTarget: new EventEmitter(), ...options });
  t.after(() => daemon.close());
  return { daemon, env, client: new HttpTestClient(daemon.mcpUrl, token) };
}
function headers(extra = {}) {
  return { Authorization: `Bearer ${token}`, Accept: 'application/json, text/event-stream',
    'Content-Type': 'application/json', 'MCP-Protocol-Version': '2025-11-25', ...extra };
}
test('validates MCP port and independent HTTP credential', () => {
  assert.equal(parseHttpConfig({ BOOKMARKDOWN_MCP_TOKEN: token }).port, 38472);
  for (const port of ['0', '-1', '65536', '1.2', 'abc', ''])
    assert.throws(() => parseHttpConfig({ BOOKMARKDOWN_MCP_TOKEN: token, BOOKMARKDOWN_MCP_PORT: port }));
  for (const value of [undefined, '', 'short', 'x'.repeat(513), 'a'.repeat(32) + '\n', '中'.repeat(32)])
    assert.throws(() => parseHttpConfig({ BOOKMARKDOWN_MCP_TOKEN: value }));
});
test('initializes, lists all tools, calls tools and isolates concurrent request IDs over HTTP', async t => {
  const { daemon, client } = await start(t);
  assert.equal((await client.initialize()).serverInfo.name, 'bookmarkdown-mcp-server');
  assert.equal((await client.request('tools/list')).tools.length, 7);
  const second = new HttpTestClient(daemon.mcpUrl, token);
  client.nextId = second.nextId = 42;
  const results = await Promise.all([client.request('tools/list'), second.initialize()]);
  assert.equal(results[0].tools.length, 7);
  assert.equal(results[1].serverInfo.name, 'bookmarkdown-mcp-server');
  await assert.rejects(client.call('browser.countOpenTabs', { instanceId: '7d8c2f92-12c8-4bd2-9701-12e602deaf01' }), { code: 'EXTENSION_NOT_CONNECTED' });
  const response = await fetch(daemon.mcpUrl, { method: 'POST', headers: headers(),
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
  assert.equal(response.status, 202);
  assert.equal(response.headers.get('mcp-session-id'), null);
});
test('rejects unauthenticated, cross-origin, rebound Host, wrong path and unsupported methods', async t => {
  const { daemon } = await start(t);
  for (const authorization of ['', 'Bearer wrong', `Basic ${token}`]) {
    const res = await fetch(daemon.mcpUrl, { headers: headers({ Authorization: authorization }) });
    assert.equal(res.status, 401); assert.equal(res.headers.get('www-authenticate'), 'Bearer');
  }
  assert.equal((await fetch(daemon.mcpUrl, { headers: headers({ Origin: 'https://evil.example' }) })).status, 403);
  const hostStatus = await new Promise((resolve, reject) => {
    const req = request(daemon.mcpUrl, { headers: headers({ Host: 'evil.example' }) }, res => {
      res.resume(); resolve(res.statusCode);
    });
    req.on('error', reject); req.end();
  });
  assert.equal(hostStatus, 403);
  for (const method of ['GET', 'DELETE', 'PUT', 'OPTIONS'])
    assert.equal((await fetch(daemon.mcpUrl, { method, headers: headers() })).status, 405);
  assert.equal((await fetch(daemon.mcpUrl + '?token=secret', { headers: headers() })).status, 404);
  assert.equal((await fetch(daemon.mcpUrl, { headers: headers({ Origin: new URL(daemon.mcpUrl).origin }) })).status, 405);
});
test('bounds payloads and delegates malformed JSON and protocol validation to SDK', async t => {
  const { daemon } = await start(t, { BOOKMARKDOWN_MAX_PAYLOAD_BYTES: '1024' });
  for (const [body, extra, status] of [
    ['x'.repeat(2048), {}, 413], ['{', {}, 400],
    ['{}', { 'MCP-Protocol-Version': 'invalid' }, 400],
    ['{}', { Accept: 'application/json' }, 406],
    ['{}', { 'Content-Type': 'text/plain' }, 415],
  ]) {
    const res = await fetch(daemon.mcpUrl, { method: 'POST', headers: headers(extra), body });
    assert.equal(res.status, status); await res.text();
  }
});
test('rolls back WebSocket when HTTP port is occupied', async t => {
  const occupied = createServer();
  await new Promise(resolve => occupied.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => occupied.close(resolve)));
  const wsPort = await reservePort();
  await assert.rejects(startDaemon({ env: { BOOKMARKDOWN_BRIDGE_TOKEN: token, BOOKMARKDOWN_MCP_TOKEN: token,
    BOOKMARKDOWN_EXTENSION_IDS: 'a'.repeat(32), BOOKMARKDOWN_WS_PORT: String(wsPort),
    BOOKMARKDOWN_MCP_PORT: String(occupied.address().port) } }), /EADDRINUSE/);
  const rebound = createServer();
  await new Promise((resolve, reject) => { rebound.once('error', reject); rebound.listen(wsPort, '127.0.0.1', resolve); });
  await new Promise(resolve => rebound.close(resolve));
});
test('limits concurrent HTTP bodies and cancels incomplete requests on bounded shutdown', async t => {
  const { daemon } = await start(t, { BOOKMARKDOWN_MAX_PENDING_REQUESTS: '1' }, { shutdownDrainMs: 20 });
  const pending = request(daemon.mcpUrl, { method: 'POST', headers: headers({ 'Content-Length': '100' }) });
  pending.on('error', () => {});
  pending.write('{');
  t.after(() => pending.destroy());
  const deadline = Date.now() + 2000;
  while (!daemon.pendingRequestCount && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(daemon.pendingRequestCount, 1);
  assert.equal((await fetch(daemon.mcpUrl, { method: 'POST', headers: headers(), body: '{}' })).status, 503);
  const close = daemon.close(); assert.equal(daemon.close(), close);
  await close;
  assert.equal(daemon.status, 'closed');
  await assert.rejects(fetch(daemon.mcpUrl));
});
