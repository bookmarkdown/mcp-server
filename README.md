---
title: "BookMarkdown MCP Server"
description: "在本機啟動 browser tool daemon，並由 stdio MCP proxy 對接 MCP host。"
ms.date: 2026-09-28
ms.topic: overview
---

## 專案用途

BookMarkdown MCP Server 使用兩個本機程序：你在終端啟動 foreground daemon；MCP host 啟動 stdio proxy。瀏覽器 extension 連線到 daemon 的 loopback WebSocket，proxy 則透過 Windows Named Pipe 將工具呼叫交給 daemon。

> [!IMPORTANT]
> 套件維持 `private`。此 repository 定義 server-side browser contract；companion extension、真實 Chrome 整合、Chrome Local Network Access 與指定 MCP host 的互通性尚未驗證。

## 提供工具

* `devices.list` 列出目前 daemon 已知的 extension instances，可選擇查詢分頁數。
* `browser.countOpenTabs` 與 `browser.countOpenWindows` 查詢指定 instance 的一般視窗分頁數或視窗數。
* `browser.listTabs` 回傳一般視窗中最多 10 個分頁的標題與 URL metadata。
* `browser.openTab`、`browser.closeTab` 與 `browser.moveTab` 操作一般視窗中的分頁；移動只支援跨視窗。

分頁標題與 URL 可能包含敏感資訊；工具不讀取頁面內容。Extension 必須從計數與清單排除 incognito 視窗和分頁。開啟、關閉與移動分頁會改變瀏覽器狀態，結果不明時不會自動重送。instance 狀態只存在 daemon 記憶體中，daemon 結束後不保留。

功能與限制詳見[功能說明](docs/features.md)。瀏覽器端連線、hello/ack 與 RPC 範例見[瀏覽器整合指南](docs/browser-integration.md)。

## 本機啟動

### 需求

* Node.js 24.11.0 或更新版本
* npm
* Windows Named Pipe 支援
* 正式模式需設定精確 extension ID 與配對 token；開發模式只需配對 token

### 安裝與建置

```shell
git clone https://github.com/bookmarkdown/mcp-server.git
cd mcp-server
npm ci
npm run build
```

### 正式模式啟動 daemon

正式模式需要高熵配對 token 與精確 extension ID。companion extension 必須使用相同 token。不要將 token 放入命令列、URL、記錄檔或原始碼管理。

```powershell
$env:BOOKMARKDOWN_BRIDGE_TOKEN = (node -p "require('node:crypto').randomBytes(32).toString('hex')")
$env:BOOKMARKDOWN_EXTENSION_IDS = "<exact-32-character-extension-id>"
npm start -- daemon
```

`npm start -- daemon`、`node dist/cli.js daemon` 與套件 CLI 預設使用正式模式。`--` 是 npm 用來轉交子命令參數的分隔符，不是 daemon 的參數。CLI 本身只接受 `daemon` 或 `proxy`。daemon 會在前景執行；以 `Ctrl+C` 停止。

### 開發模式啟動 daemon

開發模式不讀取 `BOOKMARKDOWN_EXTENSION_IDS`，接受任何符合 `[a-p]{32}` 的 `chrome-extension://` Origin。它仍要求配對 token，且 hello 中的 extension ID 必須與 Origin ID 相同。

```powershell
$env:BOOKMARKDOWN_BRIDGE_TOKEN = (node -p "require('node:crypto').randomBytes(32).toString('hex')")
Remove-Item Env:BOOKMARKDOWN_EXTENSION_IDS -ErrorAction SilentlyContinue
npm run dev -- daemon
```

`npm run dev -- daemon` 會明確使用開發模式，不依 `NODE_ENV` 判斷。開發與正式模式都只綁定 `127.0.0.1`，並使用相同的配對 token 驗證。

### 覆寫選用設定

其餘 daemon 設定都有預設值，通常不必設定。需要更換 WebSocket port 或延長請求逾時時，在同一個 PowerShell 視窗設定環境變數，再啟動 daemon：

```powershell
$env:BOOKMARKDOWN_WS_PORT = "38472"
$env:BOOKMARKDOWN_REQUEST_TIMEOUT_MS = "8000"
npm start -- daemon
```

關閉該 PowerShell 視窗後，這些環境變數不會保留。完整可選設定與範圍列在下方。

### 設定 MCP host

在 MCP host 設定中，以 `node` 執行建置後的 CLI，並將 `proxy` 作為唯一參數。請將路徑替換成此 repository 的絕對路徑：

```json
{
  "mcpServers": {
    "bookmarkdown": {
      "command": "node",
      "args": ["D:/path/to/mcp-server/dist/cli.js", "proxy"]
    }
  }
}
```

MCP host 只啟動 proxy；proxy 不會啟動 daemon，也不需要 WebSocket token。daemon 尚未啟動時，proxy 仍可完成 MCP initialize 與 `tools/list`，工具呼叫會回報 `DAEMON_UNAVAILABLE`。

## Configuration

以下環境變數由 daemon 使用：

| 環境變數 | 預設值 | 範圍 |
| --- | --- | --- |
| `BOOKMARKDOWN_BRIDGE_TOKEN` | 無 | 必填，32 至 512 UTF-8 bytes |
| `BOOKMARKDOWN_EXTENSION_IDS` | 無 | 正式模式必填，逗號分隔的精確 Chrome extension ID，格式為 `[a-p]{32}`；開發模式不讀取 |
| `BOOKMARKDOWN_WS_PORT` | `38471` | `1` 至 `65535` |
| `BOOKMARKDOWN_MAX_PAYLOAD_BYTES` | `65536` | `1024` 至 `1048576` |
| `BOOKMARKDOWN_MAX_PENDING_REQUESTS` | `32` | `1` 至 `256` |
| `BOOKMARKDOWN_MAX_CONNECTIONS` | `8` | `1` 至 `64` |
| `BOOKMARKDOWN_MAX_REGISTERED_INSTANCES` | `64` | `1` 至 `256` |
| `BOOKMARKDOWN_REQUEST_TIMEOUT_MS` | `5000` | `100` 至 `60000` |
| `BOOKMARKDOWN_HELLO_TIMEOUT_MS` | `5000` | `250` 至 `30000` |

WebSocket 固定綁定 `127.0.0.1`。設定無效或 listener 無法啟動時，daemon 會回復已開啟的資源並以非零狀態結束，不會改用其他 port。proxy 與 daemon 使用 Windows Named Pipe `\\.\pipe\bookmarkdown-mcp` 通訊。

## Development

執行測試、型別檢查與建置：

```powershell
npm test
npm run typecheck
npm run build
```

CLI 必須指定 `daemon` 或 `proxy`。開發期間可使用 `npm run dev -- daemon` 啟動開發模式 daemon；MCP host 可使用 `npm run dev -- proxy` 或建置後的 `node dist/cli.js proxy`。Proxy 不依 daemon 的 runtime mode 限制連線。