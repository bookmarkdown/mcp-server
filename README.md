# BookMarkdown MCP Server

[English](README.md) | [繁體中文](README.zh-TW.md)

BookMarkdown MCP Server lets agents call a local daemon directly through MCP Streamable HTTP. The daemon retains the browser extension WebSocket bridge; the stdio proxy and local IPC have been removed.

> [!IMPORTANT]
> This HTTP mode is not yet published; build from source to use it. Real Chrome, extension, and specific MCP host compatibility remain unverified.

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

See [Features and limitations (Traditional Chinese)](docs/features.md), [Architecture (Traditional Chinese)](docs/architecture.md), the [browser integration guide (Traditional Chinese)](docs/browser-integration.md), the [push and release workflow (Traditional Chinese)](docs/pushing.md), and [documentation conventions (Traditional Chinese)](docs/documentation-conventions.md).

## Requirements

* Windows, Linux, or macOS (macOS requires the release containing this change; `0.2.1` and earlier do not support macOS)
* Node.js 22.23.3 or later
* npm
* A compatible companion browser extension (maintained separately)

## Install from npm

You can run the published CLI without a global installation:

```bash
npx -y @bookmarkdown/mcp-server@latest
```

Set the required environment variables below before starting the daemon. Alternatively, install the CLI globally:

```bash
npm install --global @bookmarkdown/mcp-server
bookmarkdown-mcp-server
```

## Install from source

```bash
git clone https://github.com/bookmarkdown/mcp-server.git
cd mcp-server
npm ci
npm run build
```

Set the required environment variables below before starting the daemon.

## Start the daemon

The CLI starts the production daemon when you omit the subcommand. The production daemon requires a high-entropy pairing token and the exact Chrome extension ID. The companion extension must be configured with the same token through its supported configuration flow.

```powershell
$env:BOOKMARKDOWN_MCP_TOKEN = (node -p "require('node:crypto').randomBytes(32).toString('hex')")
$env:BOOKMARKDOWN_BRIDGE_TOKEN = (node -p "require('node:crypto').randomBytes(32).toString('hex')")
$env:BOOKMARKDOWN_EXTENSION_IDS = "<32-character-extension-id>"
npm start
```

```bash
export BOOKMARKDOWN_MCP_TOKEN="$(node -p "require('node:crypto').randomBytes(32).toString('hex')")"
export BOOKMARKDOWN_BRIDGE_TOKEN="$(node -p "require('node:crypto').randomBytes(32).toString('hex')")"
export BOOKMARKDOWN_EXTENSION_IDS="<32-character-extension-id>"
npm start
```

For a global installation, use `bookmarkdown-mcp-server`; for a built source checkout, use `npm start`.

Keep the daemon running in this terminal. Press `Ctrl+C` to stop it. Do not put the pairing token in command-line arguments, URLs, logs, or source control.

At startup, the daemon prints the actual WebSocket URL, allowed extension IDs, and BMD > Settings > MCP connection instructions to stderr. The pairing token is marked as configured but never printed; enter the same `BOOKMARKDOWN_BRIDGE_TOKEN` value in the extension. Logs distinguish a successful connection test from a persistent connection and report connection, disconnection, and handshake rejection reasons. They do not include tab metadata or operation payloads. With WSS, the browser must trust the server certificate.

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

The MCP host does not start the daemon. Replace the old proxy `command`/`args` with the HTTP URL; the `proxy` subcommand and `BOOKMARKDOWN_IPC_PIPE_NAME` have been removed. When the daemon is offline, initialize, tools/list, and tools/call cannot connect. HTTP uses stateless JSON responses with no MCP session; GET SSE, DELETE, and other non-POST methods return `405`. Notification streams and resumability are unsupported. Do not automatically retry operations whose outcome is unknown.

`BOOKMARKDOWN_MCP_TOKEN` is required: 32–512 printable ASCII characters without spaces. `BOOKMARKDOWN_MCP_PORT` defaults to `38472`, range 1–65535. HTTP binds exclusively to `127.0.0.1`. Every request validates the Bearer token, Host, and Origin when present. Host accepts only `127.0.0.1` or `localhost` with the actual port; Origin accepts only the corresponding local HTTP origins. CORS and HTTP LAN binding are unsupported. Generate separate MCP and extension pairing tokens.

## Multiple agents

The daemon has no configured agent-count quota. All agents share a default limit of **32 in-flight HTTP requests**, including initialize, tools/list, and tools/call. Set `BOOKMARKDOWN_MAX_PENDING_REQUESTS` to an integer from **1 to 256** to change this limit; restart the daemon for the change to take effect. Excess HTTP requests receive `503` with `Retry-After: 1`. Idle agents consume no in-flight request slots. Actual capacity also depends on system resources and workload.

The bridge separately uses the same setting to limit pending browser RPCs; reaching that limit produces the tool error `BRIDGE_BUSY`. One tool call, such as devices.list with tab counts, can issue several browser RPCs. `BOOKMARKDOWN_MAX_CONNECTIONS` defaults to **8** and limits extension WebSocket connections, rather than agents.

Each HTTP request has its own MCP server and transport, so different agents can use the same MCP JSON-RPC ID. Each browser RPC gets a separate server-generated UUID `requestId`; the daemon matches the extension reply to both that UUID and the original WebSocket connection, then returns the result through the originating HTTP request. Replies may arrive out of order. See [request routing and shared state (Traditional Chinese)](docs/architecture.md#多-agent-請求配對與共享狀態).

Agents share the MCP token, browser instances, and tool permissions. Reply routing provides no per-agent authorization, exclusive tab ownership, or operation ordering across agents. Concurrent changes to the same tab can affect one another; coordinate conflicting operations at the agent or host level.

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
