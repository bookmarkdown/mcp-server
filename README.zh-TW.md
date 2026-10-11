# BookMarkdown MCP Server

[English](README.md) | [繁體中文](README.zh-TW.md)

BookMarkdown MCP Server 讓 agent 直接透過 MCP Streamable HTTP 呼叫本機 daemon。Daemon 保留 browser extension WebSocket bridge；stdio proxy 與本機 IPC 已移除。

目前仍在 1.0 前的開發階段，功能與介面可能調整。

## 功能

Daemon 連接 agent 與相容的瀏覽器套件，提供有明確範圍的 MCP 工具。配對與伺服器設定透過本機管理頁操作。

分頁標題與 URL 可能包含敏感資訊。Server 不讀取頁面內容；extension 預期會排除 incognito 視窗與分頁。操作結果不明時，不會自動重送分頁變更操作。

詳見[功能與限制](docs/features.md)、[系統架構](docs/architecture.md)、[瀏覽器整合指南](docs/browser-integration.md)、[推送與發布流程](docs/pushing.md)及[文件規約](docs/documentation-conventions.md)。

## 需求

* Windows、Linux 或 macOS
* Node.js 22.23.3 或更新版本
* npm
* 相容的 companion browser extension，另行維護

## 快速啟動

不需全域安裝，直接啟動 daemon：

```bash
npx -y @bookmarkdown/mcp-server@latest
```

首次啟動會建立設定檔與兩組獨立 token，不需預設 ENV 或 extension ID。保持終端機開啟，按 Ctrl+C 停止。若要全域安裝，先執行 `npm install --global @bookmarkdown/mcp-server`，再執行 `bookmarkdown-mcp-server`。

## 從原始碼安裝

```bash
git clone https://github.com/bookmarkdown/mcp-server.git
cd mcp-server
npm ci
npm run build
npm start
```

原始碼修改後，重新建置並重啟 daemon。

## 連接套件與 agent

1. 在啟動 server 的電腦開啟終端機列出的設定頁，預設為 `http://127.0.0.1:38472/`。
2. 按「連接 Chrome 套件」配對相容的 BMD，或手動填入 WebSocket URL 與配對 token。先測試，再「儲存並啟用」；probe 成功不代表已註冊。
3. 複製 Agent 的 HTTP URL 與另一組 MCP token，填入下方 host 設定。

設定保存與 token 重建需重啟後生效；此前顯示／複製仍使用執行中的憑證。區網、設定檔路徑、ENV、配對連結與連線檢查詳見[設定指南](docs/settings.zh-TW.md)。

請勿將 token 放入傳輸 URL、命令列參數或 source control。含憑證的配對連結只交給要配對的瀏覽器。

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

將 token 佔位值換成管理頁上執行中的 MCP token。區網 client 改用顯示的私有 IP HTTP URL。Host 不會啟動 daemon，請另外保持 daemon 執行；舊 stdio `command`／`args` 設定改用 HTTP。

所有 agent 共用憑證、browser instances、權限與請求額度，沒有分頁獨占。請協調衝突的分頁操作，詳見[請求配對與上限](docs/architecture.md#多-agent-請求配對與共享狀態)。

## 安全與隱私

預設 HTTP／WS 綁定 loopback。開啟區網後接受本機或 RFC1918 client，並保留兩組 token、Host／Origin、hello 身分與能力檢查。正式模式的 extension ID allowlist 改為選填；開發模式接受所有相容 ID。管理頁及 token 端點只允許本機使用，另檢查同源請求與 CSRF。HTTP／WS 區網資料未加密；WSS 可透過既有 ENV 選配。設定檔含明文 token，請保護使用者目錄。詳見[設定指南](docs/settings.zh-TW.md)與[瀏覽器整合指南](docs/browser-integration.md)。

## 開發

```bash
npm test
npm run typecheck
npm run build
```

開發模式使用 `npm run dev -- daemon`，沿用設定檔與 token，接受所有相容 extension ID。WebSocket contract 與目前驗證範圍請參閱[瀏覽器整合指南](docs/browser-integration.md)。

## 授權

本專案採用 [MIT License](LICENSE)。
