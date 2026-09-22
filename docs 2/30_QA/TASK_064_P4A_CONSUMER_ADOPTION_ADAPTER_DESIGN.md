# TASK-064 P4A｜C Consumer Adoption + Data Adapter Contract Design

> 狀態：READ-ONLY DESIGN / STOP GATE
>
> 本文件只完成 P4A 的 Consumer Adoption RCA、Storage-agnostic Lifecycle Contract 設計與切換邊界。尚未進入 P4B WorkTodo Cutover，也不執行 Schema、RPC、Trigger、Adoption、Migration 或資料變更。

## 0. Baseline 與 Mutation Boundary

| 項目 | 本輪值 |
|---|---|
| Product Version | `0.9.0-alpha.9.13` |
| Runtime Build | `20260912-0921` |
| Current Development HEAD | `ba835017b78c8c25ce4e6fa938218ae91f15cd3d` |
| Protected Candidate Baseline | `6131cb9b267bedbd308e855645344bcc493279e0` |
| Formal Contract family | `module-c-lifecycle-acceptance-v2` |
| Shared Policy | `module-c-completion-archive-policy` / version `1` / `172800` seconds |
| Source Product Mutation | `0` |
| Cloud Mutation | `0` |
| Data Mutation | `0` |
| RPC Mutation | `0` |
| Trigger Mutation | `0` |
| Migration Apply | `0` |
| Deployment / Push / Candidate | `0` |

本文件是本輪唯一新增的設計證據；沒有修改 Product Runtime、Cloud Schema、正式資料或既有 Candidate。

## 1. Executive Decision

### 1.1 Required answers

| 問題 | 結論 | 判定 |
|---|---|---|
| Consumer Adoption Gap | **GENERIC C CONSUMER ADOPTION GAP**，另含 WorkTodo 的 storage/context adapter 子缺口 | `CONFIRMED` |
| Existing Formal Adoption Contract | `board_tasks` 型的 Board Instance Adoption Contract 已存在；storage-agnostic 的通用 Contract 尚不存在 | `YES / PARTIAL` |
| Multiple Board Instances Can Adopt One Published C Workflow Version | 依目前 Schema 與 RPC 語意不能安全支援 | `NO` |
| Storage-agnostic Lifecycle Contract | 可在同一 C Contract family 內增量演進，不需第二套 Engine | `FEASIBLE` |
| WorkTodo 現況 | 仍由 `user_tasks` trigger / RPC 擁有 TASK-064 寫入與 Archive Decision 權力 | `NOT ADOPTED` |
| C Mother / GAS 現況 | 有 C wiring 邊界，但目前沒有自己的 Published Workflow binding | `NOT ADOPTED / FAIL CLOSED` |
| Investment 現況 | Read-only、沒有 Completion Capability | `LEGAL N/A` |

### 1.2 核心判斷

目前不是「WorkTodo 只差呼叫一次 C RPC」。目前缺口分成兩層：

1. **Generic C Consumer Adoption Gap**：C Mother、GAS、WorkTodo 都沒有可驗證的 Published Workflow Adoption；目前 AI Board 是唯一 Cloud Read-back 已採用 Published Workflow 的 C Consumer。
2. **WorkTodo Storage Adapter Gap**：P2 C v2 的 Archive Reconciliation 直接以 `board_tasks` 為資料來源，不能安全地把 `user_tasks` 當成 `board_tasks` 呼叫；WorkTodo 也沒有持久化的 Board Instance / Workflow Version / Current Step Context。

因此，正確順序不是把 WorkTodo 接到現有 `board_c_reconcile_completion_archive_lifecycle_v2()`，而是先建立通用 Adoption / Subject Adapter Contract，再讓 WorkTodo 以 Data Adapter 採用。

## 2. Current State RCA / Evidence

### 2.1 Cloud Board Instance Read-back

目前 Cloud 以 `board_instance_workflow_state.published_workflow_version_id` 讀取的 C Board 狀態如下。這是唯讀查詢結果，不是本輪建立或修改的資料。

| Consumer / Instance | `board_instance_id` | Published Workflow | 目前判定 |
|---|---|---|---|
| AI Board | `74ff1127-ab98-4543-8f69-872e5d92fd33` | `05557542-2f91-465a-bb14-3518105f9537`，`published` | 已採用 |
| C 母版測試 | `b47881c5-20bd-4c7d-807a-bd331cb253ec` | `NULL` | 未採用；Fail Closed |
| 工作待辦 / WorkTodo | `0b2b5c4e-6767-4792-a97a-d2ddf42e60da` | `NULL` | 未採用；不能借用 AI Board |
| 庶務行政 / GAS | `38d8d4b1-6d01-4d58-835b-b2beb61fc6b9` | `NULL` | 未採用；Fail Closed |
| 投資戰情板 / Investment | `81f49fc7-ac0f-428e-8fcd-5ee612c52993` | `NULL` | Read-only，合法 N/A |

這些 `NULL` 只證明目前沒有正式 Published Workflow binding；沒有足夠證據推論「為什麼產品上尚未發布」。不得在後續 Migration 以 Consumer 名稱、status、Workspace 或既有卡片資料自行補出 binding。

### 2.2 Current C Workflow Adoption Contract

目前正式 C Workflow Contract 位於：

- `docs/supabase/20260910_c_workflow_capability_v2.sql`
- `docs/supabase/20260910_c_workflow_capability_v2_hardening.sql`
- `docs/supabase/20260910_c_workflow_existing_card_adoption_v2.sql`
- `shared/board/board-read-service.js`

