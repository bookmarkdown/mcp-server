---
title: "瀏覽器整合指南"
description: "瀏覽器 extension 連線至 BookMarkdown MCP Server 本機或私有區網 WebSocket 協定與 client 範例。"
ms.date: 2026-10-09
ms.topic: how-to
---

## 狀態與驗證範圍

2026-10-09 已使用 npm 發布的 `@bookmarkdown/mcp-server@0.4.0`、BMD extension `0.0.1` source build（基線 `666c2a5` 加上 LAN WS 修改）、Windows、Node.js `24.11.0`、npm `11.4.1`、Playwright `1.63.0` 與 Chrome for Testing `153.0.8010.12` 完成本機與同機私有網卡的真實 WS 串接。Host 是 `bmd-chrome-integration-test/1.0.0` 的 HTTP JSON-RPC client，MCP initialize 協定為 `2025-11-25`，WebSocket 協定為 `2`；並非 Codex、Claude Desktop 或 VS Code 的產品測試。

永久測試在 sibling extension repository 的 `e2e/mcp-integration.spec.ts` 與 `e2e/mcp-server.ts`。兩個情境分別使用 loopback 與 server LAN 模式廣告的 RFC1918 網卡 URL，並各自驗證下表的配對、工具及重啟流程。測試使用原始 production manifest，沒有增加 host grant、LNA bypass、寬鬆 CSP 或 fake extension；兩種 WS 均可直接連線。這不代表最低 Chrome 116、其他 Chrome 版本、跨實體電腦 LAN 或選配 WSS 已驗證。Firefox 依 extension ADR 0012 延後。

上述 npm `0.4.0` 為歷史 WS 基線：companion extension 199 項單元測試、完整 65 項 Chrome E2E、compile/build 通過，125 張附件截圖已檢視。新配對引導、輪替提醒與三段健康檢查已加入目前 source，但尚未發布；完整驗收另用更新後 server source build，不把新功能算入已發布版本。

2026-10-09 更新後的 source 驗收：server typecheck/build 通過，Node 測試 47 項中 44 項通過、3 項 Linux WSS／Unix symlink 情境在 Windows 略過。Companion extension 202 項單元測試、compile/Chrome build、完整 69 項 Chrome E2E 通過，152 張附件截圖已檢視。Server HTTP shutdown／upgrade socket 清理修正後，使用最終 build 重跑本機 WS、LAN WS 與四項 P1/P2 UI 情境，6 項全通過、35 張截圖全數檢視；英文／繁中、390px／1440px、亮／暗主題均無水平溢出。健康檢查實際經過 HTTP initialize、tools/list 與已註冊套件的唯讀計數；沒有增加 MCP 工具或瀏覽器異動操作。

| 情境 | 證據／結果 |
| --- | --- |
| 管理頁、套件設定頁與註冊 | 兩組 token 分離、錯誤 token、probe、保存、啟用、別名與 server 裝置清單已驗證。Probe 不會註冊裝置。 |
| 七個 MCP 工具 | initialize、tools/list、devices.list 及六個分頁／視窗工具通過；Chrome API 核對實際 tab/window ID 與異動結果。 |
| 讀取 | devices.list 含計數、分頁／視窗計數、listTabs limit/offset 分頁通過。 |
| 異動 | 空白與指定 URL 的 openTab、跨視窗 moveTab、closeTab 通過；同視窗移動被拒絕。 |
| 生命週期 | server 重啟與 Chrome 同 profile 重啟後重新註冊，UUID 保持不變；停用後工具回 EXTENSION_NOT_CONNECTED。 |
| UI、輸出 | 英文桌面、繁中 390px 設定頁與 server 桌面／窄版無水平溢出；page/background console 無錯誤，daemon stdout 空白、stderr 不含 token。 |
| 尚未驗證 | 真實遠端 WSS/TLS 信任、跨機器 LAN/防火牆、incognito 真實視窗、長時間 MV3 閒置與 sleep/wake、Chrome 116、指定產品 host。Node contract／單元測試不能替代以上證據。 |

Browser integration 文件應涵蓋的範圍與維護規則見[文件規約](documentation-conventions.md)。

## 實際設定流程

