# @bookmarkdown/mcp-server

## 0.4.2

### Patch Changes

- 7065b5f: Add explicit Chrome extension pairing and copy-link actions to the local management page. Prefill the user-provided extension ID, allow a browser-local override and selection of a running local/LAN WS endpoint, and create a CSRF-protected fragment handoff using only the currently active bridge token. The companion extension imports an unsaved draft, clears URL parameters and asks the user to test before explicitly saving and enabling.
  
  Restore the approved BMD logo colors in the management header and favicon: black on light backgrounds and white on dark backgrounds, independently of the page's accent color.

## 0.4.1

### Patch Changes

- 6aa1905: Add guided management setup with separate Agent/extension credentials, secret-free templates, adjacent feedback, running/pending token states and a browser-local reminder to update clients after restart. Add an explicit CSRF-protected connection check through HTTP initialize, tools/list and read-only tab counting without new MCP tools or browser mutations. Preserve the empty-device error contract and provide actionable pairing guidance.
  
  Document local/private LAN WS setup without mandatory TLS in the updated companion extension, its save-and-enable flow and bounded retry diagnostics. Separate the released 0.4.0 WS baseline from unreleased source UX, optional WSS, physical-device deployments and product-host verification boundaries.
  
  Keep in-flight HTTP replies in the shutdown drain until flushed; force-close HTTP sockets only after an expired drain with unfinished requests. Close rejected WebSocket upgrade sockets after their HTTP reply is flushed.

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