現有公開 C RPC / Service 入口包括：

- `board_c_workflow_get(p_board_instance_id, p_include_draft)`
- `board_c_workflow_request_adoption(p_board_instance_id, p_to_workflow_version_id, ...)`
- `board_c_workflow_approve_adoption(p_adoption_id, ...)`
- `board_c_workflow_set_step_mapping(p_adoption_id, p_from_step_id, p_to_step_id, ...)`
- `board_c_workflow_apply_card_mapping(p_adoption_id, p_task_id, ...)`
- `board_c_workflow_adopt_unbound_card_v2(p_task_id, p_idempotency_key)`

`createWorkflowCapability()` 對上述 RPC 做了共用邊界封裝；Consumer 只提供 Board Instance Context 與 capability，不應複製 Workflow Engine。

但這套 Contract 的正式語意是 **同一 Board Instance 內的 Workflow Version Adoption**，不是任意 Consumer、任意資料表、任意 Board Instance 的共享 Workflow Registry：

- `board_workflow_definitions.board_instance_id` 是必填 Owner。
- 同一個 Board Instance 只允許一個 Published Version。
- `board_instance_workflow_state` 以 `board_instance_id` 為主鍵保存 Published Pointer。
- `board_c_workflow_request_adoption()` 會驗證 target definition 的 `board_instance_id = p_board_instance_id` 且 `status = 'published'`。
- `board_c_workflow_apply_card_mapping()` 只鎖定 `public.board_tasks`，並驗證卡片屬於 adoption 的 Board Instance。
- `board_workflow_steps` 以 `(workflow_version_id, workspace_id)` 唯一約束，供 Board Card 以 Workspace UUID 做唯一 mapping；這不是 WorkTodo `status` 的通用轉譯器。

### 2.3 Template Adoption 與 Workflow Adoption 的邊界

`shared/services/template-adoption-policy.js` 等 Template Adoption UI / preference path 不等於 C Workflow Adoption。前者處理模板來源、版本與採用呈現；後者處理 Board Instance、Published Workflow、Step Mapping 與 Card Current Step。不能把 Template Adoption 當成 WorkTodo Lifecycle 的正式 Adoption Contract。

### 2.4 WorkTodo Current Path

目前 WorkTodo 的實際 Cloud / Runtime 路徑是：

```text
WorkTodo UI / saveWorkTodoTaskPatch()
  → DataService.saveTasksNow()
  → SupabaseRepository 的 user_tasks CRUD
  → user_tasks trigger: worktodo_completion_lifecycle_before_write
  → worktodo_apply_completion_lifecycle()
  → completed_at / archive_due_at / archived_at

Reload / loadCriticalData()
  → SupabaseRepository.reconcileWorkTodoCompletionLifecycle()
  → worktodo_reconcile_completion_lifecycle()
  → user_tasks.archived_at
```

目前已確認的 Cloud Function / Trigger：

| Object | 現況 | 目前權力 |
|---|---|---|
| `worktodo_completion_lifecycle_before_write` | `user_tasks` INSERT 與 UPDATE 觸發 | 可攔截並改寫 Lifecycle 欄位 |
| `worktodo_apply_completion_lifecycle()` | `BEFORE` trigger、非 `security definer` | 直接計算 `completed_at + interval '48 hours'`，是 WorkTodo Policy Writer |
| `worktodo_reconcile_completion_lifecycle()` | `SECURITY DEFINER`、authenticated read-triggered RPC | 直接決定逾期封存並寫入 `archived_at`，是 WorkTodo Archive Decision Writer |
| `saveWorkTodoTaskPatch()` | WorkTodo UI / Shared Drawer caller | 仍走 WorkTodo DataService，不是 C Lifecycle Adapter |
| `reconcileWorkTodoCompletionLifecycle()` | `shared/api/repositories.js` caller | 仍直接呼叫 WorkTodo 專用 RPC |
| `completionArchiveLifecycle: true` | `worktodo-task-adapter.js` capability metadata | 目前是產品能力宣告，不代表已採用 C Contract |

Cloud function definition 的唯讀檢查確認 `worktodo_apply_completion_lifecycle()` 仍含 `interval '48 hours'`，而 `worktodo_reconcile_completion_lifecycle()` 仍直接更新 `user_tasks.archived_at`。這是目前可寫入的 Duplicate Authority，不是單純名稱相似的歷史檔案。

### 2.5 Data Model Gap

目前 `public.user_tasks` 有：

- `id`
- `user_uuid`
- `status`
- `completed_at`
- `archive_due_at`
- `archived_at`
- `archived_by`
- `work_code`

目前沒有可供 C v2 直接解析的：

- `board_instance_id`
- `workflow_version_id`
- `current_workflow_step_id`
- C canonical `workspace_id`

相對地，`public.board_tasks` 已有 `board_instance_id`、`workspace_id`、`workflow_version_id` 與 `current_workflow_step_id`，這也是 P2 C v2 為何目前只能安全處理 `board_tasks` 的直接原因。

## 3. Adoption Semantics

### 3.1 What “adopt a Published C Workflow” means under the approved owner rule

目前已核准的 Owner Rule 是：**Workflow Owner = Board Instance**。因此在不改變這項決策的前提下：

