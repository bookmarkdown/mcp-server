# BookMarkdown MCP Server

[English](README.md) | [繁體中文](README.zh-TW.md)

BookMarkdown MCP Server 讓 agent 直接透過 MCP Streamable HTTP 呼叫本機 daemon。Daemon 保留 browser extension WebSocket bridge；stdio proxy 與本機 IPC 已移除。

> [!IMPORTANT]
> MCP host 必須使用 Streamable HTTP；舊的 stdio proxy 已移除。Server `0.4.0` 與 BMD `0.0.1` source build 已在 Windows、Chrome 153 通過 loopback 與同機私有網卡 WS 整合測試，使用自訂 HTTP JSON-RPC 測試 host。指定 MCP 產品與遠端 WSS 尚未驗證，詳見[整合證據](docs/browser-integration.md)。

目前 source 新增配對引導、執行中／待生效 token、重啟後更新客戶端提醒與三段唯讀連線檢查。這些管理頁功能尚未發布，需建置並啟動更新後 source；本機／私有 LAN 仍可使用 WS，不需憑證。

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

* Windows、Linux 或 macOS
* Node.js 22.23.3 或更新版本
* npm
* 相容的 companion browser extension，另行維護

## 從 npm 安裝

不需全域安裝，即可執行已發布的 CLI：

```bash
npx -y @bookmarkdown/mcp-server@latest
```

新版 CLI 首次啟動會自動建立設定檔與 token，不需設定 ENV。也可以選擇全域安裝：

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

建置後直接執行 `npm start`。

## 啟動 daemon

```bash
npm start
```

全域安裝使用 `bookmarkdown-mcp-server`。不需預先設定 ENV 或 extension ID；首次啟動會建立使用者設定檔，以及各自獨立的 MCP 與配對 token，之後沿用。

開啟終端機提示的本機管理頁（預設 `http://127.0.0.1:38472/`）。頁面以兩行大字顯示 **bookmarkdown**／**mcp-server**，提供 URL、遮蔽的 token 顯示／複製、支援套件與已配對裝置清單，以及伺服器設定。設定保存與 token 重建需重啟後生效。

套件使用 WS 與配對 token；Agent 使用 HTTP 與獨立 Bearer token。新版 BMD 先「測試」，再「儲存並啟用」，probe 成功不代表已註冊。管理頁明確點選後驗證 HTTP initialize／工具目錄、裝置註冊及唯讀分頁計數；token 顯示／複製在重啟前仍取執行中憑證。提醒保存範圍與限制見[設定指南](docs/settings.md)。

瀏覽器請開啟根路徑 `/`；`/mcp` 是 agent 的認證端點，`38471` 是套件 WebSocket port。管理頁須在啟動 server 的電腦開啟。修改或重新建置後，先停止舊程序，再執行 `npm start`。

Windows 設定存於 `%LOCALAPPDATA%\BookMarkdown\mcp-server\config.json`；Linux 與 macOS 使用各自的使用者設定目錄。ENV 可覆寫設定，`BOOKMARKDOWN_CONFIG_FILE` 可指定檔案。詳細路徑、欄位、ENV 與重啟流程見[設定指南](docs/settings.md)。

預設只接受本機連線。在網頁開啟區網、儲存並重啟後，可信任 LAN 的 agent 使用顯示的私有 IP HTTP URL，BMD 使用 `ws://<server-private-ip>:38471/` 與獨立配對 token。更新後的 BMD source build 已接受 RFC1918 IPv4 WS，不需憑證；WSS 為選配，管理頁仍僅限本機。須載入更新後的套件建置，詳見[設定指南](docs/settings.md)。

保持終端機執行，按 Ctrl+C 停止。Token 不會寫入 log，請勿放入 URL、命令列參數或 source control。

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

從管理頁複製目前執行中的 MCP token，填入上方 Authorization header；預設 port 為 `38472`。區網模式改用管理頁顯示的私有 IP URL。MCP `/mcp` 每次請求都驗證 Bearer、Host 與 Origin（若有），不提供 CORS。MCP 與套件配對 token 分開產生。

Daemon 未設定 agent 數量配額；所有 agent 共用預設 **32 個處理中的 HTTP 請求**額度，包含 initialize、tools/list 與 tools/call。`BOOKMARKDOWN_MAX_PENDING_REQUESTS` 可設為 **1–256** 的整數，修改後需重啟 daemon。超限的 HTTP 請求回 `503`，附帶 `Retry-After: 1`。閒置 agent 不占用處理中的請求額度；實際容量也取決於系統資源與工作負載。

Bridge 另以相同設定限制等待中的 browser RPC，超限時工具回 `BRIDGE_BUSY`。單次工具呼叫，例如查詢分頁數的 devices.list，可能送出多個 browser RPC。`BOOKMARKDOWN_MAX_CONNECTIONS` 預設 **8**，限制的是 extension WebSocket 連線數。

每個 HTTP 請求有獨立 MCP server 與 transport，因此不同 agent 可使用相同 MCP JSON-RPC ID。每個 browser RPC 則由 daemon 另產生 UUID `requestId`；extension 回覆須符合該 UUID 與原始 WebSocket 連線，daemon 才會透過原始 HTTP 請求回覆對應 agent。回覆可以不依送出順序抵達，詳見[請求配對與共享狀態](docs/architecture.md#多-agent-請求配對與共享狀態)。

所有 agent 共用 MCP token、browser instances 與工具權限。回覆分流沒有提供每個 agent 的權限隔離、分頁獨占或跨 agent 操作順序保證；同時修改同一分頁可能影響彼此，應由 agent 或 host 協調衝突操作。

## 安全與隱私

預設 HTTP／WS 綁定 loopback。開啟區網後接受本機或 RFC1918 client，並保留兩組 token、Host／Origin、hello 身分與能力檢查。正式模式的 extension ID allowlist 改為選填；開發模式接受所有相容 ID。管理頁及 token 端點只允許本機使用，另檢查同源請求與 CSRF。HTTP／WS 區網資料未加密；WSS 可透過既有 ENV 選配。設定檔含明文 token，請保護使用者目錄。詳見[設定指南](docs/settings.md)與[瀏覽器整合指南](docs/browser-integration.md)。

## 開發

```bash
npm test
npm run typecheck
npm run build
```

開發模式使用 `npm run dev -- daemon`，沿用設定檔與 token，接受所有相容 extension ID。WebSocket contract 與目前驗證範圍請參閱[瀏覽器整合指南](docs/browser-integration.md)。

## 授權

本專案採用 [MIT License](LICENSE)。
