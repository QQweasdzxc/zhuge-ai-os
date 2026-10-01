# TASK-064｜Module C Shared Completion Archive Lifecycle Architecture

> 狀態：Architecture Design Proposal，尚未進入 Implementation
>
> 本文件只定義目標架構與遷移邊界。本輪不修改 Product Source、RPC、Trigger、Schema、Cloud Data、TASK 或 Candidate。

## 1. Design Decision Summary

| 項目 | 決定 |
|---|---|
| 唯一 Authority | Module C Canonical Completion Archive Lifecycle Contract |
| Consumer | 只提供 Data Adapter 與 Capability 宣告，不定義 48 小時規則 |
| 48 小時政策 | C Shared Policy；Cloud 為正式 SoT |
| Completion | 由該 Board Instance 的 Published Workflow Definition 決定 Completion Step |
| Scope | `board_instance_id` + 綁定的 `workflow_version_id` + Card/Subject Identity |
| Archive | 只由 C Canonical Reconciliation 決定與寫入 |
| Workspace | 不再以名稱或全域第一個「已完成」Workspace 推導流程 |
| WorkTodo | 保留 `user_tasks` 資料模型，但改為 C Completion Archive Data Adapter |
| Investment | Read-only Capability，不採用 Completion / Archive |
| Scheduler | 目標推薦 Cloud Background Scheduler；Read-triggered Reconciliation 作為安全補償，不是第二 Authority |

**Architecture 結論：YELLOW。** 目標架構可沿用 Module C / Workflow V2；但目前 WorkTodo、舊 board RPC 與 board instance scope 尚未完成收斂，因此 TASK-064 現況仍是 `PARTIAL`，不是 Architecture PASS。

## 2. Current State

### 2.1 現行 Board path

目前 `board_tasks` 的主要 C v2 Completion path 為：

```text
PM / Runtime Completion Decision
  → createWorkflowCapability.moveWorkspaceDecision()
  → board_c_reconcile_workspace_decision_v2()
  → completion_at
  → archive_due_at = completion_at + 48 hours
  → board_reconcile_completion_lifecycle()
  → archived_at
  → Reload Read-back
```

目前的限制：

- `board_reconcile_completion_lifecycle()` 是全域 board route。
- 它以 active Workspace 的 `workspace_key/name` 找「完成」位置，沒有完整以 `board_instance_id`、Published Workflow Version 與 Completion Step scope。
- `BoardReadService.load()` 只在 AI Board application-scope、沒有指定 Board Instance 時呼叫該 RPC。
- C Mother、GAS、Investment 的 `createInstanceService().load()` 會帶 `board_instance_id`，因此跳過該 Archive Reconciliation。
- Cloud 沒有發現 `cron.job` 或 `pg_cron.job`；目前「自動」實際上是 Read-triggered Reconciliation。

### 2.2 現行 WorkTodo path

```text
WorkTodo UI / Drag / Complete
  → DataService.saveTasksNow()
  → Repository 直接寫 user_tasks
  → worktodo_completion_lifecycle_before_write trigger
  → completed_at / archive_due_at
  → reload 時 worktodo_reconcile_completion_lifecycle()
  → user_tasks.archived_at
```

這是另一套可寫入的 Completion / Archive Authority，不是單純 C Adapter。`user_tasks` 也沒有 `board_instance_id`、`workflow_version_id`、`current_workflow_step_id`。

### 2.3 Current Cloud inventory

目前 Cloud 可見與 48 小時／封存相關的正式函式包括：

- `board_c_reconcile_workspace_decision`
- `board_c_reconcile_workspace_decision_v2`
- `board_c_workflow_reconcile_legacy_card_v2`
- `board_move_task_workspace`
- `board_reconcile_pm_acceptance_lifecycle`
- `board_update_checklist_item`
- `board_reconcile_completion_lifecycle`
- `worktodo_apply_completion_lifecycle`
- `worktodo_reconcile_completion_lifecycle`