1. 安裝 Node.js `22.23.3` 以上版本。新版管理頁使用已建置 source checkout 的 `npm start`；WS 基線可執行 `npx -y @bookmarkdown/mcp-server@0.4.0`。保持終端機開啟，首次產生設定檔及兩組 token，不需先設定 ENV 或 extension ID。
2. 開啟終端機列出的管理頁，通常是 `http://127.0.0.1:38472/`。從「瀏覽器套件」卡片複製 WebSocket URL 與配對 token。
3. 在 BMD「設定 → MCP」貼入上述兩個值，按「測試連線」；成功表示 token 與 WebSocket v2 probe 通過，尚未保存或註冊裝置。
4. 按「儲存並啟用」，或先「儲存」再勾選「保持 bridge 連線」。步驟列分清驗證、儲存與註冊。套件顯示「已連線」，管理頁出現裝置名稱才算持久連線完成；別名設定放在配對後，UUID 跨重連保持不變。
5. 將管理頁「Agent」卡片的 HTTP URL 與 MCP Bearer token 填入支援 Streamable HTTP 的 host。不要把 pairing token 用作 HTTP Bearer；具體 host JSON 欄位依產品而異。Host 不會自動啟動 daemon。
6. 呼叫 `devices.list` 取得 instance UUID，再呼叫 browser tools。`devices.list` 在篩選後沒有裝置時回 `EXTENSION_NOT_CONNECTED`，不是空陣列；管理頁此時仍可正常使用。

| 欄位 | 使用者 | 預設 URL／用途 |
| --- | --- | --- |
| HTTP MCP URL + MCP token | Agent / MCP host | `http://127.0.0.1:38472/mcp`，每次請求傳 Authorization Bearer。 |
| WebSocket URL + 配對 token | Chrome 套件 | `ws://127.0.0.1:38471/`，token 放 hello 訊息，不能放 URL。 |
| 管理頁 URL | 啟動 daemon 的電腦 | `http://127.0.0.1:38472/`，不用貼到套件 endpoint 欄位。 |

Server 設定保存與 token 重建後，重啟才生效。重啟前複製／顯示按鈕仍取執行中 token，並標示待生效角色；重啟後提醒更新 Agent 與先前已知裝置。提醒只在管理瀏覽器同源 localStorage 保存無秘密的角色、設定／process 身分及最多 64 個裝置別名／UUID，使用者確認後隱藏；不是 server 端客戶端確認 registry。改 origin／port、清除／禁用儲存或換瀏覽器可能使提醒不保留，詳見[設定指南](settings.md)。

管理頁明確觸發健康檢查時，以執行中 HTTP MCP URL／token 執行 initialize、tools/list 及選定線上裝置的 `browser.countOpenTabs`，六秒總逾時。三段狀態分開 HTTP 可用、已註冊與讀取通過；沒有裝置時讀取不執行。此操作不異動分頁、不新增 MCP 工具，也不能代替指定產品 host 的設定驗收。

## 難度、取捨與 UX

同機串接評估為低到中：已安裝 Node 與 extension 時，不需固定 ID、ENV 或憑證，但需要分辨兩組 URL/token，並完成測試、保存、啟用。新手或另一種 MCP host 為中等：涉及 Node 安裝、終端機生命週期與 HTTP/Bearer 支援。可信任 LAN 串接為中等：啟用 server LAN、重啟、使用私有 IPv4 的 WS URL 即可，不需憑證；跨實體裝置仍需確認防火牆與路由。這些是流程的質性評估，沒有做新手耗時或可用性研究。

優點：單一 daemon 共用多裝置／agent、extension 主動連線、獨立 tokens、穩定 UUID、受限工具與 schema、逾時／斷線不重播異動。代價：需維持 daemon 執行、token 為本機明文設定、agent 共用權限與額度、沒有同一分頁操作鎖；只提供七個分頁／裝置工具，未提供 MCP 書籤／標籤 CRUD 或跨裝置搬移瀏覽器 session。

以下 P1/P2 已加入目前 source，維持本機／LAN WS 與現有認證邊界：

| 優先級 | 實際問題 | 改善與驗收方向 |
| --- | --- | --- |
| 已處理 | Server LAN WS URL 與原套件 TLS 規則不相容。 | 依 2026-10-09 使用者決定，更新 BMD endpoint 驗證、兩種語系與文件；本機／RFC1918 LAN WS 不強制 TLS，保留 token 與來源檢查。 |
| P1 | 分清 token 與配對階段 | 角色引導及秘密占位符樣板、明確 Save and enable、操作旁提示；token 標示執行中／待生效與重啟後更新提醒。 |
| P1 | 無裝置仍可設定 | 保留 `EXTENSION_NOT_CONNECTED`／`isError` 契約並提供先啟用套件的具體步驟，不改成空陣列。 |
| P2 | 診斷與退避 | 三段唯讀健康檢查、可操作的網路／token／選用 TLS／LNA 檢查及實際重試倒數；泛用網路錯誤不斷言原因，異動不重送。 |

