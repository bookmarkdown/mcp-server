---
"@bookmarkdown/mcp-server": patch
---

Add guided management setup with separate Agent/extension credentials, secret-free templates, adjacent feedback, running/pending token states and a browser-local reminder to update clients after restart. Add an explicit CSRF-protected connection check through HTTP initialize, tools/list and read-only tab counting without new MCP tools or browser mutations. Preserve the empty-device error contract and provide actionable pairing guidance.

Document local/private LAN WS setup without mandatory TLS in the updated companion extension, its save-and-enable flow and bounded retry diagnostics. Separate the released 0.4.0 WS baseline from unreleased source UX, optional WSS, physical-device deployments and product-host verification boundaries.

Keep in-flight HTTP replies in the shutdown drain until flushed; force-close HTTP sockets only after an expired drain with unfinished requests. Close rejected WebSocket upgrade sockets after their HTTP reply is flushed.
