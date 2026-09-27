import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IPC_ERROR_CODES,
  IPC_PROTOCOL_VERSION,
  ipcCallRequestSchema,
  ipcCancelRequestSchema,
  ipcErrorSchema,
  ipcHealthRequestSchema,
  ipcHealthResponseSchema,
  ipcHealthStatusSchema,
  ipcHelloRequestSchema,
  ipcHelloResponseSchema,
  ipcMessageSchema,
  ipcResponseSchema,
} from '../dist/ipc/protocol.js';
import {
  IpcFrameDecoder,
  IpcFrameError,
  encodeIpcFrame,
} from '../dist/ipc/framing.js';

const requestId = '89bda3d1-a14e-4611-9688-3d021b3cd6a2';

test('validates protocol and package versions independently', () => {
  assert.equal(IPC_PROTOCOL_VERSION, 3);
  const hello = {
    type: 'hello',
    protocolVersion: IPC_PROTOCOL_VERSION,
    packageVersion: '0.1.0',
  };

  assert.deepEqual(ipcHelloRequestSchema.parse(hello), hello);
  assert.equal(
    ipcHelloRequestSchema.safeParse({ ...hello, protocolVersion: '1' }).success,
    false,
  );
  assert.equal(
    ipcHelloRequestSchema.safeParse({ ...hello, packageVersion: 'v0.1.0' })
      .success,
    false,
  );
  assert.equal(
    ipcHelloRequestSchema.safeParse({
      ...hello,
      protocolVersion: 7,
      packageVersion: '99.2.3',
    }).success,
    true,
  );

  assert.deepEqual(
    ipcHelloResponseSchema.parse({
      type: 'hello.response',
      protocolVersion: IPC_PROTOCOL_VERSION,
      packageVersion: '0.1.0',
      status: 'package_version_mismatch',
    }).status,
    'package_version_mismatch',
  );
  assert.equal(
    ipcHelloResponseSchema.safeParse({
      type: 'hello.response',
      protocolVersion: IPC_PROTOCOL_VERSION,
      packageVersion: '0.1.0',
      status: 'unknown',
    }).success,
    false,
  );
});

test('validates health status and request correlation strictly', () => {
  const request = { type: 'health', requestId };
  const status = {
    protocolVersion: IPC_PROTOCOL_VERSION,
    packageVersion: '0.1.0',
    runtimeMode: 'production',
    daemonStatus: 'ready',
    extensionStatus: 'not_connected',
  };

  assert.deepEqual(ipcHealthRequestSchema.parse(request), request);
  assert.deepEqual(ipcHealthStatusSchema.parse(status), status);
  const response = { type: 'health.response', requestId, status };
  assert.deepEqual(ipcHealthResponseSchema.parse(response), response);
  assert.deepEqual(ipcMessageSchema.parse(response), response);
  assert.equal(
    ipcHealthStatusSchema.safeParse({ ...status, extensionStatus: 'offline' })
      .success,
    false,
  );
  const { runtimeMode: _runtimeMode, ...statusWithoutRuntimeMode } = status;
  assert.equal(
    ipcHealthStatusSchema.safeParse(statusWithoutRuntimeMode).success,
    false,
  );
  assert.equal(
    ipcHealthStatusSchema.safeParse({ ...status, runtimeMode: 'test' }).success,
    false,
  );
  assert.equal(
    ipcHealthRequestSchema.safeParse({ ...request, unexpected: true }).success,
    false,
  );
});

test('allows only strict tool calls from the browser tool catalog', () => {
  const devicesCall = {
    type: 'call',
    requestId,
    toolName: 'devices.list',
    arguments: { includeOffline: false, includeTabCounts: true },
  };
  const countTabsCall = {
    type: 'call',
    requestId,
    toolName: 'browser.countOpenTabs',
    arguments: { instanceId: requestId },
  };
  const countWindowsCall = {
    type: 'call',
    requestId,
    toolName: 'browser.countOpenWindows',
    arguments: { instanceId: requestId },
  };
  const listTabsCall = {
    type: 'call',
    requestId,
    toolName: 'browser.listTabs',
    arguments: { instanceId: requestId },
  };
  const openTabCall = {
    type: 'call',
    requestId,
    toolName: 'browser.openTab',
    arguments: {
      instanceId: requestId,
      url: 'https://example.invalid/',
      windowId: 4,
    },
  };
  const closeTabCall = {
    type: 'call',
    requestId,
    toolName: 'browser.closeTab',
    arguments: { instanceId: requestId, tabId: 2 },
  };
  const moveTabCall = {
    type: 'call',
    requestId,
    toolName: 'browser.moveTab',
    arguments: { instanceId: requestId, tabId: 2, targetWindowId: 4 },
  };

  assert.deepEqual(ipcCallRequestSchema.parse(devicesCall), devicesCall);
  assert.deepEqual(ipcCallRequestSchema.parse(countTabsCall), countTabsCall);
  assert.deepEqual(ipcCallRequestSchema.parse(countWindowsCall), countWindowsCall);
  assert.deepEqual(ipcCallRequestSchema.parse(listTabsCall), {
    ...listTabsCall,
    arguments: { instanceId: requestId, limit: 10, offset: 0 },
  });
  assert.deepEqual(ipcCallRequestSchema.parse(openTabCall), openTabCall);
  assert.deepEqual(ipcCallRequestSchema.parse(closeTabCall), closeTabCall);
  assert.deepEqual(ipcCallRequestSchema.parse(moveTabCall), moveTabCall);
  assert.equal(
    ipcCallRequestSchema.safeParse({
      ...devicesCall,
      toolName: 'browser.openTab',
    }).success,
    false,
  );
  assert.equal(
    ipcCallRequestSchema.safeParse({
      ...devicesCall,
      arguments: { includeOffline: true, url: 'https://example.invalid' },
    }).success,
    false,
  );
  assert.equal(
    ipcCallRequestSchema.safeParse({
      ...listTabsCall,
      arguments: { instanceId: requestId, limit: 11, offset: 0 },
    }).success,
    false,
  );
  assert.equal(
    ipcCallRequestSchema.safeParse({
      ...openTabCall,
      arguments: { ...openTabCall.arguments, url: 'https://user:pass@example.invalid/' },
    }).success,
    false,
  );
  assert.equal(
    ipcCallRequestSchema.safeParse({ ...countTabsCall, extra: true }).success,
    false,
  );
});

