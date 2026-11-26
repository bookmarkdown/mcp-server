---
"@bookmarkdown/mcp-server": minor
---

Add library write tools for saved bookmarks and tags through authenticated extension instances: bookmarks.create, bookmarks.update, bookmarks.delete, bookmarks.replaceTags, bookmarks.setTagMembership, tags.create, tags.createPath, tags.update and tags.delete, plus the read-only tags.previewDelete. bookmarks.create and bookmarks.update accept optional tagPaths (`::`-separated hierarchy paths) alongside tagIds; missing path segments are created and the leaf tags assigned in the same atomic transaction, which rolls back on failure. Mutations are never retried automatically.
