export const DEFAULT_CHROME_EXTENSION_ID = 'kdnjdggdbibdliholcdkmdkajacdmnhd';

// This explicit handoff contains the running bridge token in the fragment only.
// It is not a WebSocket URL and must never enter logs or persistent UI storage.
export function buildExtensionPairingLink(extensionId: string, endpointUrl: string, token: string): string {
  if (!/^[a-p]{32}$/.test(extensionId)) throw new Error('Invalid Chrome extension ID.');
  const endpoint = new URL(endpointUrl);
  if (!['ws:', 'wss:'].includes(endpoint.protocol) || endpoint.pathname !== '/'
    || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error('Invalid pairing endpoint.');
  }
  const params = new URLSearchParams({host: endpoint.toString(), token});
  return `chrome-extension://${extensionId}/options.html#/settings/mcp?${params}`;
}
