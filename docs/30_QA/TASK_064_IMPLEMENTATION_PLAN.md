# TASK-064｜Shared Completion Archive Lifecycle Implementation Plan

> 本文件是 Implementation Plan / Change Map，不是本輪實作。
>
> 本輪只新增設計文件；不修改 Product Source、RPC、Trigger、Schema、Cloud Data、TASK、Deployment 或 Candidate。

## 0. Baseline and Scope

| 項目 | 值 |
|---|---|
| Product Version | `0.9.0-alpha.9.13` |
| Runtime Build | `20260912-0921` |
| Source Baseline | `6131cb9b267bedbd308e855645344bcc493279e0` |
| Candidate | `20260912-1008-Source-Cleanup-WorkTodo-RED-Remediation` |
| Current architecture decision | Module C Canonical Completion Archive Lifecycle Contract |
| Current plan mutation | Product Source `0`; Cloud/Data `0` |

既有 Audit 已證明：AI Board 有 board lifecycle path，WorkTodo 有獨立 `user_tasks` lifecycle path；C Mother、GAS、Investment 尚未完成同等 Instance-scoped Archive Adoption。這份 Plan 的目的，是先鎖定如何收斂，不在本輪直接執行。

## 1. Recommended Phase Order

依相依性與資料風險，建議順序如下：

```text
P0 Contract / Caller Freeze
  → P1 C Shared Policy + Canonical Contract
  → P2 Instance / Workflow-scoped Reconciliation
  → P3 Board Consumer Adoption
  → P4 WorkTodo Data Adapter Adoption
  → P5 Legacy Route Transition / Retirement
  → P6 Background Scheduler
  → P7 Full Regression / PM Runtime QA
```

每個 Phase 都必須遵守：

```text
Implement → Developer QA → Scoped Regression → Read-back → STOP / Rollback Gate
```

不採用 Big Bang。P3 與 P4 分開，避免 WorkTodo 的不同資料模型把 Board C 流程一次帶入所有 Consumer。

### P0｜Contract / Caller Freeze

**目的**：建立最後一次 Caller、Cloud function、Trigger、RLS inventory，確認沒有漏掉的正式寫入路徑。

- Implement：只建立測試與 inventory，不改 runtime authority。
- Developer QA：所有 Completion／Archive caller 均有分類與預期 owner。
- Regression：確認既有 C Movement、Completion、WorkTodo、Investment read-only 不變。
- STOP：若發現未能辨識的正式 writer，停止進入 P1。
- Rollback：刪除僅限測試／文件 inventory；不涉及資料。

### P1｜C Shared Policy + Canonical Contract

**目的**：先讓 48 小時政策只有一個 C Cloud SoT。

- 建立或沿用單一 C Shared Policy representation。
- 定義 Completion、Reopen、Due Reconciliation、Archive 的統一 input/output。
- `archive_due_at` 由 C Policy 計算；Consumer 不再提供 interval。
- 以 authenticated、owner、Board Instance scope 與既有 RLS 建立 Contract QA。

**Gate**：Policy read-back、idempotency、failure atomicity、48→72 policy-version test 全部 PASS 才能進 P2。

### P2｜Instance / Published Workflow-scoped Reconciliation

**目的**：消除 global first-completed-workspace authority。

- Completion Step 從該 Board Instance 的 Published Workflow resolve。
- Archive Reconciliation 必須以 `board_instance_id`、Card Identity、Workflow Version 與 lifecycle timestamps scope。
- 不從 Workspace name、status、assignee 或 TASK ID 猜流程。
- Read-triggered path 與未來 Scheduler 都呼叫同一 C Reconciliation。

**Gate**：兩個 Board Instance 可有不同 Completion Workspace，互不誤封存；同一 Card retry 不重複 Audit／Archive。

### P3｜C Mother / AI Board / GAS Adoption

**目的**：先完成 `board_tasks` 型 C Consumer 的共用接入。

- C Mother 先作 canonical reference consumer。
- AI Board 改由 scoped C Contract 取得 Completion／Archive。
- GAS 依自身 Published Workflow 與 Capability 採用，不套用 AI Board 的 Step／Workspace。
- Consumer 只提供 board instance identity、card identity 與 extension data。