- C Mother、AI Board、GAS、WorkTodo 都可以使用同一套 C Adoption Capability / Engine。
- 每一個具有 Engineering / Completion Capability 的 Board Instance，必須有自己的合法 Published Workflow Pointer。
- Consumer 不得直接借用 AI Board 的 Published Workflow ID。
- Consumer 不得把「Module C 有一份 Workflow」理解為可跨 Instance 直接共用一列 Workflow Definition。

如果產品要的是「一個 immutable Published Workflow Version 被多個 Board Instance 直接採用」，那會改變目前 `board_workflow_definitions.board_instance_id` 的 Owner 語意，必須另行設計 reusable workflow library / shared published workflow identity。這不能在 P4A 直接假定或偷偷加入。

### 3.2 Multiple Board Instances result

**目前答案：`NO`。**

目前資料模型不支援同一個 `board_workflow_definitions.id` 被多個 Board Instance 正式 Adoption：

1. Definition 本身擁有單一 `board_instance_id`。
2. Adoption row 也以單一 `board_instance_id` 為 scope。
3. Request RPC 明確拒絕 target definition 不屬於該 instance 的情況。
4. Published Pointer 是每個 Board Instance 自己的 state row。

這不是要重新建立 Consumer-specific Workflow；而是要忠實區分：

```text
同一套 C Capability / Engine       = YES
同一份 Workflow Data 跨 Board 共用 = 目前 NO
各 Board Instance 有自己的 Published Definition = YES
```

若後續仍要求「同一份 Published C Workflow Data 可由多個 Instance Adoption」，需在 P4A-1 另作正式 Architecture / Schema Review；不能以跨 Instance FK 例外或直接寫 adoption row 繞過現有 owner boundary。

## 4. Generic C Lifecycle Adapter Contract（設計形狀）

### 4.1 Authority split

```text
Board Instance Published Workflow
       + Subject Binding / Current Step
       + C Shared Completion Archive Policy
                         ↓
            Module C Canonical Decision
                         ↓
                 Storage Data Adapter
                 ↙                    ↘
          board_tasks              user_tasks
```

C 是唯一的：

- Completion / Reopen / Archive Decision Authority
- 48h Policy Authority
- Completion Position / Gate resolution Authority
- Idempotency / Concurrency / Atomicity Authority
- Lifecycle Audit Authority

Adapter 只負責把 C 決策映射到允許的資料模型。Adapter 不得自行計算時間、判斷 Completion、猜 Workspace 或直接把 Consumer storage 當成 Workflow SoT。

### 4.2 Subject identity

Contract 不應接受任意 table name 或任意 SQL target。`subject_type` 必須是 server-side allowlist，例如：

- `board_task`
- `worktodo_task`

每一個 Subject 由 Adapter 回答：

| Context | 必填意義 |
|---|---|
| `subject_type` | 受控 Adapter 類型，不是任意資料表名稱 |
| `subject_id` | 原始資料模型的正式 Identity |
| `board_instance_id` | 所屬 Board Instance；沒有時不得猜 |
| `workflow_version_id` | 該 Subject 採用的 immutable Published Workflow |
| `current_workflow_step_id` | 目前正式流程階段 |
| `current_workspace_id` | 該 Step 的正式 Workspace；由 Workflow Resolve，不由名稱推導 |
| `capability` | 是否具有 Completion / Archive 能力；Investment 不可因 Adapter 存在而取得 |
| `revision` | compare-and-set / concurrency 用的版本或更新序號 |

### 4.3 Read Contract

建議以 C Canonical Read Contract 回傳：

```text
readLifecycleContext(subjectType, subjectId)
→ {
     contract,
     subject: { type, id },
     boardInstanceId,
     workflowVersionId,
     currentStepId,
     currentWorkspaceId,
     completionStepId,
     completionWorkspaceId,
     completionCapability,
     completionAt,
     archiveDueAt,
     archivedAt,
     policy: { identity, version, delaySeconds },
     revision,
     auditRef,
     failClosed,
     reasonCode
   }
```

Read 缺少 Instance、Published Workflow、Step Mapping 或 Capability 時，只回傳明確 `not_adopted` / `context_invalid`，不能補寫、不能 fallback、不能把 `status='completed'` 當成 C Completion Step。

### 4.4 Write / Decision Contract

建議的 C Action shape（僅為 Contract Design，尚未命名、尚未建立 RPC）：

```text
applyLifecycleDecision({
  subjectType,
  subjectId,
  boardInstanceId,
  workflowVersionId,
  action: "complete" | "reopen" | "reconcile_due",
  targetStepId,
  expectedRevision,
  idempotencyKey,
  actionContext
})
```

行為：

1. 以 Subject Identity + Board Instance + Published Workflow 驗證 scope。
2. 由 Published Workflow 解析 Completion Step 與必要 Gate；不從 Workspace label、status、assignee 或 Consumer 名稱猜。
3. `complete` 時由 C Policy 計算新的 `archive_due_at`；不要求 PM 手動輸入工程欄位。
4. `reopen` 保留原 Completion / Acceptance Audit，依 Contract 清除 active archive window，不刪歷史資料。
5. `reconcile_due` 只處理明確 Subject；條件是 Cloud `archive_due_at <= server_now` 且尚未封存。
6. C 呼叫受控 Adapter 在同一個 Cloud transaction 中寫入 Consumer storage。
7. 寫入 Audit、Idempotency response 與 canonical read-back。
8. 任一 Context / Gate / Policy / Revision 不成立時原子失敗，Subject 與正式 Lifecycle 不變。

### 4.5 Response Contract

