import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {createConnection} from 'node:net';
import test from 'node:test';
import {WebSocket} from 'ws';
import {createQueryHarness} from './helpers/query-harness.mjs';
import {toolCatalog} from '../dist/tools/catalog.js';

test('query tools reject invalid keywords, IDs, SQL and extra fields', () => {
  const instanceId = randomUUID();
  assert.deepEqual(toolCatalog.searchBookmarks.inputSchema.parse({instanceId}),
    {instanceId, keywords: [], tagIds: [], search: '', limit: 10, offset: 0});
  for (const payload of [{keywords: [' ']}, {keywords: Array(51).fill('React')}, {keywords: ['x'.repeat(257)]},
    {tagIds: [0]}, {tagIds: [1.5]}, {tagIds: Array(51).fill(1)}, {limit: 11}, {offset: -1}, {sql: 'SELECT 1'}]) {
    assert.equal(toolCatalog.searchBookmarks.inputSchema.safeParse({instanceId, ...payload}).success, false);
  }
  assert.equal(toolCatalog.searchTags.inputSchema.safeParse({instanceId, query: 'x'.repeat(257)}).success, false);
  assert.equal(toolCatalog.searchTags.inputSchema.safeParse({instanceId, synonyms: true}).success, false);
});

test('routes real MCP calls through authenticated instances and validates search responses', async (t) => {
  const harness = await createQueryHarness();
  const instanceId = randomUUID();
  const socket = new WebSocket(harness.endpoint, {origin: `chrome-extension://${'a'.repeat(32)}`});
  t.after(async () => { socket.terminate(); await harness.close(); });
  const catalog = await harness.request('tools/list');
  for (const name of ['bookmarks.search', 'tags.search']) {
    assert.equal(catalog.tools.find((tool) => tool.name === name).annotations.readOnlyHint, true);
  }
  await assert.rejects(harness.call('bookmarks.search', {instanceId}), /EXTENSION_NOT_CONNECTED/);
  await once(socket, 'open');
  const ack = once(socket, 'message');
  socket.send(JSON.stringify({type: 'hello', protocolVersion: '2', token: harness.token, appId: 'bmd-extension',
    instanceId, displayName: 'Query Test', extensionId: 'a'.repeat(32), browser: 'chrome', capabilities: {operations: ['bookmarks.search', 'tags.search']}}));
  assert.equal(JSON.parse((await ack)[0].toString()).ok, true);
  let mode = 'valid';
  const requests = [];
  socket.on('message', (raw) => {
    const request = JSON.parse(raw.toString());
    if (request.type !== 'browser/request') return;
    requests.push(request);
    const data = request.operation === 'bookmarks.search'
      ? {bookmarks: [{id: 1, title: 'React drag', url: 'https://example.test/', description: '', tags: [{id: 2, name: '拖曳', path: 'React / 拖曳', truncated: false}], truncated: false}], totalCount: 2, nextOffset: request.payload.offset + 1, queriedAt: new Date().toISOString()}
      : {tags: [], totalCount: 0, nextOffset: null, queriedAt: new Date().toISOString()};
    if (mode === 'badPage') data.nextOffset = 9;
    if (mode === 'badSchema') data.sql = 'private';
    socket.send(JSON.stringify({type: 'browser/response', requestId: request.requestId, ok: true, data}));
  });
  const result = await harness.call('bookmarks.search', {instanceId, keywords: ['React', '拖曳'], tagIds: [2], limit: 1});
  assert.equal(result.bookmarks[0].title, 'React drag');
  assert.deepEqual(requests[0].payload, {keywords: ['React', '拖曳'], tagIds: [2], search: '', limit: 1, offset: 0});
  assert.equal((await harness.call('tags.search', {instanceId, query: 'React'})).totalCount, 0);
  mode = 'badPage';
  await assert.rejects(harness.call('bookmarks.search', {instanceId, limit: 1}), /INVALID_EXTENSION_RESPONSE/);
  mode = 'badSchema';
  await assert.rejects(harness.call('tags.search', {instanceId}), /INVALID_EXTENSION_RESPONSE/);
  await assert.rejects(harness.call('bookmarks.search', {instanceId, tagIds: [0]}));
  assert.equal(requests.length, 4);
});

test('denied upgrades flush their HTTP status and half-open sockets are released on shutdown', async (t) => {
  const harness = await createQueryHarness();
  const sockets = [];
  t.after(async () => { for (const socket of sockets) socket.destroy(); await harness.close(); });
  const endpoint = new URL(harness.endpoint);
  for (let index = 0; index < 20; index++) {
    const socket = createConnection({host: endpoint.hostname, port: Number(endpoint.port)});
    sockets.push(socket);
    socket.on('error', () => {});
    await once(socket, 'connect');
    const response = once(socket, 'data');
    socket.write(`GET / HTTP/1.1\r\nHost: ${endpoint.host}\r\nOrigin: https://invalid.example\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n\r\n`);
    let reply;
    try { reply = await response; } catch (cause) { throw new Error('Denied upgrade response failed at attempt ' + index, {cause}); }
    assert.match(reply[0].toString(), /^HTTP\/1\.1 403 Forbidden\r\n/);
    if (index < 19) socket.end();
  }
  // The final peer deliberately keeps its write side open after receiving 403.
  // Shutdown must clean it up rather than waiting for the fallback timeout.
  const closed = new Promise((resolve) => sockets.at(-1).once('close', resolve));
  await harness.close();
  await closed;
});