目前 Board Workflow State 只有 AI Board 有 Published Workflow：

`05557542-2f91-465a-bb14-3518105f9537`

C Mother、GAS、Investment 與 WorkTodo 尚未在 Cloud Read-back 中呈現同等 Published Workflow binding。

## 3. Target Architecture

### 3.1 Module C 唯一 Authority

Module C 提供同一個 Completion Archive Lifecycle Capability，屬於既有 C Canonical Contract family，不建立第二套 Workflow Engine。

```text
Board Instance Published Workflow
  + Card / Subject Current Step
  + C Shared Completion Archive Policy
        ↓
Module C Completion Archive Contract
        ↓
Consumer Data Adapter
        ↓
各自的 board_tasks / user_tasks / 其他合法資料模型
```

C Contract 是唯一能決定或寫入下列欄位／結果的 Authority：

- Completion Decision
- `completion_at`
- `archive_due_at`
- due 判斷
- `archived_at`
- Archive Audit
- Reopen 對 active archive window 的取消

Consumer 不得自行計算 48 小時、直接決定 due、另建 Archive RPC 或以 local state 取代 Cloud 結果。

### 3.2 正式 lifecycle

```text
合法 Completion Step
  → C Completion Decision
  → completion_at
  → C Shared Policy 計算 archive_due_at
  → 到期 Reconciliation
  → archived_at
  → Cloud Read-back / Reload
```

「合法 Completion Step」來自該 Board Instance 的 Published Workflow Definition。C Mother 不固定 `done / QJC / 完成`；不同子板可以有不同 Completion Step、Workspace 與 Assignee。

### 3.3 Position 與 Result

- Position / Current Step：由 Board Instance Workflow 與 Card binding 決定。
- Completion：是該 Workflow 的受控 Result。
- Archive：是 Completion Result 的後續 C Shared Lifecycle，不由 Workspace 名稱推導。

## 4. Single Shared Policy Source

### 4.1 Policy 內容

C Shared Policy 應是 Cloud 可讀、可版本化、不可由 Consumer 覆寫的正式政策，至少包含：

- policy key：Completion Archive
- duration：`48 hours` / `172800 seconds`
- clock：Cloud server time
- due action：Archive
- reopen action：取消目前 active due window，但保留歷史 Audit
- policy version
- effective / retired metadata

Board Workflow 只能宣告是否具備 Completion Capability，以及哪個 Step 是 Completion Step；不能宣告自己的 48 小時期限。

### 4.2 Future Change Test：48 → 72

**Target Architecture：YES。**

未來改成 72 小時時，只需發布新的 Module C Shared Policy version。新 Completion Action 使用新 Policy；既有 Card 已寫入的 `archive_due_at` 不應被偷偷重算，避免歷史行為被改寫。

若 PM 另行決定連既有 active window 也要改成 72 小時，則必須走明確的 Reconciliation / Migration Decision，不能假稱是單點設定變更。

## 5. Instance / Workflow Scope

### 5.1 Board subject

每次 C Completion / Archive Action 必須能解析：

1. `board_instance_id`
2. Card Identity
3. Card 綁定的 `workflow_version_id`
4. `current_workflow_step_id`
5. Published Workflow 中的 Completion Step
6. C Shared Policy Version

任何一項無法安全取得時：

- 不從 Workspace 名稱猜測。
- 不使用全域第一個「完成」Workspace。
- 不寫入 Completion／Archive 欄位。
- 回傳可理解的 reconciliation required 結果，保留原狀。

### 5.2 Completion Workspace resolve

Runtime 應先以 Card 的 Board Instance + Workflow Version 讀取 Published Workflow，再由 Target Step 的 Workspace UUID 取得位置。Workspace 只是該 Step 的呈現／操作位置，不是 Workflow SoT。

### 5.3 Archive reconciliation scope

Archive Reconciliation 應以明確 subject scope 執行：

