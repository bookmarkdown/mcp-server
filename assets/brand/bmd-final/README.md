---
title: BMD final logo
description: Final BMD / bookmarkdown logo set with SVG, PNG, and ICO files.
ms.date: 2026-10-09
---

定案：第一輪 02「留白書籤」原版。沿用原始輪廓、M 比例及書籤尾端，未套用第二輪微調。

## 檔案

- bmd-logo.svg：原始向量圖形，viewBox 0 0 100 100，currentColor，預設黑色。
- bmd-logo-white.svg：反白向量圖形，深色背景使用。
- png/black/：透明背景黑色 PNG。
- png/white/：透明背景白色 PNG。
- bmd-logo.ico：含 16、24、32、48、64、128、256 px 的透明 RGBA 多尺寸 Windows 圖示。
- favicon.ico：與 bmd-logo.ico 相同，可直接作為網站 favicon。
- site.webmanifest：192 / 512 px 網站圖示參考設定；部署時請依實際路徑調整。
- preview.png：預覽圖，非正式 Logo 資產。

PNG 尺寸：16、24、32、48、64、96、128、180、192、256、512、1024、2048 px，皆為正方形畫布。

## 用途

| 用途 | 建議檔案 |
| --- | --- |
| 網頁、印刷、向量編輯 | bmd-logo.svg |
| 網站 favicon、Windows 圖示 | favicon.ico / bmd-logo.ico |
| 瀏覽器擴充功能 | 16、32、48、128 px PNG |
| Apple touch icon | 180 px PNG（此檔透明底；平台可能另加背景） |
| 網站 App icon | 192、512 px PNG |
| 一般展示與社群素材 | 512、1024、2048 px PNG |

PNG 與 ICO 由同一張 2048 px SVG 渲染母圖縮製，保留原版輪廓與安全留白。M 內部為真正透明負形，非白色填色。

Inline SVG 可透過 CSS color 調整色彩；以 img 引用時請使用對應黑色或白色檔。

## 驗證

已驗證 SVG XML、全部 PNG 的尺寸與透明通道、ICO 的七個內嵌尺寸及 M 內部透明負形。