**Gate**：C Mother、AI Board、GAS 各自的 Completion／Archive／Reopen／Reload／New Session matrix PASS。

### P4｜WorkTodo Data Adapter Adoption

**目的**：保留 `user_tasks`，移除 WorkTodo 對 48h Policy 與 Archive Decision 的 ownership。

- 建立可驗證的 WorkTodo Subject / Board / Workflow binding。
- WorkTodo UI 只送 Completion／Reopen intent，不自行填寫 `archive_due_at`。
- `user_tasks` 的結果仍由既有資料模型保存。
- Existing `user_tasks` trigger／RPC 先轉成 C Adapter 或 fail-closed compatibility path，再停用其政策決定權。

**STOP**：若沒有安全的持久化 binding，不能以 `status='completed'` 或 Workspace 名稱猜測；停在 Schema／Contract Gate。

### P5｜Legacy Route Transition / Retirement

**目的**：新 Contract PASS 後才收斂舊 writer。

- 先完成 Caller Inventory、Consumer Adoption、Reconciliation、Regression。
- 舊 public route 先改為受控 wrapper／Compatibility Read（僅適用讀取者）。
- 確認無正式 caller 後才 revoke／disable，再移除 Source／Migration residue。

**Gate**：不能留下兩套可寫的正式 Archive Authority。

### P6｜Background Scheduler

**目的**：落實「滿 48 小時自動封存」的真正產品語意。

- Cloud scheduler 只呼叫 C Canonical Reconciliation。
- 不直接 DML Consumer table。
- Read-triggered Reconciliation 保留作延遲／失敗補償安全網。
- Scheduler 失敗不改寫 Completion Result；下次執行可透過 idempotency 重試。

**Gate**：離線無使用者讀取時，逾期 Card 仍能在 Cloud 被封存；成功與失敗均有 Audit／監控。

### P7｜Full Regression / PM Runtime QA

- Developer QA 與 PM Runtime QA 分離。
- 需要 PM 操作的清單建立在既有 AI Board PM Task，避免 duplicate task。
- 狀態：`Pending Runtime QA`，不得由 Developer 自行標 PASS。

## 2. Exact Change Map

以下為預計 Change Boundary；本輪沒有執行任何項目。

### CREATE（預計）

| Path / Object | 類型 | 用途 | 邊界 |
|---|---|---|---|
| `docs/supabase/<timestamp>_c_completion_archive_lifecycle.sql` | Migration | C Shared Policy、subject binding（若現有 Schema 無法表達）、RLS、Canonical RPC | Additive only；正式 Apply 前重新做 Schema Review |
| `tests/c-completion-archive-lifecycle.test.js` | Test | C Policy、scope、atomicity、idempotency、consumer matrix | 不建立第二 Workflow Engine |
| `tests/c-completion-archive-lifecycle-browser.html` | Browser QA fixture | Developer／PM Runtime 分界測試 | 只用辨識明確的 QA data；不進 Production Data |
| `docs/30_QA/TASK_064_IMPLEMENTATION_EVIDENCE.md` | QA evidence | 各 Phase QA／Cloud read-back | 只記錄實際證據，不偽造 PM Acceptance |

`<timestamp>` 是實作當日的正式 migration filename，不在 Plan 階段預先捏造版本或 Migration ID。

### MODIFY（預計）

| Path / Object | 目的 |
|---|---|
| `shared/board/board-read-service.js` | 在既有 C shared service 內暴露唯一 Completion Archive capability；Instance／Workflow scope 由 Cloud resolve；不新增第二 Service authority |
| `shared/components/golden-master-runtime.js` | 將 C runtime 的 Completion／Archive read/write 接到 shared capability；不改 C presentation／A+C composition |
| `shared/components/task-action-adapters.js` | 只傳遞既有 C capability／Adapter context，不自行決策 Archive |
| `modules/worklog/worklog-app.js` | WorkTodo completion／reopen 改送 shared C intent，不再由 UI 產生 48h lifecycle fields |
| `modules/worklog/components/worktodo-task-adapter.js` | 將 WorkTodo 宣告為 C Completion Archive Data Adapter；保留 WorkTodo product capability |
| `shared/api/data-service.js` | 移除 WorkTodo 自有 Archive writer 的正式 runtime authority，改由 C Adapter 結果回填／讀取 |
| `shared/api/repositories.js` | 保留 `user_tasks` CRUD，但 lifecycle write／reconcile 改走 C Contract adapter |
| `docs/20_MODULES/SHARED_TASK_DRAWER_COMPATIBILITY_ASSESSMENT.md` | 更新 WorkTodo 為 Adapter，不再宣稱有獨立 TASK-064 authority |
| `docs/30_QA/SOURCE_AUTHORITY_AUDIT.md` | 記錄 Authority transition、Caller inventory、Legacy retirement evidence |

