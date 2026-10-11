import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import test from 'node:test';
import {WebSocket} from 'ws';
import {createQueryHarness} from './helpers/query-harness.mjs';
import {libraryTools} from '../dist/tools/catalog.js';

test('library schemas reject unsafe IDs, unknown fields, excessive tags and encoded payloads', () => {
  const instanceId = randomUUID();
  const input = {contentUrl: 'https://example.test', title: '', description: '', tagIds: [1, 2]};
  assert.ok(libraryTools.createBookmark.inputSchema.safeParse({instanceId, input}).success);
  for (const candidate of [{...input, tagIds: [0]}, {...input, tagIds: [1.5]},
    {...input, tagIds: Array(501).fill(1)}, {...input, sql: 'SELECT 1'},
    {...input, description: '\u0001'.repeat(2100)}]) {
    assert.equal(libraryTools.createBookmark.inputSchema.safeParse({instanceId, input: candidate}).success, false);
  }
  assert.equal(libraryTools.deleteTag.inputSchema.safeParse({instanceId, id: 1}).success, false);
  assert.equal(libraryTools.updateTag.inputSchema.safeParse({instanceId, id: 1, input: {name: 'child', color: '', parentId: -1}}).success, false);
});

test('MCP library tools route every mutation, validate results and never retry timed-out writes', async t => {
  const harness = await createQueryHarness();
  const instanceId = randomUUID();
  const socket = new WebSocket(harness.endpoint, {origin: `chrome-extension://${'a'.repeat(32)}`});
  t.after(async () => {socket.terminate(); await harness.close();});
  await once(socket, 'open');
  const ack = once(socket, 'message');
  socket.send(JSON.stringify({type: 'hello', protocolVersion: '2', token: harness.token, appId: 'bmd-extension',
    instanceId, displayName: 'Library Test', extensionId: 'a'.repeat(32), browser: 'chrome',
    capabilities: {operations: Object.values(libraryTools).map(t => t.name)}}));
  assert.equal(JSON.parse((await ack)[0].toString()).ok, true);
  let mode = 'valid';
  const requests = [];
  socket.on('message', raw => {
    const request = JSON.parse(raw.toString());
    if (request.type !== 'browser/request') return;
    requests.push(request);
    if (mode === 'timeout') return;
    const data = mode === 'bad' ? {status: 'success'} : mode === 'conflict'
      ? {status: 'conflict', message: 'Bookmark no longer exists'}
      : request.operation === 'tags.previewDelete'
        ? {directChildCount: 1, descendantTagCount: 2, directBookmarkCount: 3, subtreeBookmarkCount: 4}
        : {status: 'success', value: {id: mode === 'wrongId' ? 8 : 7}};
    socket.send(JSON.stringify({type: 'browser/response', requestId: request.requestId, ok: true, data}));
  });
  const catalog = (await harness.request('tools/list')).tools;
  const bookmark = {contentUrl: 'https://example.test', title: 'React', description: '', tagIds: [2, 3]};
  const tag = {name: '拖曳', color: '', parentId: 2};
  const cases = [
    ['bookmarks.create', {input: bookmark}], ['bookmarks.update', {id: 7, input: bookmark}],
    ['bookmarks.delete', {id: 7}], ['bookmarks.replaceTags', {bookmarkId: 7, tagIds: [2, 3]}],
    ['bookmarks.setTagMembership', {bookmarkId: 7, tagId: 2, assigned: true}],
    ['tags.create', {input: tag}], ['tags.createPath', {input: {path: 'React::拖曳', color: ''}}],
    ['tags.update', {id: 7, input: tag}], ['tags.previewDelete', {id: 7}], ['tags.delete', {id: 7, strategy: 'promote'}],
  ];
  for (const [name, payload] of cases) {
    const result = await harness.call(name, {instanceId, ...payload});
    assert.deepEqual(requests.at(-1).payload, payload);
    assert.equal(requests.at(-1).operation, name);
    assert.equal(catalog.find(t => t.name === name).annotations.readOnlyHint, name === 'tags.previewDelete');
    if (name !== 'tags.previewDelete') assert.equal(result.value.id, 7);
  }
  mode = 'conflict';
  const conflict = await harness.request('tools/call', {name: 'bookmarks.delete', arguments: {instanceId, id: 7}});
  assert.equal(conflict.isError, true);
  assert.deepEqual(conflict.structuredContent, {status: 'conflict', message: 'Bookmark no longer exists'});
  mode = 'bad';
  await assert.rejects(harness.call('bookmarks.delete', {instanceId, id: 7}), /INVALID_EXTENSION_RESPONSE/);
  mode = 'wrongId';
  await assert.rejects(harness.call('bookmarks.delete', {instanceId, id: 7}), /INVALID_EXTENSION_RESPONSE/);
  mode = 'timeout';
  const count = requests.length;
  await assert.rejects(harness.call('bookmarks.create', {instanceId, input: bookmark}), /REQUEST_TIMEOUT/);
  assert.equal(requests.length, count + 1);
});

test('older query-only extensions reject mutations before sending a request', async t => {
  const harness = await createQueryHarness();
  const socket = new WebSocket(harness.endpoint, {origin: `chrome-extension://${'a'.repeat(32)}`});
  t.after(async () => {socket.terminate(); await harness.close();});
  await once(socket, 'open');
  const ack = once(socket, 'message');
  const instanceId = randomUUID();
  socket.send(JSON.stringify({type: 'hello', protocolVersion: '2', token: harness.token, appId: 'bmd-extension',
    instanceId, displayName: 'Older Client', extensionId: 'a'.repeat(32), browser: 'chrome', capabilities: {operations: ['bookmarks.search']}}));
  assert.equal(JSON.parse((await ack)[0].toString()).ok, true);
  let requests = 0;
  socket.on('message', () => requests++);
  await assert.rejects(harness.call('bookmarks.delete', {instanceId, id: 1}), /UNSUPPORTED_OPERATION/);
  assert.equal(requests, 0);
});
