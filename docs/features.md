---
title: "Available Features"
description: "BookMarkdown MCP daemon、Streamable HTTP、browser window/tab 工具與目前整合狀態。"
ms.date: 2026-10-09
ms.topic: reference
---

## 本機架構

使用者手動以前景程序啟動 daemon，agent 直接透過 `http://127.0.0.1:38472/mcp` 呼叫 MCP Streamable HTTP。stdio proxy 與本機 IPC 已移除；CLI 僅接受 `daemon`，省略時也啟動 daemon。

`npm start` 使用正式模式，`npm run dev -- daemon` 使用開發模式，不依 `NODE_ENV` 判斷模式。CLI 自動讀取或建立設定檔與兩組 token，不需 ENV；production extension ID allowlist 為選填。ENV 優先於設定檔，HTTP port 預設 `38472`。MCP 無狀態 JSON 回覆不建立 session，非 POST 方法回 `405`；此限制不適用管理頁 GET。Daemon 離線時 initialize、tools/list 與 tools/call 都無法連線。啟動失敗會清理 listener；port 被占用時不掃描其他 port。設定與 migration 見 [README](../README.zh-TW.md)。

## 多 agent 容量與操作邊界

Daemon 沒有固定 agent 數量配額；所有 agent 共用預設 `32` 個處理中的 HTTP 請求額度。`BOOKMARKDOWN_MAX_PENDING_REQUESTS` 可設為 `1–256`，修改後需重啟；超限回 HTTP `503` 與 `Retry-After: 1`。閒置 agent 不占用額度。Bridge 另以相同設定限制 pending browser RPC，超限回工具錯誤 `BRIDGE_BUSY`；單次 devices.list 查詢分頁數可能占用多個 browser RPC 額度。`BOOKMARKDOWN_MAX_CONNECTIONS` 預設 `8`、範圍 `1–64`，限制 extension WebSocket 連線數。

