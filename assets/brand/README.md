---
title: Bookmarkdown logo assets
description: Final BMD cutout bookmark logo and historical identity explorations.
ms.date: 2026-10-09
---

## Current Logo

The approved logo is the cutout bookmark in [bmd-final](bmd-final/README.md).
The management header and favicon inline the outline from `bmd-final/bmd-logo.svg`
in `src/management/page.ts`: black on light backgrounds and white on dark
backgrounds. The page accent color does not change the logo color.

## Historical Design

The bookmark silhouette represents saved content. The `BMD` monogram references the project's name, with a taller and heavier central `M` emphasizing Markdown. The M is 52 units tall versus 40 for B/D, with approximately 11-unit stems versus 7. The original geometric lowercase wordmark is retained. Rounded geometry matches the local management interface. Lime `#C6EF8D` is the accent; ink `#15251D` and off-white `#EDF2EE` provide the light and dark wordmarks.

## Historical Files

* `bookmarkdown-symbol.svg`: standalone icon, transparent background.
* `bookmarkdown-logo.svg`: horizontal logo for light backgrounds.
* `bookmarkdown-logo-dark.svg`: horizontal logo for dark backgrounds.
* `bookmarkdown-logo-mono.svg`: single-color logo using `currentColor` when embedded inline.
* `preview.png`, `preview-bmd.png`: presentation of the light/dark logos and icon sizes.

All SVG artwork, including the custom geometric lowercase wordmark, uses paths. There are no font, script, image, or network dependencies. Keep proportions intact and leave at least one M-stem width of clear space. Use the symbol alone at small sizes; recommended minimum symbol width is 32 px.

The final extension logo set is in `bmd-final/`. The management page header and favicon use its `bmd-logo.svg` outline, inlined in `src/management/page.ts`. The other files in this folder are supplied separately and are not used by the page.
