# CO-03 AI 派工證據 QA

QA release identity: `CO03-QA-v1.1 / 20261020-1520` (generated from latest main; product source identity remains `0.9.0-alpha.9.87 / 20261019-1949`).

## 交付邊界

本 branch 只包含三個 CO-03 QA 檔案，基於最新 `main` 建立；不包含附件生命週期、舊 Review branch Build 或其他產品功能。契約是 read-only fixture，不建立派工後端。

## Provider Registry 身分

本工作階段可確認本地 Codex runner 與 GitHub repository checkout，但沒有 CO-03 專用 Provider ACK、remote Runner ID、Token／Quota API 或受保護 Provider runtime。GitHub CLI 未登入，未讀取任何 token 值，也未啟動付費 Provider。狀態為 `PROVIDER_RUNTIME_UNVERIFIED`／`PROVIDER_BINDING_PENDING`；本地 runner 不等於遠端 ACK。

## Native Dispatch Contract v1.1 對照

| 狀態 | CO-03 判定 | 必要條件 |
| --- | --- | --- |
| `ACK_PENDING` | 已指定 Executor，尚無有效 Provider ACK | assignment |
| `ASSIGNED` | ACK 已驗證，但尚無 Run 證據 | accepted ACK、task/executor/ack id 相符 |
| `RUNNING` | 真實 Run 已啟動且仍新鮮 | matching run id、startedAt、heartbeatAt、未過期 |
| `FAILED` | Provider Run 明確失敗 | matching run、failed/error status |
| `BLOCKED` | quota/token/disabled 明確阻擋 | 明確 block reason |
| `STALE` | heartbeat 過期或在未來 | heartbeat 不可證明新鮮 |
| `UNKNOWN` | 欄位缺失、矛盾或無法驗證 | fail closed |
| `COMPLETED` | Run 明確完成 | matching run、completed status |

沒有 heartbeat 絕不顯示 `RUNNING`。Run ID、ACK、task ID 與 executor ID 必須完全一致；GitHub PR、SHA、CI run 任一缺失時 traceability 不完整。

## CO-01 整合驗收清單

- [ ] Executor Registry 能區分 registered／enabled／disabled／unknown。
- [ ] assignment 只產生 `ACK_PENDING`，不等同接案。
- [ ] 只有 matching Provider ACK 才能進入 `ASSIGNED`。
- [ ] 沒有 matching Run ID 與新鮮 heartbeat 不得進入 `RUNNING`。
- [ ] Provider failure、quota／token、失聯分別呈現 `FAILED`、`BLOCKED`、`STALE`。
- [ ] 改派新增 assignment id 並保留 immutable history；相同 task／executor 不重複啟動。
- [ ] PR、commit SHA、CI run 可追溯且與交付 SHA 一致。
- [ ] `PROVIDER_RUNTIME_UNVERIFIED` 與 `PRODUCTION_NOT_DEPLOYED` 顯示為限制，不得轉成成功。

## 測試證據

`node --test tests/co03-dispatch-evidence.test.js` 覆蓋 DM-00～DM-04、ACK／Run／身分一致性、heartbeat fail-closed、FAILED／BLOCKED／STALE、改派去重及 GitHub traceability。預期 9/9 PASS。

驗收標籤：`SOURCE_TEST_PASS`、`PROVIDER_RUNTIME_UNVERIFIED`、`PRODUCTION_NOT_DEPLOYED`。正式發布與 PM 審測仍需要受控 Provider ACK、Run 證據及整合 CI；本 QA 不代表已接案或已執行。
