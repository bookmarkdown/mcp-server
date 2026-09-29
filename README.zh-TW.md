# BookMarkdown MCP Server

[English](README.md) | [繁體中文](README.zh-TW.md)

BookMarkdown MCP Server 讓 MCP host 與同一台電腦上的 companion browser extension 溝通。本機 daemon 透過 loopback WebSocket 接受 extension 連線；MCP host 則透過 Windows Named Pipe 與獨立的 stdio proxy 通訊。

> [!IMPORTANT]
> 本專案目前僅支援 Windows。Server 與 companion extension 的串接實作已完成；真實 Chrome、Chrome Local Network Access 與指定 MCP host 的相容性尚未驗證。npm 發布流程正在準備中；請依下方步驟從原始碼安裝。

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

詳見[功能與限制](docs/features.md)、[系統架構](docs/architecture.md)、[瀏覽器整合指南](docs/browser-integration.md)及[文件規約](docs/documentation-conventions.md)。

## 需求

* Windows
* Node.js 24.11.0 或更新版本
* npm
* 相容的 companion browser extension，另行維護

## 從原始碼安裝

```powershell
git clone https://github.com/bookmarkdown/mcp-server.git
cd mcp-server
npm ci
npm run build
```

首次 npm 版本發布前，尚不能透過 `npx` 安裝。發布後，請以實際發布版本執行 CLI：

```powershell
npx --yes --package=@bookmarkdown/mcp-server@<version> -- bookmarkdown-mcp-server
```

啟動 daemon 前，請先設定下方列出的必要環境變數。

## 啟動 daemon

未提供子命令時，CLI 會啟動正式模式 daemon。正式模式需要高熵配對 token 與精確的 Chrome extension ID。Companion extension 必須透過其支援的設定流程使用相同 token。

```powershell
$env:BOOKMARKDOWN_BRIDGE_TOKEN = (node -p "require('node:crypto').randomBytes(32).toString('hex')")
$env:BOOKMARKDOWN_EXTENSION_IDS = "<32-character-extension-id>"
npm start
```

請讓 daemon 持續在此終端執行；按 `Ctrl+C` 停止。不要將配對 token 放入命令列參數、URL、記錄檔或原始碼管理。

## 設定 MCP host

設定 MCP host 以 proxy 模式啟動建置後的 CLI。請將範例路徑換成此 repository 的絕對路徑：

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

MCP host 只會啟動 proxy，不會啟動 daemon。Proxy 使用預設 Windows Named Pipe `bookmarkdown-mcp`，不需要 WebSocket 配對 token。使用瀏覽器工具前，請先啟動 daemon。

## 安全與隱私

WebSocket server 僅綁定 `127.0.0.1`。連線需要配對 token；正式模式也會檢查精確的 extension ID allowlist。回傳的分頁標題與 URL metadata 可能包含敏感資訊，記錄或分享工具結果前請確認內容。

## 開發

```powershell
npm test
npm run typecheck
npm run build
```

開發模式可用 `npm run dev -- daemon` 啟動 daemon，但仍需配對 token。WebSocket contract 與目前驗證範圍請參閱[瀏覽器整合指南](docs/browser-integration.md)。

## 授權

本專案採用 [MIT License](LICENSE)。
