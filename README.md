# BookMarkdown MCP Server

[English](README.md) | [繁體中文](README.zh-TW.md)

BookMarkdown MCP Server connects an MCP host to a companion browser extension running on the same machine. A local daemon accepts the extension connection over a loopback WebSocket, while an MCP host communicates with a separate stdio proxy over a Windows named pipe.

> [!IMPORTANT]
> This project currently supports Windows only. The server and companion extension implementations are complete; compatibility has not been verified in a real Chrome installation, with Chrome Local Network Access, or with a specific MCP host. npm publication is being prepared; install from source using the instructions below.

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

* Windows
* Node.js 24.11.0 or later
* npm
* A compatible companion browser extension (maintained separately)

## Install from source

```powershell
git clone https://github.com/bookmarkdown/mcp-server.git
cd mcp-server
npm ci
npm run build
```

The package is not available through `npx` until its first npm release. After publication, run the CLI with the published version:

```powershell
npx --yes --package=@bookmarkdown/mcp-server@<version> -- bookmarkdown-mcp-server
```

Set the required environment variables below before starting the daemon.

## Start the daemon

The CLI starts the production daemon when you omit the subcommand. The production daemon requires a high-entropy pairing token and the exact Chrome extension ID. The companion extension must be configured with the same token through its supported configuration flow.

```powershell
$env:BOOKMARKDOWN_BRIDGE_TOKEN = (node -p "require('node:crypto').randomBytes(32).toString('hex')")
$env:BOOKMARKDOWN_EXTENSION_IDS = "<32-character-extension-id>"
npm start
```

Keep the daemon running in this terminal. Press `Ctrl+C` to stop it. Do not put the pairing token in command-line arguments, URLs, logs, or source control.

## Configure an MCP host

Configure your MCP host to start the built CLI in proxy mode. Replace the example path with the absolute path to your checkout:

```json
{
  "mcpServers": {
    "bookmarkdown": {
      "command": "node",
      "args": ["D:/path/to/mcp-server/dist/cli.js", "proxy"]
    }
  }
}
```

The MCP host starts only the proxy; it does not start the daemon. The proxy uses the default Windows named pipe, `bookmarkdown-mcp`, and does not need the WebSocket pairing token. Start the daemon before using browser tools.

## Security and privacy

The WebSocket server binds only to `127.0.0.1`. Connections require a pairing token; production mode also checks an exact extension ID allowlist. Tab titles and URLs are returned as metadata and may be sensitive. Do not record or share tool results without considering their contents.

## Development

```powershell
npm test
npm run typecheck
npm run build
```

For development mode, start the daemon with `npm run dev -- daemon`. Development mode still requires the pairing token. See the [browser integration guide](docs/browser-integration.md) for the current WebSocket contract and validation limits.

## License

This project is licensed under the [MIT License](LICENSE).