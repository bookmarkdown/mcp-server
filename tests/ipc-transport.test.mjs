import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import test from 'node:test';
import {
  connectLocalPipe,
  getLocalPipePath,
  listenLocalPipe,
} from '../src/ipc/transport.ts';

const supportedPlatforms = {
  skip: !['win32', 'linux'].includes(process.platform)
    ? 'Local IPC transport tests require Windows or Linux.'
    : false,
};

function uniquePipeName() {
  return `bookmarkdown-test-${process.pid}-${randomUUID()}`;
}

function echoRequests(socket) {
  let buffer = '';
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) {
        return;
      }

      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      const request = JSON.parse(line);
      socket.write(`${JSON.stringify({ id: request.id, value: request.value })}\n`);
    }
  });
}

function nextLine(socket) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const cleanup = () => {
      socket.off('data', onData);
      socket.off('end', onEnd);
      socket.off('close', onClose);
      socket.off('error', onError);
    };
    const onData = (chunk) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline < 0) {
        return;
      }
      cleanup();
      resolve(buffer.slice(0, newline));
    };
    const onEnd = () => {
      cleanup();
      reject(new Error('IPC connection closed before a response arrived.'));
    };
    const onClose = () => {
      cleanup();
      reject(new Error('IPC connection closed before a response arrived.'));
    };
    const onError = (error) => {
      cleanup();
      reject(error);
    };

    socket.on('data', onData);
    socket.once('end', onEnd);
    socket.once('close', onClose);
    socket.once('error', onError);
  });
}

async function sendRequest(socket, request) {
  const responsePromise = nextLine(socket);
  socket.write(`${JSON.stringify(request)}\n`);
  return JSON.parse(await responsePromise);
}

async function startServer(t, onConnection) {
  const pipeName = uniquePipeName();
  const errors = [];
  const server = await listenLocalPipe(pipeName, onConnection, (error) => {
    errors.push(error);
  });
  t.after(async () => {
    await server.close();
    assert.deepEqual(errors, []);
  });
  return { pipeName, server };
}

function waitForClose(socket) {
  if (socket.destroyed) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    socket.on('error', () => {});
    socket.once('close', resolve);
  });
}

test(
  'exchanges a request and correlated response over local IPC',
  supportedPlatforms,
  async (t) => {
    const { pipeName } = await startServer(t, echoRequests);
    const client = await connectLocalPipe(pipeName);
    t.after(async () => {
      const closed = waitForClose(client);
      client.destroy();
      await closed;
    });

    const response = await sendRequest(client, {
      id: 'request-1',
      value: 'roundtrip',
    });

    assert.deepEqual(response, { id: 'request-1', value: 'roundtrip' });
  },
);

test(
  'keeps multiple proxy connections isolated when request IDs overlap',
  supportedPlatforms,
  async (t) => {
    const { pipeName } = await startServer(t, echoRequests);
    const first = await connectLocalPipe(pipeName);
    const second = await connectLocalPipe(pipeName);
    t.after(async () => {
      const closed = Promise.all([waitForClose(first), waitForClose(second)]);
      first.destroy();
      second.destroy();
      await closed;
    });

    const [firstResponse, secondResponse] = await Promise.all([
      sendRequest(first, { id: 'request-1', value: 'first' }),
      sendRequest(second, { id: 'request-1', value: 'second' }),
    ]);

    assert.deepEqual(firstResponse, { id: 'request-1', value: 'first' });
    assert.deepEqual(secondResponse, { id: 'request-1', value: 'second' });
  },
);

test(
  'closes accepted connections and the endpoint during server shutdown',
  supportedPlatforms,
  async (t) => {
    const { pipeName, server } = await startServer(t, () => {});
    const first = await connectLocalPipe(pipeName);
    const second = await connectLocalPipe(pipeName);
    const firstPending = assert.rejects(nextLine(first));
    const secondPending = assert.rejects(nextLine(second));
    first.write('{"id":"request-1"}\n');
    second.write('{"id":"request-1"}\n');
    const closed = Promise.all([waitForClose(first), waitForClose(second)]);

    await server.close();
    await Promise.all([closed, firstPending, secondPending]);

    assert.equal(first.destroyed, true);
    assert.equal(second.destroyed, true);
    await assert.rejects(connectLocalPipe(pipeName));
  },
);

test('cancels a pending IPC connection and releases its socket', supportedPlatforms, async (t) => {
  const sockets = new Set();
  const { pipeName, server } = await startServer(t, (socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  const controller = new AbortController();
  const connecting = connectLocalPipe(pipeName, { signal: controller.signal, timeoutMs: 250 });
  controller.abort();
  await assert.rejects(connecting, { name: 'AbortError' });
  await server.close();
  assert.equal(sockets.size, 0);
  await assert.rejects(connectLocalPipe(pipeName));
});

test('rejects unbounded connection deadlines before creating a socket', supportedPlatforms, async () => {
  await assert.rejects(connectLocalPipe(uniquePipeName(), { timeoutMs: 0 }), RangeError);
  await assert.rejects(connectLocalPipe(uniquePipeName(), { timeoutMs: 30001 }), RangeError);
});

test('restricts Linux Unix socket access to the current user', {
  skip: process.platform !== 'linux',
}, async (t) => {
  const { pipeName, server } = await startServer(t, () => {});
  const socketPath = getLocalPipePath(pipeName);
  const [directoryStats, socketStats] = await Promise.all([
    stat(dirname(socketPath)),
    stat(socketPath),
  ]);

  assert.equal(directoryStats.mode & 0o777, 0o700);
  assert.equal(socketStats.mode & 0o777, 0o600);

  await server.close();
  await assert.rejects(stat(socketPath), { code: 'ENOENT' });
});