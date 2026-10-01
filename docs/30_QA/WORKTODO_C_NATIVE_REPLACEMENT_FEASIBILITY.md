# WorkTodo C-native Replacement Feasibility Audit

> 狀態：READ-ONLY FEASIBILITY AUDIT / STOP GATE
>
> 本文件只比較「Option A：Legacy WorkTodo Refactor」與「Option B：C-native WorkTodo Replacement」。本輪不 Coding、不建立新 WorkTodo、不建立 Workflow Binding、不 Migration、不修改 Cloud/Data/RPC/Trigger、不 Deployment、不 Push、不 Candidate Packaging。

## 0. Audit Baseline 與邊界

| 項目 | 本輪值 |
|---|---|
| Product Version | `0.9.0-alpha.9.13` |
| Runtime Build | `20260912-0921` |
| Current Development HEAD | `ba835017b78c8c25ce4e6fa938218ae91f15cd3d` |
| Branch | `codex/task-063-delete-card-20260907` |
| Protected Candidate Baseline | `6131cb9b267bedbd308e855645344bcc493279e0` |
| P1 / P2 / P3 | 保留；不 Rollback |
| P4 / P4A Implementation | 暫停；本輪只做可行性審查 |
| Product Source Mutation | `0` |
| Cloud Mutation | `0` |
| Data Mutation | `0` |
| RPC / Trigger Mutation | `0` |
| Deployment / Push / Candidate | `0` |
| Audit artifact | 本文件新增；不屬於 Product Runtime 修改 |

### 0.1 判讀方法

本審查以目前 Source、已存在的 Supabase Contract read-back、既有 P1/P2/P3 evidence 與 P4A design evidence 為準。沒有把「有一個名稱相似的 RPC」當成完整能力，也沒有把 Module Release adoption 當成 Workflow adoption。

功能 Parity 百分比不是產品品質分數。為了讓兩個方案可比較，本文件對下列 25 個維度採用明確規則：

- `SAME` 或 `C SUPERSET` = 已有可比較／可由 C 能力涵蓋的維度。
- `SEMANTIC DIFFERENCE`、`DATA MODEL DIFFERENCE`、`NOT ADOPTED`、`WORKTODO ONLY` = 目前不能視為可直接替代。
- 計算：`(SAME + C SUPERSET) / 25`。本次結果為 `13 / 25 = 52%`。

## 1. Executive Decision

| Required answer | 結論 | 判定 |
|---|---|---|
| Option B 是否繞過 Generic Adoption Gap？ | **NO** | `RED / 不成立` |
| Existing C-native Consumer Creation Contract | **PARTIAL** | `YELLOW / 有片段能力，非端到端 Contract` |
| Feature Parity | **52%**（審查口徑；strict SAME 為 `7/25 = 28%`） | `YELLOW` |
| Data Migration Feasibility（Option B） | **LOW** | `RED / 不宜作為短期捷徑` |
| Option A Implementation Complexity | **MEDIUM** | `YELLOW` |
| Option B Implementation Complexity | **HIGH** | `RED` |
| Option A Legacy Debt（完成 Cutover 後） | **LOW-MEDIUM** | `YELLOW` |
| Option B Legacy Debt（完成 Cutover 前後） | **HIGH** | `RED` |
| TASK-064 是否因 Option B 而簡化？ | **NO** | `RED / Generic Adoption 仍必要` |
| Generic Adoption 是否仍必要？ | **YES** | `GREEN / 架構必要條件` |
| Final Recommendation | **OPTION A** | `HIGH confidence` |

### 1.1 最重要的結論

Option B 不能因為「新 Consumer 是由 C 產生」就跳過 Board Instance Adoption。依已核准的 Owner Rule，Workflow 的 Owner 仍是 **Board Instance**；新 WorkTodo 仍要有自己的 Published Workflow Definition / Pointer / Current Context。C-native 只代表使用同一套 C Capability / Engine，不代表一個新 Board Instance 可以沒有自己的正式 Workflow binding。

Option B 還要處理 `user_tasks` 到 C-native storage / read model 的資料轉換、Identity / reference / attachment / journal / ordering / historical timestamps 的保留與回滾，因此沒有消除 Generic Adoption Gap，反而多一個高風險 Data Migration 與 Entry Cutover。

## 2. Current C → Consumer Creation Contract

### 2.1 目前已存在的正式片段