```text
subject_type
subject_id
board_instance_id (Board subject 必填)
workflow_version_id (若該能力需要 Workflow binding)
completion_at
archive_due_at
```

一次 Action 只處理可明確鎖定的 Subject；同一 Subject 以 row lock + idempotency 避免重複封存。

## 6. Data Model Boundary

### 6.1 Board Instance / Card

`board_tasks` 保留自己的 Board / Card 資料與 Identity。Workflow binding 維持：

- `workflow_version_id`
- `current_workflow_step_id`

Completion / Archive lifecycle 欄位保留在 Board Card 的正式資料模型，但寫入權限收斂到 C Contract。

### 6.2 WorkTodo

`user_tasks` 不必改造成 `board_tasks`，也不應複製 Vendor/Task Master Data。WorkTodo 可以保留自己的欄位與主鍵，但必須提供一個正式、持久化且可驗證的 C Lifecycle Adapter Context，至少能對應：

- WorkTodo Subject Identity
- WorkTodo Board / Product Instance Identity
- Current Workflow Step
- Completion Capability
- C Policy Version / Action Context

目前 Audit 尚未確認 WorkTodo 已有這個完整 binding；因此實作前若既有 Schema／Contract 無法表達，必須停在 Schema STOP Gate，不得以 `status='completed'`、Workspace 名稱或 Consumer 名稱猜測。

### 6.3 不允許的資料模型

- 不建立第二份 Vendor/Task Master Data。
- 不把完整 Workflow Definition 複製到每張 Card。
- 不用 localStorage/sessionStorage 保存正式 Completion / Archive State。
- 不在 Consumer 表內建立另一個 `48h_policy` 作為覆寫來源。

## 7. Consumer Adoption Matrix

| Consumer | Completion Capability | Archive Capability | Data Adapter | Adoption | 合法例外／目前結論 |
|---|---:|---:|---|---|---|
| C Mother | 依自身 Published Workflow | 若 Workflow 啟用則採用 | `board_tasks` / C Instance | 需要 | 目前沒有已驗證的 Published Workflow State，暫不能宣告 064 PASS |
| AI Board | 是 | 是 | `board_tasks` | 需要收斂 | 目前最接近 C path，但仍受 global legacy archive route 影響 |
| WorkTodo | 是（現有 capability） | 是 | `user_tasks` adapter | 需要 | 目前有自有 trigger/RPC，必須改為 C policy adapter，不得保留自有 authority |
| GAS | 依自身 Published Workflow | 若 Workflow 啟用則採用 | C Board Instance | 需要 | 不得因 AI Board 的完成規則推導 GAS 規則 |
| Investment | 否 | 否 | Read-only / Position Projection | 不採用 | 合法 Capability Difference；不得因 C 新增能力解除 read-only |
| 其他 C Consumer | 由 Board Instance 宣告 | 由 Capability 宣告 | 各自 adapter | 需要 | 必須通過同一 C Contract，不可建立 private engine |

## 8. WorkTodo Adapter Strategy

### 8.1 正確責任切分

WorkTodo Adapter 只負責：

- 將 `user_tasks` 的 Subject Identity 交給 C Contract。
- 將 WorkTodo 的 Current Step / Completion intent 轉成 C Contract input。
- 將 C Contract 的 `completion_at`、`archive_due_at`、`archived_at` 結果寫回／映射回 `user_tasks`。
- 將 C Audit / failure reason 呈現給 WorkTodo。

C Contract 負責：

- 48 小時政策。
- due 判斷。
- atomic completion / archive / reopen。
- idempotency / concurrency。
- Audit。

### 8.2 必須退休的 WorkTodo 權力

`worktodo_apply_completion_lifecycle()` 不得繼續自行決定 `+48 hours`；`worktodo_reconcile_completion_lifecycle()` 不得繼續自行封存。它們在過渡期只能作為受控 Adapter／Compatibility path，最終必須由 C Contract 完成或移除。

