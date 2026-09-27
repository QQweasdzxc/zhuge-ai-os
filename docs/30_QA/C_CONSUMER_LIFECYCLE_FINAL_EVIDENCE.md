# C Consumer Lifecycle Final Evidence

狀態：`PARTIAL / HARD STOP AT E`

本文件記錄本次 Final Execution Order 的可安全完成部分。Protected Candidate
`6131cb9b267bedbd308e855645344bcc493279e0` 未被覆寫；本次使用其後的
Development State。A–D 的控制面已完成 Cloud read-back，E 不得以猜測性
Migration 收尾。

## A–D 結果

### A｜C Consumer Provisioning

- 唯一入口：`board_provision_c_consumer_v2`。
- Cloud 以單一 transaction 建立 Board Instance、獨立 Workspace/Data Scope、C Release adoption 與 Instance-owned starter Workflow。
- `template_key = c`、`p_application_scope`、creator/owner authorization、private idempotency、fail-closed 均在同一受控 Contract。
- 不建立 Card，不複製 C Source，不使用 Browser localStorage 作正式狀態。
- Cloud read-back 的 provisioning function signature 為
  `board_provision_c_consumer_v2(text,text,text,text,jsonb,jsonb,text)`；匿名／公開
  execute 已撤銷，僅 authenticated／service role 可執行。
- 多次相同 idempotency request 回讀同一 Board Instance；失敗會 rollback 整個 provisioning transaction。

### B｜Completion / Archive Lifecycle

- 唯一現行 Policy：`module-c-completion-archive-policy`，Contract `module-c-lifecycle-acceptance-v2`，current delay `86400 seconds / 24 hours`。
- Completion writer 使用實際 Completion Entry Time；不使用 Creation Time 或 Last Edit Time。
- 離開 Completion 會清除尚未執行的 active timer；再次進入重新起算。
- Existing `archive_due_at` 不因新 Policy retroactive recalculation。
- Cloud policy read-back：version 1 `172800` 已 `retired`；version 2 `86400` 為
  `published`，policy source 為 `module-c-mother`。

### C｜Background Execution

- Read-triggered reconciliation 保留為 safety net。
- `pg_cron` job `module-c-completion-archive-v2` 每 5 分鐘呼叫唯一 C private reconciler。
- Scheduler 與 read path 共用 `private.board_c_reconcile_completion_archive_lifecycle_core`，有 advisory lock、per-instance scope、idempotent archive 與 error evidence。
- Cloud read-back：job id `1`、active、schedule `*/5 * * * *`；最近五次 runs
  均 `completed`、`error_count = 0`、`cards_archived = 0`，未建立新的測試 Board。

### D｜Authority / Runtime Route Conformance

- `board_c_authority_conformance_check(uuid)` 更新為 read-only v2 checker，回報 Shared Runtime、Writer、Workflow readiness、Completion/Archive Authority、Policy、Trigger/RPC、Fallback、Release Adoption、Persistence、Reload/New Session。
- 合法例外獨立呈現：C Mother 不要求 Workflow；Investment read-only 不啟用 Completion/Archive。
- WorkTodo 的可達 user_tasks trigger/reconciler 會被明確判為 legacy current route，不會被「功能看起來正常」掩蓋。
- Cloud checker read-back：AI Board `pass`；C Mother `pass`（Workflow/Completion/Archive
  為合法 `not_applicable`）；Investment `pass`（approved read-only）；GAS
  `fail_closed`（尚無自己的 Published Workflow）；WorkTodo `fail`（Legacy
  `user_tasks` trigger/reconciler 仍是 current route）。這些狀態沒有被 UI 綠燈掩蓋。

## E｜WorkTodo C-native Replacement：Hard Stop

不能安全執行 Legacy WorkTodo → New WorkTodo migration，原因不是缺少 Coding，而是
Current Cloud Data Mapping 不可由現有證據唯一判定：

