---
title: "瀏覽器整合指南"
description: "瀏覽器 extension 連線至 BookMarkdown MCP Server loopback WebSocket 的目前協定與 client 範例。"
ms.date: 2026-09-28
ms.topic: how-to
---

## 狀態與驗證範圍

此 repository 的原始碼與一般 Node.js WebSocket client 測試確認 server-side contract。Companion extension 已實作 protocol v2 handshake、probe、browser RPC 與網路錯誤後的退避重連；其單元測試涵蓋 handshake、probe、browser operations 和設定，但沒有重連／退避專項測試。真實 Chrome extension 互通性、extension 權限、Chrome Local Network Access，以及指定 MCP host 的整合尚未驗證。以下 JavaScript 僅示範 server 接受的訊息形狀，不代表已在 Chrome 中完成整合驗證。

## 連線條件

使用 loopback WebSocket URL：

```text
ws://127.0.0.1:38471/
```

預設 port 為 `38471`，可由 daemon 的 `BOOKMARKDOWN_WS_PORT` 設定。server 固定綁定 `127.0.0.1`，並要求 HTTP `Host` 完全等於 `127.0.0.1:<實際 port>`、path 為 `/`。Origin 必須符合 `chrome-extension://[a-p]{32}`；瀏覽器端應由 extension origin 提出連線，不能把 Origin 當成認證。

正式模式要求 Origin 中的 extension ID 精確列於 daemon 的 `BOOKMARKDOWN_EXTENSION_IDS`。開發模式不要求固定 allowlist，但 ID 仍須符合格式。兩種模式都要求 hello 的 `extensionId` 與 Origin ID 完全相同，並驗證 pairing token。無效的 Host、path、Origin 或正式模式 allowlist ID 會在 WebSocket upgrade 階段回覆 HTTP `403`，不會收到 `hello-ack`；連線數已達上限時回覆 HTTP `503`。

## 配對與 hello

daemon 從 `BOOKMARKDOWN_BRIDGE_TOKEN` 讀取 pairing token。瀏覽器 client 必須透過另行確認安全性的流程取得相同 token；本 server contract 未定義 token 的交付方式。token 必須是 32 至 512 UTF-8 bytes。不要將 token 放進 URL、命令列參數、log、MCP 回覆或 source control，也不要在錯誤訊息中輸出 token。

WebSocket 開啟後，client 必須在預設 5 秒內送出第一則文字 JSON `hello`。一般連線需包含以下欄位，schema 不接受額外欄位：

* `type` 固定為 `hello`，`protocolVersion` 固定為 `2`。
* `appId` 固定為 `bmd-extension`，`browser` 固定為 `chrome`。
* `instanceId` 是 UUID；同一個邏輯 instance 重連時應沿用此 ID。
* `displayName` 可由使用者自訂為 1 至 32 個中英文、數字、空格或連字號，也可使用 extension 產生的三個動物詞 alias。Server 遇到重名時會加上數字後綴，並在成功 ack 回傳最終名稱。
* `extensionId` 是 32 個小寫 `a` 至 `p` 字元，且必須等於 Origin 中的 ID。
* `token` 是 daemon 設定的 pairing token。
* `capabilities.operations` 列出 client 支援的操作。只列出 extension 已實作的 operation；browser tools 會依此欄位檢查能力。

成功的 `hello-ack` 會提供 server 產生的 `connectionId` 和最終分配的 `displayName`，連線隨後成為已註冊 instance：

```json
{
  "type": "hello-ack",
  "ok": true,
  "protocolVersion": "2",
  "connectionId": "<server-generated-uuid>",
  "displayName": "otter-fox-panda"
}
```

拒絕時的形狀如下。`mode` 只會在 hello 使用 `mode: "probe"` 且該欄位可被解析時出現：

```json
{
  "type": "hello-ack",
  "ok": false,
  "protocolVersion": "2",
  "reason": "unauthorized"
}
```

server 目前使用的拒絕原因如下：

* `hello-timeout`：未在期限內送出 hello。
* `invalid-hello`：訊息為 binary、JSON 無效或不符合 schema。
* `unauthorized`：pairing token 不符。
* `unsupported-protocol-version`：協定版本不是 `2`。
* `unsupported-client`：`appId` 或 `browser` 不受支援。
* `extension-id-mismatch`：hello 的 extension ID 與 Origin 不符。
* `invalid-probe`：probe hello 宣告了非空的 operations。
* `instance-identity-conflict`：相同 app 與 instance ID 已使用另一個 extension ID 註冊。
* `instance-limit-reached`：已達註冊 instance 上限。

收到拒絕 ack 後，server 以 close code `1008` 關閉連線。無效 Origin 等 upgrade 階段拒絕不會產生上述 ack。

### Probe

