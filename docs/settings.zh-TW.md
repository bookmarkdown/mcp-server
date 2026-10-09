---
title: "本機設定與多裝置連線"
description: "透過本機管理頁設定 daemon，並連接區網 agent 與瀏覽器套件。"
ms.date: 2026-10-09
ms.topic: how-to
---

[English](settings.md) | [繁體中文](settings.zh-TW.md)

## 首次啟動

建置 source checkout 後執行 `npm start`，或安裝支援此功能的版本後執行
`bookmarkdown-mcp-server`。不需預設 ENV；CLI 在開啟 listener 前建立有版本欄位的
JSON 設定檔，以及兩組獨立的 256-bit 隨機 token，之後沿用同一檔案。無效、過大、
未知版本或無法讀取的設定會使啟動失敗，不會覆蓋原檔。

開啟終端機列出的設定頁，預設為 `http://127.0.0.1:38472/`。頁面顯示
`BookMarkdown MCP` 標題、即時狀態、MCP／WS URL、遮蔽的 token、支援的 client
及已配對裝置。不需另輸入管理頁登入碼。Agent 使用 MCP token 作為 Authorization
Bearer header；套件使用另一組配對 token，不可混用。

相容套件必須實作 BookMarkdown／BMD Chrome extension protocol `2`、app ID
`bmd-extension` 並通過認證；接受任意相容 ID 不代表所有瀏覽器套件都能使用。
裝置清單來自成功配對，僅存在目前 process，包含該 process 已知的離線 instance。
頁面不讀取分頁內容、不異動分頁；明確點選唯讀檢查時，可查指定裝置的分頁數。

手動配對時，從「瀏覽器套件」複製 WS URL 與配對 token 到 BMD「設定 → MCP」，
先測試，再「儲存並啟用」；也可分開儲存及啟用。Probe 成功不代表已儲存或註冊。
Agent 樣板只含 token 佔位值，複製需明確點選。歷史 WS 基線為 `0.4.0`；
配對引導與健康檢查已包含在 server `0.4.1`，需搭配相容的新版套件。
驗證範圍見[整合指南](browser-integration.md)。

## 一鍵套件配對

Server `0.4.1` 提供「連接 Chrome 套件」及「複製配對連結」。更新 daemon
及相容套件後，重啟 daemon 並重新載入套件。

1. 確認 Chrome extension ID。預填的 `kdnjdggdbibdliholcdkmdkajacdmnhd`
   是使用者指定值，不代表套件已上架或安裝。開發版請從 `chrome://extensions`
   取得實際 ID。成功建立連結後，只在管理瀏覽器 localStorage 保存 ID，
   不修改 daemon allowlist 或設定檔。
2. 選擇執行中的本機 WS 端點或廣告的私有 IP LAN 端點。連接按鈕在目前分頁
   開啟套件；複製按鈕產生含憑證的連結，可貼到目標 Chrome 的網址列。
3. 套件驗證 fragment、清除目前 URL 參數，並填入未儲存草稿，提示立即或稍後測試。
   匯入與測試均不儲存、不啟用 bridge、不註冊裝置；「儲存並啟用」仍須明確操作。
   無效連結或 probe 失敗不改動既有設定。

`POST /api/pairing-link` 維持本機、Host、Origin、CSRF 與 JSON 保護，只接受
`[a-p]{32}` ID 及目前廣告的 WS 端點。回覆使用執行中的 bridge token，
不使用 Agent token 或待重啟 token；status、HTML、MCP 結果及 log 不包含配對連結。

連結指向 `options.html#/settings/mcp?host=<encoded-WS-URL>&token=<encoded-pairing-token>`。
這是使用者明確授權的 credential fragment handoff，不可把 token 放進 HTTP MCP
或 WS endpoint URL。相容套件只允許 HTTP `127.0.0.1`／`localhost` 管理頁來源
直接開啟 Options HTML，含自訂 port；不需要新增 host permission、外部 runtime API、
TLS 或一次性代碼服務。管理頁仍只供本機存取。