- `public.user_tasks`：15 rows，11 live rows。
- `public.board_tasks` with `application_scope = 'worktodo'`：33 active board rows。
- 11 個 live `WLTK` code 有同碼對應，但存在 title/status/completion/archive timestamp 衝突。
- `user_tasks` 沒有 `board_instance_id`、`workspace_id`、`workflow_version_id`、`current_workflow_step_id`，無法把其正式 State 無損綁定到新 C-native Board。
- `WLTK` prefix/application scope 仍有既有 unique identity；不能建立新正式 WorkTodo 後再猜測交換。
- `work_journal_entries` 另有 37 rows；目前已知舊 migration 只涵蓋部分 journal，不能證明 Checklist/Attachment/Ordering/Completion/Archive 全量可逆映射。

因此本輪沒有：

- 建立新 WorkTodo Board
- 改名或交換正式代號
- INSERT/UPDATE/DELETE Legacy Data
- 批次移動或回填 Card/Workspace/Workflow
- 停用 Legacy Writer/Trigger

這符合 Hard Stop 2「無法安全判定 Migration Mapping」。下一步必須由 PM 決定
Legacy identity 與 11/33 衝突資料的正式 reconciliation / mapping；在此之前，A–D
checkpoint 可保留，但不能宣告 `C Consumer Lifecycle = FULL` 或 `New WorkTodo = C-native`。

Fresh read-only crosswalk：`user_tasks` 15 rows（11 live）、WorkTodo scoped
`board_tasks` 33 rows、11 個同碼 pair；其中 title 3、status 6、completion timestamp
3、archive_due timestamp 3 個衝突；另有 22 個 board rows 沒有 live `user_tasks`
對應，`work_journal_entries` 37 rows。此證據足以阻擋身份交換與批次 Migration，
但不修改任何資料。

## Cloud / Security Boundary

本次只使用既有受控 migrations / read-back。A–D 已存在的控制面 migration：

- `20260912074625` — shared completion archive policy
- `20260912082521` — instance scope
- `20260912121019` — C Consumer provisioning v2
- `20260912121232` — completion/archive closure v2
- `20260912121339` — background scheduler v2
- `20260912121502` — authority conformance v2
- `20260912123943` — authority conformance v2 hardening
- `20260912124047` — authority conformance v2 null-scope / writer hardening

所有 private table 維持 RLS；本次 provisioning、archive lifecycle、scheduler、checker
RPC 的公開／anon execute 已撤銷，authenticated 才可使用需要的 public contract；Browser
不持有 service role。Security advisor 的既有 project baseline findings（包含既有
public security-definer view、既有 anon-executable functions 等）與本次新增控制面分開
列示；本次未修改那些 ORANGE / baseline 項目。

## QA 判定

Developer targeted command：`node --test tests/c-consumer-lifecycle-final.test.js`，
`9 pass / 0 fail / 0 skip`。

完整 Regression command：`node --test tests/*.test.js`，`465 tests / 459 pass /
0 fail / 6 skip`。6 個 skip 均為需要本機 Chrome／Chromium executable 的 Browser
regression，環境沒有 `CHROME_PATH`、`CHROMIUM_PATH` 或 `BROWSER_EXECUTABLE`；這些
不是本次測試失敗。Node syntax check（3 個修改中的 JS）與 `git diff --check` 均通過。
Browser / PM Runtime / New WorkTodo migration 不是本機可安全代替的驗收，維持
`PM Runtime QA Pending` 或本文件的 E Hard Stop，不得偽造 PASS。

Cloud policy／provisioning／scheduler／checker 為本次已核准的 additive control-plane
migrations；Product Card／Workspace／Task／Legacy WorkTodo data mutation = `0`。

## Rollback Boundary

可以安全回退的邊界是本次 Source commit 與 A–D control-plane migration 的 versioned
function definitions；不能透過 rollback 偽造已發生的歷史 WorkTodo mapping。E 的任何
identity exchange 或 data migration 必須另有可驗證、可逆的 mapping evidence 後才可施工。