成功與失敗都必須是 structured response，至少包含：

- `contract`
- `action`
- `subject_type`
- `subject_id`
- `board_instance_id`
- `workflow_version_id`
- `before`
- `after`
- `mutation_count`
- `idempotent`
- `atomic`
- `audit_ref`
- `reason_code`
- `missing_context` / `missing_gate`（若失敗）

不得回傳空 body，不能讓 Runtime 依錯誤訊息猜是哪個 Gate 或 Adapter 失敗。

## 5. WorkTodo Data Adapter Strategy

### 5.1 WorkTodo Adapter 只做什麼

WorkTodo 之後應提供一個 C-registered `worktodo_task` Adapter，責任限於：

1. 將 `user_tasks.id` 映射成 C Subject Identity。
2. 回傳 WorkTodo 所屬 Board Instance 與正式 Published Workflow Context。
3. 將 WorkTodo 的產品操作（完成、重新開啟、讀取）轉成 C Action Intent。
4. 將 C Contract 結果映射回 `user_tasks.completed_at`、`archive_due_at`、`archived_at`、`archived_by`。
5. 將 C Audit 的可讀摘要映射至 WorkTodo 的 Journal / UI（若產品需要），但不以 Journal 取代正式 Audit。

Adapter 不得：

- 寫 `48 hours`、`48h`、`172800`、`2 days` 或自訂 archive interval。
- 由 `status='completed'` 自行決定 Completion Step。
- 由 UI label 或 Consumer 名稱猜 Completion Workspace。
- 自行呼叫 Global Lifecycle RPC。
- 直接修改 C Workflow tables。
- 建立第二份 Task Master Data 或 Shadow Task。

### 5.2 Storage boundary

`public.user_tasks` 保留為 WorkTodo Data Model。沒有必要將它搬成 `board_tasks`，也不應複製一份 C Card。

但 `user_tasks` 現況缺少 C Lifecycle Context。推薦的最小方向是建立一個 **C Subject Binding / Adapter Context**（名稱待 Schema Review），只保存：

- Adapter subject type / subject id
- Board Instance Identity
- Published Workflow Version
- Current Workflow Step
- binding status / revision / adopted_at

這不是第二份 Task，也不是第二份 Completion / Archive Policy；它是讓 C 能安全辨識 `user_tasks` Subject 的正式 Context。`completion_at`、`archive_due_at`、`archived_at` 仍以 `user_tasks` 為 storage projection，由 C 決定寫入結果。

若未來選擇把 Context 欄位直接 additive 加到 `user_tasks`，也必須經同一個 C Contract 寫入與 RLS 保護；不能由 WorkTodo Repository 直接自行維護。P4A 不在這兩種 storage 形狀間自行 Apply Migration。

### 5.3 WorkTodo Board / Workflow adoption

WorkTodo 現在有 active Board Instance，但 Published Workflow Pointer 是 `NULL`。因此正式路徑應是：

```text
WorkTodo Board Instance
  → 由 C 正式建立／發布其自己的 Workflow Definition
  → C Published Workflow Adoption / Binding
  → WorkTodo Subject Adapter Context
  → C Lifecycle Contract
  → user_tasks
```

不得：

- 借用 AI Board 的 Workflow ID。
- 以 WorkTodo `status` 猜出 C Step。
- 以「完成」字串假造 Completion Step。
- 為通過 QA 直接 INSERT `board_instance_workflow_state`。

## 6. Completion Step / Workspace Mapping Strategy

### 6.1 Board Task mapping

目前 Board Task 的安全 mapping 來源是：

```text
Card.board_instance_id
  + Card.workflow_version_id
  + Published Workflow Step.workspace_id
  + Current Step Identity
```

同一 Workflow 內的 `workspace_id` 有唯一約束，因此可以在 Cloud 明確判斷。這是現有 `board_c_workflow_adopt_unbound_card_v2()` 的安全邊界。

### 6.2 WorkTodo mapping gap

目前 WorkTodo 沒有 C `workspace_id` 或 `current_workflow_step_id`。只靠：

- `user_tasks.status`
- UI 顯示名稱
- 「完成」文字
- WorkTodo Consumer 名稱

都不足以形成正式 mapping，因為這些值不能證明某一個 Published Workflow Step，也無法支援未來每張 Board 不同的 Workflow。

因此 WorkTodo 必須在正式 Adoption 後，透過 C Contract 保存／解析一個持久化的 Subject Current Step Context。Mapping 必須：

1. 針對該 WorkTodo Board Instance 的 Published Workflow。
2. 使用正式 Step Identity，不使用 UI label。
3. 由 Adapter 提供 WorkTodo 的合法 source state identity；若無法唯一映射，回傳 `needs_pm_classification` / `context_invalid`，不猜。
4. Completion Target 由該 Workflow 的 `is_completion = true` Step 決定。
5. 不要求 WorkTodo 套用 AI Board 的流程或 Completion Workspace。

### 6.3 Mapping result

**目前答案：Architecture Gap，尚未可安全實作。**

下一階段必須先完成：WorkTodo Board Instance 的 Published Workflow Adoption + Subject Context Mapping Contract；只有兩者 read-back 通過，才可讓 C Lifecycle Action 進入 `user_tasks`。

## 7. C Canonical Contract Extension

### 7.1 Current v2 limitation

目前：

```text
board_c_reconcile_completion_archive_lifecycle_v2(
  p_board_instance_id,
  p_workflow_version_id,
  p_task_id
)
```

