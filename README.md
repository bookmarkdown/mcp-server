# BookMarkdown MCP Server

[English](README.md) | [繁體中文](README.zh-TW.md)

BookMarkdown MCP Server lets agents call a local daemon directly through MCP Streamable HTTP. The daemon retains the browser extension WebSocket bridge; the stdio proxy and local IPC have been removed.

The project is in pre-1.0 development; features and interfaces may change.

## Features

The daemon connects agents to compatible browser extensions and provides bounded MCP tools. Pairing and server settings are managed through a local page.

Tab titles and URLs may contain sensitive information. The server does not read page contents. The extension is expected to exclude incognito windows and tabs. Tab changes are not automatically retried when the result is unknown.

See [Features and limitations (Traditional Chinese)](docs/features.md), [Architecture (Traditional Chinese)](docs/architecture.md), the [browser integration guide (Traditional Chinese)](docs/browser-integration.md), the [push and release workflow (Traditional Chinese)](docs/pushing.md), and [documentation conventions (Traditional Chinese)](docs/documentation-conventions.md).

## Requirements

* Windows, Linux, or macOS
* Node.js 22.23.3 or later
* npm
* A compatible companion browser extension (maintained separately)

## Quick start

Run the daemon without a global installation:

```bash
npx -y @bookmarkdown/mcp-server@latest
```

The first launch creates settings and two independent tokens; no ENV setup or extension ID is required. Keep the terminal open; press Ctrl+C to stop. For a global installation, run `npm install --global @bookmarkdown/mcp-server`, then `bookmarkdown-mcp-server`.

## Install from source

```bash
git clone https://github.com/bookmarkdown/mcp-server.git
cd mcp-server
npm ci
npm run build
npm start
```

After source changes, rebuild and restart the daemon.

## Connect your clients

1. Open the settings URL printed in the terminal on the server computer, normally `http://127.0.0.1:38472/`.
2. Pair a compatible BMD extension using **Connect Chrome extension**, or enter the WebSocket URL and pairing token manually. Test, then **Save and enable**; a successful probe alone does not register a device.
3. Copy the Agent HTTP URL and its separate MCP token into your host configuration below.

Saved settings and regenerated tokens take effect after restart; until then, copy/reveal uses the running credentials. LAN setup, configuration paths, ENV overrides, pairing links and connection checks are covered in the [settings guide](docs/settings.md).

Do not put tokens in transport URLs, command-line arguments, or source control. Share credential-containing pairing links only with the browser being paired.

## Configure an MCP host

Start the daemon, then configure your MCP host for Streamable HTTP. The host must support custom Authorization headers; JSON fields vary by host. A common configuration shape is:

```json
{
  "mcpServers": {
    "bookmarkdown": {
      "type": "http",
      "url": "http://127.0.0.1:38472/mcp",
      "headers": { "Authorization": "Bearer <BOOKMARKDOWN_MCP_TOKEN>" }
    }
  }
}
```

Replace the token placeholder with the running MCP token from the management page. LAN clients use the displayed private-IP HTTP URL. The host does not start the daemon; keep it running separately. Migrate old stdio `command`/`args` configurations to HTTP.

Agents share credentials, browser instances, permissions and request limits, without exclusive tab ownership. Coordinate conflicting tab changes; see [request routing and limits (Traditional Chinese)](docs/architecture.md#多-agent-請求配對與共享狀態).

## Security and privacy

HTTP/WS defaults to loopback. LAN accepts local/private-network clients and retains independent tokens, Host/Origin, hello identity, schema, and capability checks. The production extension ID allowlist is optional; development accepts any compatible ID. Management and token endpoints remain local-only with same-origin/CSRF checks. LAN HTTP/WS is plaintext; existing ENV options can enable WSS. The settings file contains plaintext tokens, so protect its directory. See [settings](docs/settings.md) and [browser integration](docs/browser-integration.md).

## Development

```bash
npm test
npm run typecheck
npm run build
```

Use `npm run dev -- daemon` for development mode; it reuses settings and tokens and accepts any compatible extension ID. See the [browser integration guide](docs/browser-integration.md) for the current WebSocket contract and validation limits.

## License

This project is licensed under the
[MIT License](LICENSE).
