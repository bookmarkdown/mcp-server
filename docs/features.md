---
title: "Available Features"
description: "BookMarkdown MCP daemon、stdio proxy、browser window/tab 工具與目前整合狀態。"
ms.date: 2026-09-29
ms.topic: reference
---

## 本機架構

使用者手動在前景啟動 daemon。daemon 擁有 WebSocket listener、extension 連線、工具執行與記憶體內 instance 狀態。MCP host 啟動 stdio proxy；proxy 透過本機 IPC 將工具呼叫送往 daemon，不會代為啟動 daemon。Windows 使用 Named Pipe；Linux 與 macOS 使用位於每使用者私有目錄的 Unix domain socket。

CLI 接受 `daemon` 或 `proxy`；省略子命令時預設啟動 `daemon`：

```bash
npm start
```

`npm start`、`npm start -- daemon`、`node dist/cli.js` 與 `node dist/cli.js daemon` 都會以正式模式啟動 daemon，並要求設定精確的 `BOOKMARKDOWN_EXTENSION_IDS`。`npm start -- proxy` 或 `node dist/cli.js proxy` 會啟動 MCP proxy。`npm run dev -- daemon` 明確啟動開發模式，不需要固定 ID allowlist，也不依 `NODE_ENV` 判斷模式。兩種 daemon 模式都需要配對 token。daemon 設定錯誤或 listener 啟動失敗時會清理已開啟的資源並以非零狀態結束；不會掃描替代 port。

目前已發布的 `@bookmarkdown/mcp-server@0.2.0` 支援 Windows 與 Linux；套件已在 Ubuntu 與 Windows 通過乾淨安裝及 MCP initialize smoke test，從 npm registry 安裝的套件也已在 Ubuntu 完成相同驗證。

WebSocket 預設綁定 `127.0.0.1`；選用的區網模式可指定單一 RFC1918 IPv4，並以 `BOOKMARKDOWN_WS_TLS_CERT_FILE` 和 `BOOKMARKDOWN_WS_TLS_KEY_FILE` 提供 TLS 憑證與私密金鑰。

proxy 使用 MCP SDK v2 `serveStdio`。MCP 訊息只寫入 stdout，診斷訊息寫入 stderr。daemon 離線時，proxy 仍可 initialize 與列出靜態工具目錄；每次工具呼叫會檢查 daemon 狀態。呼叫已送出後若結果不確定，不會自動重送。

## MCP 工具

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

`browser.openTab`、`browser.closeTab` 與 `browser.moveTab` 會改變瀏覽器狀態。逾時或連線中斷時，結果可能不明，proxy 不會自動重送。所有 browser tools 都要求目標 instance 在 hello capabilities 中宣告相應 operation。

### `devices.list` 結果

每個 instance 包含 `appId`、`instanceId`、`extensionId`、`browser`、`status`、`lastSeen`、回報的 operation capabilities 與 `displayName`。使用者可在 extension 設定頁自訂 1 至 32 個中英文或數字組成的別名，詞語間可用空格或連字號；也可重新產生三個不同動物詞 alias。同一 daemon 中如有其他 instance 使用相同名稱，server 會加上 `-2`、`-3` 等數字後綴，並在註冊 ack 回傳最後分配的名稱。AI 可從 `devices.list` 將 `displayName` 對應到同一項目的 `instanceId`；執行 browser tools 時仍需使用 UUID `instanceId`。

查詢分頁數時，每個 instance 都有 `countStatus` 與 nullable `tabCount`；成功結果包含 `countedAt`。`totalTabs` 僅加總成功的查詢，部分結果會以 `complete: false` 表示。未要求分頁數時，`totalTabs` 為 `null`。

instance registry 只存在 daemon 記憶體中，daemon 重啟後會清空。`includeOffline: false` 只會篩除已知的離線 instance，不會探索尚未連線的瀏覽器設定檔。

## 連線與錯誤

daemon 預設在 `127.0.0.1:38471` 接受 WebSocket 連線，可用 `BOOKMARKDOWN_WS_PORT` 指定 port。設定 `BOOKMARKDOWN_WS_HOST` 後，只接受明確的 RFC1918 IPv4；非 loopback 綁定必須提供 TLS 憑證與私密金鑰並使用 WSS，wildcard host 會被拒絕。HTTP Host 必須完全符合綁定位址與實際 port。Origin 在兩種模式都必須符合 `chrome-extension://[a-p]{32}`；正式模式另外要求 ID 精確列於 `BOOKMARKDOWN_EXTENSION_IDS`，開發模式則接受任何符合格式的 ID。兩種模式都要求 hello token 正確，且 hello extension ID 必須等於 Origin ID。Origin 本身不是認證；token 不會經 IPC 傳送。Companion extension 必須能設定相符的 WSS URL 並信任憑證，真實瀏覽器端尚未驗證。listener 與 IPC 必須同時成功啟動，否則 daemon 會回復已建立的 listener。

瀏覽器端連線、hello/ack、RPC 訊息與 client 範例見[瀏覽器整合指南](browser-integration.md)。Companion extension 已實作 WebSocket client 與 browser RPC，相關單元測試已通過；真實 Chrome 整合、Local Network Access、extension 權限與指定 MCP host 的互通性仍未驗證。重連退避已有實作，但尚無專項自動化測試。

IPC health 回覆包含 runtime mode，IPC protocol version 為 `3`。只有健康且模式相同的既有 daemon 才會被視為重複啟動；proxy 可連線至任一模式，不會以 runtime mode 篩選 daemon。

proxy 與 daemon 使用有版本的本機 IPC。Windows 使用 Named Pipe，Linux 與 macOS 使用 Unix domain socket；每個 proxy session 維持自己的連線，daemon 可同時服務多個 proxy。主要工具錯誤如下：

| 錯誤碼 | 意義 |
| --- | --- |
| `DAEMON_UNAVAILABLE` | daemon 尚未啟動或目前無法連線。 |
| `DAEMON_DISCONNECTED` | daemon 在工具呼叫送出後中斷，結果不確定且不會重送。 |
| `DAEMON_VERSION_MISMATCH` | daemon 與 proxy 版本不相容，需手動重啟相同版本的 daemon。 |
| `EXTENSION_NOT_CONNECTED` | 沒有可供該呼叫使用的已驗證 extension instance。 |

WebSocket hello 使用 protocol version `2`。一般註冊要求 app ID `bmd-extension`、browser `chrome`、UUID instance ID、合法裝置別名及與 Origin 相符的 extension ID；正式模式也必須符合 daemon allowlist。Probe 可省略別名且不會註冊 instance。Browser RPC 僅接受 `browser.countOpenTabs`、`browser.countOpenWindows`、`browser.listTabs`、`browser.openTab`、`browser.closeTab` 與 `browser.moveTab`，並在呼叫前檢查 instance capabilities。request ID 用於將回覆配對到原始連線及呼叫。

## 驗證狀態與後續工作

此 repository 的測試使用一般 Node.js 本機 IPC client、MCP stdio process 與 WebSocket client，涵蓋認證、路由、proxy-first 恢復、多 proxy 隔離、啟動 rollback，以及 Linux 私有介面上的 WSS handshake。Companion extension 的相關單元測試狀態見其所屬 repository；重連退避未有專項測試。真實 Chrome/extension 整合、Chrome Local Network Access、extension 權限及指定 MCP host 的互通性尚未驗證。

Companion extension 已實作 daemon 離線後以有上限的指數退避重新連線並重新註冊 instance；重連退避尚無專項自動化測試，且尚未在真實瀏覽器中驗證。

設定範圍與本機啟動步驟，請參閱[專案 README](../README.md)。