## 9. Legacy Card Compatibility

### 9.1 缺少 timestamps 的舊卡

舊卡若位於 Completion Position，但沒有 `completion_at` 或 `archive_due_at`：

- 不因位置自動補 Completion。
- 不因 `status='done'` 自動計算 48 小時。
- 不將 `isArchiveTask()` 當成正式 Cloud Authority。
- 只可標記為 `legacy_completion_unresolved` / `needs_reconciliation`，保留原 Card、Evidence、Audit。
- 有足夠正式資料時，透過既有 Reconciliation／Reverification Contract 判定；無法判定時交 PM Classification。

### 9.2 三種資料角色

| 類型 | 作用 | 是否能決定目前 Archive |
|---|---|---:|
| Migration | 將明確且可驗證的舊 binding 導入正式 Contract | 否，除非通過正式 Contract |
| Compatibility Read | 保留歷史資料可讀性與說明 | 否 |
| Current Authority | 依目前 Published Workflow、C Policy 與 Cloud timestamps 決策 | 是 |

## 10. Scheduler Decision

### A｜下一次 Read 時封存

優點：

- 不需背景執行環境。
- Cloud 成本與維運較低。
- 可沿用目前 Read-triggered Reconciliation。

缺點：

- 離線或沒有使用者讀取時，不會在滿 48 小時當下封存。
- 「自動封存」實際上是「下次讀取時補做」。
- AI Board、WorkTodo、C Board Instance 目前讀取觸發器不一致。

### B｜Cloud Background Scheduler

優點：

- 更符合「滿 48 小時自動封存」的產品語意。
- 不依賴使用者是否在線或 Reload。
- 所有 Consumer 可呼叫同一個 C Reconciliation Authority。

缺點：

- 需要受控的 Cloud Scheduler / Edge Function / pg_cron 執行環境。
- 需要處理批次成本、失敗重試、鎖定與監控。
- 目前專案尚未有可見的 `cron.job`／`pg_cron.job`，不能假設已存在。

### Recommendation

**推薦 B 作為最終產品語意。**

A 可保留作為 Scheduler 延遲或失敗時的 Read-time safety reconciliation，但它不是另一套 Authority，也不能作為「48 小時已在背景自動完成」的證明。

本輪不新增 Scheduler。Scheduler 的具體 Supabase／Edge 執行方式留到 Implementation Review；正式 Scheduler 必須呼叫 C Canonical Contract，不得直接 DML 或各 Consumer 各自排程。

## 11. Existing Route Disposition

| Route | 分類 | 目前責任 | 最終方向 |
|---|---|---|---|
| `board_c_reconcile_workspace_decision` | DEPRECATE AFTER ADOPTION | C v1 workspace/lifecycle write | 由 v2 + C Archive Contract 取代後停用 |
| `board_c_reconcile_workspace_decision_v2` | KEEP AS CURRENT | C v2 Workflow Decision / Completion writer | 保留為 C Decision 入口；Archive Policy 必須收斂到同一 C Contract |
| `board_c_workflow_reconcile_legacy_card_v2` | MIGRATION ONLY | 既有卡片正式 adoption/reconciliation | 僅完成安全 Mapping／Reverification 後使用，不能作一般 Runtime Archive path |
| `board_move_task_workspace` | DEPRECATE AFTER ADOPTION | 舊 direct workspace/lifecycle write | 正式 C Decision adoption 完成後停用 |
| `board_reconcile_pm_acceptance_lifecycle` | DEPRECATE AFTER ADOPTION | 舊 PM acceptance reconciliation | 由 C Completion Decision + C Audit 取代 |
| `board_update_checklist_item` | ADAPTER | Checklist / Engineering Evidence capture only；不再寫入 `board_tasks` lifecycle | 保留 Evidence capture 責任；PM Acceptance movement、Completion、Requeue 與 Archive 一律由正式 C Contract 處理 |
| `board_reconcile_completion_lifecycle` | DEPRECATE AFTER ADOPTION | 全域 board archive writer | 改為 instance/workflow-scoped C Reconciliation 後停用 |
| `worktodo_apply_completion_lifecycle` | DEPRECATE AFTER ADOPTION | `user_tasks` trigger 自行計算 48h | 轉成受控 C Adapter 或移除，不得保留政策決定權 |
| `worktodo_reconcile_completion_lifecycle` | DEPRECATE AFTER ADOPTION | WorkTodo 自有 Archive writer | 改呼叫 C Contract 後停用 |

