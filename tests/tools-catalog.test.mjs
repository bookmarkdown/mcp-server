import assert from 'node:assert/strict';
import test from 'node:test';
import { toolCatalog } from '../dist/tools/catalog.js';

test('exports the explicit browser tool catalog and stable metadata', () => {
  assert.deepEqual(
    Object.values(toolCatalog)
      .map(({ name }) => name)
      .sort(),
    [
      'bookmarks.search',
      'browser.closeTab',
      'browser.countOpenTabs',
      'browser.countOpenWindows',
      'browser.listTabs',
      'browser.moveTab',
      'browser.openTab',
      'devices.list',
      'tags.search',
    ],
  );
  assert.deepEqual(
    Object.values(toolCatalog).filter(({name}) => !['bookmarks.search', 'tags.search'].includes(name)).map(({ name, description }) => ({
      name,
      description,
    })),
    [
      {
        name: 'devices.list',
        description: 'List extension instances known to this running bridge.',
      },
      {
        name: 'browser.countOpenTabs',
        description: 'Count normal-window tabs for one connected extension instance.',
      },
      {
        name: 'browser.countOpenWindows',
        description: 'Count normal browser windows for one connected extension instance.',
      },
      {
        name: 'browser.listTabs',
        description: 'List bounded tab metadata from normal windows for one connected extension instance.',
      },
      {
        name: 'browser.openTab',
        description: 'Open a tab in a normal window, defaulting to about:blank.',
      },
      {
        name: 'browser.closeTab',
        description: 'Close one tab in a normal browser window.',
      },
      {
        name: 'browser.moveTab',
        description: 'Move one tab between normal browser windows.',
      },
    ],
  );
});

test('keeps the strict input schemas and devices.list defaults', () => {
  assert.deepEqual(toolCatalog.devicesList.inputSchema.parse({}), {
    includeOffline: true,
    includeTabCounts: true,
  });
  assert.deepEqual(
    toolCatalog.devicesList.inputSchema.parse({
      includeOffline: false,
      includeTabCounts: false,
    }),
    { includeOffline: false, includeTabCounts: false },
  );
  assert.equal(
    toolCatalog.devicesList.inputSchema.safeParse({ extra: true }).success,
    false,
  );
  assert.equal(
    toolCatalog.countOpenTabs.inputSchema.safeParse({
      instanceId: '7d8c2f92-12c8-4bd2-9701-12e602deaf01',
      extra: true,
    }).success,
    false,
  );
  assert.equal(
    toolCatalog.countOpenTabs.inputSchema.safeParse({
      instanceId: 'not-a-uuid',
    }).success,
    false,
  );
  const instanceId = '7d8c2f92-12c8-4bd2-9701-12e602deaf01';
  assert.deepEqual(toolCatalog.listTabs.inputSchema.parse({ instanceId }), {
    instanceId,
    limit: 10,
    offset: 0,
  });
  assert.deepEqual(
    toolCatalog.listTabs.inputSchema.parse({ instanceId, limit: 3, offset: 8 }),
    { instanceId, limit: 3, offset: 8 },
  );
  for (const arguments_ of [
    { instanceId, limit: 0, offset: 0 },
    { instanceId, limit: 11, offset: 0 },
    { instanceId, limit: 1.5, offset: 0 },
    { instanceId, limit: 1, offset: -1 },
    { instanceId, limit: 1, offset: 1.5 },
    { instanceId, limit: 1, offset: Number.MAX_SAFE_INTEGER + 1 },
  ]) {
    assert.equal(toolCatalog.listTabs.inputSchema.safeParse(arguments_).success, false);
  }
  assert.equal(
    toolCatalog.closeTab.inputSchema.safeParse({ instanceId, tabId: -1 }).success,
    false,
  );
  assert.equal(
    toolCatalog.moveTab.inputSchema.safeParse({
      instanceId,
      tabId: 1,
      targetWindowId: 1.5,
    }).success,
    false,
  );
});