是 Board Task-specific：

- Context resolver 讀 `board_tasks`。
- Reconciler 直接以 `board_tasks` 作為寫入對象。
- Browser Service 的 `taskId` 語意也是 Board Card UUID。

不能把 `user_tasks.id` 塞入這條 RPC 就宣稱完成 Generic Adapter。

### 7.2 Target contract family

建議在同一個 Module C Contract family 內建立下一個不可變 Contract version（實際版本號與名稱待正式 Implementation Review），以 Subject Adapter abstraction 取代 table-specific assumptions：

```text
C Canonical Lifecycle Decision
  → resolve subject / instance / published workflow
  → resolve completion / policy / gate
  → call allowlisted storage adapter
  → atomic storage write
  → canonical audit + idempotency + read-back
```

這不是：

```text
board lifecycle RPC + worktodo lifecycle RPC
```

而是：

```text
one C decision contract
  + board_tasks adapter
  + user_tasks adapter
```

### 7.3 Required Contract changes (design only)

| 類別 | 需要的能力 | 本輪狀態 |
|---|---|---|
| Subject identity | `subject_type` + `subject_id` allowlist | 設計；未建立 |
| Instance scope | Adapter 必須提供並由 C 驗證 `board_instance_id` | 設計；未建立 |
| Workflow scope | Published Workflow Version 與 Board Instance 一致 | 設計；未建立通用入口 |
| Step scope | Current Step / Completion Step identity | 設計；WorkTodo 尚缺 Context |
| Storage write | C transaction 內呼叫 Adapter | 設計；未建立 |
| Policy | 只讀 `module-c-completion-archive-policy` | 已有 C P1，WorkTodo 尚未切換 |
| Audit | C Action Context + adapter subject | 設計；未建立通用欄位 |
| Idempotency | subject-aware action key / request hash | 既有 Board 版可參考；需驗證通用形狀 |
| Atomicity | one decision / one adapter write / one result | 設計；未建立 WorkTodo path |

## 8. Existing WorkTodo Trigger / RPC Disposition

目前不刪除、不停用、不改寫下列 Object。以下是未來切換後的責任分類：

| Route | Current role | P4A target role | 最終 disposition |
|---|---|---|---|
| `worktodo_apply_completion_lifecycle()` | Trigger writer；自行計算 48h、清除／建立 due state | 暫時保留為舊路徑，不能與 C writer 同時決策 | `DEPRECATE AFTER ADOPTION` → `REMOVE AFTER CUTOVER` |
| `worktodo_reconcile_completion_lifecycle()` | Read-triggered Archive Decision writer | 暫時保留為既有資料 compatibility route；切換後不得自行封存 | `DEPRECATE AFTER ADOPTION` → `REMOVE AFTER CUTOVER` |
| `saveWorkTodoTaskPatch()` | WorkTodo UI / DataService caller | 只送 C Lifecycle Intent；保留非 Lifecycle 欄位 CRUD | `MODIFY AT P4B` |
| `reconcileWorkTodoCompletionLifecycle()` | 直接呼叫 WorkTodo RPC | 改呼叫 C shared read/reconcile capability | `MODIFY AT P4B` |
| `completionArchiveLifecycle` capability flag | 宣告 WorkTodo 具備功能 | 改為「已通過 C Adoption」後才可為 true | `ADAPTER CAPABILITY` |

重要切換原則：不能讓 C Adapter 與 WorkTodo trigger 形成兩個同時可寫的 Archive writer。過渡期保留舊路徑是為了 rollback，不代表新舊 writer 同時 active。

## 9. Migration / Cutover Strategy

### 9.1 Recommended dependency order

```text
P4A-1 Generic Published Workflow Adoption / Board Context Contract
  → P4A-2 Storage-agnostic C Lifecycle Adapter Contract
  → P4A-2 QA: Schema / RLS / Contract / Adapter read-back
  → P4B WorkTodo Data Adapter Adoption
  → P4C WorkTodo writer cutover
  → P5 Legacy Authority Retirement
```

### 9.2 P4A-1 — Generic Published Workflow Adoption

目標不是建立另一個 Workflow Engine，而是把「Board Instance 可正式採用自己的 Published Workflow」的 Contract 釐清並可驗證：

1. 決定是否維持目前 Owner Rule（推薦）：每個 Board Instance 發布自己的 immutable Workflow Version，Consumer 共用同一 C Adoption Capability。
2. 若 PM 要一份 Published Workflow Version 被多個 Board Instance 直接採用，另建 reusable Published Workflow identity / library 的 Schema Review；不能修改目前 FK 讓跨 Instance 例外通過。
3. C Mother、GAS、WorkTodo 都必須以各自 Instance 取得正式 Published Pointer；不能借 AI Board。
4. Published Workflow 無 Completion Step、Instance mismatch 或 adoption invalid 時，維持 fail closed。

### 9.3 P4A-2 — Storage-agnostic Adapter

1. 建立 allowlisted Adapter contract 與 subject context read。
2. 建立 user_tasks Subject Binding / Context 的 additive schema 方案；不複製 task、不移動既有資料。
3. 讓 C policy、completion、archive decision、audit、idempotency 只有一個 writer。
4. 為 `board_tasks` 與 `user_tasks` 建立同一 Contract 的 adapter test matrix。
5. 先完成 read / resolve / fail-closed QA，再進任何 WorkTodo write cutover。

### 9.4 P4B — WorkTodo Adoption / Cutover

切換前：