| Layer | 現有 Source / Contract | 已證明的責任 | 尚未提供的能力 |
|---|---|---|---|
| C provisioning | `shared/board/board-read-service.js` 的 `provisionConsumer()` → `board_provision_consumer` | 受控建立 Board Instance、建立預設 Workspaces、讀取 C Module Release、記錄 Module Consumer adoption | 沒有建立該 Instance 的 Published Workflow Definition / Workflow Pointer；不是完整 C-native WorkTodo 建立 Contract |
| Board primitive | `board_create_instance` | 受控建立 Board Instance；現有 Security hardening 不讓 Browser 直接取得低階建立權限 | 不是面向 Consumer 的完整 provisioning + workflow + runtime adoption 流程 |
| Module release | `publish_module_release`、`record_module_adoption`、`shared/services/template-release-service.js` | Module C Source / Build / Release adoption | Module Release adoption ≠ Board Workflow adoption；不產生 `board_instance_workflow_state` |
| C Workflow | `board_c_workflow_get`、`board_c_workflow_request_adoption`、`board_c_workflow_approve_adoption`、`board_c_workflow_set_step_mapping`、`board_c_workflow_apply_card_mapping` | 同一 Board Instance 內的 Draft / Published / Adoption / Step Mapping / Card Binding | 目前 Definition 由單一 `board_instance_id` 擁有；不能把同一 Definition id 安全當成多個 Instance 的共享 Workflow |
| C Runtime | `createInstanceService()`、`createWorkflowCapability()` | Consumer 提供 Instance Context，C 提供共用 Board / Workflow capability | 尚沒有讓任意 Consumer 以一個受控 Contract 完成「建立 Instance → 建立/採用流程 → 接上 Runtime → 回傳可用 Consumer」的端到端入口 |
| WorkTodo create | `worktodo_create_task`、`worktodoCreateTask()` | WorkTodo-specific 受控建立 task route；目前 Cloud function 仍採 WorkTodo scope / status mapping | 不是建立新 C Consumer；不能取代 Generic Adoption；不是 storage-agnostic C Lifecycle Contract |

### 2.2 Cloud read-back 的目前實況

目前可讀到的 C Board Instance：

| Consumer / Instance | `board_instance_id` | Published Workflow state | 解讀 |
|---|---|---|---|
| AI Board | `74ff1127-ab98-4543-8f69-872e5d92fd33` | `05557542-2f91-465a-bb14-3518105f9537`，`published` | 已有正式 Published Workflow |
| C Mother test instance | `b47881c5-20bd-4c7d-807a-bd331cb253ec` | 沒有 state row / pointer | 未 Adoption；維持 fail closed |
| WorkTodo | `0b2b5c4e-6767-4792-a97a-d2ddf42e60da` | 沒有 state row / pointer | 未 Adoption；不能借用 AI Board |
| GAS | `38d8d4b1-6d01-4d58-835b-b2beb61fc6b9` | 沒有 state row / pointer | 未 Adoption；維持 fail closed |
| Investment | `81f49fc7-ac0f-428e-8fcd-5ee612c52993` | 沒有 Completion Workflow adoption | Read-only 合法 N/A |

`board_workflow_adoptions` 的現況 read-back 沒有可用 adoption row。這不能解讀為「C 沒有 Adoption 功能」；只能證明目前各 Instance 沒有可拿來冒用的正式 adoption 結果。Module C 的 `consumer_adoptions` JSONB 只表示 Module Release adoption，不是 Workflow binding。

### 2.3 Option B 的關鍵推論

如果 Module C 產生新的 WorkTodo：

```text
Module C provisioning
  → 新的 WorkTodo Board Instance
  → 該 Instance 自己的 Published Workflow Definition / Pointer
  → C Adoption Contract
  → C Runtime / Adapter
```

因此 Option B **仍需要 Generic Consumer Adoption Contract**。C 可以提供一個新的共用 provisioning + adoption API，但那是把 Generic Adoption 做完整，不是繞過它。若只做 `board_provision_consumer` 而不建立 Workflow binding，結果仍是「有 Consumer、沒有可解析 Workflow」的半成品。

## 3. Does Option B Bypass the Generic Adoption Gap?

**答案：NO。**

原因有三個：

1. **Workflow Owner 不變**：核准模型是 Board Instance 擁有自己的流程。新 WorkTodo 仍然是新的 Board Instance，不能直接借 AI Board 的 Published Workflow。
2. **現有 Schema 是 Instance-scoped**：`board_workflow_definitions.board_instance_id` 必填；`board_instance_workflow_state` 以 Board Instance 為主鍵；`board_c_workflow_request_adoption()` 也要求 target Definition 屬於同一 Instance。
3. **C-native 不等於已採用**：C-native 只保證使用 C Engine。若沒有 Published Pointer、Current Step、Capability 與 Adapter Context，Runtime 仍必須 fail closed；不能因為來源是 C 就從 Workspace / status 猜流程。

### 3.1 Multiple Board Instances 結論

