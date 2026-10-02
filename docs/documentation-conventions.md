---
title: "文件規約"
description: "BookMarkdown MCP Server 公開文件的語言、格式、內容責任與維護要求。"
ms.date: 2026-09-28
ms.topic: reference
---

## 目的與範圍

本規約適用於 repository 中的 Markdown 文件。文件應面向使用者或貢獻者，記錄可由程式碼、測試或明確維護決策支持的現況；不得把計畫、提案或未驗證的整合描述為已完成。

## 語言與入口

* `README.md` 是公開首頁與英文主要入口，負責說明用途、狀態、需求、安裝、啟動、安全限制及文件導覽。
* `README.zh-TW.md` 是繁體中文對照頁。兩份 README 頂端必須提供互相對應的語言切換連結，功能與限制不得互相矛盾。
* 新增面向外部使用者的技術文件時，使用英文作為主要版本；提供繁體中文時，使用同目錄、同主題的 `.zh-TW.md` 檔案，並在兩份文件中互相連結。既有繁體中文技術文件在完成英文版本前，連結標籤應明確標示語言。
* API 名稱、環境變數、CLI 命令、協定欄位與錯誤碼保留程式中的原始拼法，不翻譯識別字。

## Frontmatter 與結構

* `README.md` 與 `README.zh-TW.md` 是 GitHub 專案首頁，不使用 YAML frontmatter；以 H1 專案名稱開頭，避免 metadata 顯示為首頁正文。
* 其他 Markdown 文件以 YAML frontmatter 開始，至少包含 `title`、`description`；依文件用途補上 `ms.date`、`ms.topic`。
* 有 frontmatter `title` 的文件，正文從 H2 開始；README 沒有 frontmatter，使用 H1。
* 使用清楚的標題與短段落。操作步驟依序排列，命令範例標示 shell 類型。
* 使用相對路徑連結 repository 內文件；語言版本之間提供互相連結。提交前確認連結目標存在。

## 文件責任

| 文件 | 應記錄的內容 |
| --- | --- |
| `README.md` | 專案用途、成熟度/驗證狀態、支援平台、需求、目前可用的安裝與啟動方式、主要限制和文件連結。 |
| `docs/features.md` | 實際可呼叫的 MCP tools、輸入輸出、邊界、錯誤與未實作功能。 |
| `docs/architecture.md` | 程序責任、資料流、HTTP/WebSocket 邊界、生命週期與安全假設。 |
| `docs/browser-integration.md` | Browser extension WebSocket contract、驗證、hello/ack、RPC schemas、限制、錯誤處理及串接驗收狀態。 |
| `docs/documentation-conventions.md` | 文件語言、格式、責任分工與維護規則。 |

設定、安裝或使用流程改變時更新 README。Tool contract 改變時同步更新 features 與 browser integration 文件；程序或資料流改變時同步更新 architecture 文件。不要把同一份完整規格複製到 README。

## 狀態與證據

* 對功能使用明確狀態，例如 `implemented`、`tested`、`not verified`、`not supported` 或 `planned`，並說清驗證範圍。
* 單元測試、Node.js WebSocket contract 測試、瀏覽器 extension 測試及真實 Chrome/MCP host 整合測試是不同證據，不可互相替代。
* 宣稱相容性或整合完成時，記錄測試日期、作業系統、Node.js/npm、Chrome、extension 版本、MCP host 版本及測試結果。未測項目明確標示，不推論為通過。
* 範例必須對應目前實作。環境變數、預設值、範圍、命令與 JSON 欄位以程式碼和測試為準；改動後重新驗證。

## 安全與隱私

* 不在文件、範例或截圖中放入有效 pairing token、存取憑證或個人資料。Token 僅以虛構佔位值或安全產生方式示範。
* 明確提醒分頁標題與 URL 可能含敏感資訊；不得把頁面內容、實際標題/URL 或敏感 payload 複製到文件或測試報告。
* 說明 incognito 視窗/分頁的排除責任屬於 extension；除非 server 已能驗證，文件不可暗示 server 能自行保證 extension 回傳資料。
* 說明預設 loopback 與選用 RFC1918 WSS 綁定、配對認證及未驗證的瀏覽器權限/整合邊界，不把 Origin 格式描述為認證。

## 瀏覽器整合文件必備方向

`docs/browser-integration.md` 是 browser integration contract 的專屬文件。它應說明目前已實作的串接方式和限制，而不是把整合描述成待完成計畫。內容至少涵蓋以下方向：

1. **範圍與參與者**：server、companion extension、MCP host 各自負責的程序、連線和功能；指出 extension 所屬 repository 及支援的 OS/瀏覽器範圍。
2. **連線與信任邊界**：預設 loopback 或選用的 RFC1918 WSS address/port、TLS 憑證信任、WebSocket path、Host/Origin 驗證、extension ID allowlist、pairing token 的設定責任，以及 token 不可使用的傳遞位置。
3. **連線生命週期**：connect、hello/ack、probe、註冊/解除註冊、heartbeat 或 liveness（若有）、reconnect、daemon restart 與 shutdown 行為。
4. **協定與相容性**：protocol version、必填/選填欄位、strict schema、capabilities、限制值、request ID 關聯、成功/拒絕範例，以及版本不相容的處理。
5. **Browser operations**：每個 MCP tool 對應的 extension operation、輸入/輸出、normal/incognito 視窗範圍、分頁 metadata 邊界、權限要求，以及開啟/關閉/移動等副作用操作的結果不明與重送規則。
6. **錯誤與資源限制**：upgrade/hello/auth/schema 錯誤、timeout、disconnect、取消、payload/連線/pending-request 上限和安全錯誤回覆。
7. **安全與隱私**：配對 token 管理、loopback/LAN TLS 限制、頁面內容不讀取、tab title/URL 敏感性、incognito 排除責任及不可記錄的資料。
8. **設定與操作方式**：必要及選用設定、預設值、範圍、daemon 啟動責任，以及 MCP host 如何連線 HTTP；範例須符合目前 CLI 和 extension contract。
9. **測試與狀態證據**：分開說明 server contract tests、extension tests、真實 Chrome/extension tests 和指定 MCP host tests。記錄實際完成的測試與環境版本；未覆蓋的組合標示 `not verified`，不可用單元測試推論真實瀏覽器相容性。
10. **維護與文件連結**：指出 contract 的 source schema、operation implementation、相鄰測試、features/architecture 文件，以及跨 repository 變更時要同步檢查的版本。

內容需以 server schema、extension 實作與測試為準。此 repository 不包含 companion extension；extension 端變更應在其所屬 repository 實作，但 server 文件仍需說清雙方 contract 與責任邊界。

## 變更前檢查

* 更新功能文件前，先核對 owning implementation、schema 和相鄰測試。
* 更新整合狀態前，確認測試確實涵蓋所宣稱的平台、瀏覽器、extension 與 MCP host。
* 執行 repository 提供的 Markdown/frontmatter/link 檢查；本 repository 目前也可執行 `npm test`、`npm run typecheck` 和 `npm run build` 來驗證程式變更。