test('validates cancellation and safe response error codes', () => {
  const cancel = { type: 'cancel', requestId };
  const response = {
    type: 'response',
    requestId,
    ok: false,
    error: { code: 'DAEMON_VERSION_MISMATCH' },
  };

  assert.deepEqual(ipcCancelRequestSchema.parse(cancel), cancel);
  assert.deepEqual(ipcResponseSchema.parse(response), response);
  assert.equal(
    ipcErrorSchema.safeParse({ code: 'UNKNOWN_ERROR' }).success,
    false,
  );
  assert.equal(
    ipcErrorSchema.safeParse({
      code: 'DAEMON_DISCONNECTED',
      message: 'untrusted details',
    }).success,
    false,
  );
  assert.deepEqual(
    [...IPC_ERROR_CODES].sort(),
    [...new Set(IPC_ERROR_CODES)].sort(),
  );
  assert.equal(
    ipcMessageSchema.safeParse({ ...cancel, requestId: 'not-a-uuid' }).success,
    false,
  );
});

test('encodes deterministic length-prefixed UTF-8 JSON frames', () => {
  const message = { type: 'test', value: 'BookMarkdown 4d6' };
  const frame = encodeIpcFrame(message);
  const payload = Buffer.from(JSON.stringify(message), 'utf8');

  assert.deepEqual(encodeIpcFrame(message), frame);
  assert.equal(frame.readUInt32BE(0), payload.byteLength);
  assert.deepEqual(frame.subarray(4), payload);

  const exactLimitFrame = encodeIpcFrame(message, payload.byteLength);
  assert.deepEqual(exactLimitFrame, frame);
  assert.throws(() => encodeIpcFrame(message, payload.byteLength - 1), {
    code: 'FRAME_TOO_LARGE',
  });

  const utf8Message = {
    type: 'test',
    value: String.fromCodePoint(0x4f60, 0x597d),
  };
  const utf8Frame = encodeIpcFrame(utf8Message);
  const decoder = new IpcFrameDecoder();
  assert.ok(utf8Frame.subarray(4).some((byte) => byte > 0x7f));
  assert.deepEqual(decoder.push(utf8Frame), [utf8Message]);
  decoder.end();
});

test('decodes frames split at every byte boundary', () => {
  const message = { type: 'test', value: '30d' };
  const frame = encodeIpcFrame(message);

  for (let split = 1; split < frame.byteLength; split += 1) {
    const decoder = new IpcFrameDecoder();
    assert.deepEqual(decoder.push(frame.subarray(0, split)), []);
    assert.deepEqual(decoder.push(frame.subarray(split)), [message]);
    decoder.end();
  }
});

test('decodes multiple coalesced frames in order', () => {
  const messages = [
    { type: 'first', value: 1 },
    { type: 'second', value: 2 },
    { type: 'third', value: 3 },
  ];
  const frames = messages.map((message) => encodeIpcFrame(message));
  const decoder = new IpcFrameDecoder();

  assert.deepEqual(decoder.push(Buffer.concat(frames)), messages);
  decoder.end();
});

test('rejects truncated headers and payloads at end of stream', () => {
  const frame = encodeIpcFrame({ type: 'test', value: 'payload' });
  const partialFrames = [
    frame.subarray(0, 2),
    frame.subarray(0, frame.byteLength - 1),
  ];

  for (const partialFrame of partialFrames) {
    const decoder = new IpcFrameDecoder();
    assert.deepEqual(decoder.push(partialFrame), []);
    assert.throws(() => decoder.end(), { code: 'TRUNCATED_FRAME' });
    assert.equal(decoder.bufferedBytes, 0);
  }
});

test('rejects oversized frames from the header without buffering a payload', () => {
  const decoder = new IpcFrameDecoder(8);
  const oversizedHeader = Buffer.alloc(4);
  oversizedHeader.writeUInt32BE(9, 0);

  assert.throws(() => decoder.push(oversizedHeader), {
    code: 'FRAME_TOO_LARGE',
  });
  assert.equal(decoder.bufferedBytes, 0);
  assert.throws(() => new IpcFrameDecoder(1024 * 1024 + 1), RangeError);
});

test('rejects invalid lengths, UTF-8, and JSON without exposing payloads', () => {
  const emptyLength = Buffer.alloc(4);
  const invalidUtf8 = Buffer.from([0xc3, 0x28]);
  const invalidJson = Buffer.from('{', 'utf8');
  const makeFrame = (payload) => {
    const frame = Buffer.alloc(4 + payload.byteLength);
    frame.writeUInt32BE(payload.byteLength, 0);
    payload.copy(frame, 4);
    return frame;
  };

  assert.throws(() => new IpcFrameDecoder().push(emptyLength), {
    code: 'INVALID_FRAME_LENGTH',
  });
  assert.throws(
    () => new IpcFrameDecoder().push(makeFrame(invalidUtf8)),
    (error) => error instanceof IpcFrameError && error.code === 'INVALID_UTF8',
  );
  assert.throws(() => new IpcFrameDecoder().push(makeFrame(invalidJson)), {
    code: 'INVALID_JSON',
  });
});