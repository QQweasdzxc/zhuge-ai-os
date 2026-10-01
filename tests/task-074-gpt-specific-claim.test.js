const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(path.join(root, "docs/supabase/20260920_task_074_gpt_specific_claim.sql"), "utf8");
const activeGuardMigration = fs.readFileSync(path.join(root, "docs/supabase/20260920_task_074_gpt_specific_claim_active_guard.sql"), "utf8");
const edge = fs.readFileSync(path.join(root, "supabase/functions/engineering-transition/index.ts"), "utf8");
const tool = require(path.join(root, "tools/engineering-transition.js"));

test("TASK-074 adds a targeted GPT claim without a second ledger or queue-wide replacement", () => {
  assert.match(migration, /create or replace function public\.board_claim_specific_gpt_task/i);
  assert.match(migration, /private\.board_task_claims/);
  assert.match(migration, /v_purpose\s*:=\s*case[\s\S]*gpt_planning[\s\S]*gpt_review/i);
  assert.match(migration, /grant execute on function public\.board_claim_specific_gpt_task[\s\S]*to service_role/i);
  assert.doesNotMatch(migration, /create table\s+[^;]*claim/i);
  assert.doesNotMatch(migration, /board_claim_next_gpt_task/i);
});

test("targeted GPT planning and review claims fail closed on canonical eligibility", () => {
  assert.match(migration, /v_stage not in \('planning', 'review'\)/i);
  assert.match(migration, /v_task\.status <> 'ready'[\s\S]*v_task\.assignee <> 'Co'[\s\S]*workspace_id is distinct from v_todo_workspace\.id/i);
  assert.match(migration, /v_task\.status <> 'qa'[\s\S]*v_task\.assignee <> 'GPT'[\s\S]*workspace_id is distinct from v_gpt_workspace\.id/i);
  assert.match(migration, /v_task\.archived_at is not null/i);
  assert.match(migration, /TASK already has an active Cloud Claim/i);
  assert.match(migration, /board_c_resolve_workflow_create_state/i);
  assert.match(migration, /workflow_version_id = v_binding\.workflow_version_id/i);
  assert.match(migration, /current_workflow_step_id = v_binding\.current_workflow_step_id/i);
});

test("competing specific GPT claims fail closed at the active-claim boundary", () => {
  assert.match(activeGuardMigration, /TASK already has an active Cloud Claim/i);
  assert.match(activeGuardMigration, /board_claim_specific_gpt_task/i);
  assert.match(activeGuardMigration, /A non-expired target claim wins before stage eligibility/i);
  assert.ok(
    activeGuardMigration.indexOf("TASK already has an active Cloud Claim")
      < activeGuardMigration.indexOf("if v_stage = 'planning' then"),
    "active claim guard must precede stage eligibility"
  );
});

test("Edge exposes signed GPT-specific claim and calls only the targeted RPC", () => {
  assert.match(edge, /operation === "claim_specific_gpt"/);
  assert.match(edge, /actorToken\.profile !== "transition" \|\| actorToken\.actor !== "GPT"/);
  assert.match(edge, /rpc\/board_claim_specific_gpt_task/);
  assert.match(edge, /p_task_id: task\.id/);
  assert.match(edge, /p_actor_label: "GPT"/);
  const branch = edge.split('if (operation === "claim_specific_gpt")')[1].split('if (operation === "plan_handoff_co")')[0];
  assert.doesNotMatch(branch, /board_claim_next_gpt_task/);
});

test("GPT-specific claim tool is explicit, bounded, and dry-run by default", async () => {
  const config = { functionUrl: "https://example.supabase.co/functions/v1/engineering-transition" };
  assert.deepEqual(await tool.claimSpecificGptTask(config, {
    task: "TASK-079",
    actor: "GPT",
    stage: "planning",
    "idempotency-key": "gpt-specific-001"
  }), {
    dryRun: true,
    service: config.functionUrl,
    operation: "claim_specific_gpt",
    actor: "GPT",
    task: "TASK-079",
    stage: "planning",
    idempotencyKey: "gpt-specific-001",
    leaseSeconds: 900
  });
  await assert.rejects(
    tool.claimSpecificGptTask(config, { task: "TASK-079", actor: "Co", "idempotency-key": "wrong-actor-001" }),
    /actor GPT/
  );
  await assert.rejects(tool.claimSpecificGptTask(config, {
    task: "TASK-079", actor: "GPT", stage: "other", "idempotency-key": "bad-stage-001"
  }), /planning or review/);
});