完整要求、重跑指令及最新驗收見 [sibling extension 整合指南](../../bmd-extension/docs/mcp-integration.md)。新版需先建置本 repository，將 `E2E_MCP_SERVER_DIR` 指向 source checkout 並設定 `E2E_MCP_UX=true`，再從 extension 執行 `pnpm run test:e2e --workers=1 '--reporter=list,html'`。只使用 npm `0.4.0` 則不能啟用新版 UX 情境。Harness 建立獨立 config、隨機 port 與 Chrome profile，最後只清理自己的狀態。

## Agent 連線

Agent 直接透過 daemon 的 MCP Streamable HTTP `/mcp` endpoint 呼叫，不再啟動 stdio proxy 或使用 IPC。預設 HTTP URL 為 `http://127.0.0.1:38472/mcp`，使用獨立的 `BOOKMARKDOWN_MCP_TOKEN` Bearer header。Extension 仍透過下列 WebSocket contract 與 `BOOKMARKDOWN_BRIDGE_TOKEN` 配對；其協定版本與 browser RPC 不變。HTTP 設定見 [README](../README.zh-TW.md)。

## 連線條件

預設使用 loopback WebSocket URL：

```text
ws://127.0.0.1:38471/
```

預設 host 為 `127.0.0.1`，port 為 `38471`。CLI 管理頁可開啟區網模式，重啟後 HTTP／WS 綁定 `0.0.0.0` 並列出私有 IP URL，不要求 TLS。`BOOKMARKDOWN_WS_HOST` 仍可指定單一 RFC1918 IPv4；TLS certificate/key ENV 為選填且須同時設定，使用時提供 WSS（TLS 1.2 以上）。詳見[設定指南](settings.md)。

Server 要求 Host 符合 listener 實際 port 與本機／私有介面 IP，path 為 `/`，peer 為本機／RFC1918 位址。Origin 必須符合 `chrome-extension://[a-p]{32}` 並與 hello ID 一致；Origin 不是認證。Production allowlist 為選填，留空接受所有相容 ID；development 不使用固定 allowlist。所有連線仍需正確 token。HTTP／WS 區網資料未加密，適用可信任的區網。

本機與可信任 LAN 使用 WS 即可，不需 TLS 憑證。更新後的 BMD source build 接受 `127.0.0.1`、`10.0.0.0/8`、`172.16.0.0/12`、`192.168.0.0/16` 的根路徑明文 WS；不接受公開 IP 明文 WS、帳密、query 或 fragment。`localhost`、`::1` 與 LAN DNS 名稱仍不在明文端點範圍，使用管理頁列出的 numeric 私有 IPv4 URL。Server 開啟 LAN、儲存並重啟後，可將 `ws://<server-private-ip>:38471/` 與配對 token 填入套件，測試、儲存並啟用。若選擇 WSS，憑證須涵蓋設定 IP，且 client 裝置信任簽發者；WSS 是選配。防火牆只需開放使用的 LAN port，驗證證據與跨實體裝置限制見上方狀態表。

正式模式只有設定非空的 `BOOKMARKDOWN_EXTENSION_IDS` 時，才要求 ID 精確符合清單。開發模式不要求固定 allowlist，但 ID 仍須符合格式。兩種模式都要求 hello 的 `extensionId` 與 Origin ID 完全相同，並驗證 pairing token。無效的 Host、path、Origin 或正式模式 allowlist ID 會在 WebSocket upgrade 階段回覆 HTTP `403`，不會收到 `hello-ack`；連線數已達上限時回覆 HTTP `503`。

## 配對與 hello

CLI 首次啟動建立配對 token 並保存在使用者設定檔。從本機管理頁複製目前執行中的 token 給 extension，或以 `BOOKMARKDOWN_BRIDGE_TOKEN` 覆寫。ENV token 支援 32–512 UTF-8 bytes；設定檔使用 32–512 可列印 ASCII 字元。Token 不放入 URL、命令列參數、log、MCP 回覆或 source control。

WebSocket 開啟後，client 必須在預設 5 秒內送出第一則文字 JSON `hello`。一般連線需包含以下欄位，schema 不接受額外欄位：

