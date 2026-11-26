---
title: Bounded tab content reading
description: browser.readTabContent is the only MCP tool that returns page text, as a bounded, unlogged extract
status: accepted
ms.date: 2026-11-26
ms.topic: architecture
---

## Context

The server originally exposed only tab metadata (title, URL) and stated that it never reads page contents. Agents that tag or summarize bookmarks need some page text to decide on tags. The companion extension accepted progressive tab reading in its ADR 0032 (`browser.searchTabs` and `browser.readTabContent`). The user confirmed this direction on 2026-11-26.

## Decision

`browser.readTabContent` is the only MCP tool allowed to return page content. It returns a bounded DOM text extract (title, meta description, up to 20 h1–h3 headings, text and URL) for one tab the agent explicitly names, in `excerpt` or `text` mode with cursor-based continuation and hard size limits. It is a text extract, not an AI summary.

* All other tools keep returning metadata only.
* The server never logs, caches or persists page text, and never includes it in errors.
* Incognito windows and tabs stay excluded; that remains the extension's responsibility because the server cannot verify it.
* Any new tool that returns page content needs a new ADR.

## Consequences

Agent rules, README files, `docs/features.md` and `docs/documentation-conventions.md` describe the single exception instead of an absolute "no page content" rule. Page text may contain sensitive information, so the logging and error-message prohibitions now explicitly cover it.
