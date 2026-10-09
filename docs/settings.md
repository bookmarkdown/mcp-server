---
title: Local settings and multi-device setup
description: Configure the daemon through its local management page and connect LAN agents and extensions.
ms.date: 2026-10-03
ms.topic: how-to
---

## First launch

Build the source checkout and run `npm start`, or run `bookmarkdown-mcp-server` after installing a release containing this feature. No environment variables are required. The CLI creates a versioned JSON configuration with two independent 256-bit random tokens before opening listeners. Subsequent launches read the same file. Invalid, oversized, unknown-version, or unreadable files fail startup without replacing them.

Open the local settings URL printed in the terminal, normally `http://127.0.0.1:38472/`. The page displays the `BookMarkdown MCP` title with a live status indicator, current MCP/WS URLs, masked tokens, supported client information, and paired devices. Copy the MCP token into the agent's Bearer Authorization header and the pairing token into the extension's supported configuration screen. No separate management login code is required.

The supported client contract is BookMarkdown/BMD Chrome extension protocol `2`, app ID `bmd-extension`. A client must implement this contract and authenticate; accepting any compatible extension ID does not mean arbitrary browser extensions work. Connected instances are discovered through successful pairing. The list is process-local and includes previously connected instances while this daemon remains running. The page never queries tab contents or performs tab mutations.

## Storage location

| OS | Default file |
| --- | --- |
| Windows | `%LOCALAPPDATA%\BookMarkdown\mcp-server\config.json` |
| Linux | `$XDG_CONFIG_HOME/bookmarkdown-mcp/config.json`, or `~/.config/bookmarkdown-mcp/config.json` |
| macOS | `~/Library/Application Support/BookMarkdown/mcp-server/config.json` |

`BOOKMARKDOWN_CONFIG_FILE` selects another file; relative paths resolve against the startup directory. Linux requires an absolute `XDG_CONFIG_HOME`, otherwise the home-directory default is used. Created directories request mode `0700` and files `0600` on POSIX. Existing directory permissions are retained. Windows uses inherited directory ACLs: the normal user-profile location provides the account boundary; a custom shared directory can grant other users access. Tokens are stored as plaintext in the private file and must not be committed or shared.

Writes use a temporary file in the same directory, fsync, and rename. Symlink configuration files are rejected. The configuration contains `version`, `lanEnabled`, `mcpPort`, `webSocketPort`, `mcpToken`, `bridgeToken`, `requestTimeoutMs`, `maxConnections`, `maxPendingRequests`, and `extensionIds`.

## Save and restart

Ports, LAN mode, timeouts, limits, and an optional production extension-ID allowlist can be edited on the page. Port values must differ. Saves and token regeneration become active after restarting the daemon with Ctrl+C and the startup command. Until then, the connection cards and token copy/reveal buttons show the currently running credentials and endpoints. A restart notice stays visible while saved configuration differs from startup configuration. After rotating tokens and restarting, update the corresponding agents or extensions.

The management page is available only from loopback connections with a loopback Host. It rejects foreign Origins; mutation and secret endpoints also require same-origin POST plus a per-process CSRF token. Ordinary HTML and status responses omit authentication tokens. The page has no CORS access, uses no-store responses, and blocks embedding. Access is based on the local machine boundary, not per-user browser authentication: local processes and other users on the same machine may access it.

## LAN mode

Enable LAN in the page, save, and restart. Both listeners bind to `0.0.0.0`; the page lists private IPv4 addresses and copyable HTTP/WS URLs. Connect remote agents to `http://<server-private-ip>:38472/mcp` with the MCP token, and extensions to `ws://<server-private-ip>:38471/` with the pairing token. Multiple devices share this one server and its instance registry. The management URL remains `http://127.0.0.1:38472/` on the server computer. Allow the selected ports in your host firewall if required.

LAN does not require certificates or WSS. HTTP/WS carries credentials and data in plaintext, so use it on a trusted private network. The server accepts loopback and RFC1918 peers and validates Host against its own private interface addresses; it ignores forwarded-address headers. Public-address peers/Hosts are rejected. This is not a public deployment or reverse-proxy mode.

Existing `BOOKMARKDOWN_WS_HOST` can bind one private IPv4 address. Optional `BOOKMARKDOWN_WS_TLS_CERT_FILE` and `BOOKMARKDOWN_WS_TLS_KEY_FILE` together retain WSS support; clients then need a trusted certificate. These advanced ENV settings are not required by the UI. A custom WS host can differ from the HTTP LAN binding and the page shows it separately. Real Chrome permissions, Local Network Access, companion extension URL support, and specific MCP host compatibility require integration verification.

## Environment overrides

Environment variables take precedence over saved values and do not rewrite them. Overridden editable fields are disabled on the page. Remove the override to use saved settings. Additional settings, such as a WS host or TLS files, are displayed as ENV-only information on the page.

| ENV | Saved field / behavior |
| --- | --- |
| `BOOKMARKDOWN_CONFIG_FILE` | Configuration path |
| `BOOKMARKDOWN_LAN_ENABLED` | `lanEnabled`; `true`/`false` or `1`/`0` |
| `BOOKMARKDOWN_MCP_PORT` | `mcpPort`; default 38472 |
| `BOOKMARKDOWN_WS_PORT` | `webSocketPort`; default 38471 |
| `BOOKMARKDOWN_MCP_TOKEN` | `mcpToken`; 32–512 printable ASCII characters without spaces |
| `BOOKMARKDOWN_BRIDGE_TOKEN` | `bridgeToken`; 32–512 UTF-8 bytes |
| `BOOKMARKDOWN_EXTENSION_IDS` | `extensionIds`; optional comma-separated exact Chrome IDs in production |
| `BOOKMARKDOWN_REQUEST_TIMEOUT_MS` | `requestTimeoutMs`; 100–60000, default 5000 |
| `BOOKMARKDOWN_MAX_CONNECTIONS` | `maxConnections`; 1–64, default 8 |
| `BOOKMARKDOWN_MAX_PENDING_REQUESTS` | `maxPendingRequests`; 1–256, default 32 |
| `BOOKMARKDOWN_WS_HOST` | ENV-only WS bind address |
| `BOOKMARKDOWN_WS_TLS_CERT_FILE`, `BOOKMARKDOWN_WS_TLS_KEY_FILE` | ENV-only optional WSS certificate/key |
| `BOOKMARKDOWN_MAX_PAYLOAD_BYTES` | ENV-only; 1024–1048576, default 65536 |
| `BOOKMARKDOWN_MAX_REGISTERED_INSTANCES` | ENV-only; 1–256, default 64 |
| `BOOKMARKDOWN_HELLO_TIMEOUT_MS` | ENV-only; 250–30000, default 5000 |

`npm run dev -- daemon` explicitly selects development mode. Production accepts all compatible authenticated IDs when its allowlist is empty; development ignores the fixed allowlist. Both modes enforce Chrome Origin format, matching hello identity, pairing token, schemas, capabilities, and connection/request limits. MCP credentials and permissions remain shared among agents.
