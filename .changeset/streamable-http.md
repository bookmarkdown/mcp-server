---
"@bookmarkdown/mcp-server": minor
---

Replace the stdio proxy and local IPC with a loopback MCP Streamable HTTP daemon endpoint. Agents connect directly to /mcp using BOOKMARKDOWN_MCP_TOKEN bearer authentication. Remove the proxy subcommand and BOOKMARKDOWN_IPC_PIPE_NAME; retain the extension WebSocket contract and browser tools. Update migration instructions and package smoke verification.