### KEEP（不作功能重寫）

| Path / Object | 保留原因 |
|---|---|
| `shared/board/board-read-service.js` 的 C shared service boundary | 目前 C Mother、AI Board、GAS 等共用入口；以增量 capability 收斂，不另建 parallel engine |
| `board_tasks` 的 Card Identity 與既有 lifecycle columns | 保留既有資料、Audit、`completion_at`、`archive_due_at`、`archived_at` |
| `user_tasks` data model | WorkTodo 資料模型保留，僅移交 lifecycle policy authority |
| `shared/board/board-read-service.js:isArchiveTask()` | 暫作相容讀取／呈現；不得被當作 Cloud write authority |
| Investment read-only capability | 合法產品差異，不採用 Completion／Archive |
| Existing Published Workflow versions | immutable；不因新 Policy 偷改既有 Card binding |

### DEPRECATE（採用完成後）

- `board_c_reconcile_workspace_decision`
- `board_move_task_workspace`
- `board_reconcile_pm_acceptance_lifecycle`
- global `board_reconcile_completion_lifecycle`
- `worktodo_apply_completion_lifecycle`
- `worktodo_reconcile_completion_lifecycle`

它們在 transition 期間可保留為受控 compatibility wrapper，但不得繼續作為第二個正式 Policy／Archive writer。

### REMOVE LATER（不是本輪）

只有在 New Contract、Caller Inventory、Consumer Adoption、Reconciliation、Regression 全部 PASS 後，才可評估移除：

- v1 direct lifecycle writer／transition route
- global completion archive implementation
- WorkTodo 自有 48h trigger／reconciler
- 沒有 caller 的 legacy migration／test residue

`board_c_workflow_reconcile_legacy_card_v2` 在歷史 Card 安全 Mapping／Reverification 完成前保留為 **MIGRATION ONLY**，不得移除。

## 3. Expected Cloud Changes

### 3.1 Expected additive migration

若 Current Schema 沒有可用的 binding，預計需要：

1. 一個 C Shared Policy 的 Cloud SoT（immutable version、duration、effective state）。
2. 一個可辨識不同資料模型的 Subject / Adapter binding；只保存 identity／workflow context，不複製 task master data。
3. 保留既有 `board_tasks`／`user_tasks` lifecycle columns。
4. RLS：Board Instance owner／authorized role、WorkTodo user boundary、Investment read-only boundary。
5. 必要 index／unique constraint，避免同一 Subject 同時建立重複 active lifecycle action。

這些只是預計方案。若現有 Schema 可以安全表達，優先 reuse；若需要 destructive change、批次猜測或削弱 RLS，立即 Schema STOP。

### 3.2 Expected RPC changes

不建立第二 Workflow Engine；預計收斂為既有 C Contract family 內的受控 action：

- `board_c_reconcile_workspace_decision_v2`：保留 C Workflow Decision，Completion／Reopen 時呼叫同一 C Archive Lifecycle。
- 一個 C Canonical Completion Archive action／reconciliation contract：支援 `complete`、`reopen`、`reconcile_due`，subject type 只允許明確 allow-list。
- `board_reconcile_completion_lifecycle`：由 global writer 轉為 scoped wrapper／transition compatibility，最後停用。
- `worktodo_reconcile_completion_lifecycle`：由獨立 writer 轉為 C Adapter wrapper，最後停用。
- `board_c_workflow_reconcile_legacy_card_v2`：保留 Migration Only，不作一般 Archive scheduler。

任何 RPC 都不得接受任意 table／column／Consumer policy 作為輸入，也不得讓 browser 直接 DML。

