const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(path.join(root, "docs/supabase/20260920_task_074_agent_workspace_closed_loop.sql"), "utf8");
const edge = fs.readFileSync(path.join(root, "supabase/functions/engineering-transition/index.ts"), "utf8");
const tool = require(path.join(root, "tools/engineering-transition.js"));

test("TASK-074 adds GPT authority to the existing claim ledger, not a second Task system", () => {
  for (const fragment of [
    "alter table private.board_task_claims",
    "board_task_claims_actor_label_scope_check",
    "claim_purpose in ('co_execution', 'gpt_planning', 'gpt_review')",
    "board_claim_next_gpt_task",
    "board_renew_gpt_task_claim",
    "board_release_gpt_task_claim",
    "board_gpt_plan_and_handoff_co",
    "board_orchestrate_engineering_review",
    "task_gpt_claimed",
    "task_gpt_plan_handoff_to_co",
    "developer_qa_to_gpt",
    "gpt_review_to_qjc",
    "gpt_review_rework_to_co",
    "regression-evidence",
    "grant execute on function public.board_claim_next_gpt_task",
    "grant execute on function public.board_orchestrate_engineering_review"
  ]) assert.match(migration, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(migration, /insert\s+into\s+public\.board_tasks/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.(?:board_tasks|engineering_checklist_items)/i);
  assert.match(migration, /create or replace function public\.board_claim_next_task[\s\S]*claim\.actor_label = 'Co'[\s\S]*claim\.claim_purpose = 'co_execution'/i);
});

test("TASK-074 planning requires an authenticated GPT Claim and returns the canonical task to Co", () => {
  assert.match(migration, /claim_purpose\s*=\s*'gpt_planning'/i);
  assert.match(migration, /status\s*=\s*'ready'[\s\S]{0,180}assignee\s*=\s*'Co'[\s\S]{0,180}workspace_id\s*=\s*v_todo_workspace\.id/i);
  assert.match(migration, /Active GPT planning Claim is required/i);
  assert.match(migration, /p_plan\s+jsonb/i);
  assert.match(migration, /objective, proposed_solution and acceptance_criteria/i);
});

test("Co Developer QA is the only handoff into the existing GPT workspace", () => {
  assert.match(migration, /Only the required Co Developer QA item can trigger orchestration/i);
  assert.match(migration, /workspace_key = 'gpt'/i);
  assert.match(migration, /status = 'qa', assignee = 'GPT', workspace_id = v_gpt_workspace\.id/i);
  assert.match(migration, /task_developer_qa_handoff/);
  assert.match(migration, /lifecycle', 'developer_qa_to_gpt'/);
});

test("GPT Review PASS and REWORK are evidence-gated and bounded", () => {
  assert.match(migration, /GPT PASS must name pm_decision_required or runtime_qa/i);
  assert.match(migration, /GPT PASS requires Regression evidence/i);
  assert.match(migration, /board_transition_task\([\s\S]*p_target_assignee => 'QJC'/i);
  assert.match(migration, /status = 'ready', assignee = 'Co', workspace_id = v_todo_workspace\.id/i);
  assert.match(migration, /gpt_review_rework_to_co/);
  assert.match(edge, /operation === "claim_gpt"/);
  assert.match(edge, /operation === "plan_handoff_co"/);
  assert.match(edge, /operation === "engineering_review"/);
  assert.match(edge, /GPT qa transitions must use the controlled engineering_review operation/);
});

test("GPT Claim and plan handoff default to dry-run and do not need a service key", async () => {
  const config = { functionUrl: "https://example.supabase.co/functions/v1/engineering-transition" };
  assert.deepEqual(await tool.claimGpt(config, {
    "board-instance-id": "00000000-0000-0000-0000-000000000001",
    actor: "GPT",
    stage: "planning",
    "idempotency-key": "gpt-plan-001"
  }), {
    dryRun: true,
    service: config.functionUrl,
    operation: "claim_gpt",
    actor: "GPT",
    boardInstanceId: "00000000-0000-0000-0000-000000000001",
    stage: "planning",
    idempotencyKey: "gpt-plan-001",
    leaseSeconds: 900
  });

  const plan = JSON.stringify({
    objective: "Objective",
    proposed_solution: "Solution",
    acceptance_criteria: "Evidence"
  });
  const handoff = await tool.planHandoffCo(config, {
    task: "TASK-074",
    actor: "GPT",
    "claim-token": "00000000-0000-0000-0000-000000000002",
    "idempotency-key": "gpt-handoff-001",
    "plan-json": plan
  });
  assert.equal(handoff.dryRun, true);
  assert.equal(handoff.operation, "plan_handoff_co");
  assert.deepEqual(handoff.plan, JSON.parse(plan));
});

test("GPT direct qa transition and unbounded lease values are rejected before Cloud", () => {
  assert.throws(() => tool.validateTransition({
    actor: "GPT", currentStatus: "qa", targetStatus: "inprogress", targetAssignee: "Co"
  }), /engineering-review/);
  assert.throws(() => tool.boundedLeaseSeconds(45), /between 60 and 86400/);
});
