# BookMarkdown MCP Server

[English](README.md) | [繁體中文](README.zh-TW.md)

BookMarkdown MCP Server 讓 MCP host 與 companion browser extension 溝通。Daemon 預設透過 loopback WebSocket 接受 extension 連線；MCP host 則透過本機 IPC 與獨立的 stdio proxy 通訊，Windows 使用 Named Pipe，Linux 使用 Unix domain socket。

> [!IMPORTANT]
> 目前 source checkout 支援 Windows 與 Linux；已發布至 npm 的 `0.1.3` 仍僅支援 Windows，Linux 支援可從原始碼使用。乾淨套件安裝 smoke test 尚未完成。真實 Chrome、companion extension、Chrome Local Network Access 與指定 MCP host 的相容性仍未驗證。選用的區網連線需要 WSS，且 companion extension 必須設定為連線至伺服器 URL。

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

* Windows 或 Linux
* Node.js 24.11.0 或更新版本
* npm
* 相容的 companion browser extension，另行維護

## 從原始碼安裝

```bash
git clone https://github.com/bookmarkdown/mcp-server.git
cd mcp-server
npm ci
npm run build
```

已發布的 `0.1.3` 僅支援 Windows。Linux 可使用此 source checkout；Windows 與 Linux 的乾淨套件安裝 smoke test 均尚未完成。

啟動 daemon 前，請先設定下方列出的必要環境變數。

## 啟動 daemon

未提供子命令時，CLI 會啟動正式模式 daemon。正式模式需要高熵配對 token 與精確的 Chrome extension ID。Companion extension 必須透過其支援的設定流程使用相同 token。

```powershell
$env:BOOKMARKDOWN_BRIDGE_TOKEN = (node -p "require('node:crypto').randomBytes(32).toString('hex')")
$env:BOOKMARKDOWN_EXTENSION_IDS = "<32-character-extension-id>"
npm start
```

```bash
export BOOKMARKDOWN_BRIDGE_TOKEN="$(node -p "require('node:crypto').randomBytes(32).toString('hex')")"
export BOOKMARKDOWN_EXTENSION_IDS="<32-character-extension-id>"
npm start
```

請讓 daemon 持續在此終端執行；按 `Ctrl+C` 停止。不要將配對 token 放入命令列參數、URL、記錄檔或原始碼管理。

## 設定 MCP host

設定 MCP host 以 proxy 模式啟動此 source checkout 建置的 CLI。請將範例路徑換成 MCP host 上此 checkout 的 `dist/cli.js` 絕對路徑，並先執行 `npm ci` 與 `npm run build`。

```json
{
  "mcpServers": {
    "bookmarkdown": {
      "command": "node",
  "args": ["/path/to/mcp-server/dist/cli.js", "proxy"]
    }
  }
}
```

在 Windows 上，請將範例路徑換成 `dist/cli.js` 的絕對 Windows 路徑。

MCP host 只會啟動 proxy，不會啟動 daemon。Proxy 使用預設本機 IPC endpoint `bookmarkdown-mcp`，Windows 為 Named Pipe，Linux 為 Unix domain socket，不需要 WebSocket 配對 token。使用瀏覽器工具前，請先啟動 daemon。

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
