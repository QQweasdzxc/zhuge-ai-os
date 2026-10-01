const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "docs/supabase/20260921_task_074_runtime_qa_workflow.sql"),
  "utf8",
);
const transition = fs.readFileSync(
  path.join(root, "supabase/functions/engineering-transition/index.ts"),
  "utf8",
);
const tool = fs.readFileSync(
  path.join(root, "tools/engineering-transition.js"),
  "utf8",
);

test("TASK-074 publishes one additive QJC runtime_qa gate without rebinding tasks", () => {
  assert.match(migration, /^begin;\s*$/m);
  assert.match(migration, /^commit;\s*$/m);
  assert.match(migration, /status = 'published'/);
  assert.match(migration, /step_key = 'step-5'/);
  assert.match(migration, /gate_key = 'runtime_qa'/);
  assert.match(migration, /human_action_required,\s*\n\s*completion_role/);
  assert.match(migration, /'runtime_action'/);
  assert.match(migration, /'step-5_runtime_qa_pass'/);
  assert.match(migration, /'step-5_runtime_qa_rework'/);
  assert.match(migration, /array\['qjc'\]::text\[\]/);
  assert.match(migration, /on conflict \(workflow_version_id, transition_key\) do nothing/i);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.board_tasks/i);
  assert.doesNotMatch(migration, /update\s+public\.board_tasks/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.board_tasks/i);
});

test("TASK-074 QJC PASS is non-completing and REWORK returns to the Co step", () => {
  assert.match(migration, /'step-5_runtime_qa_pass',[\s\S]{0,520}v_qjc_step_id,[\s\S]{0,180}v_qjc_step_id,[\s\S]{0,160}true/i);
  assert.match(migration, /'step-5_runtime_qa_rework',[\s\S]{0,520}v_qjc_step_id,[\s\S]{0,180}v_co_step_id,[\s\S]{0,160}false/i);
  assert.match(migration, /PM-controlled completion\s+--\s+remains separate/i);
});

test("TASK-074 Co runtime path uses the canonical Edge and RPC contracts", () => {
  assert.match(tool, /claim-specific-task/);
  assert.match(tool, /operation: "claim_specific_task"/);
  assert.match(tool, /operation: "checklist"/);
  assert.match(tool, /actor: args\.actor/);
  assert.match(tool, /itemKey: args\["item-key"\]/);
  assert.match(tool, /claimToken: args\["claim-token"\]/);
  assert.match(transition, /actorToken\.actor === "Co"/);
  assert.match(transition, /rpc\/board_claim_specific_task/);
  assert.match(transition, /rpc\/board_orchestrate_developer_qa/);
  assert.match(transition, /itemKey\.toLowerCase\(\) === "developer-qa"/);
  assert.match(transition, /p_actor_label: "Co"/);
  assert.match(transition, /p_claim_token: body\.claimToken/);
  assert.doesNotMatch(transition, /insert\s+into\s+board_tasks/i);
  assert.doesNotMatch(transition, /update\s+board_tasks/i);
});

test("TASK-074 Co path cannot impersonate GPT or QJC", () => {
  assert.match(transition, /const ALLOWED_ACTORS = new Set\(\["Co", "GPT"\]\)/);
  assert.match(transition, /body\.actor && body\.actor !== actorToken\.actor/);
  assert.match(transition, /GPT qa transitions must use the controlled engineering_review operation/);
  assert.doesNotMatch(tool, /actor:\s*["']GPT["'][\s\S]{0,120}claim-specific-task/);
});
