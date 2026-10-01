# BookMarkdown MCP Server

[English](README.md) | [繁體中文](README.zh-TW.md)

BookMarkdown MCP Server 讓 MCP host 與 companion browser extension 溝通。Daemon 預設透過 loopback WebSocket 接受 extension 連線；MCP host 則透過本機 IPC 與獨立的 stdio proxy 通訊，Windows 使用 Named Pipe，Linux 與 macOS 使用 Unix domain socket。

> [!IMPORTANT]
> 已發布至 npm 的 `0.2.0` 支援 Windows 與 Linux，並已在 Ubuntu 與 Windows 通過乾淨安裝及 MCP initialize smoke test。真實 Chrome、companion extension、Chrome Local Network Access 與指定 MCP host 的相容性仍未驗證。選用的區網連線需要 WSS，且 companion extension 必須設定為連線至伺服器 URL。

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
$env:BOOKMARKDOWN_BRIDGE_TOKEN = (node -p "require('node:crypto').randomBytes(32).toString('hex')")
$env:BOOKMARKDOWN_EXTENSION_IDS = "<32-character-extension-id>"
npx -y @bookmarkdown/mcp-server@latest
```

```bash
export BOOKMARKDOWN_BRIDGE_TOKEN="$(node -p "require('node:crypto').randomBytes(32).toString('hex')")"
export BOOKMARKDOWN_EXTENSION_IDS="<32-character-extension-id>"
npx -y @bookmarkdown/mcp-server@latest
```

全域安裝可改用 `bookmarkdown-mcp-server`；已建置的 source checkout 可改用 `npm start`。

請讓 daemon 持續在此終端執行；按 `Ctrl+C` 停止。不要將配對 token 放入命令列參數、URL、記錄檔或原始碼管理。

啟動時，daemon 會透過 stderr 印出實際 WebSocket URL、允許的 extension IDs，以及 BMD → 設定 → MCP 的串接步驟。配對 token 只顯示已設定，不會印出內容；請在 extension 填入相同的 `BOOKMARKDOWN_BRIDGE_TOKEN` 值。Log 會區分連線測試成功與正式連線，並顯示連線、離線及握手拒絕原因，不包含分頁 metadata 或操作 payload。使用 WSS 時，瀏覽器必須信任 server 憑證。

## 設定 MCP host

設定 MCP host 透過 `npx` 啟動已發布的 proxy，不需 source checkout 或全域安裝。Daemon 與 proxy 請固定使用相同套件版本；IPC 握手會拒絕版本不一致的連線。`-y` 可避免安裝確認提示阻擋 MCP 啟動。

```json
{
  "mcpServers": {
    "bookmarkdown": {
        "command": "npx",
        "args": ["-y", "@bookmarkdown/mcp-server@latest", "proxy"]
    }
  }
}
```

MCP host 的 PATH 必須能找到 `npx`。Windows 上若 host 需要 command shim，可改用 `npx.cmd`。

請在本 repository 以外執行已發布版本的 `npx` 指令，並避免將 MCP host 的工作目錄設為此 checkout。在相同版本的 checkout 內，npm 可能解析成本機套件而非已發布的 CLI；本機 executable 不存在時會回報 `bookmarkdown-mcp-server: not found`。

從原始碼開發時，先執行 `npm ci` 與 `npm run build`，再用 `"command": "node"` 搭配 `"args": ["/path/to/mcp-server/dist/cli.js", "proxy"]`。請換成 checkout 的絕對路徑，Windows 使用 Windows 路徑。這會執行本機程式碼，而非 npm 發布版本。

MCP host 只會啟動 proxy，不會啟動 daemon。Proxy 使用預設本機 IPC endpoint `bookmarkdown-mcp`，Windows 為 Named Pipe，Linux 與 macOS 為 Unix domain socket，不需要 WebSocket 配對 token。使用瀏覽器工具前，請先啟動 daemon。macOS 的 socket 放在 `/tmp/bookmarkdown-<uid>/`，避免過長的 `TMPDIR`；目錄與 socket 分別限制為目前使用者的 `0700` 與 `0600` 權限。

Proxy 會透過 stderr 顯示啟動提醒，stdout 只包含 MCP 協定訊息。是否能看到 stderr 取決於 MCP host；extension 連線 log 顯示於 daemon 終端。

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
