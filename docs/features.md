---
title: "Available Features"
description: "BookMarkdown MCP daemon、Streamable HTTP、browser window/tab、書籤／標籤查詢與 CRUD 工具及整合狀態。"
ms.date: 2026-10-14
ms.topic: reference
---

## 本機架構

使用者手動以前景程序啟動 daemon，agent 直接透過 `http://127.0.0.1:38472/mcp` 呼叫 MCP Streamable HTTP。stdio proxy 與本機 IPC 已移除；CLI 僅接受 `daemon`，省略時也啟動 daemon。

`npm start` 使用正式模式，`npm run dev -- daemon` 使用開發模式，不依 `NODE_ENV` 判斷模式。CLI 自動讀取或建立設定檔與兩組 token，不需 ENV；production extension ID allowlist 為選填。ENV 優先於設定檔，HTTP port 預設 `38472`。MCP 無狀態 JSON 回覆不建立 session，非 POST 方法回 `405`；此限制不適用管理頁 GET。Daemon 離線時 initialize、tools/list 與 tools/call 都無法連線。啟動失敗會清理 listener；port 被占用時不掃描其他 port。設定與 migration 見 [README](../README.zh-TW.md)。

## 多 agent 容量與操作邊界

Daemon 沒有固定 agent 數量配額；所有 agent 共用預設 `32` 個處理中的 HTTP 請求額度。`BOOKMARKDOWN_MAX_PENDING_REQUESTS` 可設為 `1–256`，修改後需重啟；超限回 HTTP `503` 與 `Retry-After: 1`。閒置 agent 不占用額度。Bridge 另以相同設定限制 pending browser RPC，超限回工具錯誤 `BRIDGE_BUSY`；單次 devices.list 查詢分頁數可能占用多個 browser RPC 額度。`BOOKMARKDOWN_MAX_CONNECTIONS` 預設 `8`、範圍 `1–64`，限制 extension WebSocket 連線數。

