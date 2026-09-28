---
name: mcp-live-testing
description: "即時 MCP live testing、Agent MCP tools 驗證、BookMarkdown browser tools、devices.list、視窗與分頁計數、browser.listTabs 分頁，以及明確授權的 openTab、closeTab、moveTab 安全測試。- Brought to you by BookMarkdown/mcp-server"
---

# BookMarkdown MCP 即時工具測試

## Overview

透過目前 Agent MCP session 中直接提供的工具，檢查 BookMarkdown MCP server 的即時工具路徑。直接呼叫 Agent 可用的 MCP tools 是主要方式；本 skill 是工作流程指引，不是隨附可執行程式。

預設只做唯讀檢查。若工具不可用、沒有 online instance，或必要操作未宣告支援，回報 `blocked` 並停止，不要改用 daemon 控制或自行重設環境。除非使用者另外要求 stdio-proxy 診斷，否則不要執行代理診斷；若另行執行，必須標示為獨立診斷，不得描述成 Agent tool call，也不能據此宣稱 Agent MCP live test 通過。

分頁標題與 URL 是敏感資料。不要複製、引用、記錄或回報它們的值；也不要輸出 pairing token 或 instance ID。最終摘要只列各項狀態、計數、欄位名稱及安全的錯誤代碼。

## Prerequisites

* 目前 Agent MCP session 可列出並呼叫相關 MCP tools。不要把本機 source code、shell proxy 或其他程序的結果當作 Agent MCP 呼叫結果。
* 唯讀檢查需要 `devices.list`、`browser.countOpenWindows`、`browser.countOpenTabs` 和 `browser.listTabs`。至少要有一個 online instance，且其 `capabilities.operations` 宣告正在測試的操作。
* 所有分頁變更預設略過。只有使用者明確授權對應操作後，才可建立、移動或關閉 skill 建立的暫存分頁。
* 不要停止、重啟或重新設定執行中的 daemon；不要要求、傳送或記錄任何 secret。

## Quick Start

1. 列出目前 Agent MCP session 可用的工具名稱。確認上述唯讀工具存在；缺少任何必要工具時回報 `blocked`，不要改用 stdio proxy 代替。
2. 呼叫 `devices.list`，設定 `includeOffline: false`、`includeTabCounts: false`。選取一個 `status` 為 `online` 的 instance，確認 `capabilities.operations`。呼叫每項操作前都要確認該 operation 已宣告；唯讀操作未宣告時標示 `blocked` 並停止該項，變更操作未宣告時標示 `skipped`。只在後續工具參數中暫時使用其 `instanceId`；不要將 ID 複製到摘要、檔案或 log。沒有 online instance 時回報 `blocked`。
3. 依序呼叫 `browser.countOpenWindows` 和 `browser.countOpenTabs`，各自只傳入所選 instance 的 `instanceId`。確認 `count` 是非負安全整數、`countedAt` 是有效時間戳記，只保留計數和成功/失敗狀態。
4. 呼叫 `browser.listTabs`，從 `limit: 10`（允許 1 至 10）、`offset: 0` 開始。確認 `tabs` 最多 10 筆、`queriedAt` 是有效時間戳記、`nextOffset` 為 `null` 或等於本頁 offset 加筆數。每筆 metadata 檢查 `tabId`、`windowId` 是非負安全整數，`active` 是 boolean，`title` 最多 512 字元及 1024 UTF-8 bytes，`url` 最多 2048 字元及 2048 UTF-8 bytes；只回報欄位名稱，不回報字串內容。需要下一頁時，使用回應的 `nextOffset` 作為下一個 offset；偵測到 cursor 不前進、重複或不符預期時計算時停止並標示 `failed`。只讀取驗證所需頁面，不要為摘要傾印完整分頁清單。
5. 將每個操作標示為 `passed`、`skipped`、`blocked` 或 `failed`。唯讀操作未宣告支援時標示 `blocked`；未授權或條件不符的選用變更標示 `skipped`。
6. 預設只做唯讀檢查。建立暫存分頁前，確認目前 Agent MCP session 同時提供 `browser.openTab` 與 `browser.closeTab`，所選 instance 的 `capabilities.operations` 同時宣告兩者，且使用者已分別明確授權建立及關閉 skill-owned 暫存分頁；任一條件不符就略過整個分頁變更流程，不呼叫 `browser.openTab`。符合條件時才執行：
   * 呼叫 `browser.openTab` 建立暫存分頁時省略 `url`，讓 server 使用 `about:blank` 預設值。不要傳入其他 URL；若為已授權的移動測試指定 `windowId`，只能使用已確認的一般來源視窗。保留回應中的 `tabId` 作為唯一的分頁變更目標；其他識別值只可在工具參數中暫時使用，不得記錄或回報。
   * 只有 extension 宣告 `browser.moveTab`、已從一般視窗資料確認有兩個不同視窗，且使用者明確授權移動這個 skill-owned 暫存分頁時，才呼叫 `browser.moveTab`。只可移到另一個一般視窗；否則標示 `skipped`。不得移動或關閉既有使用者分頁。
   * 流程最後只對這個 skill 建立的 `tabId` 呼叫一次 `browser.closeTab` 作為 cleanup；若沒有取得 `tabId`，不得猜測目標分頁。
   * `openTab`、`closeTab` 或 `moveTab` 發生 timeout 或 disconnect 時，不要重試該操作，因為結果可能未知。若已知 skill-owned `tabId` 且 cleanup 尚未嘗試，仍只可進行一次已授權的 `closeTab` cleanup；若 `closeTab` 自身結果未知，不得再次嘗試。
7. 回報各操作狀態、計數、已驗證的欄位名稱及安全錯誤代碼。MCP server 呼叫成功只代表 Agent MCP 工具路徑通過，不代表 Chrome、extension 權限或指定 MCP host 的整合已驗證。

## Troubleshooting

* 必要 MCP tool 不在目前 session：標示 `blocked`，不要改用 proxy 或控制 daemon。
* 沒有 online instance：標示 `blocked`；不要嘗試配對、重啟或重新設定 daemon。
* 唯讀操作未列於 `capabilities.operations`：標示該操作 `blocked`，不要呼叫不支援的操作。
* 變更操作未宣告支援或未獲明確授權：標示 `skipped`，不呼叫工具。`moveTab` 另須確認有兩個不同的一般視窗。
* 工具回傳錯誤、欄位不符或 pagination cursor 重複：標示 `failed`，只回報安全錯誤代碼或欄位名稱，不附原始訊息或 payload。
* 變更操作 timeout/disconnect：結果標示 `failed` 且註明結果未知；不得重試。若已知暫存 `tabId`，依 Quick Start 的規則最多嘗試一次 cleanup。
* 工具結果含有 title、URL、pairing token 或 instance ID：不要把原始輸出貼到聊天、終端、檔案或 log；摘要僅保留允許回報的狀態、計數、欄位名稱及安全錯誤代碼。
* `nextOffset` 不等於本頁 offset 加筆數，或 count/timestamp/metadata 不符合 schema：標示 `failed`，不繼續用錯誤 cursor 查詢。

## Attribution

> Brought to you by BookMarkdown/mcp-server