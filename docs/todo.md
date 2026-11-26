---
title: Remaining project work
description: Unfinished work for the BookMarkdown MCP server
ms.date: 2026-11-26
ms.topic: reference
status: pending
---

## Scope

Only unfinished work is kept here. Durable decisions belong in [ADRs](adr);
current behavior belongs in [features](features.md) and
[browser integration](browser-integration.md). Remove an item once it is done
or explicitly dropped.

## Pending work

| Area | Remaining work | Completion condition |
| --- | --- | --- |
| Real integration evidence | Verify a named MCP host with the real Chrome extension, including LAN, restart, long idle and sleep/wake | Record versions and results in `browser-integration.md`; unit and contract tests do not count |
| Management UI verification | Visually verify the local management page and its interactions in a browser (left unverified by ADR 0001) | Record browser, OS and result; fix any layout or interaction defects |
| Release documentation | Reconcile README, `docs/features.md` and the published npm version with the current source | Published version, supported platforms and tools match the source and changelog |