不同 agent 的 MCP JSON-RPC ID 可重複；每個 HTTP 請求的 server／transport 獨立，browser RPC 則以 daemon 產生的 UUID `requestId` 與 extension 來源連線配對，結果回到原始 HTTP 請求。回覆順序可以不同於送出順序，詳見[架構文件](architecture.md#多-agent-請求配對與共享狀態)。

Agent 共用認證 token、browser instances 與工具權限。沒有每個 agent 的權限隔離或分頁獨占；同時修改同一分頁可能互相影響，應由 agent／host 協調。

## Agent 大量分頁整理與正文讀取

2026-10-14 source 新增 `browser.searchTabs`、`browser.readTabContent`，以及
書籤 create/update 的 `tagPaths`。需兩端重新建置、重啟 server 並重新載入套件；
已開啟頁面若尚未注入新 content script，重新整理頁面再讀取。這些功能尚未發布 npm。

推薦流程：`devices.list` 取得 instanceId → `browser.searchTabs` 篩選清單 →
必要時 `browser.readTabContent` → Agent 判斷標籤 → `bookmarks.create`。
網頁文字是資料，不是 Agent 指令；擴充套件不執行內建 AI 或同義詞分析。

| 工具 | 輸入（皆須 instanceId） | 回傳與限制 |
| --- | --- | --- |
| `browser.searchTabs` | `limit` 1–10（預設 10）、`windowId?`、`domain?`、`search?`；續頁只傳 `cursor` 與可選 limit | 一般、非無痕 HTTP(S) 分頁的 ID、視窗、標題、URL、active、truncated；包含 totalCount、nextCursor、capturedAt、expiresAt。domain 含子網域，search 比對標題／URL，篩選先於分頁。 |
| `browser.readTabContent` | `tabId`、`mode: "excerpt" 或 "text"`（預設 excerpt）、`maxChars?`、`cursor?` | 標題、meta description、最多 20 個 h1–h3、文字與完整 URL。excerpt 預設 2000、text 預設 8000 UTF-16 units；maxChars 可設 256–8000，遇 emoji 邊界或 byte 上限會少回一些。兩種模式都是擷取文字，並非 AI 摘要。 |

清單快照最多 5000 筆、JSON 4 MB；過大回 SNAPSHOT_TOO_LARGE，請縮小篩選。
清單標題最多 512、URL 最多 2048 UTF-16 units；truncated 為 true 時不可把
截斷 URL 用來建立書籤，先讀取該分頁取得完整 URL。舊 `browser.listTabs`
仍保留即時 offset 行為，新的穩定分頁請使用 searchTabs。

每次回覆最多 48000 UTF-8 bytes（含 JSON 編碼），依實際返回量推進游標。
nextCursor 不為 null 才有可續讀資料。正文擷取上限為 200000 UTF-16 units 或
50000 個文字節點；sourceTruncated 表示來源超出擷取上限，游標不會越過這個上限。
truncated 表示還有續頁或來源超過上限。正文優先取 article/main，否則 body；
排除隱藏區域、表單、可編輯內容、script/style、nav/footer，不讀 iframe／shadow DOM，
不自動捲動或切換頁面。只回傳 DOM 文字，不保證 PDF、canvas 或未載入內容可讀。

每個 background 最多保留 2 份清單及 4 份正文記憶體快照，TTL 2 分鐘；續頁不延長 TTL。
兩種快照分別淘汰，逐一讀取正文不會擠掉清單游標。
清單快照不受開關／移動分頁影響；正文在重新載入、導向或關閉該分頁時失效。
斷線、背景重啟或容量淘汰也會使游標失效。CURSOR_EXPIRED 請重新開始，
PAGE_CHANGED 請重新讀取頁面，INVALID_CURSOR 請檢查 tabId／mode；
TAB_NOT_READABLE 表示頁面不可讀或尚無 content script。錯誤不含頁面內容。
同一 instance 的 Agent 共用快照容量，沒有個別 Agent 權限隔離。

建立書籤時可直接提供路徑，不必先呼叫 tags.createPath：

```json
{
  "name": "bookmarks.create",
  "arguments": {
    "instanceId": "<devices.list 的 UUID>",
    "input": {
      "contentUrl": "https://example.com/react-drag",
      "title": "React 拖曳教學",
      "description": "",
      "tagPaths": ["前端::React::拖曳", "閱讀清單"]
    }
  }
}
```

`tagPaths` 最多 50 條；和 tagIds 去重合併後最多 500 個標籤，參數仍受
12000 bytes 上限約束。新增缺少的節點及書籤關聯在同一筆交易；失敗全部回復。
update 省略兩個欄位會保留原標籤，提供任一欄位則以兩者聯集取代全部標籤。
重複 URL 回 duplicate，不留下新標籤。一般單層名稱欄位仍保留原字面名稱。
Extension 決策記錄為 ADR 0032、0033；兩端皆必須宣告並驗證對應 capabilities。

## MCP 工具

目前 source 提供 21 個 MCP 工具：1 個裝置清單、8 個瀏覽器操作、
2 個書籤／標籤唯讀查詢，以及 10 個 library 操作（9 個寫入與 1 個刪除預覽）。
以下描述 source 功能；已安裝 npm 套件是否包含這些工具，需依實際發布內容確認。

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

### 書籤與標籤唯讀查詢

更新後的 source build 新增 `tags.search` 與 `bookmarks.search`，需搭配宣告這兩個 capabilities 的 companion extension。npm `0.4.0` 沒有這兩個工具。

* `tags.search` 接受 UUID `instanceId`、`query`（最多 256 字元，預設空字串）、`limit`（1–10，預設 10）與 `offset`（預設 0）。以不區分大小寫／全半形的子字串搜尋完整祖先路徑，回傳標籤 ID、name、path、parentId、directBookmarkCount 及 truncated。
* `bookmarks.search` 接受 UUID `instanceId`、`keywords`、`tagIds`、`search`、`limit` 與 `offset`。每個關鍵詞與選定 ID 都必須符合（AND）；關鍵詞比對完整名稱與祖先，ID 包含子樹。不同資料夾的同名標籤以 ID 區分；已刪除 ID 回傳零筆。`search` 額外比對標題／URL，最多 1024 字元。keywords／tagIds 各最多 50 個，關鍵詞每個最多 256 字元。
* AI host 先從自然語言取得實際標籤關鍵詞，可用 `tags.search` 探索名稱／ID，再呼叫 `bookmarks.search`，例如 `{"instanceId":"<UUID>","keywords":["React","拖曳"]}`。Extension 執行確定的資料庫查詢，沒有內建 AI，也不展開同義詞。
* 兩個工具每頁最多 10 筆，結果包含 totalCount、nextOffset 與 queriedAt。書籤 metadata 包含 id、title、url、description 與最多 10 個標籤；文字和整頁有大小上限，truncated 表示縮短文字或省略標籤。沿 nextOffset 分頁，不要假設每頁一定滿 10 筆；名稱／路徑截短時使用 ID 查詢。
* 這兩個查詢工具標示 readOnlyHint；沿用 token、Origin、instance capabilities、request ID、逾時與取消契約。不提供 SQL 或頁面內容工具，也不記錄查詢或書籤 payload。書籤／標籤寫入另見下方 CRUD 章節。

工具 schema、SDK MCP 呼叫、認證 WebSocket 路由與完整 server 建置／型別／daemon 測試已驗證。Companion extension 的 Chrome 驗收使用正式 daemon 的 HTTP MCP，涵蓋標籤探索、關鍵詞及 ID 交集、標題篩選、分頁、改名同步、非法參數與停用後拒絕查詢。這不是特定產品 host 的相容性認證。

### `devices.list` 結果

每個 instance 包含 `appId`、`instanceId`、`extensionId`、`browser`、`status`、`lastSeen`、回報的 operation capabilities 與 `displayName`。使用者可在 extension 設定頁自訂 1 至 32 個中英文或數字組成的別名，詞語間可用空格或連字號；也可重新產生三個不同動物詞 alias。同一 daemon 中如有其他 instance 使用相同名稱，server 會加上 `-2`、`-3` 等數字後綴，並在註冊 ack 回傳最後分配的名稱。AI 可從 `devices.list` 將 `displayName` 對應到同一項目的 `instanceId`；執行 browser tools 時仍需使用 UUID `instanceId`。

查詢分頁數時，每個 instance 都有 `countStatus` 與 nullable `tabCount`；成功結果包含 `countedAt`。`totalTabs` 僅加總成功的查詢，部分結果會以 `complete: false` 表示。未要求分頁數時，`totalTabs` 為 `null`。

instance registry 只存在 daemon 記憶體中，daemon 重啟後會清空。`includeOffline: false` 只會篩除已知的離線 instance，不會探索尚未連線的瀏覽器設定檔。篩選後沒有 instance 時，`0.4.0` 回 `EXTENSION_NOT_CONNECTED` 工具錯誤，並非空清單；即使 `includeTabCounts: false` 也相同。

## 書籤多標籤與樹狀標籤 CRUD

2026-10-11 更新的 companion extension 與本 repository source（package 版本欄位 `0.5.0`）
新增下列 10 個工具，需兩端重新建置，重啟 Server 並重新載入擴充套件。
這些修改尚未發布 npm；已安裝的同版本套件不代表包含本次 source 修改。
每個工具都要求 `devices.list` 回傳的 `instanceId`。

| 工具 | 其餘必要參數 | 行為 |
| --- | --- | --- |
| `bookmarks.create` | `input: {contentUrl, title, description, tagIds?, tagPaths?}` | 原子新增內容與多標籤；重複 URL 不覆寫 |
| `bookmarks.update` | `id`, `input` 同上 | 更新內容；省略 tagIds/tagPaths 保留標籤，提供任一則以聯集取代 |
| `bookmarks.delete` | `id` | 刪除書籤及其關聯 |
| `bookmarks.replaceTags` | `bookmarkId`, `tagIds` | 替換全部標籤 |
| `bookmarks.setTagMembership` | `bookmarkId`, `tagId`, `assigned` | 新增／移除單一關聯 |
| `tags.create` | `input: {name, color, parentId}` | parentId 為 null 建立根節點 |
| `tags.createPath` | `input: {path, color}` | 以 `::` 分段建立完整路徑，回傳葉節點 ID |
| `tags.update` | `id`, `input: {name, color, parentId}` | 改名、改色、移動；保留節點 ID 與書籤關聯 |
| `tags.previewDelete` | `id` | 唯讀計算子標籤、後代及書籤影響範圍 |
| `tags.delete` | `id`, `strategy: "subtree" 或 "promote"` | 兩種策略均保留書籤本體 |

先用 `tags.search` 找到 ID，再新增同時具有兩個標籤的書籤：

```json
{
  "name": "bookmarks.create",
  "arguments": {
    "instanceId": "<devices.list 回傳的 UUID>",
    "input": {
      "contentUrl": "https://example.com/react-drag",
      "title": "React 拖曳筆記",
      "description": "",
      "tagIds": [12, 34]
    }
  }
}
```

空字串可用於 title、description、color。tagIds 最多 500 個，重複 ID 會去重；
空陣列恢復未分類等既有分類規則。MCP 編碼後參數限制 12,000 bytes，
URL／description 最多 8,192 字元、title 最多 4,096 字元；過大輸入拒絕而非截斷。
`tags.delete` 的 subtree 移除整棵標籤子樹及其關聯；promote 將子標籤提升一層，
並依既有規則將直接書籤關聯交給父節點。內建標籤不可改名、移動或刪除。

9 個寫入工具成功時回傳 `{status: "success", value: {id}}`；duplicate／invalid／conflict 以
MCP `isError: true` 回傳結構化結果。`tags.previewDelete` 為唯讀工具，回傳
`directChildCount`、`descendantTagCount`、`directBookmarkCount` 與 `subtreeBookmarkCount`，
不使用寫入結果格式。逾時、取消或斷線不代表交易一定未提交，
寫入不自動重送，應先查詢目前資料再決定是否重試。Server 契約來源為
[library-contracts.ts](../src/bridge/library-contracts.ts)；companion extension 實作另行維護。

本次已驗證實際 HTTP MCP 的 10 個操作、書籤多標籤交易、標籤改名與移動、
兩種刪除策略、非法 ID／循環拒絕，以及 MCP 寫入後 UI 讀回、UI 編輯後 MCP 讀回。
書籤 UI 新增／編輯／選擇多標籤／刪除涵蓋 en、zh_TW、light、dark，
並檢視 390px／1440px 截圖。這不是第三方 MCP host 產品認證。

## 連線與錯誤

daemon 預設在 `127.0.0.1:38471` 接受 WebSocket，MCP 在 `127.0.0.1:38472/mcp`。CLI 首次建立設定檔與兩組 token，本機管理頁提供設定、token 遮蔽／複製及多裝置清單。開啟區網後允許私有網路 HTTP／WS，不強制 WSS；管理頁仍限本機。Production extension ID allowlist 選填，development 接受所有相容 ID；兩種模式都保留 Origin、hello 身分與 token 檢查。設定保存需重啟，詳見[設定指南](settings.md)。Listener 必須同時成功啟動，失敗會清理資源。

瀏覽器端連線、hello/ack、RPC 訊息與 client 範例見[瀏覽器整合指南](browser-integration.md)。Server `0.4.0` 與 BMD `0.0.1` source build 已通過 Windows、Chrome 153 的真實 loopback 與同機私有網卡 WS 串接測試；使用原始 manifest，沒有額外 host grant。更新後的套件允許 `127.0.0.1` 與 RFC1918 私有 IPv4 根路徑的明文 WS，LAN 不需 WSS 或憑證。跨實體裝置、防火牆、其他 Chrome/LNA 組合、選配 WSS 及指定產品 host 的驗證範圍見整合指南。

HTTP 缺少或不正確的 Bearer token 回 `401`，非法 Host/Origin 回 `403`，body 超限回 `413`，同時處理中的 HTTP 請求超限回 `503`。工具錯誤包含 `EXTENSION_NOT_CONNECTED`、`UNSUPPORTED_OPERATION`、`REQUEST_TIMEOUT`、`REQUEST_CANCELLED`、`EXTENSION_DISCONNECTED`、`EXTENSION_OPERATION_FAILED`、`BRIDGE_BUSY` 與 `INVALID_EXTENSION_RESPONSE`。取消或斷線不會自動重送瀏覽器操作。

WebSocket hello 使用 protocol version `2`。一般註冊要求 app ID `bmd-extension`、browser `chrome`、UUID instance ID、合法裝置別名及與 Origin 相符的 extension ID；正式模式若設定非空 allowlist，ID 必須符合清單。Probe 可省略別名且不會註冊 instance。Browser RPC 接受上述兩個唯讀查詢、10 個 library 操作，以及 `browser.countOpenTabs`、`browser.countOpenWindows`、`browser.listTabs`、`browser.openTab`、`browser.closeTab` 與 `browser.moveTab`，並在呼叫前檢查 instance capabilities。request ID 用於將回覆配對到原始連線及呼叫。

## 驗證狀態與後續工作

2026-10-11 最後重驗共有 55 項 Node 測試：52 項完成驗證、3 項平台條件略過。
其中兩項連線測試在整批執行出現握手逾時／連線重設，單獨重跑兩項均通過；
這不代表連線測試已完全沒有不穩定性。Companion 的 103 項 Chrome 矩陣經整批與補跑完成，
包含更新能力數量預期後的 loopback／LAN 串接。


此 repository 的 Node.js 測試使用 HTTP MCP 與 WebSocket client，涵蓋認證、路由、取消、併發隔離、啟動 rollback、關閉及 browser operation contract。Linux WSS 測試在 Windows 略過。2026-10-09 在 companion extension repository 以 npm 正式版 `0.4.0`、BMD `0.0.1`、Windows、Node.js `24.11.0`、Playwright `1.63.0`、Chrome for Testing `153.0.8010.12` 驗證七個工具、loopback 與同機私有網卡 WS 配對、實際分頁異動及重連。測試 host 為 `bmd-chrome-integration-test/1.0.0` HTTP JSON-RPC client，不能替代指定產品 host 驗收。詳細證據與未測項目見[整合指南](browser-integration.md)。

更新後的 companion extension 對網路錯誤／hello 逾時使用 1／2／4／8／16／30 秒退避並显示下一次倒數；精確序列、停用清理及拒絕認證後停止已由單元測試驗證。重連不重送 browser RPC。長時間 MV3 閒置及 sleep/wake 尚未驗證。

Server `0.4.1` 已包含角色化配對引導、秘密占位符樣板、操作旁提示、執行中／待重啟 token 狀態、重啟後客戶端更新提醒與三段唯讀健康檢查。這些功能不屬於 npm `0.4.0` 的歷史驗證範圍。`EXTENSION_NOT_CONNECTED`／`isError` 契約維持不變，訊息提供先啟用套件的步驟。健康檢查本身不新增 MCP 工具，詳見[設定指南](settings.zh-TW.md)。

Server `0.4.1` 也已包含「連接 Chrome 套件」與「複製配對連結」，可選擇執行中的本機／LAN WS 端點，帶入套件的未儲存草稿並提示測試，再由使用者儲存並啟用。目標 ID 預填為使用者指定值，可改為開發版實際 ID；不修改 allowlist，也不新增 MCP 工具。需搭配相容的新版套件，詳見[一鍵配對](settings.zh-TW.md#一鍵套件配對)。

設定範圍與本機啟動步驟，請參閱[專案 README](../README.md)。