`mode: "probe"` 是選用的連線檢查，不是一般註冊所需。probe 必須通過相同的 token、版本與 client 驗證，且 `capabilities.operations` 必須是空陣列；probe 不需要 `displayName`。成功 ack 為 `type: "hello-ack"`、`mode: "probe"`、`ok: true` 與 `protocolVersion: "2"`，不包含 `connectionId`；server 送出 ack 後以 close code `1000`、reason `probe-complete` 關閉連線，也不會註冊 instance。

## Browser RPC operations

每個 MCP browser tool 都以 `instanceId` 指定已連線的 extension instance。daemon 只會送出下列 allowlist 中的 operation，且 instance 的 `capabilities.operations` 必須宣告該名稱，否則 MCP call 回 `UNSUPPORTED_OPERATION`。WebSocket `payload` 不包含 `instanceId`，由 daemon 依連線路由。

計數與清單只涵蓋一般視窗和分頁。Extension 必須排除 incognito 視窗與分頁，因為 server 無法檢查 extension 回傳的瀏覽器資料。`browser.openTab` 的目標、`browser.closeTab` 的分頁，以及 `browser.moveTab` 的來源和目的地也必須依一般視窗政策處理；`moveTab` 只支援跨視窗移動，不提供同視窗排序或 index。

> [!WARNING]
> 分頁標題與 URL 可能包含敏感資訊，會由 MCP tool 回傳給呼叫端。只回傳下列有界 metadata，不讀取頁面內容，也不要記錄標題、URL 或 operation payload。

`tabId`、`windowId` 與 `targetWindowId` 都是非負安全整數。所有 success `data` 都使用 strict schema；多餘欄位或無效結果會被拒絕。

### `browser.countOpenTabs`

請求的 `payload` 是空物件；結果只包含一般視窗的分頁數和 ISO 8601 時間戳記：

```json
{
  "type": "browser/request",
  "requestId": "<server-generated-uuid>",
  "operation": "browser.countOpenTabs",
  "payload": {}
}
```

```json
{
  "type": "browser/response",
  "requestId": "<same-request-uuid>",
  "ok": true,
  "data": { "count": 4, "countedAt": "2026-09-28T12:00:00.000Z" }
}
```

### `browser.countOpenWindows`

請求的 `payload` 是空物件；結果格式與分頁計數相同，但只計算一般視窗：

```json
{
  "type": "browser/request",
  "requestId": "<server-generated-uuid>",
  "operation": "browser.countOpenWindows",
  "payload": {}
}
```

```json
{
  "type": "browser/response",
  "requestId": "<same-request-uuid>",
  "ok": true,
  "data": { "count": 2, "countedAt": "2026-09-28T12:00:00.000Z" }
}
```

### `browser.listTabs`

`limit` 預設為 `10`，範圍為 `1` 至 `10`；`offset` 預設為 `0`，必須是非負安全整數。每頁最多 10 筆。`title` 最多 512 個字元且 1024 UTF-8 bytes；`url` 最多 2048 個字元且 2048 UTF-8 bytes。若還有資料，`nextOffset` 必須是本頁結尾的 offset；否則為 `null`。

```json
{
  "type": "browser/request",
  "requestId": "<server-generated-uuid>",
  "operation": "browser.listTabs",
  "payload": { "limit": 10, "offset": 0 }
}
```

```json
{
  "type": "browser/response",
  "requestId": "<same-request-uuid>",
  "ok": true,
  "data": {
    "tabs": [
      {
        "tabId": 12,
        "windowId": 7,
        "active": true,
        "title": "Example",
        "url": "https://example.invalid/"
      }
    ],
    "nextOffset": null,
    "queriedAt": "2026-09-28T12:00:00.000Z"
  }
}
```

### `browser.openTab`

`url` 和 `windowId` 都可省略；省略 URL 表示開啟 `about:blank`。若提供 URL，必須是無 username/password 的絕對 HTTP 或 HTTPS URL；提供的 `windowId` 必須屬於一般視窗。省略 URL 時，response 的 `url` 必須是 `about:blank`。

```json
{
  "type": "browser/request",
  "requestId": "<server-generated-uuid>",
  "operation": "browser.openTab",
  "payload": { "url": "https://example.invalid/", "windowId": 7 }
}
```

```json
{
  "type": "browser/response",
  "requestId": "<same-request-uuid>",
  "ok": true,
  "data": { "tabId": 24, "windowId": 7, "url": "https://example.invalid/" }
}
```

省略 URL 時，request payload 可以是 `{}`，成功結果的 URL 為 `about:blank`：

```json
{
  "type": "browser/response",
  "requestId": "<same-request-uuid>",
  "ok": true,
  "data": { "tabId": 25, "windowId": 7, "url": "about:blank" }
}
```

### `browser.closeTab`

```json
{
  "type": "browser/request",
  "requestId": "<server-generated-uuid>",
  "operation": "browser.closeTab",
  "payload": { "tabId": 24 }
}
```

```json
{
  "type": "browser/response",
  "requestId": "<same-request-uuid>",
  "ok": true,
  "data": { "tabId": 24, "closed": true }
}
```

### `browser.moveTab`

