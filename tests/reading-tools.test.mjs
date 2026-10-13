import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {once} from 'node:events';
import test from 'node:test';
import {WebSocket} from 'ws';
import {createQueryHarness} from './helpers/query-harness.mjs';
import {readingTools, libraryTools} from '../dist/tools/catalog.js';

test('reading schemas reject extra commands and invalid continuations; paths are explicit', () => {
  const instanceId = randomUUID();
  for (const args of [{limit: 11}, {domain: 'https://example.test'}, {cursor: 'invalid'},
    {cursor: `${randomUUID()}:10`, search: 'changed'}, {script: 'evil'}]) {
    assert.equal(readingTools.searchTabs.inputSchema.safeParse({instanceId, ...args}).success, false);
  }
  assert.equal(readingTools.readTabContent.inputSchema.safeParse({instanceId, tabId: 1, maxChars: 8001}).success, false);
  const input = {contentUrl: 'https://example.test', title: '', description: '', tagPaths: ['AA::BB::CC']};
  assert.ok(libraryTools.createBookmark.inputSchema.safeParse({instanceId, input}).success);
  assert.equal(libraryTools.createBookmark.inputSchema.safeParse({instanceId, input: {...input, tagPaths: Array(51).fill('a')}}).success, false);
});

test('reading RPC validates IDs, budgets, cursor advancement and safe error codes', async t => {
  const harness = await createQueryHarness(), instanceId = randomUUID();
  const socket = new WebSocket(harness.endpoint, {origin: `chrome-extension://${'a'.repeat(32)}`});
  t.after(async () => {socket.terminate(); await harness.close();});
  await once(socket, 'open'); const ack = once(socket, 'message');
  socket.send(JSON.stringify({type: 'hello', protocolVersion: '2', token: harness.token, appId: 'bmd-extension', instanceId,
    displayName: 'Reading Test', extensionId: 'a'.repeat(32), browser: 'chrome', capabilities: {operations: Object.values(readingTools).map(t => t.name)}}));
  assert.equal(JSON.parse((await ack)[0].toString()).ok, true);
  let mode = 'valid';
  const cursorId = randomUUID();
  socket.on('message', raw => {
    const request = JSON.parse(raw.toString()); if (request.type !== 'browser/request') return;
    if (mode === 'expired') {
      socket.send(JSON.stringify({type:'browser/response', requestId:request.requestId, ok:false,
        error:{name:'Error', code:'CURSOR_EXPIRED', message:'private content must not be returned'}})); return;
    }
    const info = {nextCursor:null, capturedAt:'2026-10-14T00:00:00.000Z', expiresAt:'2026-10-14T00:02:00.000Z'};
    let data = request.operation === 'browser.searchTabs' ? {...info, totalCount:1,
      tabs:[{tabId:1,windowId:1,active:true,title:'React',url:'https://example.test',truncated:false}]}
      : {...info, tabId:mode === 'wrongId' ? 2 : 1, mode:'excerpt',url:'https://example.test',title:'React',description:'',headings:[],text:'Hello',sourceTruncated:false,truncated:false};
    if (mode === 'badCursor') data = {...data,nextCursor:`${cursorId}:0`,totalCount:2};
    if (mode === 'oversize') data.text = 'x'.repeat(2001);
    socket.send(JSON.stringify({type:'browser/response',requestId:request.requestId,ok:true,data}));
  });
  assert.equal((await harness.call('browser.searchTabs',{instanceId})).totalCount,1);
  assert.equal((await harness.call('browser.readTabContent',{instanceId,tabId:1})).text,'Hello');
  mode='wrongId'; await assert.rejects(harness.call('browser.readTabContent',{instanceId,tabId:1}),/INVALID_EXTENSION_RESPONSE/);
  mode='oversize'; await assert.rejects(harness.call('browser.readTabContent',{instanceId,tabId:1}),/INVALID_EXTENSION_RESPONSE/);
  mode='badCursor'; await assert.rejects(harness.call('browser.searchTabs',{instanceId}),/INVALID_EXTENSION_RESPONSE/);
  mode='expired'; const result=await harness.request('tools/call',{name:'browser.searchTabs',arguments:{instanceId}});
  assert.equal(result.isError,true); assert.match(result.content[0].text,/CURSOR_EXPIRED/);
  assert.ok(!result.content[0].text.includes('private content'));
});
