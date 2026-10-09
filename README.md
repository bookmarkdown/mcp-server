# BookMarkdown MCP Server

[English](README.md) | [繁體中文](README.zh-TW.md)

BookMarkdown MCP Server lets agents call a local daemon directly through MCP Streamable HTTP. The daemon retains the browser extension WebSocket bridge; the stdio proxy and local IPC have been removed.

> [!IMPORTANT]
> MCP hosts must use Streamable HTTP; the former stdio proxy is no longer available. Real Chrome, extension, and specific MCP host compatibility remain unverified.

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

* Windows, Linux, or macOS
* Node.js 22.23.3 or later
* npm
* A compatible companion browser extension (maintained separately)

## Install from npm

You can run the published CLI without a global installation:

```bash
npx -y @bookmarkdown/mcp-server@latest
```

The new CLI creates settings and tokens on first launch; no ENV setup is required. Alternatively, install the CLI globally:

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

After building, run `npm start`.

## Start the daemon

```bash
npm start
```

For a global installation, run `bookmarkdown-mcp-server`. No environment variables or extension IDs are required: the first launch creates per-user settings and independent MCP/extension tokens; later launches reuse them.

Open the local settings URL printed in the terminal, normally `http://127.0.0.1:38472/`. The page shows **bookmarkdown** and **mcp-server** branding, URLs, masked tokens with reveal/copy controls, supported clients, paired devices, and editable settings. Saved settings and regenerated tokens take effect after restarting.

Open the root path `/` in your browser on the server computer. `/mcp` is the authenticated agent endpoint, and port `38471` is the extension WebSocket listener. After changing or rebuilding the source, stop the old process and run `npm start` again.

Windows uses `%LOCALAPPDATA%\BookMarkdown\mcp-server\config.json`; Linux and macOS use their per-user configuration directories. ENV overrides saved values, and `BOOKMARKDOWN_CONFIG_FILE` selects another file. See the [settings guide](docs/settings.md) for all paths, fields, ENV options, and restart behavior.

Loopback is the default. Enable LAN in the page and restart to connect agents and extensions on multiple devices to one server. Copy the displayed private-IP HTTP/WS URLs. WSS is optional; management remains local-only. Use plaintext LAN connections on a trusted network.

Keep the terminal running; press Ctrl+C to stop. Logs omit tokens. Do not put tokens in URLs, command-line arguments, or source control.

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

Copy the running MCP token from the management page into the Authorization header above. The default port is `38472`; LAN clients use the displayed private-IP URL. Every MCP `/mcp` request validates Bearer, Host, and Origin when present, without CORS. MCP and extension tokens are generated independently.

The daemon has no configured agent-count quota. All agents share a default limit of **32 in-flight HTTP requests**, including initialize, tools/list, and tools/call. Set `BOOKMARKDOWN_MAX_PENDING_REQUESTS` to an integer from **1 to 256** to change this limit; restart the daemon for the change to take effect. Excess HTTP requests receive `503` with `Retry-After: 1`. Idle agents consume no in-flight request slots. Actual capacity also depends on system resources and workload.

The bridge separately uses the same setting to limit pending browser RPCs; reaching that limit produces the tool error `BRIDGE_BUSY`. One tool call, such as devices.list with tab counts, can issue several browser RPCs. `BOOKMARKDOWN_MAX_CONNECTIONS` defaults to **8** and limits extension WebSocket connections, rather than agents.

Each HTTP request has its own MCP server and transport, so different agents can use the same MCP JSON-RPC ID. Each browser RPC gets a separate server-generated UUID `requestId`; the daemon matches the extension reply to both that UUID and the original WebSocket connection, then returns the result through the originating HTTP request. Replies may arrive out of order. See [request routing and shared state (Traditional Chinese)](docs/architecture.md#多-agent-請求配對與共享狀態).

Agents share the MCP token, browser instances, and tool permissions. Reply routing provides no per-agent authorization, exclusive tab ownership, or operation ordering across agents. Concurrent changes to the same tab can affect one another; coordinate conflicting operations at the agent or host level.

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