* `type` 固定為 `hello`，`protocolVersion` 固定為 `2`。
* `appId` 固定為 `bmd-extension`，`browser` 固定為 `chrome`。
* `instanceId` 是 UUID；同一個邏輯 instance 重連時應沿用此 ID。
* `displayName` 可由使用者自訂為 1 至 32 個中英文、數字、空格或連字號，也可使用 extension 產生的三個動物詞 alias。Server 遇到重名時會加上數字後綴，並在成功 ack 回傳最終名稱。
* `extensionId` 是 32 個小寫 `a` 至 `p` 字元，且必須等於 Origin 中的 ID。
* `token` 是 daemon 設定的 pairing token。
* `capabilities.operations` 列出 client 支援的操作。只列出 extension 已實作的 operation；browser tools 會依此欄位檢查能力。

成功的 `hello-ack` 會提供 server 產生的 `connectionId` 和最終分配的 `displayName`，連線隨後成為已註冊 instance：

```json
{
  "type": "hello-ack",
  "ok": true,
  "protocolVersion": "2",
  "connectionId": "<server-generated-uuid>",
  "displayName": "otter-fox-panda"
}
```

拒絕時的形狀如下。`mode` 只會在 hello 使用 `mode: "probe"` 且該欄位可被解析時出現：

```json
{
  "type": "hello-ack",
  "ok": false,
  "protocolVersion": "2",
  "reason": "unauthorized"
}
```

server 目前使用的拒絕原因如下：

* `hello-timeout`：未在期限內送出 hello。
* `invalid-hello`：訊息為 binary、JSON 無效或不符合 schema。
* `unauthorized`：pairing token 不符。
* `unsupported-protocol-version`：協定版本不是 `2`。
* `unsupported-client`：`appId` 或 `browser` 不受支援。
* `extension-id-mismatch`：hello 的 extension ID 與 Origin 不符。
* `invalid-probe`：probe hello 宣告了非空的 operations。
* `instance-identity-conflict`：相同 app 與 instance ID 已使用另一個 extension ID 註冊。
* `instance-limit-reached`：已達註冊 instance 上限。

收到拒絕 ack 後，server 以 close code `1008` 關閉連線。無效 Origin 等 upgrade 階段拒絕不會產生上述 ack。

### Probe

`mode: "probe"` 是選用的連線檢查，不是一般註冊所需。probe 必須通過相同的 token、版本與 client 驗證，且 `capabilities.operations` 必須是空陣列；probe 不需要 `displayName`。成功 ack 為 `type: "hello-ack"`、`mode: "probe"`、`ok: true` 與 `protocolVersion: "2"`，不包含 `connectionId`；server 送出 ack 後以 close code `1000`、reason `probe-complete` 關閉連線，也不會註冊 instance。

## Browser RPC operations

每個 MCP browser tool 都以 `instanceId` 指定已連線的 extension instance。daemon 只會送出下列 allowlist 中的 operation，且 instance 的 `capabilities.operations` 必須宣告該名稱，否則 MCP call 回 `UNSUPPORTED_OPERATION`。WebSocket `payload` 不包含 `instanceId`，由 daemon 依連線路由。

計數與清單只涵蓋一般視窗和分頁。Extension 必須排除 incognito 視窗與分頁，因為 server 無法檢查 extension 回傳的瀏覽器資料。`browser.openTab` 的目標、`browser.closeTab` 的分頁，以及 `browser.moveTab` 的來源和目的地也必須依一般視窗政策處理；`moveTab` 只支援跨視窗移動，不提供同視窗排序或 index。

> [!WARNING]
> 分頁標題與 URL 可能包含敏感資訊，會由 MCP tool 回傳給呼叫端。只回傳下列有界 metadata，不讀取頁面內容，也不要記錄標題、URL 或 operation payload。

`tabId`、`windowId` 與 `targetWindowId` 都是非負安全整數。所有 success `data` 都使用 strict schema；多餘欄位或無效結果會被拒絕。

### `browser.countOpenTabs`

請求的 `payload` 是空物件；結果只包含一般視窗的分頁數和 ISO 8601 時間戳記：

```json
{
  "type": "browser/request",
  "requestId": "<server-generated-uuid>",
  "operation": "browser.countOpenTabs",
  "payload": {}
}
```

```json
{
  "type": "browser/response",
  "requestId": "<same-request-uuid>",
  "ok": true,
  "data": { "count": 4, "countedAt": "2026-09-28T12:00:00.000Z" }
}
```

### `browser.countOpenWindows`

請求的 `payload` 是空物件；結果格式與分頁計數相同，但只計算一般視窗：

