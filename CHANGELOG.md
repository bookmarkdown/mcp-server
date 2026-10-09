# @bookmarkdown/mcp-server

## 0.4.0

### Minor Changes

- acf3879: Create persistent per-user settings and random tokens on first CLI launch, expose a local settings and device-status page, and support optional multi-device LAN HTTP/WS without requiring TLS or preconfigured extension IDs.
- acf3879: Replace the stdio proxy and local IPC with a loopback MCP Streamable HTTP daemon endpoint. Agents connect directly to /mcp using BOOKMARKDOWN_MCP_TOKEN bearer authentication. Remove the proxy subcommand and BOOKMARKDOWN_IPC_PIPE_NAME; retain the extension WebSocket contract and browser tools. Update migration instructions and package smoke verification.

## 0.3.0

### Minor Changes

- 78e7620: Print extension connection instructions and credential-redacted lifecycle diagnostics to stderr, including probe success and handshake rejection hints. Add a proxy startup reminder while preserving MCP-only stdout.
- 78e7620: Support macOS installation and daemon/proxy IPC using a private per-user Unix domain socket under /tmp. Keep paths below the macOS socket limit and validate CLI, IPC permissions, lifecycle, routing, and clean package installation on macOS in GitHub Actions.

### Patch Changes

- ff1ac99: Add a step-by-step push and release workflow for maintainers.

## 0.2.1

### Patch Changes

- e45ff7c: Simplify releases around `main`, tighten publish validation, and document npm installation for Windows and Linux.
- c84d984: Run cross-platform CI explicitly for automated Version Packages pull requests.

## 0.2.0

### Minor Changes

- e5ae4c5: Add Linux local IPC support and TLS-protected private-LAN
  WebSocket bindings.

## 0.1.3

### Patch Changes

- Align the package version with the corrected npm release tag.

## 0.1.1

### Patch Changes

- 0787f81: Prepare the package for public npm distribution with reproducible builds and release metadata.