### 3.3 Expected trigger changes

- `worktodo_completion_lifecycle_before_write`：在 WorkTodo caller 遷移後，不再自行計算 `+48 hours`；可暫留為 fail-closed consistency adapter，最終停用。
- `board_tasks` 現有 identity／workflow binding trigger 保留；不得新增 Consumer-specific Archive trigger。
- 不以 DB trigger 取代 C Decision；trigger 只能維持 adapter storage invariants。

## 4. Authority Transition Map

| Consumer | Before Authority | Transition | After Authority | Migration fallback | Rollback boundary |
|---|---|---|---|---|---|
| AI Board | C v2 Completion writer + global board archive RPC | 先切 Completion／Archive 到 Instance-scoped C Contract | C Canonical Contract + AI Board workflow data | C read-time safety reconciliation；不回到 global writer 作正式新 action | 保留既有 timestamps／Audit；停止新 Adapter，不重算舊 due |
| C Mother | C shared movement/read；目前沒有完整 Archive Adoption | 以自身 Published Workflow 綁定 Completion Step，再啟用 capability | C Canonical Contract + Mother Board Instance | 若 binding 不完整則維持原狀、fail-closed | 不修改 Card Identity；未 adoption card 留待正式 reconciliation |
| GAS | C Instance runtime；目前沒有完整 Archive Adoption | 以 GAS Board Instance／Workflow Adoption 接入 | C Canonical Contract + GAS data adapter | Compatibility Read only；不套 AI Board 完成規則 | 保持 GAS data／Vendor 功能；停用未完成 adapter |
| WorkTodo | `user_tasks` direct Repository + trigger + WorkTodo reconciler | 建立 subject binding，先切 read-back，再切 write，最後停用 trigger authority | C Canonical Contract + WorkTodo Data Adapter + `user_tasks` | 只讀既有 lifecycle 欄位；若無 binding，拒絕猜測並保留原狀 | 不將 `user_tasks` 改表；保留既有 data/audit，不批次重算 |
| Investment | Read-only / Position Projection；無 Completion | 不採用 Archive capability | Read-only，C movement／Archive 仍 disabled | 無 | 不因 C adoption 改變 Investment 權限 |

過渡期的 fallback 只能是 Compatibility Read 或 fail-closed；不能讓舊 writer 與新 C writer 同時作正式決策。

## 5. Canonical C Contract Interface

### 5.1 Common input

```text
subject_type
subject_id
board_instance_id       # Board subject 必填
workflow_version_id     # Published binding
current_workflow_step_id
target_step_id / target_workspace_id
action                   # complete | reopen | reconcile_due
idempotency_key
actor / authorization context
```

`target_workspace_id` 只能作為 PM／Runtime intent；C Contract 必須由 Published Workflow 驗證其唯一對應的 Step，不得反推 Workflow。

### 5.2 Read Contract

回傳至少包含：

- Subject／Card Identity
- Board Instance Identity
- Published Workflow Version
- Current Step／Completion Step
- Completion Capability
- `completion_at`
- `archive_due_at`
- `archived_at`
- C Policy Version／Policy Source
- lifecycle state
- latest relevant Audit reference

Read 不得因缺 binding 自動補寫資料。

### 5.3 Write Contract

`complete`：

1. 鎖定 Subject。
2. 驗證 Board Instance、Published Workflow、Target Completion Step 與必要 Gate。
3. 使用 C Shared Policy 計算 `archive_due_at`。
4. 原子寫入 Completion Result、timestamps、Audit。

`reopen`：

1. 保留既有 Completion／Acceptance Audit。
2. 清除目前 active archive window 的 due state。
3. 原子寫入新 Current Step／State 與 Reopen Audit。

### 5.4 Reconciliation Contract

`reconcile_due`：

- 只掃描明確 scope 的 Subject。
- 條件為 Cloud `archive_due_at <= server_now` 且尚未 archived。
- 使用 row lock + idempotency。
- 寫入 `archived_at` 與 C Audit。
- 不改 Completion Result，不搬移到另一個 Workspace。

### 5.5 Authorization / Failure

