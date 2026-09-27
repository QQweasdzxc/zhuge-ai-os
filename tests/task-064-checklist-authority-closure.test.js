const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "docs/supabase/20260914_task_064_checklist_evidence_only_authority.sql"),
  "utf8"
);
const runtime = fs.readFileSync(
  path.join(root, "shared/components/golden-master-runtime.js"),
  "utf8"
);
const service = fs.readFileSync(
  path.join(root, "shared/board/board-read-service.js"),
  "utf8"
);
const cPolicyMigration = fs.readFileSync(
  path.join(root, "docs/supabase/20260913_c_completion_archive_optional_workflow.sql"),
  "utf8"
);

function functionSection(source) {
  const start = source.indexOf("create or replace function public.board_update_checklist_item");
  const end = source.indexOf("$function$;", start);
  assert.ok(start >= 0, "checklist RPC definition is present");
  assert.ok(end > start, "checklist RPC body is bounded");
  return source.slice(start, end);
}

test("checklist RPC remains an evidence-only adapter", () => {
  const fn = functionSection(migration);
  assert.match(fn, /update public\.engineering_checklist_items/);
  assert.match(fn, /insert into public\.engineering_activity_log/);
  assert.match(fn, /p_actor_type/);
  assert.match(fn, /p_actor_label/);
  assert.doesNotMatch(fn, /update\s+public\.board_tasks/i);
  assert.doesNotMatch(fn, /completion_at|archive_due_at|archived_at/i);
  assert.doesNotMatch(fn, /48\s*hours|172800|2\s*days/i);
  assert.doesNotMatch(fn, /workspace_key\s*=\s*'(?:completed|co)'/i);
  assert.doesNotMatch(fn, /status\s*=\s*'(?:done|ready|inprogress)'/i);
});

test("PM PASS and FAIL remain on their existing formal routes", () => {
  assert.match(runtime, /acceptThroughCContract/);
  assert.match(runtime, /workflow\.reconcileWorkspaceDecision/);
  assert.match(service, /board_c_reconcile_workspace_decision_v2/);
  assert.match(service, /board_pm_qa_fail_requeue/);
  assert.match(cPolicyMigration, /archive_delay_seconds\s*=\s*86400/);
  assert.match(cPolicyMigration, /policy_identity\s*=\s*'module-c-completion-archive-policy'/);
});

test("the migration preserves the checklist RPC application boundary", () => {
  assert.match(migration, /revoke all on function public\.board_update_checklist_item\(uuid, text, text, text, text, text\)\s+from public, anon/i);
  assert.match(migration, /grant execute on function public\.board_update_checklist_item\(uuid, text, text, text, text, text\)\s+to authenticated/i);
  assert.match(migration, /does not write board_tasks lifecycle fields/i);
});
