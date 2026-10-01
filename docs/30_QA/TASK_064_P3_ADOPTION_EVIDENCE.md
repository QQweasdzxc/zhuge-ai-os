# TASK-064｜P3 Board Consumer Adoption Evidence

## Scope

P3 只處理 Module C shared Completion Archive capability 的 C Mother、AI Board、GAS 接線。
WorkTodo 留在 P4；Investment 維持 read-only、合法不採用 Completion Archive capability。

本次沒有建立新的 RPC、Migration、Trigger 或 Consumer-specific lifecycle engine，也沒有修改 Cloud／Product Data。

## Current Cloud State（read-only preflight）

| Board Instance | Published Workflow | P3 判定 |
|---|---|---|
| AI Board `74ff1127-ab98-4543-8f69-872e5d92fd33` | `05557542-2f91-465a-bb14-3518105f9537`，published v1 | 已具備正式 adoption |
| C 母版測試 `b47881c5-20bd-4c7d-807a-bd331cb253ec` | 尚無 Published Workflow / Instance State | 未採用；fail-closed，不猜測 |
| 庶務行政 `38d8d4b1-6d01-4d58-835b-b2beb61fc6b9` | 尚無 Published Workflow / Instance State | 未採用；fail-closed，不猜測 |
| 投資戰情板 `81f49fc7-ac0f-428e-8fcd-5ee612c52993` | 不適用 | read-only，不啟用 |

C Mother 與 GAS 沒有自己的 Published Workflow 時，不能把 AI Board 的流程跨 Instance 套用。Runtime 只回報明確的 `C_ARCHIVE_WORKFLOW_REQUIRED` non-adoption 狀態，不寫入 Adoption State、不呼叫 archive reconciler、不 fallback 到 global workspace 或 legacy lifecycle。

## Source Adoption

### Shared Authority

`shared/board/board-read-service.js` 的 `createInstanceService()` 現在提供唯一的 `completionArchiveLifecycle` capability：

1. 先以該 Board Instance 的 C workflow resolver 讀取 Published Workflow。
2. 驗證 Published pointer、Workflow snapshot、Board Instance 三者一致。
3. 有效時才呼叫 `board_c_reconcile_completion_archive_lifecycle_v2`，並固定帶入 Instance／Published Workflow scope。
4. 缺少或不一致時 fail closed，不使用 `board_reconcile_completion_lifecycle()`。

`shared/components/golden-master-runtime.js` 將 AI Board 納入同一個 C Instance Service；C Mother、AI Board、GAS 因而不再各自持有 Archive authority。Investment 維持未啟用。

### Authority Evidence

| Consumer | Lifecycle Authority | Completion Archive Adoption | Current Runtime Global Archive Call |
|---|---|---|---|
| C Mother | C（能力來源）；目前未採用本板流程 | NOT ADOPTED / fail-closed（無 Published Workflow） | 0 |
| AI Board | C | ADOPTED；Instance-scoped v2 reconciliation | 0 |
| GAS | C（能力來源）；目前未採用本板流程 | NOT ADOPTED / fail-closed（無 Published Workflow） | 0 |
| WorkTodo | P4，不在本輪切換 | NOT IN P3 | 不變 |
| Investment | N/A；read-only capability | LEGAL NON-ADOPTION | 不變 |

Consumer-specific 48h policy／archive decision／archive reconciliation：P3 採用路徑為 `0`。WorkTodo 既有 route 仍按 P4 邊界保留，未在本輪切換或修改。

## Failure Safety

- Missing Board Instance：由既有 Instance resolver fail closed。
- Missing Published Workflow：`C_ARCHIVE_WORKFLOW_REQUIRED`，不寫入、不 fallback。
- Published pointer／snapshot／Instance 不一致：`C_ARCHIVE_WORKFLOW_BINDING_INVALID`，不進行 reconciliation。
- C v2 reconciliation 的 Instance scope、Workflow scope、atomicity、idempotency 與 authenticated boundary 沿用 P2 Contract。

## QA Evidence

### Targeted

`node --test tests/task-064-board-adoption.test.js`

- 6 tests
- 6 passed
- 0 failed

覆蓋：AI Board shared instance read/reconciliation、缺少 Published Workflow、malformed binding、disabled capability、runtime routing、Consumer policy duplication guard。

### Regression

P3 未修改 WorkTodo、Investment、C Core Movement、Workflow Settings 或任何 Product Data。完整回歸結果以本次執行輸出為準；既有 browser skip 仍標示為 skip，不冒充 Runtime PASS。

本次完整回歸：509 tests / 501 passed / 0 failed / 8 skipped。8 個 skipped 為既有 Browser regression 環境缺少可執行瀏覽器，非本次新增失敗。

## Cloud / Data Mutation

- RPC／Migration／Trigger：0
- Cloud Data Mutation：0
- Product Data Mutation：0
- Card／Workspace Mutation：0

本文件是 P3 Developer QA evidence，不代表 C Mother／GAS 已有可用 Published Workflow，也不代表 PM Runtime Acceptance 已完成。