| 問題 | 目前答案 |
|---|---|
| 多個 Board Instance 可以使用同一套 C Engine / Capability 嗎？ | **YES** |
| 多個 Board Instance 可以直接共享同一個現有 `board_workflow_definitions.id` 嗎？ | **NO** |
| Option B 因為由 C 建立新 Consumer 就能避開這個限制嗎？ | **NO** |
| 若產品未來要求共享同一份 Workflow Data，是否需要另外的 reusable Workflow Library / Schema Review？ | **YES** |

這個「同一套程式、各自 Workflow 資料」與「同一份 Workflow row 跨 Instance 共用」必須分開，不可用名稱或 provisioning shortcut 混在一起。

## 4. Legacy WorkTodo vs Module C Feature Parity

### 4.1 25 維度比較

| # | Dimension | Current Legacy WorkTodo vs C Golden Master | 證據／判讀 |
|---:|---|---|---|
| 1 | Workspace | `DATA MODEL DIFFERENCE` | WorkTodo 以 `user_tasks` / status / WorkTodo workspace 路徑為主；C 以 Board Instance + Workspace UUID + Published Workflow 為主 |
| 2 | Card | `C SUPERSET` | C Shared Card / Board shell 已提供共用 Card Presentation；WorkTodo 有 adapter |
| 3 | Quick Create | `SAME` | 兩邊都有受控建立工作入口，但 Cloud data route 不同 |
| 4 | Move | `SEMANTIC DIFFERENCE` | C Core Movement 與 WorkTodo legacy status / workspace path 尚未由同一 C Lifecycle Context 完成統一 |
| 5 | Delete | `SEMANTIC DIFFERENCE` | WorkTodo 有自己的 task/workspace delete contract；C 有 instance-scoped delete / reconciliation semantics |
| 6 | Drawer | `C SUPERSET` | WorkTodo 透過 `worktodo-task-adapter.js` 接 Shared Drawer；C 另有共用內容與治理能力 |
| 7 | 工作內容 | `SAME` | Task title / note / summary 等基本內容可互相表達 |
| 8 | 使用情境 | `SAME` | WorkTodo `usage_scenario` 與 C task context 均有此產品語意 |
| 9 | Checklist | `SEMANTIC DIFFERENCE` | WorkTodo checklist 路徑與 C board checklist / governance checklist 不是同一資料模型 |
| 10 | Progress | `C SUPERSET` | C 有共用 progress / activity surfaces；WorkTodo 另有 progress journal |
| 11 | Attachment | `C SUPERSET` | C 有 task/progress attachment contract；WorkTodo 另有自己的 attachment storage / route |
| 12 | 約定日期 | `C SUPERSET` | C shared service 有 agreement schedule；WorkTodo 具有較完整的工作日程語意 |
| 13 | Search | `SAME` | 兩邊均有使用者側搜尋能力 |
| 14 | Filter | `SAME` | 兩邊均有篩選／檢視能力 |
| 15 | Data Health | `SEMANTIC DIFFERENCE` | WorkTodo 有個人工作資料健康／初始化語意；不能直接視為 C Board Health 同一 Contract |
| 16 | Refresh | `SAME` | 兩邊都有重新讀取 Cloud 的操作 |
| 17 | Completion | `SEMANTIC DIFFERENCE` | C Completion 是 Workflow Target + Gate + Action；WorkTodo legacy 由 `user_tasks` path 決定 |
| 18 | Archive | `SEMANTIC DIFFERENCE` | C v2 為 Instance/Workflow scoped；WorkTodo 目前由自有 trigger/RPC 寫 `archived_at` |
| 19 | Workspace CRUD | `C SUPERSET` | C 有 instance-scoped workspace contract；WorkTodo 也保留自己的產品化 CRUD 語意 |
| 20 | Ordering | `SEMANTIC DIFFERENCE` | WorkTodo 有 `sort_score` / pin / ordering；C 有 Board Workspace/Card ordering |
| 21 | Reload Persistence | `SAME` | 兩邊均以 Cloud read-back 為 Reload 來源；但目前不是同一 lifecycle route |
| 22 | Cloud Persistence | `DATA MODEL DIFFERENCE` | WorkTodo 核心是 `public.user_tasks`；C Board 核心是 `public.board_tasks` |
| 23 | Workflow | `SEMANTIC DIFFERENCE` | WorkTodo 有產品狀態流程，但目前沒有自己的 Published C Workflow binding |
| 24 | Movement Authority | `NOT ADOPTED` | C Core 有 shared authority；WorkTodo 尚未完成 Generic Adoption / Context adapter |
| 25 | Completion Lifecycle | `SEMANTIC DIFFERENCE` | WorkTodo 有 `worktodo_apply_*` / `worktodo_reconcile_*` writer；C v2 目前只安全支援 `board_tasks` |

### 4.2 Parity 結果