```json
{
  "type": "browser/request",
  "requestId": "<server-generated-uuid>",
  "operation": "browser.countOpenWindows",
  "payload": {}
}
```

```json
{
  "type": "browser/response",
  "requestId": "<same-request-uuid>",
  "ok": true,
  "data": { "count": 2, "countedAt": "2026-09-28T12:00:00.000Z" }
}
```

### `browser.listTabs`

`limit` 預設為 `10`，範圍為 `1` 至 `10`；`offset` 預設為 `0`，必須是非負安全整數。每頁最多 10 筆。`title` 最多 512 個字元且 1024 UTF-8 bytes；`url` 最多 2048 個字元且 2048 UTF-8 bytes。若還有資料，`nextOffset` 必須是本頁結尾的 offset；否則為 `null`。

```json
{
  "type": "browser/request",
  "requestId": "<server-generated-uuid>",
  "operation": "browser.listTabs",
  "payload": { "limit": 10, "offset": 0 }
}
```

```json
{
  "type": "browser/response",
  "requestId": "<same-request-uuid>",
  "ok": true,
  "data": {
    "tabs": [
      {
        "tabId": 12,
        "windowId": 7,
        "active": true,
        "title": "Example",
        "url": "https://example.invalid/"
      }
    ],
    "nextOffset": null,
    "queriedAt": "2026-09-28T12:00:00.000Z"
  }
}
```

### `browser.openTab`

`url` 和 `windowId` 都可省略；省略 URL 表示開啟 `about:blank`。若提供 URL，必須是無 username/password 的絕對 HTTP 或 HTTPS URL；提供的 `windowId` 必須屬於一般視窗。省略 URL 時，response 的 `url` 必須是 `about:blank`。

```json
{
  "type": "browser/request",
  "requestId": "<server-generated-uuid>",
  "operation": "browser.openTab",
  "payload": { "url": "https://example.invalid/", "windowId": 7 }
}
```

```json
{
  "type": "browser/response",
  "requestId": "<same-request-uuid>",
  "ok": true,
  "data": { "tabId": 24, "windowId": 7, "url": "https://example.invalid/" }
}
```

省略 URL 時，request payload 可以是 `{}`，成功結果的 URL 為 `about:blank`：

```json
{
  "type": "browser/response",
  "requestId": "<same-request-uuid>",
  "ok": true,
  "data": { "tabId": 25, "windowId": 7, "url": "about:blank" }
}
```

### `browser.closeTab`

```json
{
  "type": "browser/request",
  "requestId": "<server-generated-uuid>",
  "operation": "browser.closeTab",
  "payload": { "tabId": 24 }
}
```

```json
{
  "type": "browser/response",
  "requestId": "<same-request-uuid>",
  "ok": true,
  "data": { "tabId": 24, "closed": true }
}
```

### `browser.moveTab`

`targetWindowId` must identify a different normal window from the tab's current window. Same-window movement and reorder/index behavior are not supported.

```json
{
  "type": "browser/request",
  "requestId": "<server-generated-uuid>",
  "operation": "browser.moveTab",
  "payload": { "tabId": 24, "targetWindowId": 9 }
}
```

```json
{
  "type": "browser/response",
  "requestId": "<same-request-uuid>",
  "ok": true,
  "data": { "tabId": 24, "sourceWindowId": 7, "targetWindowId": 9 }
}
```

### Response handling

所有 response 必須在收到 request 的同一條 WebSocket 上回覆，並沿用相同 UUID `requestId`。不同 socket 上的回覆、未知 ID 或逾時後才抵達的回覆會被忽略；多個請求可以依 UUID 配對，不必依送出順序回覆。

多個 agent 可同時透過 HTTP 呼叫同一 daemon，並使用相同的 MCP JSON-RPC `id`。該 `id` 與 WebSocket UUID `requestId` 是不同層級；extension 只需沿用收到的 WebSocket UUID，不需辨識 agent。Daemon 依 UUID 與來源 WebSocket `connectionId` 完成對應的 browser RPC，再由該呼叫原本的 HTTP response 回覆 agent，agent 不直接接收 extension WebSocket 訊息。