複製 LAN 配對連結不會開放遠端管理頁。清除目前 URL 不會清除剪貼簿或其他歷史副本；
請只交給要配對的瀏覽器。未安裝、ID 錯誤或版本過舊時，請安裝／更新套件、修正 ID
或改用手動配對。

## 設定檔位置

| OS | 預設檔案 |
| --- | --- |
| Windows | `%LOCALAPPDATA%\BookMarkdown\mcp-server\config.json` |
| Linux | `$XDG_CONFIG_HOME/bookmarkdown-mcp/config.json`，或 `~/.config/bookmarkdown-mcp/config.json` |
| macOS | `~/Library/Application Support/BookMarkdown/mcp-server/config.json` |

`BOOKMARKDOWN_CONFIG_FILE` 可指定其他檔案，相對路徑以啟動目錄解析。Linux 的
`XDG_CONFIG_HOME` 必須為絕對路徑，否則使用 home 預設位置。POSIX 新建目錄與檔案
分別要求 `0700`、`0600`，既有目錄權限保留。Windows 使用繼承 ACL；預設使用者
目錄提供帳戶邊界，自訂共用目錄可能讓其他使用者讀取。Token 以明文保存，
不可提交或分享設定檔。

寫入使用同目錄暫存檔、fsync 與 rename，拒絕 symlink 設定檔。設定包含 `version`、
`lanEnabled`、`mcpPort`、`webSocketPort`、`mcpToken`、`bridgeToken`、
`requestTimeoutMs`、`maxConnections`、`maxPendingRequests`、`extensionIds`。

## 儲存與重啟

Port、LAN、逾時、上限與選填的 production ID allowlist 可在頁面修改，兩個 port
不得相同。儲存或重建 token 後，按 Ctrl+C 停止 daemon，再用啟動命令重啟才生效。
此前連線區與 token 顯示／複製仍使用執行中的值，頁面標示待生效狀態；
保存設定與啟動設定不同時，重啟提示持續顯示。重啟後更新對應 agent 或套件。

管理瀏覽器會保存 Agent 角色及最多 64 個已知裝置別名／UUID 的更新提醒，
使用者確認更新後才隱藏。同源 localStorage 只含設定路徑身分、process 身分、
角色與有界裝置識別資料，不含 token；這不是 server 全域的客戶端確認紀錄。
清除／封鎖儲存、改管理 origin／port 或換瀏覽器，提醒可能無法跨重啟保留。
原 process 執行時仍有 pending state。重啟後重新整理活動分頁會重新載入頁面，
取得新 CSRF token 並再次遮蔽已顯示憑證。

## 唯讀連線檢查

頁面分別顯示 HTTP MCP 可用、套件已認證註冊、工具讀取成功。明確點選檢查時，
送出同源且受 CSRF 保護的 `POST /api/connection-check`，可選線上 `instanceId`。
Daemon 以自己的執行中 HTTP URL／token 執行 initialize（`2025-11-25`）、
tools/list，並對已註冊裝置執行 `browser.countOpenTabs`，總期限六秒。
不接受使用者指定 URL／token、不開啟／移動／關閉分頁、不新增 MCP 工具；
狀態與錯誤不含憑證或原始 transport error。

沒有裝置時，HTTP 可通過，但註冊為缺少、工具不執行。讀取通過只證明當次
HTTP→bridge→extension 路徑，不代表每種 MCP 產品 host 設定都正確。
設定、輪替與檢查回饋顯示在操作旁。套件網路診斷提示 server、port、防火牆、
Chrome Local Network Access 及選用 WSS 憑證檢查，泛用 WebSocket 失敗不能判定原因。

管理頁只接受 loopback peer 與 loopback Host，拒絕外部 Origin；異動及秘密端點
另要求同源 POST 與每個 process 的 CSRF token。一般 HTML／status 不含 token。
無 CORS、回覆 no-store、禁止嵌入。這是本機邊界而非每位使用者的登入認證；
同機 process 與其他本機使用者可能存取。

## 區網模式

