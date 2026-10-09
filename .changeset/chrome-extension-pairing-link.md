---
"@bookmarkdown/mcp-server": patch
---

Add explicit Chrome extension pairing and copy-link actions to the local management page. Prefill the user-provided extension ID, allow a browser-local override and selection of a running local/LAN WS endpoint, and create a CSRF-protected fragment handoff using only the currently active bridge token. The companion extension imports an unsaved draft, clears URL parameters and asks the user to test before explicitly saving and enabling.

Restore the approved BMD logo colors in the management header and favicon: black on light backgrounds and white on dark backgrounds, independently of the page's accent color.