- `user_tasks.completed_at`、`archive_due_at`、`archived_at` 的既有值保持不變。
- 不批次猜測既有 WorkTodo 的 Workflow Step。
- 沒有安全 Context 的 row 標記為待 Adoption / Reconciliation，不由 Runtime 自動完成。

切換時：

1. 以正式 C Adoption / Subject Binding 建立可驗證 Context。
2. 以 C Contract 執行新的 Completion / Reopen / Due Reconciliation。
3. 在同一 Cloud cutover boundary 停止 WorkTodo trigger / RPC 作為 Policy / Archive writer；它們只能留下 compatibility read 或受控 wrapper。
4. 以 Cloud read-back 確認 C Policy、Adapter、`user_tasks` 三者一致。

切換後：

- WorkTodo Repository 不再傳入 `archive_due_at` 作為政策決策值。
- C 只對新的合法 lifecycle decision 計算新 due time。
- 舊 Compatibility Read 只能呈現歷史，不得覆蓋 C Current State。
- 待充分 Caller / Regression / Reconciliation 證據後，才進 P5 retire。

## 10. Existing Data / Cutover Boundary

### 10.1 Preserve existing rows

既有 `user_tasks.completed_at`、`archive_due_at`、`archived_at` 一律保留。Adoption 不得：

- 因 Policy version 改變而 retroactive 重算 `archive_due_at`。
- 因補 Context 而改寫 Completion 時間。
- 將既有已封存資料搬到另一張表。
- 以現在的 status 或 UI 位置假造歷史 Completion。

### 10.2 Distinguish old and new authority

正式 cutover 必須有可驗證 boundary，例如：

- Subject Binding / Adoption 的 `applied_at` 與 Contract version。
- C Action Audit 的 `contract_version`、`policy_version`、`adapter_type`。
- 新 lifecycle action 的 idempotency / revision。

這些欄位只用來辨識「之後由 C Contract 產生的結果」，不能把舊資料重新包裝成歷史 C Evidence。

### 10.3 Rows without safe Context

沒有 Board Instance、Published Workflow 或唯一 Current Step Mapping 的既有 WorkTodo row：

- 保留原資料與既有時間欄位。
- 不自動回填、不自動封存、不自動完成。
- 標示 `needs_adoption_context` / `needs_pm_classification`（實際枚舉需另行 Contract Review）。
- 等正式 Adoption / Reconciliation 流程處理。

## 11. C Mother / GAS / WorkTodo Impact

### C Mother

- 目前有 shared C service wiring，但沒有 Cloud Published Workflow Pointer。
- 不可由 AI Board Workflow 複製或借用。
- 未來必須採同一 C Adoption / Lifecycle Contract；是否具 Completion Capability 由自己的 Published Workflow / Capability 決定。

### GAS

- 目前沒有自己的 Published Workflow Pointer。
- 若 GAS 不啟用 Completion / Archive Capability，合法結果是 N/A，不得因 P4A 強迫開啟。
- 若日後啟用，必須以自身 Board Instance Workflow 採用 C，不能建立 GAS-specific Archive Policy。

### WorkTodo

- 具備 Completion / Archive 產品語意，但目前仍有自己的 Cloud writer。
- 必須先建立正式 Workflow / Subject Context，再接 C Data Adapter。
- 保留 `user_tasks` storage，不搬表、不建 Shadow Task。

### Investment

- Read-only Capability；沒有 Completion / Archive Write。
- 不需要 C Completion Archive Adoption。
- C 新增 Adapter Contract 不得擴張 Investment 的 Move、Workflow Editing 或 Acceptance 權限。

## 12. Cloud Contract / Schema / RPC / Adapter Change Map

本節是預計 Change Boundary，不是本輪 Apply 清單。

### 12.1 Required Schema changes（預計、需下一個 Schema Review）

1. **Published Workflow Adoption scope**：若維持 Board Instance Owner Rule，不需讓 Definition 跨 Instance 共用；每個 Instance 走正式 publish/adoption。若要跨 Instance 共享同一 version，需另增 reusable immutable workflow identity / adoption relation，這是額外 Architecture Decision。
2. **C Subject Binding / Adapter Context**：以 additive、RLS-protected binding 保存 WorkTodo Subject 對應的 Board Instance、Published Workflow、Current Step、revision、adoption status。不得複製完整 Task 或 Policy。
3. **Subject-aware Idempotency**：確認既有 `private.board_workflow_action_idempotency` 能否表達 `subject_type + subject_id`；若不能，增量擴充或建立同一 C Contract family 的 additive key shape，不得拿 Claim table 硬湊。
4. **Audit Context**：沿用現有 Audit SoT 能力，補足 subject type、adapter、contract version、policy version、source / target step、actor 與 idempotency context；不得以 WorkTodo Journal 代替 C Audit。
5. 所有新欄位／索引／RLS 必須 additive、authenticated / owner scoped、可回滾；不得修改 Board / Card Identity，不得批次猜測歷史 Step。

### 12.2 Required RPC changes（預計）

| Contract | 方向 |
|---|---|
| Generic C Subject Read / Resolve | 接受受控 `subject_type + subject_id`，回傳 Instance / Workflow / Step / Policy Context；缺 Context fail closed |
| Generic C Lifecycle Action | `complete` / `reopen` / `reconcile_due` 由 C 做 Decision，再透過 Adapter 寫入 storage |
| Generic C Adoption / Binding | 由正式 Board Instance / Published Workflow Adoption 產生 Subject Context；禁止 Browser 直接 insert |
| Existing v2 Board RPC | 在 Generic Contract PASS 前保留；不直接拿來承擔 `user_tasks` |
| WorkTodo RPC | P4B 前保留 current behavior；P4B 後只能作 compatibility / wrapper，最終 retire |