本輪不刪除任何上述 route。Legacy 只能在 New Contract PASS、Caller Inventory PASS、Consumer Adoption PASS、Reconciliation PASS、Regression PASS 後退休。

## 12. Migration / Adoption Strategy

1. **Contract Freeze**：先定義 C Completion Archive Contract、Policy Version、Subject Adapter interface 與錯誤語意。
2. **Scope Proof**：證明每個適用 Subject 都能取得 Board Instance / Workflow Version / Current Step 或合法 Adapter Context。
3. **Canonical Test**：先完成 completion、due、archive、reopen、idempotency、concurrency、failure atomicity 測試。
4. **Adapter Adoption**：依 C Mother、AI Board、WorkTodo、GAS 順序接入；Investment 明確保持 read-only。
5. **Legacy Reconciliation**：只對可明確 Mapping 的 Card 執行正式 adoption；無法安全 Mapping 的標記 `needs_pm_classification`，不猜、不批次覆寫。
6. **Caller Migration**：將舊 route caller 改為 C Contract 或明確包裝成 Adapter；不得讓新舊兩套都作為正式寫入入口。
7. **Scheduler Adoption**：若採 B，Scheduler 只呼叫 C Canonical Reconciliation，並以 idempotency／row lock 防重複。
8. **Retirement Gate**：完成 Consumer Matrix、Cloud Read-back、Reload/New Session、Failure Atomicity 與 Full Regression 後，才 Disable Legacy Caller，再進行 Code Removal。

禁止以單一 `status`、Workspace 名稱、assignee、TASK ID 或 Consumer 名稱替歷史 Card 猜 Workflow binding。

## 13. Implementation Phases（後續，不是本輪執行）

### Phase 1｜C Contract / Policy

- 確認既有 C Canonical Contract 的延伸位置。
- 建立唯一 C Shared Policy 的 Cloud representation。
- 定義 subject scope、error、audit、idempotency。

### Phase 2｜Board Adapter

- 將 Board Completion / Archive 全部置於 `board_instance_id` + Workflow Version scope。
- 移除 global first-completed-workspace resolution。

### Phase 3｜WorkTodo Adapter

- 建立正式 WorkTodo Subject binding。
- 讓 `user_tasks` 保留自身資料模型，但不再擁有 48h Policy / Archive Decision。

### Phase 4｜Consumer Adoption

- C Mother、AI Board、GAS 依各自 Published Workflow Adoption。
- Investment 保持 read-only。

### Phase 5｜Reconciliation / Scheduler

- 完成既有 Card 的安全分類與 adoption。
- 依 PM 採用 B 時建立受控 Cloud Scheduler。

### Phase 6｜Legacy Retirement

- 以 Caller Matrix、Regression、Cloud Read-back 證明無正式依賴後，停用並移除舊 authority。

## 14. Security / Atomicity Requirements

- Browser 不持有 service role，也不直接 DML 正式 lifecycle 欄位。
- C Contract 維持 authenticated／owner／Board Instance scope 與既有 RLS boundary。
- Scheduler 使用受控 server-side execution，仍須經 C Contract，不直接修改 consumer table。
- Completion、Reopen、Archive 都以 subject row lock + private idempotency key 保護。
- Action retry 不得重複 Audit、重複封存或重新產生 due window。
- Gate／Evidence 不足時原子失敗：Card、Status、Assignee、Completion、Archive 均保持原狀。
- Workflow Version Published immutable；新版本不得偷偷改寫既有 Card binding。

