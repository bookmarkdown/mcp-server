---
title: "MCP Streamable HTTP Daemon 架構"
description: "Agent 直接呼叫 HTTP daemon 與 browser WebSocket bridge 的資料流、安全邊界及生命週期。"
ms.date: 2026-10-02
ms.topic: concept
---

## 資料流

```mermaid
flowchart LR
    A["Agent / MCP host"] <-->|"MCP Streamable HTTP<br/>Bearer token, loopback /mcp"| D["BookMarkdown daemon<br/>MCP tools、instance registry"]
    C["Browser extension"] <-->|"WebSocket / WSS<br/>pairing token"| D
```

使用者啟動單一 daemon；agent 直接呼叫 HTTP endpoint。stdio proxy 與本機 IPC 已移除。Daemon 擁有 WebSocket listener、extension 連線、工具執行與記憶體內 instance registry；重啟後 registry 清空，由 extension 重連並重新註冊。

## HTTP transport

預設 endpoint 為 `http://127.0.0.1:38472/mcp`，port 由 `BOOKMARKDOWN_MCP_PORT` 設定。HTTP 固定綁定 loopback，與可選用區網 WSS 的 extension listener 分開。每個請求必須提供 `Authorization: Bearer <BOOKMARKDOWN_MCP_TOKEN>`；MCP token 與 extension pairing token 各自設定。

使用 SDK `NodeStreamableHTTPServerTransport`，每個 POST 建立獨立 MCP server 與 transport，工具執行共用 daemon bridge，避免不同 client 的 request ID 或協定狀態混用。無狀態模式不建立 `Mcp-Session-Id`，使用 JSON 回覆；notifications/initialized 回 `202`。非 POST 方法回 `405`，不支援 GET SSE 通知串流或 resumability。MCP negotiation、Accept/Content-Type、JSON-RPC parsing 與 protocol header validation 由 SDK 處理。

HTTP body 上限沿用 `BOOKMARKDOWN_MAX_PAYLOAD_BYTES`，超限回 `413`。同時處理中的 HTTP 請求數沿用 `BOOKMARKDOWN_MAX_PENDING_REQUESTS`，超限或正在關閉時回 `503`。Bridge 另行限制 WebSocket 連線、instances 與 in-flight browser RPC；工具逾時沿用 `BOOKMARKDOWN_REQUEST_TIMEOUT_MS`。

## 多 agent 請求配對與共享狀態

Daemon 未實作 agent 數量配額或持久的 agent session。所有 agent 共用 HTTP 處理額度，`BOOKMARKDOWN_MAX_PENDING_REQUESTS` 預設為 `32`，可設定 `1–256`；修改後需重啟 daemon。額度包含正在處理的 initialize、tools/list、tools/call 與其他已接受的 POST。閒置 agent 不占用此額度，超限回 HTTP `503` 與 `Retry-After: 1`。實際可服務的 agent 數仍取決於系統資源與呼叫頻率。

Bridge 另行以相同設定限制 pending browser RPC；這是另一個計數器，超限回工具錯誤 `BRIDGE_BUSY`。單次 devices.list 在查詢多個 instance 分頁數時，可能產生多個 browser RPC。`BOOKMARKDOWN_MAX_CONNECTIONS` 預設 `8`、範圍 `1–64`，用於 extension WebSocket 連線上限，並非 agent 數量上限。

兩層 ID 分別由 MCP client 與 daemon 管理：

| 層級 | ID 與配對方式 |
| --- | --- |
| Agent → HTTP MCP | Agent 提供 JSON-RPC `id`；每個 HTTP 請求有獨立 MCP server／transport，回覆使用原始 `id` 與 HTTP response。不同 agent 可同時使用 `id: 1`。 |
| Daemon → extension WebSocket | `RequestRouter` 為每個 browser RPC 產生 UUID `requestId`，保存該呼叫的 resolve/reject、operation 與 `connectionId`；extension 沿用 UUID 回覆。 |

例如 A 與 B 都送出 MCP `id: 1`，daemon 的 browser RPC 分別使用 UUID A 與 UUID B。即使 B 的 WebSocket 回覆先到，router 也只完成 UUID B 對應的呼叫，結果由 B 原本的 HTTP response 回傳；agent 不直接接收或篩選 extension WebSocket 訊息。

`RequestRouter.handleResponse()` 同時驗證 `requestId` 與來源 `connectionId`。來自其他 extension socket、未知 ID，或取消／逾時後才抵達的回覆會被忽略。HTTP 斷線只取消該 HTTP 請求的 bridge 等待，不會取消其他 agent 的 HTTP 請求；extension socket 中斷則會使所有等待該 socket 回覆的 browser RPC 失敗。實作見 [daemon service](../src/daemon/service.ts) 與 [request router](../src/bridge/request-router.ts)。

所有 agent 共用 MCP token、instance registry 與工具權限，未提供每個 agent 的身分／權限隔離、分頁獨占、交易或跨 agent 操作順序保證。回覆正確配對不代表瀏覽器狀態互相隔離；兩個 agent 同時修改同一分頁仍可能互相影響，衝突操作應由 agent／host 協調，結果不明時不自動重送。

## 生命週期

1. 驗證 WebSocket 與 HTTP 設定、token、正式模式 extension ID allowlist。
2. 啟動 WebSocket bridge 與 HTTP listener；任一失敗會清理已建立的資源。不掃描替代 port，重複啟動回報 port 被占用，不再使用 IPC duplicate probe。
3. Agent 直接 initialize 與 tools/list。Daemon 離線時 HTTP 無法連線；extension 尚未連線時工具回 `EXTENSION_NOT_CONNECTED`。
4. HTTP response socket 中斷時取消該請求的 bridge 等待，其他請求不受影響。工具錯誤維持安全的 MCP `isError` 回覆。
5. `SIGINT`、`SIGTERM` 或 `close()` 停止接受新連線，等待在途請求完成，預設最多 1000 ms。超時後取消等待、關閉 HTTP sockets 與 WebSocket bridge。`close()` 可重複呼叫。
6. 開啟、關閉與移動分頁的結果不明時不自動重送；重新連線與重試決策由 agent／host 負責。

## 安全邊界

HTTP 使用 constant-time Bearer token 比較。Host 僅接受實際 port 的 `127.0.0.1` 或 `localhost`；Origin 若存在，必須為相同本機 HTTP origin，否則回 `403`。不啟用 CORS，不提供 HTTP 區網綁定。缺少或不正確的 Authorization 回 `401`。Token 不得放在 URL、log 或 source control。

Extension WebSocket 保留 pairing token、production extension ID allowlist、Origin 與 hello ID 一致性驗證，以及可選用 RFC1918 WSS。Browser RPC 保留 operation allowlist、strict schemas 與 instance capability 檢查。分頁 metadata 可能敏感，不記錄操作 payload，不讀取頁面內容；排除 incognito 屬 extension 責任。

## 驗證範圍

Node.js 測試涵蓋 HTTP initialize、工具目錄、認證、Host/Origin、body 限制、取消、併發隔離、啟動 rollback、關閉與 WebSocket browser RPC。Linux WSS 與 Unix symlink CLI 測試在 Windows 略過。真實 Chrome、extension、Chrome Local Network Access 與指定 MCP host 相容性仍未驗證。設定見 [README](../README.zh-TW.md)，extension contract 見[瀏覽器整合指南](browser-integration.md)。
