---
title: "BookMarkdown MCP Server 工作指示"
description: "本 repository 的 MCP Streamable HTTP daemon、WebSocket bridge、測試與文件維護規則。"
ms.date: 2026-10-02
---

## 專案範圍

本 repository 負責 BookMarkdown MCP daemon 與其 loopback 或可選的私有區網 WebSocket bridge。使用者啟動 daemon，MCP host 直接透過本機或區網 Streamable HTTP `/mcp` 呼叫；另一個 repository 的 browser extension 是 WebSocket client。

* 不要在本 repository 實作或修改 Chrome extension、manifest、service worker、options UI 或 extension 權限。
* 不要新增假 MV3 extension 作為測試工具。WebSocket 行為使用一般 JavaScript/Node.js client 驗證。
* 不要因為 Chrome Local Network Access、extension permission 或 service worker 尚未完成驗證，就阻擋 MCP/WebSocket server 的本地開發與測試。
* Chrome、extension 與指定 MCP host 的真實整合未通過前，不要宣稱跨專案或瀏覽器相容性已驗證。
* 除非使用者明確要求，不要發布 npm 套件、提交 git commit、推送遠端或修改 sibling repository。

## 架構與協定

* MCP transport 使用 SDK v2 `NodeStreamableHTTPServerTransport`，每個 POST 獨立 server／transport，無狀態 JSON 回覆。HTTP 預設 loopback，區網開關允許 IPv4 wildcard binding 與私有 peers／Hosts；每次 MCP 請求驗證 Bearer、Host、Origin，不提供 CORS。CLI 首次建立使用者設定與兩組 token，ENV 優先；設定頁僅限本機、保存後重啟生效。
* MCP 回覆透過 HTTP 傳送；daemon stdout 不輸出協定訊息，診斷、啟動狀態與錯誤寫到 stderr。
* WebSocket 是獨立應用層 RPC，預設 loopback。區網開關可綁定 `0.0.0.0`，只接受 loopback／RFC1918 peers 與本機私有 Host；TLS 為選配，不強制 WSS。不掃描替代 port。
* HTTP 或 WebSocket port 占用、設定失效時，daemon 啟動失敗並清理已建立的資源。Daemon 離線時 initialize、tools/list 與 tools/call 都無法連線。
* `npm start` 與套件 CLI 未提供子命令時預設啟動 production daemon；CLI 僅接受 `daemon`，stdio proxy 與 IPC 已移除。`npm run dev -- daemon` 明確使用 development。不要從 `NODE_ENV` 推斷 runtime mode。
* WebSocket Origin 在兩種模式都必須符合 `chrome-extension://[a-p]{32}`，hello extension ID 必須等於 Origin ID，並通過 pairing token 驗證。Production 若設定非空 `BOOKMARKDOWN_EXTENSION_IDS` 才要求符合清單；development 不使用固定 ID allowlist。Origin 不是認證；不得把 token 放進 URL、命令列參數、log、MCP 回覆或 source control。
* 不使用 IPC health 或 duplicate-daemon probe；重複啟動回報 port 被占用。HTTP agent token 與 extension pairing token 獨立亂數產生並保存；所有 agent 共用 instances 與工具權限，不提供每個 agent 的權限隔離或分頁獨占。
* 所有訊息、參數、回覆都要驗證 schema。維持 payload、連線數、註冊 instance 數、pending request 數與 timeout 上限；只接受明確 allowlist 的操作。
* request/response 以唯一 ID 關聯，並限定在原連線內；處理逾時、斷線、取消和 shutdown 時清除 pending state。副作用操作若未取得結果，不可自動重送。
* companion extension contract 目前仍是提案。開始跨 repository 整合或變更 wire format 前，先檢查目前版本與兩側實作；不可把提案中的所有功能當成已核准或已實作。

## MCP 功能邊界

目前 MCP tools 僅允許以下明確功能：