不同 agent 的 MCP JSON-RPC ID 可重複；每個 HTTP 請求的 server／transport 獨立，browser RPC 則以 daemon 產生的 UUID `requestId` 與 extension 來源連線配對，結果回到原始 HTTP 請求。回覆順序可以不同於送出順序，詳見[架構文件](architecture.md#多-agent-請求配對與共享狀態)。

Agent 共用認證 token、browser instances 與工具權限。沒有每個 agent 的權限隔離或分頁獨占；同時修改同一分頁可能互相影響，應由 agent／host 協調。

## MCP 工具

| 工具 | 輸入 | 行為 |
| --- | --- | --- |
| `devices.list` | `includeOffline`、`includeTabCounts`，預設皆為 `true` | 列出目前 daemon 已知的 instances、各自的 UUID 與裝置別名，可查詢線上 instance 的分頁數。 |
| `browser.countOpenTabs` | UUID `instanceId` | 計算指定 instance 一般視窗中的分頁數。 |
| `browser.countOpenWindows` | UUID `instanceId` | 計算指定 instance 的一般視窗數。 |
| `browser.listTabs` | UUID `instanceId`、`limit`（預設 10、上限 10）、`offset`（預設 0） | 分頁查詢，每頁最多回傳 10 筆 `tabId`、`windowId`、`active`、`title` 與 `url`。 |
| `browser.openTab` | UUID `instanceId`、選用的 `url` 與 `windowId` | 在一般視窗開啟分頁；省略 URL 時使用 `about:blank`，提供的 URL 限制為無憑證 HTTP(S)。 |
| `browser.closeTab` | UUID `instanceId`、非負整數 `tabId` | 關閉指定分頁。 |
| `browser.moveTab` | UUID `instanceId`、非負整數 `tabId` 與 `targetWindowId` | 將分頁移至另一個一般視窗，不提供同視窗排序或 index。 |

計數工具回傳 `count` 與 `countedAt`。分頁標題和 URL 可能含有敏感資訊；`browser.listTabs` 只回傳有界 metadata，不讀取頁面內容。Extension 必須確保 `browser.countOpenTabs`、`browser.countOpenWindows` 與 `browser.listTabs` 排除 incognito 視窗和分頁。Server 無法從 extension 回覆判斷其是否遵守此規則。

`browser.openTab`、`browser.closeTab` 與 `browser.moveTab` 會改變瀏覽器狀態。逾時或連線中斷時，結果可能不明，server 不會自動重送。所有 browser tools 都要求目標 instance 在 hello capabilities 中宣告相應 operation。

### `devices.list` 結果

每個 instance 包含 `appId`、`instanceId`、`extensionId`、`browser`、`status`、`lastSeen`、回報的 operation capabilities 與 `displayName`。使用者可在 extension 設定頁自訂 1 至 32 個中英文或數字組成的別名，詞語間可用空格或連字號；也可重新產生三個不同動物詞 alias。同一 daemon 中如有其他 instance 使用相同名稱，server 會加上 `-2`、`-3` 等數字後綴，並在註冊 ack 回傳最後分配的名稱。AI 可從 `devices.list` 將 `displayName` 對應到同一項目的 `instanceId`；執行 browser tools 時仍需使用 UUID `instanceId`。

查詢分頁數時，每個 instance 都有 `countStatus` 與 nullable `tabCount`；成功結果包含 `countedAt`。`totalTabs` 僅加總成功的查詢，部分結果會以 `complete: false` 表示。未要求分頁數時，`totalTabs` 為 `null`。

instance registry 只存在 daemon 記憶體中，daemon 重啟後會清空。`includeOffline: false` 只會篩除已知的離線 instance，不會探索尚未連線的瀏覽器設定檔。篩選後沒有 instance 時，`0.4.0` 回 `EXTENSION_NOT_CONNECTED` 工具錯誤，並非空清單；即使 `includeTabCounts: false` 也相同。

## 連線與錯誤

daemon 預設在 `127.0.0.1:38471` 接受 WebSocket，MCP 在 `127.0.0.1:38472/mcp`。CLI 首次建立設定檔與兩組 token，本機管理頁提供設定、token 遮蔽／複製及多裝置清單。開啟區網後允許私有網路 HTTP／WS，不強制 WSS；管理頁仍限本機。Production extension ID allowlist 選填，development 接受所有相容 ID；兩種模式都保留 Origin、hello 身分與 token 檢查。設定保存需重啟，詳見[設定指南](settings.md)。Listener 必須同時成功啟動，失敗會清理資源。

瀏覽器端連線、hello/ack、RPC 訊息與 client 範例見[瀏覽器整合指南](browser-integration.md)。Server `0.4.0` 與 BMD `0.0.1` source build 已通過 Windows、Chrome 153 的真實 loopback 與同機私有網卡 WS 串接測試；使用原始 manifest，沒有額外 host grant。更新後的套件允許 `127.0.0.1` 與 RFC1918 私有 IPv4 根路徑的明文 WS，LAN 不需 WSS 或憑證。跨實體裝置、防火牆、其他 Chrome/LNA 組合、選配 WSS 及指定產品 host 的驗證範圍見整合指南。

HTTP 缺少或不正確的 Bearer token 回 `401`，非法 Host/Origin 回 `403`，body 超限回 `413`，同時處理中的 HTTP 請求超限回 `503`。工具錯誤包含 `EXTENSION_NOT_CONNECTED`、`UNSUPPORTED_OPERATION`、`REQUEST_TIMEOUT`、`REQUEST_CANCELLED`、`EXTENSION_DISCONNECTED`、`EXTENSION_OPERATION_FAILED`、`BRIDGE_BUSY` 與 `INVALID_EXTENSION_RESPONSE`。取消或斷線不會自動重送瀏覽器操作。

WebSocket hello 使用 protocol version `2`。一般註冊要求 app ID `bmd-extension`、browser `chrome`、UUID instance ID、合法裝置別名及與 Origin 相符的 extension ID；正式模式若設定非空 allowlist，ID 必須符合清單。Probe 可省略別名且不會註冊 instance。Browser RPC 僅接受 `browser.countOpenTabs`、`browser.countOpenWindows`、`browser.listTabs`、`browser.openTab`、`browser.closeTab` 與 `browser.moveTab`，並在呼叫前檢查 instance capabilities。request ID 用於將回覆配對到原始連線及呼叫。

## 驗證狀態與後續工作

此 repository 的 Node.js 測試使用 HTTP MCP 與 WebSocket client，涵蓋認證、路由、取消、併發隔離、啟動 rollback、關閉及 browser operation contract。Linux WSS 測試在 Windows 略過。2026-10-09 在 companion extension repository 以 npm 正式版 `0.4.0`、BMD `0.0.1`、Windows、Node.js `24.11.0`、Playwright `1.63.0`、Chrome for Testing `153.0.8010.12` 驗證七個工具、loopback 與同機私有網卡 WS 配對、實際分頁異動及重連。測試 host 為 `bmd-chrome-integration-test/1.0.0` HTTP JSON-RPC client，不能替代指定產品 host 驗收。詳細證據與未測項目見[整合指南](browser-integration.md)。

更新後的 companion extension 對網路錯誤／hello 逾時使用 1／2／4／8／16／30 秒退避並显示下一次倒數；精確序列、停用清理及拒絕認證後停止已由單元測試驗證。重連不重送 browser RPC。長時間 MV3 閒置及 sleep/wake 尚未驗證。

目前 source 新增角色化配對引導、秘密占位符樣板、操作旁提示、執行中／待重啟 token 狀態、重啟後客戶端更新提醒與三段唯讀健康檢查。這些管理頁功能尚未發布，不屬於 npm `0.4.0` 的既有驗證。`EXTENSION_NOT_CONNECTED`／`isError` 契約維持不變，訊息新增先啟用套件的步驟。健康檢查不增加七個工具之外的 MCP 工具，詳見[設定指南](settings.md)。

目前 source 另新增「連接 Chrome 套件」與「複製配對連結」，可選擇執行中的本機／LAN WS 端點，帶入套件的未儲存草稿並提示測試，再由使用者儲存並啟用。目標 ID 預填為使用者指定值，可改為開發版實際 ID；不修改 allowlist，也不新增 MCP 工具。這項配對連結功能尚未發布，需更新兩端，詳見[一鍵配對](settings.md#one-click-extension-pairing)。

設定範圍與本機啟動步驟，請參閱[專案 README](../README.md)。