開啟 LAN、儲存並重啟後，HTTP／WS 綁定 `0.0.0.0`，頁面列出私有 IPv4 與
可複製端點。遠端 agent 使用 `http://<server-private-ip>:38472/mcp` 與 MCP token；
相容新版 BMD 使用 `ws://<server-private-ip>:38471/` 與獨立配對 token，
先測試，再儲存並啟用。明文 LAN 位址限 RFC1918 IPv4：`10.0.0.0/8`、
`172.16.0.0/12`、`192.168.0.0/16`，WS path 必須為 `/`，不需憑證。
多裝置共用同一 server／registry，管理頁仍只在 server 電腦的
`http://127.0.0.1:38472/` 開啟，視需要開放防火牆 port。

本機／私有 LAN 不強制 WSS，HTTP／WS 會明文傳送憑證與資料，只適用可信任網路。
Token、Origin／hello 身分、schema 與上限仍有效。Server 接受 loopback／RFC1918
peer，Host 必須符合本機私有介面，忽略 forwarded-address header；
拒絕公開位址 peer／Host，不支援公開部署或 reverse proxy 模式。

`BOOKMARKDOWN_WS_HOST` 可指定單一私有 IPv4；同時提供
`BOOKMARKDOWN_WS_TLS_CERT_FILE` 與 `BOOKMARKDOWN_WS_TLS_KEY_FILE` 才啟用選配 WSS，
只有選用 WSS 才需受信任憑證。自訂 WS host 可與 HTTP LAN binding 不同，頁面分開顯示。
同機 Chrome 驗證見[整合指南](browser-integration.md)；跨實體裝置、防火牆／路由、
其他 Chrome／LNA、選配 WSS 與指定 MCP 產品 host 需各自驗證。

## 環境變數覆寫

ENV 優先於保存值，但不回寫設定檔；被覆寫的可編輯欄位會停用。移除 ENV 才使用保存值。
WS host／TLS 檔案等設定以 ENV-only 資訊顯示。

| ENV | 保存欄位／行為 |
| --- | --- |
| `BOOKMARKDOWN_CONFIG_FILE` | 設定檔路徑 |
| `BOOKMARKDOWN_LAN_ENABLED` | `lanEnabled`；`true`／`false` 或 `1`／`0` |
| `BOOKMARKDOWN_MCP_PORT` | `mcpPort`；預設 38472 |
| `BOOKMARKDOWN_WS_PORT` | `webSocketPort`；預設 38471 |
| `BOOKMARKDOWN_MCP_TOKEN` | `mcpToken`；32–512 個無空格的可列印 ASCII 字元 |
| `BOOKMARKDOWN_BRIDGE_TOKEN` | `bridgeToken`；32–512 UTF-8 bytes |
| `BOOKMARKDOWN_EXTENSION_IDS` | `extensionIds`；production 選填，以逗號分隔的精確 Chrome IDs |
| `BOOKMARKDOWN_REQUEST_TIMEOUT_MS` | `requestTimeoutMs`；100–60000，預設 5000 |
| `BOOKMARKDOWN_MAX_CONNECTIONS` | `maxConnections`；1–64，預設 8 |
| `BOOKMARKDOWN_MAX_PENDING_REQUESTS` | `maxPendingRequests`；1–256，預設 32 |
| `BOOKMARKDOWN_WS_HOST` | ENV-only WS binding |
| `BOOKMARKDOWN_WS_TLS_CERT_FILE`、`BOOKMARKDOWN_WS_TLS_KEY_FILE` | ENV-only 選配 WSS 憑證／key |
| `BOOKMARKDOWN_MAX_PAYLOAD_BYTES` | ENV-only；1024–1048576，預設 65536 |
| `BOOKMARKDOWN_MAX_REGISTERED_INSTANCES` | ENV-only；1–256，預設 64 |
| `BOOKMARKDOWN_HELLO_TIMEOUT_MS` | ENV-only；250–30000，預設 5000 |

`npm run dev -- daemon` 明確選擇 development。Production 在 allowlist 為空時接受
所有相容且認證通過的 ID；development 忽略固定 allowlist。兩種模式皆檢查 Chrome
Origin 格式、hello 身分一致、token、schema、capabilities 與連線／請求上限。
MCP 憑證與權限仍由所有 agent 共用。