* `devices.list` 列出此 server process 已知的 instances，並可選擇查詢分頁數。
* `browser.countOpenTabs` 與 `browser.countOpenWindows` 計算指定 instance 一般視窗中的分頁數或視窗數。
* `browser.listTabs` 分頁列出一般視窗的 bounded `tabId`、`windowId`、`active`、`title` 與 `url` metadata。
* `browser.openTab`、`browser.closeTab` 與 `browser.moveTab` 執行明確核准的分頁操作；移動只支援不同的一般視窗。

Extension 必須在計數與清單中排除 incognito 視窗和分頁；server 無法自行驗證 extension 回傳的瀏覽器資料。分頁標題與 URL 可能包含敏感資訊，絕不可記錄 payload 或回傳頁面內容。不要自行新增書籤、SQL、任意 browser operation、其他寫入行為或跨裝置 tab transfer。新增能力需要明確產品需求、資料與授權邊界，以及相應的協定和測試。

## 實作與驗證

* 使用 Node.js `22.23.3` 或更新版本，使用 npm 與 `package-lock.json`；變更 dependencies 時同步更新 lockfile。Source checkout 支援 Windows、Linux 與 macOS，agent 連線統一使用 HTTP。
* 安裝後可執行 `npm test`、`npm run typecheck`、`npm run build`。`npm test` 會先 build 再執行 `node:test`。
* 新增或修改 WebSocket 行為時，使用一般 Node.js WebSocket client 測試握手、驗證、request/response 關聯、逾時、斷線、限制與 MCP 結果。測試不得依賴 Chrome 或未實作的 extension。
* 每次修改後先跑能檢查該行為的窄測試，再依風險執行完整測試、typecheck 和 build。不要宣稱未執行的檢查已通過。
* 保留 loopback 預設綁定；區網開關接受私有網路 HTTP／WS，不要求 TLS；管理頁仍以 loopback／Host／Origin／CSRF 保護。維持 stdout/stderr 分工和 fail-closed 認證。不得在錯誤訊息或 log 印出 pairing token、敏感 URL 或頁面內容。
* 已發布的 `@bookmarkdown/mcp-server@0.2.1` 支援 Windows/Linux；目前 source checkout 另支援 macOS。CI 在 Ubuntu、Windows 與 macOS 驗證測試、型別及乾淨套件安裝與 MCP initialize。這不代表真實 extension/MCP host 互通性已驗證。發布前須確認 npm Trusted Publisher 設定可讓 workflow 透過 OIDC 發布。除非使用者明確要求，不得執行實際發布。

## 文件維護

* `README.md` 是 GitHub repository 首頁，優先呈現專案用途、需求、安裝與啟動方式、設定入口及狀態；不要只放內部開發筆記。
* `docs/features.md` 說明目前實際可用功能、輸入輸出、限制與未實作項目。功能改變時同步更新此頁。
* 只有設定、啟動或使用流程改變時才同步更新 README；避免把完整功能規格複製到 README。
* 公開首頁 `README.md` 與 `README.zh-TW.md` 不使用 YAML frontmatter，從 H1 專案名稱開始，避免 GitHub 將 metadata 顯示為正文。其他 Markdown 使用 YAML frontmatter，依檔案位置填入 `title`、`description` 等必要欄位；有 `title` 時正文從 H2 開始。
* 使用清楚、精簡的繁體中文說明；以程式碼和測試為準，不把計畫、提案或未驗證的整合寫成既有功能。

## 工作流程

* 開始前確認 repository 根目錄、工作樹狀態、相關程式與測試，保留使用者既有變更。
* 修改範圍限於當前需求與本 repository；不要將 sibling extension 的規則或依賴套用到這裡。
* 若目前有對應的 `.copilot-tracking` implementation plan，依使用者最新決定調整計畫與變更紀錄，不可讓舊計畫覆蓋最新的明確範圍。


### 對話

* 對話要保持簡潔回答重點
* 與使用者對話使用正體中文，技術研究內容以英文為主