RPC 必須 authenticated only、驗證 Instance access / user ownership、保留 structured error、atomicity、idempotency；Browser 不持有 service role，也不直接 DML lifecycle 欄位。

### 12.3 Required Adapter changes（預計）

- C Mother / AI Board / GAS：提供 Instance Context，不取得 Lifecycle Authority。
- WorkTodo：新增 C-registered `user_tasks` Data Adapter；保留 WorkTodo UI / Repository 的產品資料責任。
- Investment：不註冊 Completion Archive Adapter。
- `shared/board/board-read-service.js`：未來應暴露唯一 generic C capability；不新增 WorkTodo-specific C engine。
- `shared/components/golden-master-runtime.js`：只接 shared capability / adapter context；不新增 Consumer-specific policy。
- WorkTodo `data-service.js` / `repositories.js` / `worklog-app.js`：在 P4B 才改 caller route；本輪未修改。

## 13. Security / RLS / Atomicity / Idempotency

### Security

- 維持 authenticated-only RPC；現有 C workflow functions 已是 `SECURITY DEFINER` + explicit `auth.uid()` / `board_instance_can_read/write()` 邊界，新的 Contract 必須延續同一原則。
- Adapter 類型採 server-side allowlist，不讓 Browser 送任意 table / column / SQL。
- WorkTodo Subject 必須驗證 `user_tasks.user_uuid = auth.uid()` 或等價的正式 ownership contract。
- 不新增 anon/public write grant，不把 service role 給 Browser / ChatGPT。
- Investment Capability 仍為 read-only。

### RLS

- Workflow / Adoption / Binding / Idempotency tables 維持 RLS。
- Consumer storage 的既有 RLS 不可因 C Adapter 而放寬。
- Security-definer function 必須固定 `search_path`，不得依 caller 提供的任意 identifier 執行 SQL。
- 新 Binding 的 read/write 必須跟 Board Instance / WorkTodo owner boundary 一致。

### Atomicity

一個 C lifecycle action 必須在同一受控 Cloud transaction 內完成：

```text
lock / compare subject
→ verify instance + published workflow + gate + policy
→ calculate / preserve timestamps
→ adapter storage write
→ audit + idempotency response
→ canonical read-back
```

任一項失敗都不得留下半套 `completed_at`、`archive_due_at`、`archived_at` 或 Step 狀態。

### Idempotency / concurrency

- 每個 action 必須有 subject-aware idempotency key 與 request hash。
- 同一 key 重試回傳相同 canonical response；不同 payload 使用同一 key 必須拒絕。
- Subject row / binding 需 lock 或 compare-and-set；兩個 archive worker 不能產生兩筆 Archive Audit。
- `archive_due_at` 只在新的合法 Completion Decision 產生；既有 due time 不因重試重算。

## 14. Detection Mechanism V2 Requirement（本輪只記錄）

### Current gap

目前 C Parity / Consistency checker 可以驗證 Feature、Template、Source、Fingerprint、Capability 與部分 Runtime Contract，但沒有完整檢查：

- Board Instance 存在但 Published Workflow Pointer 是 `NULL`。
- Consumer 是否真的完成 C Adoption / Binding。
- 哪個 Trigger / RPC / Repository 可以寫 Completion / Archive。
- WorkTodo 是否仍有第二個 48h Policy / Archive Writer。
- Adapter 是否與宣告的 C Authority 一致。

因此可能出現 Feature 15/15、Fingerprint MATCH，但 WorkTodo 仍有 Duplicate Archive Authority。

### Future fourth layer

**Authority Conformance + Adoption Binding Conformance = RECOMMENDED**，但不得混入本 P4A Product Implementation。

至少應檢查：

1. Movement Authority
2. Workspace Authority
3. Completion Authority
4. Archive Lifecycle Authority
5. Workflow Authority
6. Cloud Write Authority
7. SoT / Fallback Authority
8. Board Instance Published Workflow Adoption
9. Subject Adapter Binding / Current Step Conformance

合法 Capability Difference（例如 Investment read-only、WorkTodo 不啟用 Engineering Acceptance）必須由宣告式 Capability Contract 判斷，不得把「未採用某能力」直接判成 Consumer Bug。

## 15. QA Plan（後續，不是本輪執行）

### Contract / Schema / RLS QA

- C Shared Policy 只有一個 Current Policy Source。
- C Mother、AI Board、GAS、WorkTodo 各自 Instance scope 不互相解析。
- Published Workflow / Completion Step 僅接受同一 Instance 的正式 binding。
- WorkTodo adapter subject 只能讀寫自己的 `user_tasks`。
- Anonymous / unauthenticated write 被拒絕。
- RLS / owner boundary 沒有擴張。

### Adapter QA

- `board_tasks` 與 `user_tasks` 使用同一 C Action Contract，不出現第二套 Policy / Decision。
- `user_tasks.completed_at`、`archive_due_at`、`archived_at` 映射正確。
- Existing `archive_due_at` 不 retroactive change。
- Missing Context / invalid adoption / invalid mapping 全部 fail closed。
- Adapter retry、並行 action、重複 action 不重複 Archive / Audit。

### Consumer QA

