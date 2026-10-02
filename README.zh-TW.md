# BookMarkdown MCP Server

[English](README.md) | [繁體中文](README.zh-TW.md)

BookMarkdown MCP Server 讓 agent 直接透過 MCP Streamable HTTP 呼叫本機 daemon。Daemon 保留 browser extension WebSocket bridge；stdio proxy 與本機 IPC 已移除。

> [!IMPORTANT]
> 此 HTTP 模式尚未發布，請從原始碼建置。真實 Chrome、extension 與指定 MCP host 的相容性仍未驗證。

## 功能

Server 提供以下 MCP tools：

| 工具 | 說明 |
| --- | --- |
| `devices.list` | 列出執行中 daemon 已知的 extension instances，並可選擇查詢分頁數。 |
| `browser.countOpenTabs` | 計算指定連線 instance 一般視窗中的分頁數。 |
| `browser.countOpenWindows` | 計算指定連線 instance 的一般視窗數。 |
| `browser.listTabs` | 分頁回傳分頁 metadata，每次最多 10 個分頁。 |
| `browser.openTab` | 在一般視窗開啟分頁。 |
| `browser.closeTab` | 關閉一般視窗中的分頁。 |
| `browser.moveTab` | 將分頁移至另一個一般視窗。 |

分頁標題與 URL 可能包含敏感資訊。Server 不讀取頁面內容；extension 預期會排除 incognito 視窗與分頁。操作結果不明時，不會自動重送分頁變更操作。

詳見[功能與限制](docs/features.md)、[系統架構](docs/architecture.md)、[瀏覽器整合指南](docs/browser-integration.md)、[推送與發布流程](docs/pushing.md)及[文件規約](docs/documentation-conventions.md)。

## 需求

* Windows、Linux 或 macOS（macOS 需使用包含此變更的新版；`0.2.1` 與更早版本不支援 macOS）
* Node.js 22.23.3 或更新版本
* npm
* 相容的 companion browser extension，另行維護

## 從 npm 安裝

不需全域安裝，即可執行已發布的 CLI：

```bash
npx -y @bookmarkdown/mcp-server@latest
```

啟動 daemon 前，請先設定下方列出的必要環境變數。也可以選擇全域安裝：

```bash
npm install --global @bookmarkdown/mcp-server
bookmarkdown-mcp-server
```

## 從原始碼安裝

```bash
git clone https://github.com/bookmarkdown/mcp-server.git
cd mcp-server
npm ci
npm run build
```

啟動 daemon 前，請先設定下方列出的必要環境變數。

## 啟動 daemon

未提供子命令時，CLI 會啟動正式模式 daemon。正式模式需要高熵配對 token 與精確的 Chrome extension ID。Companion extension 必須透過其支援的設定流程使用相同 token。

```powershell
$env:BOOKMARKDOWN_MCP_TOKEN = (node -p "require('node:crypto').randomBytes(32).toString('hex')")
$env:BOOKMARKDOWN_BRIDGE_TOKEN = (node -p "require('node:crypto').randomBytes(32).toString('hex')")
$env:BOOKMARKDOWN_EXTENSION_IDS = "<32-character-extension-id>"
npm start
```

```bash
export BOOKMARKDOWN_MCP_TOKEN="$(node -p "require('node:crypto').randomBytes(32).toString('hex')")"
export BOOKMARKDOWN_BRIDGE_TOKEN="$(node -p "require('node:crypto').randomBytes(32).toString('hex')")"
export BOOKMARKDOWN_EXTENSION_IDS="<32-character-extension-id>"
npm start
```

全域安裝可改用 `bookmarkdown-mcp-server`；已建置的 source checkout 可改用 `npm start`。

請讓 daemon 持續在此終端執行；按 `Ctrl+C` 停止。不要將配對 token 放入命令列參數、URL、記錄檔或原始碼管理。

啟動時，daemon 會透過 stderr 印出實際 WebSocket URL、允許的 extension IDs，以及 BMD → 設定 → MCP 的串接步驟。配對 token 只顯示已設定，不會印出內容；請在 extension 填入相同的 `BOOKMARKDOWN_BRIDGE_TOKEN` 值。Log 會區分連線測試成功與正式連線，並顯示連線、離線及握手拒絕原因，不包含分頁 metadata 或操作 payload。使用 WSS 時，瀏覽器必須信任 server 憑證。