- `SAME`：7 項（#3、#7、#8、#13、#14、#16、#21）。
- `C SUPERSET`：6 項（#2、#6、#10、#11、#12、#19）。
- 可比較／可由 C 涵蓋：`13 / 25 = 52%`。
- 嚴格相同語意：`7 / 25 = 28%`。
- 其餘 12 項不是單純 UI 差異，而是 Semantic、Authority 或 Data Model 差異，不能假設搬到 C-native 就零成本相容。

這個數字不表示「52% 的資料可以直接搬」。資料可搬性另見第 6 節，結論較保守。

### 4.3 WorkTodo-only / WorkTodo-specific features

以下是 Legacy WorkTodo 目前仍具有、不能因 C-native replacement 而默默遺失的產品或資料責任：

- **Work Journal / 工時與工作紀錄**：`work_journal_entries` 時間軸、進度筆記、修改／刪除與附件關聯；這不是單一 task note 的替代品。
- **個人工作／工時語意**：工時月曆、時間紀錄、補登、工作描述、ECP task 與工時建議。
- **個人工作模型**：工作屬性、估時、優先級分數、pin、deadline / agreement schedule 的 WorkTodo-specific 行為。
- **WorkTodo GPT / AI 欄位**：`gpt_understanding`、`gpt_analysis`、`gpt_recommendation`、`gpt_execution_principles`、`gpt_handoff_summary` 等欄位與相關 UI。
- **知識、建議與 AI 助手整合**：Knowledge Library、學習／整理狀態、工作建議批次、AI assistant quick actions。
- **WorkTodo-specific status / ordering**：個人待辦的狀態、`sort_score`、pin、工作列表排序與其讀寫路徑。
- **WorkTodo identity / compatibility**：`WLTK` work code、`legacy_id`、既有 `user_tasks` identity 與 legacy read-only history。
- **WorkTodo-specific attachment / checklist / schedule routes**：即使 C 有相似能力，資料表、Storage path、權限與產品語意仍需 adapter / migration mapping。
- **個人工作資料健康與初始化語意**：WorkTodo 對個人資料、Journal、Knowledge / calendar 等模組的獨立初始化與 Data Health。

其中部分能力在 C Golden Master 有共用 UI surface 或更一般化的能力，但現況仍屬 `WorkTodo adapter / data responsibility`；不能把「C 有相似 UI」當作完成替換。

## 5. Authority End State：Option A vs Option B

### 5.1 Option A — Legacy WorkTodo Refactor

```text
WorkTodo UI / product features
        ↓
WorkTodo Data Adapter (user_tasks)
        ↓
Module C Generic Lifecycle Decision
        ↓
C Policy + Instance/Workflow Scope + Audit/Idempotency
```

| Authority | Option A 最終狀態 |
|---|---|
| Workflow Authority | Module C；WorkTodo Board Instance 保存自己的 Published Workflow |
| Workspace Authority | C Workflow / Instance Contract；WorkTodo 只提供 Context / Adapter mapping |
| Movement Authority | C Core；WorkTodo 不再另判定 |
| Completion Authority | C Canonical Decision Contract |
| Archive Authority | C Canonical Completion Archive Lifecycle |
| Policy Authority | `module-c-completion-archive-policy` |
| Cloud Write Authority | C Contract + allowlisted WorkTodo Adapter；`user_tasks` 仍是 storage |
| Compatibility Code | 保留 legacy read；完成 cutover 後逐步移除 WorkTodo policy writers |

### 5.2 Option B — C-native WorkTodo Replacement

```text
Module C Golden Master
        ↓
New C-native WorkTodo Consumer / Board Instance
        ↓
Generic C Workflow Adoption
        ↓
Data migration / crosswalk from user_tasks
        ↓
Entry cutover + Legacy WorkTodo retirement
```

| Authority | Option B 最終狀態 |
|---|---|
| Workflow Authority | Module C Engine；新的 WorkTodo Board Instance 仍需自己的 Published Workflow |
| Workspace Authority | C Workflow / Instance Contract |
| Movement Authority | C Core |
| Completion Authority | C Canonical Decision Contract |
| Archive Authority | C Canonical Completion Archive Lifecycle |
| Policy Authority | C Shared Policy |
| Cloud Write Authority | C-native storage adapter / C Contract；Legacy `user_tasks` 需 compatibility 或退場 |
| Compatibility Code | 過渡期至少同時處理 Legacy entry、data crosswalk、reference / attachment compatibility |

兩個方案都可以達到「最終 C Authority = 1」，但只有在完整 Adoption、Cutover、Caller Inventory、Regression 與 Legacy Retirement 後才成立。Option B 的問題是到達終點前多一個新 Consumer、資料轉換與入口切換面，且不能省掉 Generic Adoption。

## 6. Data Migration Read-only Inventory

本節只盤點 Schema / mapping 風險，沒有掃描、搬動或修改正式資料。

### 6.1 目前資料邊界

