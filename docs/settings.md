---
title: Local settings and multi-device setup
description: Configure the daemon through its local management page and connect LAN agents and extensions.
ms.date: 2026-10-09
ms.topic: how-to
---

[English](settings.md) | [繁體中文](settings.zh-TW.md)

## First launch

Build the source checkout and run `npm start`, or run `bookmarkdown-mcp-server` after installing a release containing this feature. No environment variables are required. The CLI creates a versioned JSON configuration with two independent 256-bit random tokens before opening listeners. Subsequent launches read the same file. Invalid, oversized, unknown-version, or unreadable files fail startup without replacing them.

Open the local settings URL printed in the terminal, normally `http://127.0.0.1:38472/`. The page displays the `BookMarkdown MCP` title with a live status indicator, current MCP/WS URLs, masked tokens, supported client information, and paired devices. Copy the MCP token into the agent's Bearer Authorization header and the pairing token into the extension's supported configuration screen. No separate management login code is required.

The supported client contract is BookMarkdown/BMD Chrome extension protocol `2`, app ID `bmd-extension`. A client must implement this contract and authenticate; accepting any compatible extension ID does not mean arbitrary browser extensions work. Connected instances are discovered through successful pairing. The list is process-local and includes previously connected instances while this daemon remains running. The page never queries tab contents or performs tab mutations. An explicit read-only connection check can request the selected device's tab count.

For local BMD setup, copy the browser-extension card's WebSocket URL and pairing token into Options → Settings → MCP. Test, then choose Save and enable in the updated extension; separate Save and enable controls remain available. The verify/save/register steps distinguish a successful probe from saved settings and a registered device. Use the agent card's separate MCP token only in the host's Authorization header. Templates use token placeholders and copy actions require an explicit click. Released server `0.4.0` is the historical WS baseline; guided management UX and health checks are included in `0.4.1`. Use a compatible updated extension. See [integration evidence (Traditional Chinese)](browser-integration.md).

## One-click extension pairing

The updated source adds **Connect Chrome extension** (`連接 Chrome 套件`) and
**Copy pairing link** (`複製配對連結`) to the Browser extension card. This
handoff is included in server `0.4.1`. Update the daemon and use a compatible
extension build; restart the daemon/reload the extension before using it.

1. Confirm the target Chrome extension ID. The initial value is
   `kdnjdggdbibdliholcdkmdkajacdmnhd`, supplied by the user; it does not establish
   that the extension is published or installed. For unpacked builds use the
   actual ID from `chrome://extensions`. Successful link creation saves only the
   ID in this management browser's localStorage, without changing the daemon
   allowlist or configuration file.
2. Choose the running local WS endpoint or an advertised private-IP LAN endpoint.
   Connect opens the extension in the current tab. Copy produces a credential-
   containing link to paste into the destination Chrome address bar.
3. The extension validates the fragment parameters, clears the current URL and
   fills an unsaved draft. Its dialog offers Test connection now or Test later.
   Neither import nor testing saves credentials, enables a bridge, or registers
   a device. Save and enable remains explicit; invalid links and failed probes
   leave saved settings intact.

`POST /api/pairing-link` retains local-only Host/Origin/CSRF and JSON protections.
It accepts a valid `[a-p]{32}` extension ID and only a currently advertised WS
endpoint. The response uses the running bridge token, never the Agent token or
pending rotation. Status, HTML, MCP tool results and logs contain no pairing link.

The link targets `options.html#/settings/mcp?host=<encoded-WS-URL>&token=<encoded-pairing-token>`.
This explicit credential handoff is the exception to the transport-URL rule:
tokens still cannot be placed in HTTP MCP or WebSocket endpoint URLs. Only the
Options HTML is web accessible to HTTP `127.0.0.1`/`localhost` origins, including
custom ports; other websites are not authorized navigation origins. No additional
host permission, external runtime API, TLS or one-time-code service is required.
Management remains local-only. Copying a LAN link for pasting into another
browser does not expose the management page remotely. Clearing the current URL
does not erase clipboard or other historical copies; provide the link only to
the browser being paired. Missing/wrong-ID/older extensions require installation,
an ID correction or manual pairing.

## Storage location

| OS | Default file |
| --- | --- |
| Windows | `%LOCALAPPDATA%\BookMarkdown\mcp-server\config.json` |
| Linux | `$XDG_CONFIG_HOME/bookmarkdown-mcp/config.json`, or `~/.config/bookmarkdown-mcp/config.json` |
| macOS | `~/Library/Application Support/BookMarkdown/mcp-server/config.json` |