## 15. Regression Risks

### GREEN

- C Mother、AI Board、GAS 共用同一 C Contract，資料仍各自保存。
- WorkTodo 保留 `user_tasks`，不需要把資料表改成 `board_tasks`。
- Investment read-only Capability 可明確排除，不會因 C 新增能力被放開。
- `archive_due_at` 作為 Cloud materialized due time，可支援 Reload / New Session 一致性。

### YELLOW

- WorkTodo 目前沒有已驗證的完整 C Workflow binding。
- AI Board 仍有 v1／legacy write surface。
- Read-triggered reconciliation 與未來 Background Scheduler 的責任需明確分界。
- 既有缺少 timestamps 的 Completion cards 需要逐筆正式 reconciliation。

### RED

- 若在 C Contract 完成前直接把 WorkTodo 接到目前 global `board_reconcile_completion_lifecycle()`，會把 Duplicate Authority 接到另一個未完成 scope 的 Authority。
- 若保留 `worktodo_apply_completion_lifecycle()` 與 `worktodo_reconcile_completion_lifecycle()` 作為可寫入路徑，48→72 仍需修改多處，且新舊政策會並存。
- 若以 Workspace 名稱補 binding，會重新引入 Runtime guessing 與跨 Board Instance 誤封存風險。

## 16. Rollback Boundary

Rollback 必須以 Contract／Adapter 版本為單位，不回復到任意 Consumer 自行決定 48h 的狀態。

可回復：

- 停用尚未完成 Adoption 的新 Consumer Adapter。
- 保留既有 Card Identity、`completion_at`、`archive_due_at`、`archived_at` 與 Audit。
- 對未完成的 Workflow Adoption 保持原 binding／`needs_reconciliation`。
- 停用 Scheduler invocation，但保留 C Read-time safety reconciliation。

不可接受：

- 批次清除或重算既有 timestamps。
- 將已封存 Card 自動搬回 active Workspace。
- 以舊 Workspace／status 猜測並覆寫 Current Step。
- 重新啟用 Consumer private Archive Authority 作為永久正式路徑。

## 17. PM Answers

1. **最終唯一 Authority 是什麼？**  Module C Canonical Completion Archive Lifecycle Contract；Consumer 只有 Adapter。
2. **48→72 是否能只改一處？**  Target Architecture 是 YES：只發布 C Shared Policy 新版本；既有 due timestamp 不偷偷重算。
3. **WorkTodo 如何共用而不共用資料表？**  保留 `user_tasks`，以正式 Subject/Data Adapter 交給同一 C Contract；WorkTodo 不保留政策與 Archive Decision。
4. **C Mother / AI Board / GAS 如何 Adoption？**  各自以 Board Instance + Published Workflow + Card binding 採用同一 C Capability；Completion Step 由各自 Workflow 決定。
5. **Investment 為什麼不適用？**  它是 read-only Capability，沒有 Completion；這是合法產品差異，不是 Drift。
6. **哪些 Legacy Route 暫時必須保留？**  v2 current decision、legacy card adoption、checklist/evidence adapter，以及尚未完成 Caller Inventory／Consumer Adoption／Regression 的 v1 compatibility routes；本輪不刪。
7. **是否需要 Background Scheduler？**  最終推薦需要（B），才能符合「滿 48 小時自動封存」；A 可作 Read-time safety net。本輪不新增 Scheduler。

## 18. Design Gate

本文件完成的是 TASK-064 Target Architecture Design，不是 Implementation Approval。

本輪結果：

- Source Mutation：`0`（本文件為設計證據，不修改 Product Source）
- Cloud Mutation：`0`
- Data Mutation：`0`
- RPC／Trigger／Migration：`0`
- Deployment／Push／Candidate：`0`

**TASK-064 Architecture Design 完成，STOP，等待 PM／GPT Design Review。**