`public.user_tasks` 目前保存 WorkTodo 核心 task 與 WorkTodo-specific 欄位，包括：

- Identity / ownership：`id`、`user_uuid`、`legacy_id`、`work_code`。
- 基本內容：`title`、`note`、`due_date`、`status`、`priority`、`usage_scenario`、`work_property`。
- 個人工作資料：`estimated_minutes`、`sort_score`、`user_pinned`、`progress`、`started_at`、`deadline`、`completed_note`、`completed_by`、`completion_source`。
- GPT / AI 欄位：理解、分析、建議、原則與 handoff summary。
- Lifecycle storage：`completed_at`、`archive_due_at`、`archived_at`、`archived_by`。

`public.board_tasks` 則具備 C Board lifecycle 所需的：

- `board_instance_id`、`workspace_id`。
- `workflow_version_id`、`current_workflow_step_id`。
- Board-specific status / assignee / acceptance / evidence / completion fields。

目前 `user_tasks` 沒有 C v2 直接需要的 `board_instance_id`、`workspace_id`、`workflow_version_id`、`current_workflow_step_id`，因此不能直接把 `user_tasks.id` 當成 `board_tasks` lifecycle subject 呼叫現有 v2 RPC。

### 6.2 Option B migration matrix

| 資料類別 | Current source | Option B 判定 | 風險／注意 |
|---|---|---|---|
| Task identity | `user_tasks.id`、`legacy_id`、`work_code` | `TRANSFORM` | UUID shape 相似不代表可直接沿用 FK；需 crosswalk / identity policy，不能自動假定 Card Identity 相同 |
| Work code | `WLTK-*` | `TRANSFORM` | C-native prefix / allocator 可能不同；不得重編或碰撞，需正式 identity contract |
| Workspace | WorkTodo status / workspace route | `TRANSFORM` | 必須以目標 Board Instance Published Workflow / Step Mapping 決定，不能以 label 或 status 猜 |
| Workflow / Current Step | 目前未持久化 C binding | `SPECIAL MIGRATION` | 需要每個新 Instance 的 Published Workflow 與安全 mapping；無法判斷必須停在 classification |
| Checklist | WorkTodo checklist / related rows | `TRANSFORM` | ID、完成狀態、排序、owner 與 C checklist contract 需 crosswalk |
| Attachments | WorkTodo attachment path / Storage metadata | `SPECIAL MIGRATION` | 需保留 object reference、權限與歷史連結；搬 path 或 object 有 loss / orphan risk |
| Journal / progress | `work_journal_entries`、progress notes | `SPECIAL MIGRATION` | C Card activity 不等於 Work Journal 1:N history；直接折疊會遺失時間軸與 revision |
| Dates | due / deadline / agreement / started / completed | `TRANSFORM` | 多欄位語意不同；completion/archive timestamp 必須保留，不可因新 Policy retroactive 重算 |
| Completion / archive | `completed_at`、`archive_due_at`、`archived_at` | `SPECIAL MIGRATION` | 可保留 storage value，但 Authority 切換 boundary 與 audit 必須可辨識，不能假造歷史 C Evidence |
| Ordering / pin | `sort_score`、`user_pinned`、priority | `TRANSFORM` | C Board ordering 與 WorkTodo personal ordering 不同，可能需保留 WorkTodo extension |
| GPT fields | WorkTodo GPT columns | `TRANSFORM / SPECIAL` | C Board 欄位不一定一一對應；不能為了表面 parity 丟掉既有內容 |
| Relationships | ECP / Knowledge / calendar / suggestions | `SPECIAL MIGRATION` | 外部 references、個人模型與跨模組連結需逐類確認 |
| Audit / history | Existing WorkTodo history | `SPECIAL MIGRATION` | 必須 append-only 保留，不能將新 Reverification / C Action 偽裝為歷史事件 |

### 6.3 Feasibility

**Option B Data Migration Feasibility：LOW。**

這不是說技術上永遠不能搬，而是目前沒有足夠 evidence 證明可以在不損失 Identity、Checklist、Attachment、Journal、Ordering、Completion/Archive timestamp 與跨模組 reference 的情況下安全完成。若未來真的選 Option B，必須先另開 Data Migration Design / Schema / Security / Rollback Review，並以 dry-run / reconciliation report 證明，不得直接以三段 INSERT 或前端轉換當正式解法。

Option A 的優勢是可保留 `user_tasks` 作 storage，先補正式 C Subject Context / Adapter，避免一次搬動所有 WorkTodo product data。這不代表 Option A 零資料工作，而是把高風險 bulk migration 轉為受控 context adoption 與逐步 cutover。

## 7. Future Mother Update Test

### 7.1 C Shared Policy：48 → 72