| Consumer | 必測 |
|---|---|
| C Mother | 若未 Published Workflow，維持 `not_adopted` / fail closed；不得借 AI Board |
| AI Board | 現有 C v2 path 不 Regression；不回到 global archive route |
| GAS | 未採用時 fail closed；若無 Completion Capability，合法 N/A |
| WorkTodo | `user_tasks` storage 保留；C policy / lifecycle decision 唯一；Reload / New Session 一致 |
| Investment | read-only；不取得 Completion / Archive / Workflow Editing |

### 48 → 72 Future Change Test

在 Target Contract 完成後，修改 C Shared Policy version / delay 時，WorkTodo JS、WorkTodo RPC、WorkTodo Trigger、WorkTodo Repository 都應為：

```text
NO CHANGE
```

既有 `archive_due_at` 保持不變；新合法 Completion Action 才讀取新的 C Policy version。

## 16. Rollback Boundary

### 可回滾

- 尚未完成 Adoption 的 Consumer 保持 `not_adopted` / fail closed。
- 停用未完成的 Adapter / Contract version，不改既有 storage data。
- 保留 `user_tasks` / `board_tasks` Identity、timestamps、Audit。
- 以 Contract / Adapter version 回退，不重算歷史 `archive_due_at`。
- Scheduler 尚未加入；未來若加入，停止 invocation 不得改寫 Completion Result。

### 不可接受

- 把 `user_tasks` 搬成 `board_tasks`。
- 為了通過 QA 借用 AI Board Workflow。
- 同時啟用 C writer 與 WorkTodo writer。
- 重新開啟 WorkTodo 48h Policy 作永久 Current Authority。
- 用 status、Workspace label、Consumer 名稱或時間猜測 Workflow Context。
- 批次修改既有 WorkTodo Completion / Archive timestamps。
- 以 Compatibility Read 覆蓋 C Current State。

## 17. Final Recommendation

### Recommended order

**YES：先做 P4A-1，再做 P4A-2，最後才回到 P4B WorkTodo Cutover。**

1. **P4A-1 Generic Published Workflow Adoption / Board Context**
   - 先鎖定目前 Owner Rule 的實作語意：每個 Board Instance 自己有 Published Workflow，C 提供同一套 Adoption Capability。
   - 若要跨 Instance 共用同一 Published Version，先另做正式 Architecture / Schema Decision；本輪不假定。
2. **P4A-2 Storage-agnostic C Lifecycle Adapter**
   - 建立 Subject Identity、Instance / Workflow / Step Context、Adapter allowlist、C-owned Decision、subject-aware idempotency 與 Audit shape。
   - 讓 `board_tasks` 與 `user_tasks` 成為兩個 Data Adapter，而不是兩套 Lifecycle Engine。
3. **P4B WorkTodo Adapter Adoption / Cutover**
   - WorkTodo 取得自身正式 Published Workflow / Context 後，才將 `user_tasks` 接入 C Contract。
   - 完成單一 writer cutover，確認沒有雙寫，再進 P5 Legacy Retirement。

### Current stop decision

本輪不能安全進 P4B，因為 WorkTodo 目前沒有 Published Workflow binding，也沒有可唯一解析的 C Current Step Context。直接接現有 P2 Board RPC 會違反 Storage Boundary，直接保留 WorkTodo trigger 作為新路徑 writer 會保留 Duplicate Authority。

## 18. PM / GPT Review Items

以下是後續 Implementation 前必須以現有 Architecture 為基礎確認的設計邊界；不是本輪自行決策或 Apply 的項目：

1. 維持「Board Instance 是 Workflow Owner」時，WorkTodo 是否建立自己的 Published Workflow Definition，再由同一 C Adoption Capability 採用。
2. 若產品一定要求「同一個 Published Workflow Version 可被多個 Board Instance 直接採用」，是否另開 reusable Workflow Library / identity 的 Schema Review。
3. C Subject Binding 要採獨立 additive table，或採 Consumer storage 的 additive context columns；兩者都不得形成 Shadow Task 或第二 Policy Authority。
4. `needs_adoption_context` 與 `needs_pm_classification` 的正式錯誤枚舉與 PM 呈現文字。
5. WorkTodo Completion Capability 是否在取得正式 Published Workflow 前保持 disabled / fail closed。

## 19. P4A Completion Record

- Consumer Adoption Gap：`GENERIC C CONSUMER ADOPTION GAP`；WorkTodo 另有 `STORAGE / CONTEXT ADAPTER GAP`。
- Existing Formal Adoption Contract：`YES / PARTIAL`；目前是 `board_tasks + same Board Instance` scope。
- Multiple Board Instances Can Adopt One Published C Workflow：`NO` under current owner schema / RPC。
- Storage-agnostic Lifecycle Contract：`FEASIBLE`，但尚未實作。
- C Mother / GAS / WorkTodo：未偽造 Published Workflow；維持 `NOT ADOPTED / FAIL CLOSED`。
- WorkTodo `user_tasks` Storage：保留；未搬表、未建立 Shadow Task。
- Existing archive timestamps：未變更；不 retroactive recalculate。
- Detection V2：`Authority + Adoption Binding Conformance = RECOMMENDED`，不併入本輪。
- Source / Cloud / Data / RPC / Trigger Mutation：全部 `0`。

**P4A Read-only Design 完成。依 PM 指示 STOP；不進 P4B、P5、Scheduler、Detection V2、Deployment 或 Candidate Packaging。**
