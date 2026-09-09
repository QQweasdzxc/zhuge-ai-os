const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const runtime = fs.readFileSync(path.join(root, "shared/components/golden-master-runtime.js"), "utf8");
const service = fs.readFileSync(path.join(root, "shared/board/board-read-service.js"), "utf8");
const adapter = fs.readFileSync(path.join(root, "shared/components/task-action-adapters.js"), "utf8");
const gateway = fs.readFileSync(path.join(root, "shared/supabase/supabase-gateway.js"), "utf8");
const migration = fs.readFileSync(path.join(root, "docs/supabase/20260908_task_lifecycle_workspace_consistency.sql"), "utf8");
const pmAcceptanceMigration = fs.readFileSync(path.join(root, "docs/supabase/20260909_pm_acceptance_qjc_drop.sql"), "utf8");

test("AI Board canonical workspace targets use the formal lifecycle path", () => {
  assert.match(runtime, /function aiBoardLifecycleTarget\(workspace\)/);
  assert.match(runtime, /todo: \{ key: "todo", status: "ready", assignee: "Co"/);
  assert.match(runtime, /co: \{ key: "co", status: "inprogress", assignee: "Co"/);
  assert.match(runtime, /qjc: \{ key: "qjc", status: "qa", assignee: "QJC"/);
  assert.match(runtime, /completed: \{ key: "completed", status: "done", assignee: "QJC"/);
  assert.match(runtime, /if \(lifecycleTarget\) \{[\s\S]*?await moveAiBoardLifecycleTask/);
  assert.match(runtime, /await activeService\(\)\.transitionTask\(task\.id, lifecycleTarget\.status/);
  assert.match(runtime, /PM Acceptance Evidence.*必填/);
  assert.match(runtime, /PM QA 退回 Evidence.*必填/);
  assert.doesNotMatch(runtime, /PM Acceptance PASS（卡片拖曳：/);
});

test("ordinary custom workspace movement remains on the existing generic path", () => {
  const lifecycleBranch = runtime.indexOf("const lifecycleTarget = aiBoardLifecycleTarget(target);");
  const genericBranch = runtime.indexOf('executeSharedTaskAction(task, "moveWorkspace"', lifecycleBranch);
  assert.ok(lifecycleBranch >= 0);
  assert.ok(genericBranch > lifecycleBranch);
  assert.match(runtime.slice(genericBranch, genericBranch + 700), /workspaceId: target\.id/);
});

test("a stale canonical workspace still runs the formal lifecycle transition", () => {
  const lifecycleBranch = runtime.indexOf("const lifecycleTarget = aiBoardLifecycleTarget(target);");
  const sameWorkspaceGuard = runtime.indexOf("String(task.workspaceId) === String(target.id)", lifecycleBranch);
  const lifecycleCall = runtime.indexOf("await moveAiBoardLifecycleTask(task, current, target, lifecycleTarget);", lifecycleBranch);
  assert.ok(lifecycleBranch >= 0);
  assert.ok(sameWorkspaceGuard > lifecycleBranch);
  assert.ok(lifecycleCall > sameWorkspaceGuard);
  assert.match(runtime.slice(sameWorkspaceGuard, lifecycleCall), /lifecycleMatchesTarget/);
  assert.match(runtime.slice(sameWorkspaceGuard, lifecycleCall), /正式狀態與負責人也已一致/);
});

test("PM QA FAIL uses the atomic checklist/task contract", () => {
  assert.match(adapter, /payload\.pmQaFail/);
  assert.match(adapter, /pmQaFailChecklist/);
  assert.match(service, /board_pm_qa_fail_requeue/);
  assert.match(migration, /create or replace function public\.board_pm_qa_fail_requeue/);
  assert.match(migration, /set state = 'fail'/);
  assert.match(migration, /set status = 'inprogress'/);
  assert.match(migration, /assignee = 'Co'/);
  assert.match(migration, /workspace_id = v_co_workspace\.id/);
});

test("AI Board Cloud invariant rejects workspace-only lifecycle drift", () => {
  assert.match(migration, /create or replace function public\.enforce_ai_board_lifecycle_workspace_consistency/);
  assert.match(migration, /before insert or update of status, assignee, workspace_id on public\.board_tasks/i);
  assert.match(migration, /AI Board lifecycle 與工作區不一致/);
  assert.match(migration, /when 'todo' then[\s\S]*v_expected_status := 'ready'[\s\S]*v_expected_assignee := 'Co'/i);
  assert.match(migration, /when 'completed' then[\s\S]*v_expected_status := 'done'[\s\S]*v_expected_assignee := 'QJC'/i);
  assert.match(migration, /ordinary custom workspaces are not lifecycle states/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.board_tasks/i);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.board_tasks/i);
});

test("honest PM acceptance recovery never infers completion from stale placement", () => {
  assert.match(migration, /create or replace function public\.board_reconcile_pm_acceptance_lifecycle/);
  assert.match(migration, /正式 PM Acceptance Evidence 不存在；不會從工作區或時間戳推定完成/);
  assert.match(migration, /已有 PM Acceptance Evidence，但 TASK 不在 qa\/QJC；未自動修復/);
  assert.match(migration, /set status = 'done'/);
  assert.match(migration, /workspace_key = 'completed'/);
});

test("Cloud non-2xx responses expose a bounded actionable fallback", () => {
  assert.match(gateway, /const endpoint = String\(path \|\| ""\)\.split\("\?"\)\[0\] \|\| "request"/);
  assert.match(gateway, /Cloud 未提供錯誤明細/);
  assert.match(gateway, /error\.endpoint = endpoint/);
});

test("QJC completion drop composes the existing guarded lifecycle contracts atomically", () => {
  assert.match(pmAcceptanceMigration, /create or replace function public\.board_pm_acceptance_from_qjc_drop/i);
  assert.match(pmAcceptanceMigration, /workspace_key = 'qjc'/i);
  assert.match(pmAcceptanceMigration, /public\.board_transition_task/);
  assert.match(pmAcceptanceMigration, /public\.board_update_checklist_item/);
  assert.match(pmAcceptanceMigration, /qa\/GPT/);
  assert.match(pmAcceptanceMigration, /卡片未移動，正式狀態不變/);
  assert.match(pmAcceptanceMigration, /revoke all on function public\.board_pm_acceptance_from_qjc_drop/);
  assert.match(pmAcceptanceMigration, /grant execute on function public\.board_pm_acceptance_from_qjc_drop[^;]*authenticated/i);
  assert.doesNotMatch(pmAcceptanceMigration, /board_reconcile_pm_acceptance_lifecycle/);
  assert.match(runtime, /currentKey === "qjc" && status === "qa" && \(assignee === "GPT" \|\| assignee === "QJC"\)/);
  assert.match(runtime, /activeService\(\)\.pmAcceptTaskFromQjcDrop/);
  const acceptanceStart = runtime.indexOf("async function acceptTaskByCardDrop");
  const acceptanceEnd = runtime.indexOf("async function rejectTaskByCardDrop");
  assert.ok(acceptanceStart >= 0 && acceptanceEnd > acceptanceStart);
  assert.doesNotMatch(runtime.slice(acceptanceStart, acceptanceEnd), /transitionTask\([^\n]*done/);
});