- Browser 使用 authenticated session，不持有 service role。
- Board Instance owner／正式授權角色驗證由 Cloud 保持。
- WorkTodo 只能透過其 Adapter 的 Subject boundary。
- Investment 不取得 Write／Completion／Archive。
- binding、Published Workflow、Policy 或 Gate 不成立時，整個 action atomic fail，Card／State／Audit 不產生半套結果。
- 錯誤必須回傳 structured code、缺少的 context／gate、是否已 mutation；不能只有空 response body。

## 6. Single Policy Source Verification

Implementation 前後都要有自動檢查：

1. Current Runtime Source 不得出現 Consumer-specific `48 hours`、`48h`、`2 days` 或 archive interval calculation。
2. Consumer 不得自行寫 `archive_due_at` 的 policy value。
3. C Contract／C Shared Policy 是唯一 current writer。
4. Historical migration／compatibility 文件可保留 literal，但必須標示 `MIGRATION ONLY` 或 `HISTORICAL REFERENCE`，不可成為 Runtime caller。
5. Cloud `pg_proc` inventory 必須確認所有 current writer 不是第二套 policy authority。

這不是單純 grep。還要以 Caller Inventory + Cloud function definition + Trigger inventory 證明 `48h` 沒有被另一個可達 writer 使用。

## 7. Detection Mechanism Gap（獨立於 TASK-064 Implementation）

### 判定

**C Detection Mechanism Gap = CONFIRMED。**

目前 Parity / Consistency checker 主要檢查：

- Feature／Capability inventory
- C Mother 與 Consumer 的來源／版本／Fingerprint
- UI／Function／Template parity
- 已宣告的 Consumer Capability Difference

它沒有檢查：

- 實際 Runtime Route 到哪一個 RPC／Trigger
- 哪個 Function 可以寫 Completion／Archive 欄位
- WorkTodo 是否擁有第二個 Archive Policy writer
- Cloud Function Grant／Trigger／Caller 是否偏離 C Authority

因此 WorkTodo 的 Duplicate Authority 可以在 `15/15` 與 Fingerprint MATCH 時仍未被 Detect。

### Recommendation

**Authority Conformance Layer = RECOMMENDED。**

建議成為未來獨立的第四層 Governance／Detection Contract：

1. Movement Authority
2. Workspace Authority
3. Completion Authority
4. Archive Lifecycle Authority
5. Workflow Authority
6. Cloud Write Authority
7. SoT／Fallback Authority

它應以宣告式 Contract、Cloud function／trigger／grant inventory 與 Runtime caller evidence 比對，不以檔名猜測，也不以「版本不同」直接判 FAIL。

**Scope boundary**：第四層 Checker Upgrade 不併入 TASK-064 Product Implementation Change Set；本輪只記錄 Gap，不修改 Checker。

## 8. QA Plan

### Developer QA

- C Policy read/write/reconcile Contract。
- Board Instance／Published Workflow scope。
- Completion／Reopen atomicity。
- 48h due calculation only from C Policy。
- 48→72 new Policy version；existing `archive_due_at` unchanged。
- C Mother、AI Board、GAS adoption。
- WorkTodo adapter with `user_tasks` unchanged as data model。
- No Consumer-specific interval／writer。
- Idempotency、retry、concurrency、failure atomicity。
- Investment read-only regression。
- Reload／New Session Cloud read-back。

### PM Runtime QA

Implementation 完成後，在既有 AI Board PM Task 建立或更新一張正式 QA checklist；優先避免 duplicate Task。狀態：`Pending Runtime QA`，Owner：PM。

必要 checklist：

1. AI Board：完成 → 等待 48h → Cloud archive read-back。
2. AI Board：Reopen 保留原 Completion Audit，取消 active due window。
3. C Mother：不同 Completion Workspace 的 scoped archive。
4. GAS：自身 Workflow Completion／Reload。
5. WorkTodo：`user_tasks` Completion／Archive／Reload／New Session。
6. WorkTodo：重試不重複 Archive／Audit。
7. Investment：仍不可使用 Completion／Archive。
8. 多 Board Instance：不得跨 Instance 誤封存。
9. 離線無 Read（若 Scheduler 完成）：到期後 Cloud 自動 reconcile。

PM 不需要輸入工程 Evidence；Runtime Action Context 由正式 Contract 產生。