| Change | Option A after cutover | Option B after cutover |
|---|---|---|
| 修改 C Shared Policy | C Policy 一處 | C Policy 一處 |
| 修改 WorkTodo JS | `NO` | `NO`（前提是 C-native Consumer 真正只 consume C） |
| 修改 WorkTodo RPC | `NO`；legacy RPC 只能 compatibility read / wrapper，最終退休 | `NO`；但舊 WorkTodo 若尚未退場仍有額外 legacy debt |
| 修改 WorkTodo Trigger | `NO`；新 writer 已由 C 控制 | `NO`；仍要先處理舊 trigger 的 retirement |
| 修改 WorkTodo Repository | `NO`；除非 Adapter Contract 變更 | `NO`；但 migration / compatibility route 可能仍需維護 |
| 既有 `archive_due_at` | 不重算 | 不重算；新 C-native lifecycle 只對新合法決策套新 policy |

### 7.2 C 新功能／Drawer／Movement／Workflow 發布

兩方案的理想終態都是：

```text
C Mother change
  → Publish C
  → Consumer / Board Instance adoption
  → shared Runtime reads C
```

但 Option A 只需驗證 WorkTodo Adapter 與 Board Instance adoption；Option B 還要維護新 Consumer entry、舊 WorkTodo compatibility、資料／參照 crosswalk 以及 cutover 的一致性。若 C Feature 改變 WorkTodo-specific data semantics，兩案仍需產品／資料 mapping review，不能宣稱所有 C 更新都完全零 Consumer 工作。

### 7.3 Published Workflow 更新

在目前 Owner Rule 下，Workflow 版本不是由 C Mother 全域覆蓋所有子板。對兩方案都應是：

```text
該 Board Instance 建立 Draft
  → Validate
  → Publish immutable version
  → 正式 Adoption / Step Mapping
  → 既有 Card 不自動改寫
```

因此 Option B 不會因「C-native」而把 Workflow adoption 省略；它只可能共用同一套 Adoption mechanism。

## 8. TASK-064 Impact

### 8.1 Option A 還需要的 Phase

1. **P4A-1 Generic Published Workflow Adoption / Board Context**：讓 WorkTodo Board Instance 有自己的正式 Published Workflow / Pointer。
2. **P4A-2 Storage-agnostic C Lifecycle Adapter**：以 allowlisted `worktodo_task` Subject Adapter 對接 `user_tasks`；C 做唯一 Decision。
3. **P4B WorkTodo Adoption / Data Adapter**：建立安全 binding / current-step context；沒有安全 mapping 的既有 row 不猜。
4. **Writer Cutover**：停用 `worktodo_apply_completion_lifecycle()` 與 `worktodo_reconcile_completion_lifecycle()` 作為 Policy / Archive writer；避免雙寫與 race。
5. **P5 Legacy Retirement**：完成 Caller Inventory / Regression / Compatibility Read 後才移除舊 Authority。
6. **P6 Scheduler**：若依已核准架構加入 Cloud Background Execution，Read-triggered reconciliation 保留 Safety Net。

### 8.2 Option B 還需要的 Phase

1. **Generic C-native Consumer Creation Contract**：把目前 partial provisioning 提升為 Instance + Published Workflow + capability adoption 的正式流程；這本身就是 Generic Adoption 的實作，不是 bypass。
2. **C-native WorkTodo Consumer / Adapter**：接 C Engine，但保留 WorkTodo-specific product extension。
3. **Data Migration Design / dry-run / apply**：建立 identity / reference crosswalk、Checklist / Attachment / Journal / Ordering / timestamps migration boundary。
4. **Runtime Entry Cutover**：新舊 WorkTodo route 的 read/write ownership、Reload / New Session、Deep Link / attachment reference 一致。
5. **Legacy WorkTodo Retirement**：等新 Consumer、migration、regression 與 rollback evidence 齊全才退場。
6. **P6 Scheduler**：C Scheduler 仍需要；C-native 不會自動產生 background execution。

**TASK-064 Simplification：NO。** Option B 不能省略 Generic Adoption、C Instance Scope、Storage / Context mapping 或 Scheduler；它反而增加 migration / cutover phase。

## 9. C Mother / GAS / WorkTodo / Investment Implication

| Consumer | Current evidence | Option A effect | Option B effect |
|---|---|---|---|
| C Mother | C wiring ready，但無 Published Workflow state | 由同一 Generic Adoption Contract 取得自身 binding；不借 AI Board | 不因新 WorkTodo 而自動解決；仍需 Generic Adoption |
| AI Board | 已有 Published Workflow，已走 C Authority | 可作既有 reference consumer；不應成為 WorkTodo 的 Workflow source | 同樣不能被當成新 Consumer 的隱性 source |
| GAS | C wiring ready，但無 Published Workflow state | 由同一 Contract Adoption；若不啟用 Completion 則合法 fail closed / N/A | 未被 Option B 自動修好；仍需 Generic Adoption |
| WorkTodo | `user_tasks`；有自有 lifecycle writer；無 Published Workflow state | 以 Data Adapter 保留 storage，移交 C Authority | 建新 C-native Consumer 後仍需新 Instance binding，並處理舊資料 migration |
| Investment | Read-only Capability | 不採用 Completion Archive；不取得寫入能力 | 同樣合法 N/A；不因 C-native WorkTodo 改變 |

