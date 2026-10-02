const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const BoardRead = require("../shared/board/board-read-service.js");

const policy = read("docs/supabase/20260912_c_shared_completion_archive_policy.sql");
const closure = read("docs/supabase/20260912_c_completion_archive_closure_v2.sql");
const scheduler = read("docs/supabase/20260912_c_completion_archive_scheduler_v2.sql");
const optionalWorkflow = read("docs/supabase/20260913_c_completion_archive_optional_workflow.sql");
const worktodoRetirement = read("docs/supabase/20260913_task_064_worktodo_legacy_retirement.sql");
const actorSystem = read("docs/supabase/20260915_c_completion_archive_actor_label_system.sql");
const runtime = read("shared/components/golden-master-runtime.js");
const serviceSource = read("shared/board/board-read-service.js");

const INSTANCE_ID = "00000000-0000-4000-8000-000000000036";

function lifecycleTask({ completionAt, archiveDueAt, archivedAt = null, status = "done" }) {
  return BoardRead.normalizeTask({
    id: "task-36",
    status,
    workspace_key: "completed",
    workspace_name: "完成",
    completion_at: completionAt,
    archive_due_at: archiveDueAt,
    archived_at: archivedAt
  });
}

function validReconciliation() {
  return {
    contract: "module-c-lifecycle-acceptance-v2",
    capability: "completion-archive-lifecycle",
    action: "reconcile-completion-archive",
    state: "reconciled",
    board_instance_id: INSTANCE_ID,
    workflow_version_id: null,
    workflow_status: "not_configured",
    completion_step_id: null,
    completion_workspace_id: "workspace-completed",
    completion_designation_status: "configured",
    archive_designation_status: "configured",
    policy_identity: "module-c-completion-archive-policy",
    policy_version: 2,
    archive_delay_seconds: 86400,
    archived_count: 0,
    task_ids: [],
    idempotent: true,
    atomic: true,
    scope_verified: true,
    existing_due_at_retroactive: false
  };
}