`targetWindowId` must identify a different normal window from the tab's current window. Same-window movement and reorder/index behavior are not supported.

```json
{
  "type": "browser/request",
  "requestId": "<server-generated-uuid>",
  "operation": "browser.moveTab",
  "payload": { "tabId": 24, "targetWindowId": 9 }
}
```

```json
{
  "type": "browser/response",
  "requestId": "<same-request-uuid>",
  "ok": true,
  "data": { "tabId": 24, "sourceWindowId": 7, "targetWindowId": 9 }
}
```

### Response handling

所有 response 必須在收到 request 的同一條 WebSocket 上回覆，並沿用相同 UUID `requestId`。不同 socket 上的回覆、未知 ID 或逾時後才抵達的回覆會被忽略；多個請求可以依 UUID 配對，不必依送出順序回覆。

操作失敗時可回覆下列 strict error shape。`name` 與 `code` 不可為空且最多 128 字元；`message` 最多 1024 字元。Server 會將 extension error 映射為 `EXTENSION_OPERATION_FAILED`，不會轉送敏感 payload。開啟、關閉或移動分頁若逾時或斷線，結果可能不明；server/proxy 不會自動重送。

```json
{
  "type": "browser/response",
  "requestId": "<same-request-uuid>",
  "ok": false,
  "error": {
    "name": "OperationError",
    "message": "The browser operation failed.",
    "code": "OPERATION_FAILED"
  }
}
```

## 瀏覽器端範例

以下只示範 handshake 與 RPC envelope。`browserOperations` 是 extension 自己提供的 adapter；其 implementation 必須遵守每項操作的 schema、一般視窗/incognito 規則與資料上限。此範例不宣稱任何 Chrome API 權限或 Local Network Access 已驗證。

```javascript
const supportedOperations = [
  "browser.countOpenTabs",
  "browser.countOpenWindows",
  "browser.listTabs",
  "browser.openTab",
  "browser.closeTab",
  "browser.moveTab",
];

function connectExtension(pairingToken, instanceId, browserOperations) {
  const operations = supportedOperations.filter((name) =>
    Object.hasOwn(browserOperations, name),
  );
  const socket = new WebSocket("ws://127.0.0.1:38471/");
  let authenticated = false;

  socket.addEventListener("open", () => {
    socket.send(JSON.stringify({
      type: "hello",
      "protocolVersion": "2",
      token: pairingToken,
      appId: "bmd-extension",
      instanceId,
      "displayName": "otter-fox-panda",
      extensionId: chrome.runtime.id,
      browser: "chrome",
      capabilities: { operations },
    }));
  });

  socket.addEventListener("message", async (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }

    if (message.type === "hello-ack") {
      authenticated = message.ok === true && message.mode !== "probe";
      return;
    }
    if (
      !authenticated ||
      message.type !== "browser/request" ||
      !operations.includes(message.operation)
    ) {
      return;
    }

    const handler = browserOperations[message.operation];
    try {
      const data = await handler(message.payload);
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: "browser/response",
          requestId: message.requestId,
          ok: true,
          data,
        }));
      }
    } catch {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: "browser/response",
          requestId: message.requestId,
          ok: false,
          error: {
            name: "OperationError",
            message: "The browser operation failed.",
            code: "OPERATION_FAILED",
          },
        }));
      }
    }
  });

  return socket;
}

const instanceId = await getOrCreateStableInstanceId();
const socket = connectExtension(pairingToken, instanceId, browserOperations);
```

範例中的 `pairingToken` 由呼叫端安全提供。`getOrCreateStableInstanceId()` 是示意 helper；companion extension 目前會將 instance UUID 持久保存，並在重新連線時沿用。此範例只涵蓋一次連線和 request/response，不包含 extension 實際的重連流程，也不代表該流程已在 Chrome 中驗證。

## 逾時、關閉與限制

hello 預設須在 5 秒內送達；browser request 預設等待 5 秒，可用 `BOOKMARKDOWN_REQUEST_TIMEOUT_MS` 設定。WebSocket 預設 payload 上限為 64 KiB、同時連線上限為 8、in-flight request 上限為 32、註冊 instance 上限為 64。各項設定由 daemon 管理。

socket 中斷會讓該連線上的 pending request 失敗，instance 在 daemon 的記憶體 registry 中標為 offline；daemon 重啟時 registry 清空。相同 `instanceId` 與 extension ID 再次註冊會取代舊連線，舊 socket 以 close code `4001`、reason `replaced` 關閉；相同 instance ID 搭配不同 extension ID 則遭拒。連線逾時或中斷後，server 不會替 client 重連。

Server 不會替 client 重連。Companion extension 已實作網路錯誤後重新連線，退避間隔最高為 30 秒，並在連線恢復後重新註冊 instance；目前沒有重連／退避專項自動化測試。Chrome Local Network Access 與 extension 權限設定仍需在目標 Chrome 版本和 extension 中實際驗證；Node.js 測試不代表瀏覽器互通性已通過。