## 設定 MCP host

先啟動 daemon，再將 MCP host 設為 Streamable HTTP。Host 必須支援自訂 Authorization header；JSON 欄位依 host 而異，以下為常見設定形狀：

```json
{
  "mcpServers": {
    "bookmarkdown": {
      "type": "http",
      "url": "http://127.0.0.1:38472/mcp",
      "headers": { "Authorization": "Bearer <BOOKMARKDOWN_MCP_TOKEN>" }
    }
  }
}
```

MCP host 不會啟動 daemon。舊的 proxy `command`／`args` 設定需改為 HTTP URL；`proxy` 子命令與 `BOOKMARKDOWN_IPC_PIPE_NAME` 已移除。Daemon 離線時 initialize、tools/list 與 tools/call 都無法連線。HTTP 使用無狀態 JSON 回覆，不建立 MCP session；GET SSE、DELETE 與其他非 POST 方法回 `405`，不支援通知串流或續傳。操作結果不明時不得自動重送。

`BOOKMARKDOWN_MCP_TOKEN` 必填，為 32–512 個不含空白的可列印 ASCII 字元；`BOOKMARKDOWN_MCP_PORT` 預設 `38472`，範圍 1–65535。HTTP 固定綁定 `127.0.0.1`。每次請求都驗證 Bearer token、Host 與 Origin（若有）；Host 僅接受實際 port 的 `127.0.0.1` 或 `localhost`，Origin 僅接受相同的本機 HTTP origin。不提供 CORS 或 HTTP 區網綁定。MCP token 與 extension pairing token 應分別產生。

## 多個 agent

Daemon 未設定 agent 數量配額；所有 agent 共用預設 **32 個處理中的 HTTP 請求**額度，包含 initialize、tools/list 與 tools/call。`BOOKMARKDOWN_MAX_PENDING_REQUESTS` 可設為 **1–256** 的整數，修改後需重啟 daemon。超限的 HTTP 請求回 `503`，附帶 `Retry-After: 1`。閒置 agent 不占用處理中的請求額度；實際容量也取決於系統資源與工作負載。

Bridge 另以相同設定限制等待中的 browser RPC，超限時工具回 `BRIDGE_BUSY`。單次工具呼叫，例如查詢分頁數的 devices.list，可能送出多個 browser RPC。`BOOKMARKDOWN_MAX_CONNECTIONS` 預設 **8**，限制的是 extension WebSocket 連線數。

每個 HTTP 請求有獨立 MCP server 與 transport，因此不同 agent 可使用相同 MCP JSON-RPC ID。每個 browser RPC 則由 daemon 另產生 UUID `requestId`；extension 回覆須符合該 UUID 與原始 WebSocket 連線，daemon 才會透過原始 HTTP 請求回覆對應 agent。回覆可以不依送出順序抵達，詳見[請求配對與共享狀態](docs/architecture.md#多-agent-請求配對與共享狀態)。

所有 agent 共用 MCP token、browser instances 與工具權限。回覆分流沒有提供每個 agent 的權限隔離、分頁獨占或跨 agent 操作順序保證；同時修改同一分頁可能影響彼此，應由 agent 或 host 協調衝突操作。

## 安全與隱私

WebSocket server 預設綁定 `127.0.0.1`。選用的區網模式只接受單一 RFC1918 IPv4，並要求 TLS 憑證與私密金鑰；不接受 wildcard 位址或未加密的區網連線。Companion extension 必須連線至相符的 `wss://` URL，並信任該憑證。所有連線仍須通過配對 token 驗證；正式模式也會檢查精確的 extension ID allowlist。回傳的分頁標題與 URL metadata 可能包含敏感資訊，記錄或分享工具結果前請確認內容。設定與驗證限制見[瀏覽器整合指南](docs/browser-integration.md)。

## 開發

```bash
npm test
npm run typecheck
npm run build
```

開發模式可用 `npm run dev -- daemon` 啟動 daemon，但仍需配對 token。WebSocket contract 與目前驗證範圍請參閱[瀏覽器整合指南](docs/browser-integration.md)。

## 授權

本專案採用 [MIT License](LICENSE)。