test('describes the existing tool result shapes', () => {
  const countedAt = '2026-09-27T12:00:00.000Z';
  const deviceListResult = {
    instances: [
      {
        appId: 'bmd-extension',
        instanceId: '7d8c2f92-12c8-4bd2-9701-12e602deaf01',
        extensionId: 'a'.repeat(32),
        browser: 'chrome',
        status: 'online',
        lastSeen: countedAt,
        displayName: null,
        capabilities: { operations: ['browser.countOpenTabs'] },
        countStatus: 'ok',
        tabCount: 4,
        countedAt,
      },
    ],
    totalTabs: 4,
    complete: true,
    queriedAt: countedAt,
  };
  const countResult = { count: 4, countedAt };

  assert.deepEqual(
    toolCatalog.devicesList.outputSchema.parse(deviceListResult),
    deviceListResult,
  );
  assert.equal(
    toolCatalog.devicesList.outputSchema.safeParse({
      ...deviceListResult,
      extra: true,
    }).success,
    false,
  );
  assert.deepEqual(
    toolCatalog.countOpenTabs.outputSchema.parse(countResult),
    countResult,
  );
  assert.deepEqual(
    toolCatalog.countOpenWindows.outputSchema.parse(countResult),
    countResult,
  );
});

test('validates open-tab URLs and bounds returned tab metadata', () => {
  const instanceId = '7d8c2f92-12c8-4bd2-9701-12e602deaf01';
  for (const url of ['http://example.invalid/', 'https://example.invalid/path']) {
    assert.equal(
      toolCatalog.openTab.inputSchema.safeParse({ instanceId, url }).success,
      true,
    );
  }
  for (const url of [
    'javascript:alert(1)',
    'ftp://example.invalid/file',
    'file:///private/document',
    '/relative/path',
    'https://user:password@example.invalid/',
  ]) {
    assert.equal(
      toolCatalog.openTab.inputSchema.safeParse({ instanceId, url }).success,
      false,
    );
  }

  const timestamp = '2026-09-27T12:00:00.000Z';
  const tab = {
    tabId: 4,
    windowId: 2,
    active: true,
    title: 'Example',
    url: 'https://example.invalid/',
  };
  const result = {
    tabs: [tab],
    nextOffset: null,
    queriedAt: timestamp,
  };
  assert.deepEqual(toolCatalog.listTabs.outputSchema.parse(result), result);
  assert.deepEqual(
    toolCatalog.openTab.outputSchema.parse({
      tabId: 5,
      windowId: 2,
      url: 'about:blank',
    }),
    { tabId: 5, windowId: 2, url: 'about:blank' },
  );
  assert.deepEqual(
    toolCatalog.closeTab.outputSchema.parse({ tabId: 4, closed: true }),
    { tabId: 4, closed: true },
  );
  assert.deepEqual(
    toolCatalog.moveTab.outputSchema.parse({
      tabId: 4,
      sourceWindowId: 2,
      targetWindowId: 3,
    }),
    { tabId: 4, sourceWindowId: 2, targetWindowId: 3 },
  );

  assert.equal(
    toolCatalog.listTabs.outputSchema.safeParse({
      ...result,
      tabs: Array.from({ length: 11 }, (_, index) => ({ ...tab, tabId: index })),
    }).success,
    false,
  );
  assert.equal(
    toolCatalog.listTabs.outputSchema.safeParse({
      ...result,
      tabs: [{ ...tab, title: 'x'.repeat(513) }],
    }).success,
    false,
  );
  assert.equal(
    toolCatalog.listTabs.outputSchema.safeParse({
      ...result,
      tabs: [{ ...tab, title: '界'.repeat(342) }],
    }).success,
    false,
  );
  assert.equal(
    toolCatalog.listTabs.outputSchema.safeParse({
      ...result,
      tabs: [{ ...tab, url: '界'.repeat(683) }],
    }).success,
    false,
  );
  assert.equal(
    toolCatalog.listTabs.outputSchema.safeParse({
      ...result,
      tabs: [{ ...tab, incognito: false }],
    }).success,
    false,
  );
});