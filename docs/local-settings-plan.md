---
title: Local settings and LAN implementation plan
description: Accepted scope for persistent configuration, local management, and multi-device access.
ms.date: 2026-10-03
ms.topic: reference
---

## Accepted behavior

The CLI reads a per-user configuration file before listening. First launch creates it with independent random MCP and extension tokens. Environment variables override saved values. Invalid configuration fails startup without replacing the file.

The local management page shows a compact `BookMarkdown MCP` header with live status, masked tokens with reveal/copy controls, connection URLs, supported protocol clients, connected devices, and editable settings. Saving and token rotation take effect after restarting. Tokens never appear in logs or ordinary status responses.

Loopback is the default. Enabling LAN binds both listeners to IPv4 interfaces and accepts local/private-network traffic. HTTP and WS are sufficient; TLS is optional for existing deployments. LAN clients authenticate with their respective tokens. Management routes remain restricted to loopback, including when LAN is enabled, with Host, Origin, and CSRF checks.

Compatible Chrome extensions can pair without preconfigured IDs. An explicit production ID allowlist remains optional; development accepts any compatible ID. Existing protocol identity, operation schemas, request correlation, and limits remain in force. The page lists paired instances without fetching tab contents or adding browser mutation controls.

## Validation

Check configuration creation/reuse, permissions, malformed files, environment overrides, local page access, masked status, CSRF, saving/restart, token rotation, LAN routing, unrestricted pairing, and existing MCP/bridge tests. Verify the compiled CLI and management UI. Real Chrome/extension integration remains a separate integration check.

## Implementation result

Implemented the accepted scope. Windows checks pass: 44 tests, typecheck, build, and packed-artifact configuration/assets/status/MCP smoke. Three platform-specific tests are skipped. Clean npm installation is blocked by registry access restrictions. Browser security policy denied local UI navigation, so visual layout and actual browser interactions remain unverified; no alternate browser route was attempted.
