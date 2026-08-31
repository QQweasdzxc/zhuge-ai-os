const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(path.join(root, "docs/supabase/20260831_task_040_minimal_lifecycle_orchestration.sql"), "utf8");
const reclaimMigration = fs.readFileSync(path.join(root, "docs/supabase/20260831_task_040_expired_claim_reclaim.sql"), "utf8");
const edgeFunction = fs.readFileSync(path.join(root, "supabase/functions/engineering-transition/index.ts"), "utf8");
const tool = fs.readFileSync(path.join(root, "tools/engineering-transition.js"), "utf8");

test("TASK-040 migration defines the minimal Cloud claim and audit contract", () => {
  for (const fragment of [
    "create schema if not exists private",
    "private.board_task_claims",
    "enable row level security",
    "board_claim_next_task",
    "board_renew_task_claim",
    "board_release_task_claim",
    "board_orchestrate_developer_qa",
    "pg_advisory_xact_lock",
    "for update of task skip locked",
    "task_claimed",
    "task_developer_qa_handoff",
    "task_pm_qa_failed_requeued",
    "board_claim_next_task",
    "requires board_claim_next_task"
  ]) assert.match(migration, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(migration, /insert\s+into\s+public\.board_tasks/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.(?:board_tasks|engineering_checklist_items)/i);
  assert.match(migration, /set\s+status\s*=\s*'ready'[\s\S]{0,180}workspace_id\s*=\s*v_co_workspace\.id/i);
  assert.match(migration, /revoke\s+all\s+on\s+private\.board_task_claims/i);
});

test("TASK-040 expired Claim reclaim is targeted, generic and auditable", () => {
  for (const fragment of [
    "board_reclaim_expired_task",
    "p_expired_claim_token",
    "targeted_reclaim",
    "lease_expires_at > v_now",
    "task_claim_reclaimed",
    "pg_advisory_xact_lock",
    "revoke all on function public.board_reclaim_expired_task",
    "grant execute on function public.board_reclaim_expired_task"
  ]) assert.match(reclaimMigration, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.doesNotMatch(reclaimMigration, /insert\s+into\s+public\.board_tasks/i);
  assert.doesNotMatch(reclaimMigration, /update\s+public\.board_tasks/i);
  assert.doesNotMatch(reclaimMigration, /delete\s+from\s+public\./i);
  assert.match(reclaimMigration, /state\s*<>\s*'active'[\s\S]*lease_expires_at\s*>\s*v_now/i);
  assert.match(reclaimMigration, /after_data\s*->>\s*'claim_id'/i);
});

test("TASK-040 Edge Function exposes controlled claim and truthful handoff operations", () => {
  for (const fragment of [
    'operation === "claim"',
    'operation === "reclaim_expired_claim"',
    'operation === "renew_claim"',
    'operation === "release_claim"',
    'rpc/board_claim_next_task',
    'rpc/board_reclaim_expired_task',
    'rpc/board_orchestrate_developer_qa',
    'expiredClaimToken',
    'NEXT_CLAIM_FAILED_AFTER_HANDOFF',
    'autoClaimNext'
  ]) assert.match(edgeFunction, new RegExp(fragment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(edgeFunction, /return\s+json\([\s\S]*NEXT_CLAIM_FAILED_AFTER_HANDOFF[\s\S]*503\)/);
});

test("TASK-040 tool routes Co ready work through Claim", () => {
  assert.match(tool, /claim|reclaim-expired-claim|renew-claim|release-claim/);
  assert.match(tool, /reclaim_expired_claim/);
  assert.match(tool, /Co ready -> inprogress requires board_claim_next_task/);
  assert.doesNotMatch(tool, /ready:\s*Object\.freeze\(\{\s*inprogress:\s*"Co"/);
});