### 9.1 Generic Adoption Gap 的範圍

這是 **GENERIC C CONSUMER ADOPTION GAP**，不是 WorkTodo-only gap。WorkTodo 另外有 storage/context adapter gap；但 C Mother、GAS 也缺正式 Published Workflow adoption，證明問題不會因替換 WorkTodo 而消失。

## 10. Migration / Cutover Authority Boundary

### 10.1 Option A

```text
Current:
  WorkTodo user_tasks trigger/RPC = lifecycle writer

Transitional:
  C Adoption + WorkTodo Subject Context ready
  legacy writer retained for rollback, but not dual-decision

Cutover:
  C Decision → allowlisted WorkTodo Adapter → user_tasks
  one writer, one audit, one idempotency result

After:
  compatibility read only → caller inventory → retire legacy writer
```

回滾邊界在 Adapter / Contract version；保留既有 `user_tasks` identity / timestamps，不以回滾重算 `archive_due_at`。

### 10.2 Option B

```text
Current:
  Legacy WorkTodo entry + user_tasks lifecycle writer

Transitional:
  C-native WorkTodo entry + new Instance Workflow binding
  legacy route read/compatibility boundary + migration crosswalk

Cutover:
  one selected entry and write authority
  migrated references / attachments / journals verified

After:
  legacy WorkTodo read-only compatibility → retirement
```

Option B 的 rollback 必須同時處理新舊 entry、identity crosswalk、references、storage paths 與已產生的 lifecycle audit；因此比 Option A 更難做到原子退回。

## 11. Engineering Cost Comparison

| Dimension | Option A | Option B | Current evidence / reason |
|---|---|---|---|
| Implementation Complexity | `MEDIUM` | `HIGH` | A 主要建立 Generic Adoption + adapter + writer cutover；B 另建 Consumer 與新 entry |
| Migration Complexity | `MEDIUM` | `HIGH` | A 以 context / adapter 為主，避免一次搬所有 task；B 需完整跨模型轉換 |
| Regression Surface | `HIGH` | `HIGH` | A 會切 WorkTodo lifecycle writer；B 同時碰新 UI/entry、資料、reference、legacy cutover |
| Compatibility Debt | `MEDIUM` → `LOW` after retirement | `HIGH` | B 過渡期有新舊 WorkTodo、crosswalk、attachment/journal compatibility |
| Future Maintenance | `MEDIUM` | `MEDIUM-HIGH` | A 保留 WorkTodo product extension；B 維護新 Consumer 與舊資料 compatibility |
| Rollback Complexity | `MEDIUM` | `HIGH` | A rollback 在 adapter/contract boundary；B rollback 需跨 entry/storage/reference |
| Risk of second authority during transition | `MEDIUM` | `HIGH` | 兩案都需防雙寫；B 新舊 Consumer 同時存在時間較長 |

這些成本不是對 Option A 的 sunk-cost 偏見：Option B 仍需完成 Generic Adoption，且額外增加資料搬移與切換風險；就目前 evidence，沒有顯示它能消除任何必要的 C foundation phase。

## 12. Security / RLS / Contract Consequences

兩方案都必須延續目前安全邊界：

- Browser 不直接 INSERT / UPDATE 正式 lifecycle tables；不給 Browser / ChatGPT `service_role`。
- C Contract 只接受 server-side allowlisted Subject / Adapter type，不接受任意 table / column / SQL。
- Board Instance / WorkTodo owner boundary、RLS、authenticated-only RPC 必須保留。
- Workflow adoption、current step、completion / archive action 要有 structured error、Audit、Idempotency 與 atomic result。
- Investment read-only capability 不因共用 C capability 而獲得 Move / Workflow Editing / Acceptance。
- 不以 `status`、Workspace label、Consumer name 或第一個完成 Workspace 推導 Workflow。

Option B 若要建立新 Consumer，仍需經同一 Security / RLS / Adoption Contract；「由 C 產生」不能成為權限旁路。

## 13. Current Detection / Governance Gap

目前 C Parity / Consistency checker 能檢查部分 Feature、Template、Source、Fingerprint、Capability 與 Runtime Contract，但尚不能完整回答：

- Board Instance 存在但 Published Workflow pointer 為 `NULL`。
- Consumer 是否完成正式 C Workflow Adoption / Binding。
- 哪個 Trigger / RPC / Repository 仍可寫 Completion / Archive。
- WorkTodo 是否還有第二個 48h / Archive writer。
- Consumer 宣告的 C Capability 是否與實際 Authority 一致。

