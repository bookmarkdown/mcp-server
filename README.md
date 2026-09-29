# BookMarkdown MCP Server

[English](README.md) | [繁體中文](README.zh-TW.md)

BookMarkdown MCP Server connects an MCP host to a companion browser extension. The daemon accepts the extension over WebSocket, using loopback by default; the MCP host communicates with a separate stdio proxy over local IPC, using Windows Named Pipes or Linux Unix domain sockets.

> [!IMPORTANT]
> The current source checkout supports Windows and Linux. Published npm version
> `0.1.3` remains Windows-only. The `0.2.0` package candidate passed clean tarball
> installation and MCP initialize smoke tests on Ubuntu and Windows, but is not
> published yet. Linux users should continue to install from source. Real Chrome,
> companion extension, Chrome Local Network Access, and specific MCP host
> compatibility remain unverified. Optional LAN connections require WSS and a
> companion extension configured for the server URL.

## Features

The server exposes these MCP tools:

| Tool | Description |
| --- | --- |
| `devices.list` | List extension instances known to the running daemon and optionally query tab counts. |
| `browser.countOpenTabs` | Count tabs in normal windows for one connected instance. |
| `browser.countOpenWindows` | Count normal browser windows for one connected instance. |
| `browser.listTabs` | Return paginated tab metadata, limited to 10 tabs per request. |
| `browser.openTab` | Open a tab in a normal window. |
| `browser.closeTab` | Close a tab in a normal window. |
| `browser.moveTab` | Move a tab to another normal window. |

Tab titles and URLs may contain sensitive information. The server does not read page contents. The extension is expected to exclude incognito windows and tabs. Tab changes are not automatically retried when the result is unknown.

See [Features and limitations (Traditional Chinese)](docs/features.md), [Architecture (Traditional Chinese)](docs/architecture.md), the [browser integration guide (Traditional Chinese)](docs/browser-integration.md), and [documentation conventions (Traditional Chinese)](docs/documentation-conventions.md).

## Requirements

* Windows or Linux
* Node.js 24.11.0 or later
* npm
* A compatible companion browser extension (maintained separately)

## Install from source

```bash
git clone https://github.com/bookmarkdown/mcp-server.git
cd mcp-server
npm ci
npm run build
```

Published version `0.1.3` remains Windows-only. The tested `0.2.0` package
candidate is not available on npm yet; Linux users can run this source checkout
until `0.2.0` is published.

Set the required environment variables below before starting the daemon.

## Start the daemon

The CLI starts the production daemon when you omit the subcommand. The production daemon requires a high-entropy pairing token and the exact Chrome extension ID. The companion extension must be configured with the same token through its supported configuration flow.

```powershell
$env:BOOKMARKDOWN_BRIDGE_TOKEN = (node -p "require('node:crypto').randomBytes(32).toString('hex')")
$env:BOOKMARKDOWN_EXTENSION_IDS = "<32-character-extension-id>"
npm start
```

```bash
export BOOKMARKDOWN_BRIDGE_TOKEN="$(node -p "require('node:crypto').randomBytes(32).toString('hex')")"
export BOOKMARKDOWN_EXTENSION_IDS="<32-character-extension-id>"
npm start
```

Keep the daemon running in this terminal. Press `Ctrl+C` to stop it. Do not put the pairing token in command-line arguments, URLs, logs, or source control.

## Configure an MCP host

Configure your MCP host to start the proxy built from this source checkout. Replace the example path with this checkout's absolute `dist/cli.js` path on the MCP host, and run `npm ci` and `npm run build` first.

```json
{
  "mcpServers": {
    "bookmarkdown": {
      "command": "node",
  "args": ["/path/to/mcp-server/dist/cli.js", "proxy"]
    }
  }
}
```

On Windows, replace the example path with the absolute Windows path to `dist/cli.js`.

The MCP host starts only the proxy; it does not start the daemon. The proxy uses the default local IPC endpoint, a Windows Named Pipe or Linux Unix domain socket named `bookmarkdown-mcp`, and does not need the WebSocket pairing token. Start the daemon before using browser tools.

## Security and privacy

The WebSocket server binds to `127.0.0.1` by default. Optional LAN binding accepts one RFC1918 IPv4 address and requires TLS certificate and private-key files; wildcard addresses and unencrypted LAN connections are rejected. The companion extension must connect to the matching `wss://` URL and trust its certificate. Connections still require a pairing token, and production mode checks an exact extension ID allowlist. See the [browser integration guide](docs/browser-integration.md) for configuration and verification limits.

## Development

```bash
npm test
npm run typecheck
npm run build
```

For development mode, start the daemon with `npm run dev -- daemon`. Development mode still requires the pairing token. See the [browser integration guide](docs/browser-integration.md) for the current WebSocket contract and validation limits.

## License

This project is licensed under the
[MIT License](LICENSE).
