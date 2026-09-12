const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const BoardRead = require("../shared/board/board-read-service.js");
const Parity = require("../shared/components/template-parity-engine.js");

const provisioning = read("docs/supabase/20260912_c_consumer_provisioning_v2.sql");
const closure = read("docs/supabase/20260912_c_completion_archive_closure_v2.sql");
const scheduler = read("docs/supabase/20260912_c_completion_archive_scheduler_v2.sql");
const checker = read("docs/supabase/20260912_c_authority_conformance_v2_hardening.sql");

test("A: C Consumer provisioning is one atomic, idempotent, fail-closed contract", () => {
  assert.match(provisioning, /board_provision_c_consumer_v2\(/i);
  assert.match(provisioning, /p_application_scope\s+text/i);
  assert.match(provisioning, /p_idempotency_key\s+text/i);
  assert.match(provisioning, /v_user\s+uuid\s*:=\s*auth\.uid\(\)/i);
  assert.match(provisioning, /if\s+v_user\s+is\s+null/i);
  assert.match(provisioning, /pg_advisory_xact_lock/i);
  assert.match(provisioning, /board_create_instance\(/i);
  assert.match(provisioning, /board_c_workflow_save_draft\(/i);
  assert.match(provisioning, /board_c_workflow_publish\(/i);
  assert.match(provisioning, /consumer_adoptions/i);
  assert.match(provisioning, /atomic', true/i);
  assert.match(provisioning, /fail_closed', true/i);
  assert.doesNotMatch(provisioning, /insert\s+into\s+public\.board_tasks\b/i);
  assert.match(provisioning, /revoke all on function public\.board_provision_c_consumer_v2/i);
  assert.match(provisioning, /grant execute on function public\.board_provision_c_consumer_v2[\s\S]*to authenticated/i);
});

test("A: browser adapter requires idempotency and forwards the complete C contract", async () => {
  const calls = [];
  const gateway = { rpc: async (name, args) => { calls.push({ name, args }); return { board_instance_id: "instance-1" }; } };
  await assert.rejects(
    () => BoardRead.provisionCConsumer({ name: "No Key", taskCodePrefix: "NOKEY" }, { gateway }),
    error => error.code === "C_CONSUMER_PROVISION_IDEMPOTENCY_REQUIRED"
  );
  const result = await BoardRead.provisionCConsumer({
    name: "QA C Board",
    taskCodePrefix: "QAC",
    templateKey: "c",
    applicationScope: "qa_c_board",
    workspaceBlueprint: [{ workspace_key: "todo", name: "待辦", sort_order: 10 }],
    workflowBlueprint: { name: "QA 流程", steps: [{ step_key: "todo", workspace_key: "todo" }] },
    idempotencyKey: "c-provision-test-1"
  }, { gateway });
  assert.equal(result.board_instance_id, "instance-1");
  assert.deepEqual(calls, [{
    name: "board_provision_c_consumer_v2",
    args: {
      p_name: "QA C Board",
      p_task_code_prefix: "QAC",
      p_template_key: "c",
      p_application_scope: "qa_c_board",
      p_workspace_blueprint: [{ workspace_key: "todo", name: "待辦", sort_order: 10 }],
      p_workflow_blueprint: { name: "QA 流程", steps: [{ step_key: "todo", workspace_key: "todo" }] },
      p_idempotency_key: "c-provision-test-1"
    }
  }]);
});

test("A: the C create UI reaches only the canonical v2 provisioner", () => {
  const runtime = read("shared/components/golden-master-runtime.js");
  const createStart = runtime.indexOf("async function createConsumer");
  const createEnd = runtime.indexOf("function consumerRuntimeHref", createStart);
  const createBlock = runtime.slice(createStart, createEnd < 0 ? undefined : createEnd);
  assert.match(createBlock, /provisionCConsumer/);
  assert.doesNotMatch(createBlock, /provisionConsumer\(/);
  assert.match(createBlock, /consumerProvisionIdempotencyKey/);
  assert.doesNotMatch(createBlock, /localStorage/);
});

test("B: current C closure uses the Cloud 24-hour policy and actual completion entry", () => {
  assert.match(closure, /policy_version[\s\S]*86400/i);
  assert.match(closure, /status\s*=\s*'published'/i);
  const decision = closure.slice(closure.indexOf("create or replace function public.board_c_reconcile_workspace_decision_v2"), closure.indexOf("-- Private worker shared"));
  assert.match(decision, /clock_timestamp\(\)/i);
  assert.match(decision, /private\.module_c_completion_archive_policies/i);
  assert.match(decision, /when v_target_step\.is_completion then v_archive_due_at/i);
  assert.match(decision, /when v_is_reopen then null/i);
  assert.doesNotMatch(decision, /172800|48\s*hours|2\s*days/i);
  assert.doesNotMatch(decision, /creation_time|last_edit_time/i);
});

test("B/C: safety net and background scheduler share one C archive writer", () => {
  assert.match(closure, /private\.board_c_reconcile_completion_archive_lifecycle_core\(/i);
  assert.match(closure, /board_c_reconcile_completion_archive_lifecycle_v2\(/i);
  assert.match(scheduler, /private\.board_c_reconcile_completion_archive_lifecycle_core\(/i);
  assert.match(scheduler, /cron\.schedule\(/i);
  assert.match(scheduler, /module-c-completion-archive-v2/i);
  assert.match(scheduler, /'\*\/5 \* \* \* \*'/i);
  assert.match(scheduler, /pg_try_advisory_xact_lock/i);
  assert.doesNotMatch(scheduler, /interval\s+'48 hours'|interval\s+'24 hours'|86400/i);
});

test("D: Authority Checker v2 reports route, writer, policy, adoption, and persistence conformance", () => {
  const body = checker.slice(checker.indexOf("$function$") + "$function$".length, checker.lastIndexOf("$function$"));
  assert.match(checker, /stable\s+security definer/i);
  assert.match(checker, /module-c-authority-conformance-v2/i);
  for (const key of [
    "shared_runtime", "card_writer", "workspace_writer", "movement_authority",
    "workflow_engine", "workflow_binding_readiness", "completion_authority",
    "archive_authority", "cloud_writer", "trigger_conformance", "release_adoption",
    "legacy_fallback", "global_fallback", "local_fallback", "persistence", "reload", "new_session"
  ]) assert.match(checker, new RegExp(`'${key}'`));
  assert.match(body, /worktodo_apply_completion_lifecycle/i);
  assert.match(body, /worktodo_reconcile_completion_lifecycle/i);
  assert.match(body, /board_reconcile_completion_lifecycle/i);
  assert.match(body, /archive_delay_seconds\s*=\s*86400/i);
  assert.doesNotMatch(body, /insert\s+into\s+public\.(board_tasks|user_tasks)\b/i);
  assert.doesNotMatch(body, /update\s+public\.(board_tasks|user_tasks)\b/i);
  assert.match(checker, /revoke all on function public\.board_c_authority_conformance_check\(uuid\) from public, anon/i);
  assert.match(checker, /grant execute on function public\.board_c_authority_conformance_check\(uuid\) to authenticated/i);
});

test("D: parity treats a non-pass authority check as a real conformance gap", () => {
  const pass = Parity.normalizeAuthorityConformance({
    contract: "module-c-authority-conformance-v2",
    status: "pass",
    board_instance_id: "instance-1",
    checks: { shared_runtime: "pass", workflow_engine: "not_applicable" }
  });
  assert.equal(pass.layerStatus, "pass");
  const failClosed = Parity.normalizeAuthorityConformance({
    contract: "module-c-authority-conformance-v2",
    status: "fail_closed",
    board_instance_id: "instance-2",
    checks: { shared_runtime: "pass", workflow_engine: "not_configured" }
  });
  assert.equal(failClosed.layerStatus, "fail");
  assert.deepEqual(failClosed.failedChecks, ["workflow_engine"]);
  assert.match(Parity.formatReport({ authorityConformance: failClosed }), /Authority Conformance：fail_closed/);
});

test("C: formal runtime keeps WorkTodo outside the new C instance lifecycle until its safe replacement", () => {
  const runtime = read("shared/components/golden-master-runtime.js");
  const boardRead = read("shared/board/board-read-service.js");
  assert.match(runtime, /const cInstanceRuntime = \["c", "ai_board", "procurement"\]\.includes\(state\.applicationScope\)/);
  assert.doesNotMatch(runtime, /const cInstanceRuntime = \[[^\]]*worktodo/);
  assert.match(boardRead, /board_c_reconcile_completion_archive_lifecycle_v2/);
});

test("E safety gate: legacy WorkTodo cannot be declared migrated by code alone", () => {
  const source = read("docs/30_QA/C_CONSUMER_LIFECYCLE_FINAL_EVIDENCE.md");
  assert.match(source, /11.*user_tasks|user_tasks.*11/i);
  assert.match(source, /33.*board_tasks|board_tasks.*33/i);
  assert.match(source, /mapping|collision|conflict/i);
  assert.match(source, /STOP|blocked|cannot/i);
});
