import assert from 'node:assert/strict';
import test from 'node:test';
import {buildExtensionPairingLink, DEFAULT_CHROME_EXTENSION_ID} from '../dist/management/pairing-link.js';

test('builds a pairing fragment with encoded endpoint and credential, using the user-provided default ID', () => {
  assert.equal(DEFAULT_CHROME_EXTENSION_ID, 'kdnjdggdbibdliholcdkmdkajacdmnhd');
  const token = 'a+&?#%='.repeat(10);
  const link = new URL(buildExtensionPairingLink(DEFAULT_CHROME_EXTENSION_ID, 'ws://192.168.1.2:38471/', token));
  assert.equal(link.search, '');
  assert.equal(link.pathname, '/options.html');
  const params = new URLSearchParams(link.hash.split('?')[1]);
  assert.equal(params.get('host'), 'ws://192.168.1.2:38471/');
  assert.equal(params.get('token'), token);
});

test('rejects invalid target IDs and endpoints without including secrets in errors', () => {
  assert.throws(() => buildExtensionPairingLink('../invalid', 'ws://127.0.0.1/', 'secret'), /Invalid Chrome extension ID/);
  for (const endpoint of ['http://127.0.0.1/mcp', 'ws://user:password@127.0.0.1/', 'ws://127.0.0.1/?token=secret']) {
    assert.throws(() => buildExtensionPairingLink(DEFAULT_CHROME_EXTENSION_ID, endpoint, 'secret'), /Invalid pairing endpoint/);
  }
});