因此「C template / feature parity 看起來正常」不能被當成「WorkTodo 已採用 C Lifecycle」。這是既有 Detection V2 / Authority Conformance requirement；本輪不修改 Checker。

## 14. Recommendation

### Final Recommendation：**OPTION A**

**Confidence：HIGH**

#### Short-term engineering cost

Option A 較低。它可以保留 `user_tasks`、WorkTodo UI 與 WorkTodo-only features，以最小的新增面完成：

```text
Generic Published Workflow Adoption
  → Storage-agnostic C Lifecycle Adapter
  → WorkTodo writer cutover
  → Legacy retirement
```

Option B 仍要做上面前兩項，並增加新 Consumer、資料 crosswalk、entry cutover 與高風險 migration。

#### Long-term architecture quality

在兩方案都完整收斂的理想終態，均可達到 C Authority = 1；但 Option A 較容易保留「一個 C、各自資料、WorkTodo 是 Adapter」的已核准模型，並較早移除 WorkTodo policy authority。Option B 若沒有完整 migration / retirement，反而最容易長期留下：

```text
Legacy WorkTodo authority
  + C-native WorkTodo authority
  + compatibility / crosswalk route
```

這會違反「不得保留兩套正式 Workflow / Lifecycle Engine」的 Cleanup 目標。

### 14.1 Recommended dependency order

1. 先完成 **P4A-1 Generic Published Workflow Adoption / Board Context**（適用 C Consumer 的共用能力，不做 WorkTodo 特例）。
2. 再完成 **P4A-2 Storage-agnostic C Lifecycle Adapter**，先做 Contract / RLS / read / fail-closed QA。
3. 再進 **P4B WorkTodo Data Adapter Adoption**；保留 `user_tasks`，不搬成 `board_tasks`。
4. 通過單一 writer、Concurrency、Audit、Reload / New Session 與 Regression 後，才做 WorkTodo writer cutover。
5. 最後才做 Legacy Retirement / Scheduler；不要讓兩個 writer 長期同時 active。

## 15. PM / GPT Decision Boundary

本輪不需要新的產品決策才能完成 feasibility audit；以下是若未來選擇實作時，必須另行核准的邊界：

1. 是否維持「每個 Board Instance 自己擁有 Published Workflow」；本文件依目前核准模型採 YES。
2. WorkTodo 的正式 Board Instance Workflow 內容與 Completion Capability；不得借 AI Board，也不得用 status / label 猜。
3. C Subject Binding 採獨立 additive context table 或 Consumer storage additive columns；需 Schema Review，不能在此文件自行決定。
4. `user_tasks` 的歷史資料哪些可安全 Context adoption、哪些需要 PM classification；不得批次猜測。
5. WorkTodo-only Journal / Knowledge / calendar / attachment features 的保留形式與是否需要 C extension；不能以 C-native 名義默默刪除。
6. 若產品要求同一份 Published Workflow Data 跨多個 Board Instance 共享，需另開 reusable Workflow Library / identity 的 Architecture / Schema Review。

## 16. Read-only Completion Record

| Item | Result |
|---|---|
| Option B bypasses Generic Adoption Gap | **NO** |
| Existing C-native Consumer Creation Contract | **PARTIAL** |
| Multiple Board Instances can adopt one current Published Workflow row | **NO** |
| Same C Engine / Capability usable by multiple Instances | **YES** |
| Feature Parity | **52%** by defined audit metric |
| WorkTodo-only / specific feature set | Journal, 工時／月曆、個人工作模型、GPT fields、Knowledge / Suggestions / Assistant、WLTK / legacy compatibility、WorkTodo storage routes |
| Option B Data Migration Feasibility | **LOW** |
| Option A Complexity | **MEDIUM** implementation; **MEDIUM** migration |
| Option B Complexity | **HIGH** implementation; **HIGH** migration |
| Option A Legacy Debt after retirement | **LOW-MEDIUM** |
| Option B Legacy Debt | **HIGH** until old entry / data / authority retire |
| TASK-064 Simplification by Option B | **NO** |
| Generic Adoption Still Required | **YES** |
| Consumer-specific Workflow Engine needed | **NO** |
| Cloud / Data Mutation | **0** |
| Product Source Mutation | **0** |
| Final Recommendation | **OPTION A** |
| Confidence | **HIGH** |

## 17. STOP

本輪只完成可行性 Audit 文件。沒有建立新的 WorkTodo、沒有建立 Workflow binding、沒有 Migration、沒有 Cloud/Data Mutation、沒有修改既有 Candidate、沒有進入 P4A-1 Coding。依 PM 指示停止，等待 Architecture Decision。