`BOOKMARKDOWN_CONFIG_FILE` selects another file; relative paths resolve against the startup directory. Linux requires an absolute `XDG_CONFIG_HOME`, otherwise the home-directory default is used. Created directories request mode `0700` and files `0600` on POSIX. Existing directory permissions are retained. Windows uses inherited directory ACLs: the normal user-profile location provides the account boundary; a custom shared directory can grant other users access. Tokens are stored as plaintext in the private file and must not be committed or shared.

Writes use a temporary file in the same directory, fsync, and rename. Symlink configuration files are rejected. The configuration contains `version`, `lanEnabled`, `mcpPort`, `webSocketPort`, `mcpToken`, `bridgeToken`, `requestTimeoutMs`, `maxConnections`, `maxPendingRequests`, and `extensionIds`.

## Save and restart

Ports, LAN mode, timeouts, limits, and an optional production extension-ID allowlist can be edited on the page. Port values must differ. Saves and token regeneration become active after restarting the daemon with Ctrl+C and the startup command. Until then, the connection cards and token copy/reveal buttons show the currently running credentials and endpoints. Each token identifies its running/pending state; a restart notice stays visible while saved configuration differs from startup configuration. After rotating tokens and restarting, update the corresponding agents or extensions.

The management browser retains a reminder of the affected Agent role and up to 64 known device aliases/UUIDs until the user acknowledges updating them after restart. Only config-path identity, process ID, roles and bounded device identifiers enter same-origin localStorage; tokens do not. This is a UI reminder, not server-wide client acknowledgment. Clearing/blocking browser storage, changing the management origin/port, or opening another browser can prevent it from surviving restart. Pending server state remains available while the original process runs. Active-tab refresh after restart reloads the page for the new CSRF token and re-masks revealed credentials.

## Read-only connection checks

The local page distinguishes HTTP MCP availability, authenticated extension registration and a successful tool read. Clicking the check button sends same-origin, CSRF-protected `POST /api/connection-check`, optionally with an online `instanceId`. The daemon uses its own running HTTP URL/token to perform initialize (`2025-11-25`), tools/list, and, for a registered device, `browser.countOpenTabs`, with a six-second total deadline. It does not accept a user-supplied URL/token, open/move/close tabs, or add a new MCP tool. Status/errors contain no credentials or raw transport errors.

With no device, HTTP can pass while registration is missing and tool execution is not run. A passed read establishes the local HTTP→bridge→extension path at that check, not correct configuration of every MCP product host. Settings/rotation/check feedback appears beside its action. Network diagnostics in the extension suggest server, port, firewall, browser Local Network Access and optional WSS certificate checks; a generic WebSocket failure cannot identify which cause applies.

The management page is available only from loopback connections with a loopback Host. It rejects foreign Origins; mutation and secret endpoints also require same-origin POST plus a per-process CSRF token. Ordinary HTML and status responses omit authentication tokens. The page has no CORS access, uses no-store responses, and blocks embedding. Access is based on the local machine boundary, not per-user browser authentication: local processes and other users on the same machine may access it.

## LAN mode

Enable LAN in the page, save, and restart. Both listeners bind to `0.0.0.0`; the page lists private IPv4 addresses and copyable HTTP/WS URLs. Remote agents use `http://<server-private-ip>:38472/mcp` with the MCP token. In an updated BMD source build, paste `ws://<server-private-ip>:38471/` into the MCP endpoint field and use the separate pairing token, then test, save and enable the bridge. Accepted plaintext LAN addresses are RFC1918 IPv4: `10.0.0.0/8`, `172.16.0.0/12`, and `192.168.0.0/16`; the WS path must be `/`. No certificate is required. Multiple devices share this one server and its instance registry. Management remains at `http://127.0.0.1:38472/` on the server computer. Allow the selected ports in your host firewall if required.

Neither the server nor updated BMD requires certificates or WSS for local/private LAN connections. HTTP/WS carries credentials and data in plaintext, so use it on a trusted private network. Pairing and HTTP tokens, Origin/hello identity, schemas and limits still apply. The server accepts loopback and RFC1918 peers and validates Host against its own private interface addresses; it ignores forwarded-address headers. Public-address peers/Hosts are rejected. This is not a public deployment or reverse-proxy mode.

Existing `BOOKMARKDOWN_WS_HOST` can bind one private IPv4 address. `BOOKMARKDOWN_WS_TLS_CERT_FILE` and `BOOKMARKDOWN_WS_TLS_KEY_FILE` together optionally enable WSS; only users choosing WSS need a trusted certificate. These ENV settings are not required for LAN WS. A custom WS host can differ from the HTTP LAN binding and the page shows it separately. Exact local/private-interface Chrome results are in the [integration guide](browser-integration.md); separate physical devices, firewall/routing, other Chrome/LNA combinations, optional WSS and specific MCP product hosts require their own verification.

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