取消後才抵達的回覆也會被忽略。單一 HTTP 請求中斷只取消其等待；extension WebSocket 中斷則會影響所有等待該連線回覆的 browser RPC。配對機制不提供同一分頁的操作鎖定或跨 agent 順序保證，衝突操作需由 agent／host 協調。共享額度與完整流程見[架構文件](architecture.md#多-agent-請求配對與共享狀態)。

操作失敗時可回覆下列 strict error shape。`name` 與 `code` 不可為空且最多 128 字元；`message` 最多 1024 字元。Server 會將 extension error 映射為 `EXTENSION_OPERATION_FAILED`，不會轉送敏感 payload。開啟、關閉或移動分頁若逾時或斷線，結果可能不明；server 不會自動重送。

```json
{
  "type": "browser/response",
  "requestId": "<same-request-uuid>",
  "ok": false,
  "error": {
    "name": "OperationError",
    "message": "The browser operation failed.",
    "code": "OPERATION_FAILED"
  }
}
```

## 瀏覽器端範例

以下只示範 handshake 與 RPC envelope。`browserOperations` 是 extension 自己提供的 adapter；其 implementation 必須遵守每項操作的 schema、一般視窗/incognito 規則與資料上限。此範例不宣稱任何 Chrome API 權限或 Local Network Access 已驗證。

```javascript
const supportedOperations = [
  "browser.countOpenTabs",
  "browser.countOpenWindows",
  "browser.listTabs",
  "browser.openTab",
  "browser.closeTab",
  "browser.moveTab",
];

function connectExtension(
  pairingToken,
  instanceId,
  browserOperations,
  webSocketUrl = "ws://127.0.0.1:38471/",
) {
  const operations = supportedOperations.filter((name) =>
    Object.hasOwn(browserOperations, name),
  );
  const socket = new WebSocket(webSocketUrl);
  let authenticated = false;

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({
      type: "hello",
      "protocolVersion": "2",
      token: pairingToken,
      appId: "bmd-extension",
      instanceId,
      "displayName": "otter-fox-panda",
      extensionId: chrome.runtime.id,
      browser: "chrome",
      capabilities: { operations },
    }));
  });

  socket.addEventListener("message", async (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }

    if (message.type === "hello-ack") {
      authenticated = message.ok === true && message.mode !== "probe";
      return;
    }
    if (
      !authenticated ||
      message.type !== "browser/request" ||
      !operations.includes(message.operation)
    ) {
      return;
    }

    const handler = browserOperations[message.operation];
    try {
      const data = await handler(message.payload);
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: "browser/response",
          requestId: message.requestId,
          ok: true,
          data,
        }));
      }
    } catch {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: "browser/response",
          requestId: message.requestId,
          ok: false,
          error: {
            name: "OperationError",
            message: "The browser operation failed.",
            code: "OPERATION_FAILED",
          },
        }));
      }
    }
  });

  return socket;
}

const instanceId = await getOrCreateStableInstanceId();
const socket = connectExtension(pairingToken, instanceId, browserOperations);
```

範例中的 `pairingToken` 由呼叫端安全提供。`getOrCreateStableInstanceId()` 是示意 helper；companion extension 會將 instance UUID 持久保存，並在重新連線時沿用。此範例只涵蓋一次連線和 request/response；實際 extension 的重連已在上述本機 server/Chrome 重啟情境驗證，未涵蓋長時間閒置與 sleep/wake。

## 逾時、關閉與限制

hello 預設須在 5 秒內送達；browser request 預設等待 5 秒，可用 `BOOKMARKDOWN_REQUEST_TIMEOUT_MS` 設定。WebSocket 預設 payload 上限為 64 KiB、同時連線上限為 8、in-flight request 上限為 32、註冊 instance 上限為 64。各項設定由 daemon 管理。

socket 中斷會讓該連線上的 pending request 失敗，instance 在 daemon 的記憶體 registry 中標為 offline；daemon 重啟時 registry 清空。相同 `instanceId` 與 extension ID 再次註冊會取代舊連線，舊 socket 以 close code `4001`、reason `replaced` 關閉；相同 instance ID 搭配不同 extension ID 則遭拒。連線逾時或中斷後，server 不會替 client 重連。

Server 不會替 client 重連。更新後的 companion extension 對網路錯誤／hello 逾時使用 1／2／4／8／16／30 秒退避（不加抖動），顯示實際 deadline；停用或認證／協定拒絕會停止，成功註冊後重設。精確序列及清理已由 fake-timer 單元測試驗證，Chrome 測試驗證倒數、重啟與換 token 恢復；不代表長時間 MV3 liveness 或 sleep/wake 已驗證。重連不重播 browser RPC。
原 manifest/CSP 在已測 Chrome 版本的 loopback 與同機私有網卡 WS 連線不需追加 host grant；其他版本、跨實體電腦 LAN、其他 LNA 位址類別、選配 WSS 與指定產品 host 仍需分別驗證。
