const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(root, "docs/supabase/20260920_task_074_workflow_binding_atomicity.sql"),
  "utf8",
);

test("TASK-074 reuses the canonical Module C resolver for atomic target binding", () => {
  assert.match(migration, /private\.board_c_resolve_workflow_create_state/);
  assert.match(migration, /new\.workflow_version_id\s*:=\s*v_expected\.workflow_version_id/);
  assert.match(migration, /new\.current_workflow_step_id\s*:=\s*v_expected\.current_workflow_step_id/);
  assert.match(migration, /new\.workspace_id\s+is\s+distinct\s+from\s+old\.workspace_id/i);
  assert.match(migration, /status\s+is\s+distinct\s+from\s+v_expected\.workflow_status/i);
  assert.match(migration, /assignee\s+is\s+distinct\s+from\s+v_expected\.workflow_assignee/i);
});

test("TASK-074 keeps explicit binding mismatches fail-closed", () => {
  assert.match(migration, /workflow binding is incomplete; card was not changed/i);
  assert.match(migration, /published Workflow requires a canonical card binding/i);
  assert.match(migration, /Workflow state does not match the bound workspace; card was not changed/i);
  assert.match(migration, /revoke all on function public\.enforce_module_c_workflow_invariant\(\)/i);
});

test("TASK-074 binding repair is an additive migration with no product-data DML", () => {
  assert.match(migration, /^begin;/m);
  assert.match(migration, /^commit;\s*$/m);
  assert.doesNotMatch(migration, /insert\s+into\s+public\.(?:board_tasks|board_cards)/i);
  assert.doesNotMatch(migration, /delete\s+from\s+public\.(?:board_tasks|board_cards)/i);
});
