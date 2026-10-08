import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, writeFile, rm, stat, symlink } from 'node:fs/promises';
import { createServer, request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Script } from 'node:vm';
import { WebSocket } from 'ws';
import { SettingsStore, defaultSettingsPath } from '../dist/settings.js';
import { startDaemon } from '../dist/daemon/service.js';
import { privateAddresses, allowedPeer, isLoopback } from '../dist/network.js';
import { HttpTestClient } from './helpers/http-client.mjs';
import { managementJs } from '../dist/management/page.js';

async function storeFor(t, env = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'bmd-settings-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return SettingsStore.load({ BOOKMARKDOWN_CONFIG_FILE: join(directory, 'config.json'), ...env });
}
function editable(store) { const { mcpToken, bridgeToken, version, ...rest } = store.settings; return rest; }
async function port() {
  const server = createServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port; await new Promise(resolve => server.close(resolve));
  return value > 10080 ? value : port();
}
async function start(t, store) {
  const { daemon } = await startDaemon({ env: store.effectiveEnv(), settings: store, signalTarget: new EventEmitter() });
  t.after(() => daemon.close()); return daemon;
}
async function api(url, csrf, body, path = '/api/settings', extras = {}) {
  return fetch(url + path, { method: 'POST', headers: { Origin: url, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, ...extras }, body: JSON.stringify(body) });
}
test('compiled management JavaScript is syntactically valid', () => {
  assert.doesNotThrow(() => new Script(managementJs));
});
test('creates independent persistent tokens, private POSIX permissions and per-user paths', async t => {
  const store = await storeFor(t);
  assert.match(store.settings.mcpToken, /^[a-f0-9]{64}$/);
  assert.notEqual(store.settings.mcpToken, store.settings.bridgeToken);
  assert.deepEqual((await SettingsStore.load(store.env)).settings, store.settings);
  if (process.platform !== 'win32') assert.equal((await stat(store.path)).mode & 0o777, 0o600);
  assert.match(defaultSettingsPath({ LOCALAPPDATA: 'C:/Users/test/AppData/Local' }, 'win32'), /BookMarkdown[\\/]mcp-server[\\/]config.json$/);
  assert.equal(defaultSettingsPath({ XDG_CONFIG_HOME: '/tmp/example' }, 'linux'), join('/tmp/example', 'bookmarkdown-mcp', 'config.json'));
  assert.match(defaultSettingsPath({}, 'darwin'), /Application Support[\\/]BookMarkdown/);
});
test('fails closed on malformed/unknown configuration without replacement; saves atomically', async t => {
  const store = await storeFor(t);
  const before = store.settings;
  await assert.rejects(store.save({ ...editable(store), mcpPort: before.webSocketPort }));
  assert.deepEqual(store.settings, before);
  await store.save({ ...editable(store), lanEnabled: true });
  assert.equal((await SettingsStore.load(store.env)).settings.lanEnabled, true);
  await writeFile(store.path, JSON.stringify({ ...before, unknown: true }));
  const malformed = await readFile(store.path, 'utf8');
  await assert.rejects(SettingsStore.load(store.env), /not overwritten/);
  assert.equal(await readFile(store.path, 'utf8'), malformed);
  await writeFile(store.path, '{');
  await assert.rejects(SettingsStore.load(store.env), /not overwritten/);
});
test('environment overrides runtime configuration and locks edits; rotations persist', async t => {
  const store = await storeFor(t, { BOOKMARKDOWN_MCP_PORT: '39200' });
  assert.equal(store.effectiveEnv().BOOKMARKDOWN_MCP_PORT, '39200');
  assert.deepEqual(store.overrides, ['mcpPort']);
  await assert.rejects(store.save({ ...editable(store), mcpPort: 39201 }), /read-only/);
  const previous = store.settings.mcpToken;
  await store.rotate('mcpToken');
  assert.notEqual(store.settings.mcpToken, previous);
  assert.equal((await SettingsStore.load(store.env)).settings.mcpToken, store.settings.mcpToken);
});
test('rejects symlink configuration files', { skip: process.platform === 'win32' }, async t => {
  const store = await storeFor(t);
  const target = store.path + '.target'; await writeFile(target, await readFile(store.path));
  await rm(store.path); await symlink(target, store.path);
  await assert.rejects(SettingsStore.load(store.env), /not overwritten/);
});
test('local management masks tokens, rejects forged requests, saves then restarts', async t => {
  const store = await storeFor(t);
  await store.save({ ...editable(store), mcpPort: await port(), webSocketPort: await port() });
  let daemon = await start(t, store); const url = new URL(daemon.mcpUrl).origin;
  const page = await fetch(url + '/'); const html = await page.text();
  assert.equal(page.status, 200); assert.match(html, /bookmarkdown<span>mcp-server/);
  assert.match(page.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.equal(html.includes(store.settings.mcpToken), false);
  const csrf = /name="csrf-token" content="([a-f0-9]+)"/.exec(html)[1];
  const status = await (await fetch(url + '/api/status')).json();
  assert.deepEqual(status.devices, []); assert.equal(status.restartRequired, false);
  assert.equal(JSON.stringify(status).includes(store.settings.bridgeToken), false);
  const mcpPage = await fetch(url + '/mcp');
  assert.equal(mcpPage.status, 401);
  assert.match(await mcpPage.text(), /請在啟動 server 的電腦開啟設定頁/);
  const wsPage = await fetch(daemon.webSocketUrl.replace(/^ws:/, 'http:'));
  assert.equal(wsPage.status, 404);
  assert.match(await wsPage.text(), /WebSocket 連線/);
  assert.equal((await fetch(url + '/api/secrets')).status, 404);
  assert.equal((await api(url, '', { which: 'mcpToken' }, '/api/secrets')).status, 403);
  assert.equal((await api(url, csrf, { which: 'mcpToken' }, '/api/secrets', { Origin: 'https://evil.example' })).status, 403);
  assert.equal((await api(url, csrf, { which: 'mcpToken' }, '/api/secrets')).status, 200);
  assert.equal((await api(url, csrf, { ...editable(store), lanEnabled: true })).status, 200);
  assert.equal((await (await fetch(url + '/api/status')).json()).restartRequired, true);
  assert.equal((await api(url, csrf, { token: 'unexpected' })).status, 400);
  assert.equal((await api(url, csrf, { which: 'mcpToken' }, '/api/rotate')).status, 200);
  const activeSecret = await (await api(url, csrf, { which: 'mcpToken' }, '/api/secrets')).json();
  assert.notEqual(activeSecret.token, store.settings.mcpToken);
  await daemon.close(); daemon = await start(t, await SettingsStore.load(store.env));
  assert.equal((await (await fetch(url + '/api/status')).json()).restartRequired, false);
  assert.equal((await fetch(url + '/mcp', { headers: { Authorization: `Bearer ${activeSecret.token}` } })).status, 401);
  assert.equal((await new HttpTestClient(daemon.mcpUrl, store.settings.mcpToken).initialize()).serverInfo.name, 'bookmarkdown-mcp-server');
});
test('LAN exposes authenticated HTTP and WS, accepts compatible IDs, and denies remote management', async t => {
  const store = await storeFor(t);
  await store.save({ ...editable(store), lanEnabled: true, mcpPort: await port(), webSocketPort: await port() });
  const daemon = await start(t, store);
  const address = privateAddresses()[0];
  assert.equal(allowedPeer('8.8.8.8'), false); assert.equal(isLoopback('192.168.1.2'), false);
  if (address) {
    const remote = `http://${address}:${store.settings.mcpPort}`;
    const remotePage = await fetch(remote + '/');
    assert.equal(remotePage.status, 403);
    assert.match(await remotePage.text(), /設定頁僅限本機存取/);
    assert.equal((await fetch(remote + '/api/status')).status, 403);
    assert.equal((await fetch(remote + '/mcp')).status, 401);
    assert.equal((await new HttpTestClient(remote + '/mcp', store.settings.mcpToken).initialize()).serverInfo.name, 'bookmarkdown-mcp-server');
  } else t.diagnostic('No private interface: LAN HTTP checks limited to wildcard listener and loopback.');
  const extensionId = 'c'.repeat(32);
  const ws = new WebSocket(`ws://${address ?? '127.0.0.1'}:${store.settings.webSocketPort}/`, { origin: `chrome-extension://${extensionId}` });
  t.after(() => ws.terminate());
  await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  const reply = new Promise(resolve => ws.once('message', bytes => resolve(JSON.parse(bytes.toString()))));
  ws.send(JSON.stringify({ type: 'hello', protocolVersion: '2', appId: 'bmd-extension', token: store.settings.bridgeToken,
    extensionId, instanceId: '7d8c2f92-12c8-4bd2-9701-12e602deaf01', displayName: '測試裝置', browser: 'chrome', capabilities: { operations: ['browser.countOpenTabs'] } }));
  assert.equal((await reply).ok, true);
  const status = await (await fetch(new URL(daemon.mcpUrl).origin + '/api/status')).json();
  assert.equal(status.devices.length, 1); assert.equal(status.devices[0].extensionId, extensionId);
  const forbiddenHost = await new Promise((resolve, reject) => {
    const req = request(new URL(daemon.mcpUrl).origin + '/', { headers: { Host: 'evil.example' } }, res => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(forbiddenHost, 403);
});