test("TASK-36 canonical policy is 24h and starts from the latest completion entry", () => {
  assert.match(closure, /'completion_archive'[\s\S]*2[\s\S]*'published'[\s\S]*86400/);
  const decision = closure.slice(
    closure.indexOf("create or replace function public.board_c_reconcile_workspace_decision_v2"),
    closure.indexOf("-- Private worker shared")
  );
  assert.match(decision, /v_now timestamptz := clock_timestamp\(\)/i);
  assert.match(decision, /v_archive_due_at := v_now \+ make_interval/i);
  assert.match(decision, /completion_at = case[\s\S]*when v_target_step\.is_completion then v_now[\s\S]*when v_is_reopen then null/i);
  assert.match(decision, /archive_due_at = case[\s\S]*when v_target_step\.is_completion then v_archive_due_at[\s\S]*when v_is_reopen then null/i);
  const dueCalculation = decision.slice(
    decision.indexOf("if v_target_step.is_completion then"),
    decision.indexOf("if v_transition.requires_gate")
  );
  assert.doesNotMatch(dueCalculation, /created_at|updated_at|last_edit_time|creation_time/i);
  assert.match(policy, /existing_due_at_retroactive', false/i);
});

test("TASK-36 boundary cases keep the countdown tied to completion state", () => {
  const now = Date.now();
  const entered = new Date(now - 23 * 60 * 60 * 1000 - 59 * 60 * 1000).toISOString();
  const dueInOneMinute = new Date(now + 60 * 1000).toISOString();
  const duePassed = new Date(now - 1).toISOString();

  assert.equal(BoardRead.isArchiveTask(lifecycleTask({ completionAt: entered, archiveDueAt: dueInOneMinute })), false, "A: 23h59m is not due");
  assert.equal(BoardRead.isArchiveTask(lifecycleTask({ completionAt: new Date(now - 24 * 60 * 60 * 1000).toISOString(), archiveDueAt: duePassed })), true, "B: due completion is archive-eligible");
  assert.equal(BoardRead.isArchiveTask(lifecycleTask({ completionAt: entered, archiveDueAt: null })), false, "C: leaving completion cancels the active timer");
  assert.equal(BoardRead.isArchiveTask(lifecycleTask({ completionAt: new Date(now - 12 * 60 * 60 * 1000).toISOString(), archiveDueAt: dueInOneMinute })), false, "D: re-entry has a fresh due time");
  assert.equal(BoardRead.isArchiveTask(lifecycleTask({ completionAt: entered, archiveDueAt: duePassed, archivedAt: duePassed })), true, "E: an already archived task stays read-only");
});

test("TASK-36 archive writer is server-side, scoped, archive-only, idempotent, and auditable", () => {
  assert.match(closure, /for update skip locked/i);
  assert.match(closure, /archived_at is null/i);
  assert.match(closure, /set archived_at = v_now[\s\S]*updated_at = v_now/i);
  assert.match(closure, /insert into public\.engineering_activity_log/i);
  assert.match(closure, /'task_auto_archived'/i);
  assert.match(closure, /'Module C instance-scoped completion archive reconciliation'/i);
  assert.doesNotMatch(`${closure}\n${optionalWorkflow}\n${actorSystem}`, /delete\s+from\s+public\.(board_tasks|user_tasks)\b/i);
  assert.match(actorSystem, /'stored_actor_label',\s*'System'/i);
  assert.match(actorSystem, /actor_id, actor_type, actor_label, activity_type[\s\S]*p_actor_id,\s*'system',\s*'System'/i);
  assert.match(actorSystem, /new\.completion_at is not null/i);
  assert.match(actorSystem, /new\.archive_due_at\s+<=\s*clock_timestamp\(\)/i);
  assert.match(actorSystem, /to_jsonb\(old\)\s*-\s*'archived_at'\s*-\s*'archived_by'\s*-\s*'updated_at'/i);
});

test("TASK-36 has one background scheduler and retains read-time reconciliation only as a safety net", () => {
  assert.match(scheduler, /create extension if not exists pg_cron/i);
  assert.match(scheduler, /cron\.schedule\(/i);
  assert.match(scheduler, /'module-c-completion-archive-v2'/i);
  assert.match(scheduler, /'\*\/5 \* \* \* \*'/i);
  assert.match(scheduler, /private\.board_c_reconcile_completion_archive_lifecycle_core\(/i);
  assert.match(scheduler, /pg_try_advisory_xact_lock/i);
  assert.match(actorSystem, /perform set_config\('zhuge\.module_c_completion_archive_scheduler',\s*'1',\s*true\)/i);
  assert.match(actorSystem, /left join public\.board_instance_workflow_state/i);
  assert.match(actorSystem, /instance\.template_key = 'c'/i);
  const schedulerFunction = actorSystem.slice(actorSystem.indexOf("create or replace function private.board_c_completion_archive_scheduler_run"));
  assert.doesNotMatch(schedulerFunction, /update public\.board_tasks/i);
  assert.match(serviceSource, /instanceReconcileCompletionArchiveOnLoad/);
  assert.match(serviceSource, /board_c_reconcile_completion_archive_lifecycle_v2/);
});

test("TASK-36 retires the old WorkTodo lifecycle writer without deleting retained history", () => {
  assert.match(worktodoRetirement, /disable trigger worktodo_completion_lifecycle_before_write/i);
  assert.match(worktodoRetirement, /revoke all on function public\.worktodo_apply_completion_lifecycle/i);
  assert.match(worktodoRetirement, /revoke all on function public\.worktodo_reconcile_completion_lifecycle/i);
  assert.match(worktodoRetirement, /revoke all on function public\.board_reconcile_completion_lifecycle/i);
  assert.doesNotMatch(worktodoRetirement, /delete\s+from\s+public\.(user_tasks|work_journal_entries)\b/i);
});

test("TASK-36 routes WorkTodo, AI Board, GAS, and C Mother through the same C RPC", async () => {
  const calls = [];
  const gateway = {
    async select(table) {
      if (table === "board_instances") {
        return [{ id: INSTANCE_ID, template_key: "c", active: true, name: "QA C Board" }];
      }
      return [];
    },
    async rpc(name, params) {
      calls.push({ name, params });
      if (name !== "board_c_reconcile_completion_archive_lifecycle_v2") throw new Error(`Unexpected RPC ${name}`);
      return validReconciliation();
    }
  };
  const adopters = [
    { consumerId: "worktodo", legacyApplicationScope: "worktodo" },
    { consumerId: "ai-board", legacyApplicationScope: "ai_board" },
    { consumerId: "procurement-gas", legacyApplicationScope: "procurement" },
    { consumerId: "c-mother", legacyApplicationScope: "" }
  ];

  for (const adopter of adopters) {
    const service = BoardRead.createInstanceService({
      gateway,
      boardInstanceId: INSTANCE_ID,
      consumerId: adopter.consumerId,
      legacyApplicationScope: adopter.legacyApplicationScope,
      completionArchiveLifecycle: true
    });
    const result = await service.reconcileCompletionArchiveLifecycle({ workflowVersionId: null });
    assert.equal(result.boardInstanceId, INSTANCE_ID);
    assert.equal(result.archiveDelaySeconds, 86400);
    assert.equal(result.idempotent, true);
    assert.equal(result.atomic, true);
  }

  assert.equal(calls.length, adopters.length);
  assert.deepEqual([...new Set(calls.map(call => call.name))], ["board_c_reconcile_completion_archive_lifecycle_v2"]);
  assert.deepEqual([...new Set(calls.map(call => call.params.p_board_instance_id))], [INSTANCE_ID]);
  assert.match(runtime, /const cInstanceRuntime = \["c", "ai_board", "procurement"\]\.includes\(state\.applicationScope\) \|\| state\.applicationScope === "worktodo"/);
  assert.match(runtime, /completionArchiveLifecycle: completionArchiveRuntime/);
});