## 9. Legacy Retirement Plan

退休條件固定為：

```text
New Contract PASS
→ Caller Inventory PASS
→ Consumer Adoption PASS
→ Reconciliation PASS
→ Regression PASS
→ Legacy Caller Disable
→ Legacy Code Removal
```

在此之前：

- 不刪 `board_c_reconcile_workspace_decision`、`board_move_task_workspace` 或其他舊 route。
- 不刪 WorkTodo trigger／RPC。
- 不把 global board reconciler 接給 WorkTodo。
- 不讓 legacy writer 透過 compatibility path 覆蓋 C Policy。
- `board_c_workflow_reconcile_legacy_card_v2` 僅作安全 Migration／Reverification。

## 10. Rollback Boundary

### 可回復

- 停用尚未完成 adoption 的 Consumer Adapter。
- 停止 Scheduler invocation。
- 保留既有 Card／Task Identity、timestamps、Audit。
- 未能安全 Mapping 的 Card 維持原狀並標記待 reconciliation。
- 退回 C Contract／Adapter 版本，不重算歷史 due time。

### 不可接受

- 批次清除或重算 `completion_at`／`archive_due_at`。
- 把 `user_tasks` 改成 `board_tasks` 以繞過 Adapter 設計。
- 恢復 WorkTodo 私有 48h Policy 作永久正式 authority。
- 以 Workspace、status、assignee、TASK ID 猜 workflow。
- 為了 rollback 重新啟用第二套正式 Workflow／Archive Engine。

## 11. Implementation Stop Gates

任何一項發生即停止：

- 需要 destructive Schema Change。
- 無法取得 WorkTodo 的持久化 Subject／Workflow binding。
- 需要修改 Board／Card Identity。
- 需要批次猜測歷史 Card。
- 需要削弱 RLS 或授予 browser service role。
- C Contract 與現有 v2 無法安全相容。
- Consumer 必須 fork C Workflow／Archive Engine。
- Scheduler 只能直接 DML，無法走 C Contract。
- Cloud／Runtime 出現無法解釋的 scope drift。

## 12. Final Plan Answers

1. **Recommended Phase Order**：P0 → P1 → P2 → P3 → P4 → P5 → P6 → P7。
2. **Exact Change Map**：以 `shared/board/board-read-service.js` 與既有 C runtime 為 shared boundary；新增最小 Cloud Policy／Subject binding／QA artifacts；WorkTodo 僅改 Adapter route。
3. **Expected Migrations**：C Shared Policy、必要的 Subject binding、RLS／unique constraint；全部 additive，Apply 前仍須 Schema Review。
4. **Expected RPC Changes**：既有 C v2 Decision 接入唯一 Completion Archive Contract；舊 route 先 wrapper／compatibility，再依 Gate 退休。
5. **Expected Trigger Changes**：WorkTodo trigger 不再計算 48h；過渡期 adapter／fail-closed，最終停用獨立 policy authority。
6. **Consumer Adoption Changes**：C Mother、AI Board、GAS 依自身 Board Instance／Workflow；WorkTodo 以 `user_tasks` Adapter；Investment 不採用。
7. **Legacy Retirement Plan**：New Contract → Caller → Adoption → Reconciliation → Regression → Disable → Remove。
8. **Scheduler Plan**：最終推薦 Cloud Background Scheduler；只呼叫 C Reconciliation；Read-triggered 保留 Safety Net。
9. **Rollback Boundary**：只回退 Contract／Adapter／Scheduler 版本，不回寫歷史 Card、Identity 或 timestamps。
10. **C Detection Mechanism Gap**：**CONFIRMED**。
11. **Authority Conformance Layer**：**RECOMMENDED**，但必須是獨立 Change Set，不併入 TASK-064 Product Implementation。

## 13. Design-only Completion Record

- Product Source Mutation：`0`
- Cloud Mutation：`0`
- Data Mutation：`0`
- RPC／Trigger／Migration Apply：`0`
- Deployment／Push／Candidate Repackaging：`0`
- 本輪唯一新增：本 Implementation Plan 文件

**TASK-064 Implementation Plan 完成，STOP，等待 PM／GPT 核准後才進入 Schema／Contract Implementation。**
