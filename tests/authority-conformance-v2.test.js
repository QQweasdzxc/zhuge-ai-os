const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const checker = fs.readFileSync(
  path.join(ROOT, "docs/supabase/20260914_c_authority_conformance_v2.sql"),
  "utf8"
);
const instanceMovementRetirement = fs.readFileSync(
  path.join(ROOT, "docs/supabase/20260914_retire_board_instance_move_workspace.sql"),
  "utf8"
);

test("Checker V2 is the existing canonical RPC with a structured contract", () => {
  assert.match(checker, /create\s+or\s+replace\s+function\s+public\.board_c_authority_conformance_check\(\s*p_board_instance_id\s+uuid/i);
  assert.match(checker, /stable\s+security\s+definer/i);
  assert.match(checker, /'contract',\s*'module-c-authority-conformance-v2'/i);
  assert.match(checker, /'schema_version',\s*2/i);
  for (const section of [
    "consumer", "release", "runtime", "capabilities", "authority",
    "data_isolation", "workflow", "completion", "overall"
  ]) assert.match(checker, new RegExp(`'${section}'`));
  for (const status of ["healthy", "partial", "unhealthy", "na", "unknown"]) {
    assert.match(checker, new RegExp(`'${status}'`));
  }
});

test("Checker V2 distinguishes writer body, grant, reachability, and authority", () => {
  assert.match(checker, /pg_get_functiondef\(p\.oid\)/i);
  assert.match(checker, /has_function_privilege\('anon'/i);
  assert.match(checker, /has_function_privilege\('authenticated'/i);
  assert.match(checker, /has_function_privilege\('service_role'/i);
  assert.match(checker, /application_reachable/i);
  assert.match(checker, /body_inspected/i);
  assert.match(checker, /body_targets_c_owned/i);
  assert.match(checker, /'canonical'/i);
  assert.match(checker, /'alternate'/i);
  assert.match(checker, /'HISTORICAL_COMPATIBILITY'/i);
  for (const fixture of [
    "worktodo_update_task",
    "worktodo_delete_task",
    "board_pm_acceptance_from_qjc_drop",
    "board_instance_move_task_workspace",
    "board_instance_delete_workspace",
    "worktodo_apply_completion_lifecycle"
  ]) assert.match(checker, new RegExp(fixture));
  assert.match(checker, /reachable-alternate-c-owned-writer/i);
  assert.match(checker, /no-reachable-legacy-48h-writer/i);
});

test("Checker V2 inventories enabled and inactive trigger surfaces", () => {
  assert.match(checker, /pg_trigger/i);
  assert.match(checker, /pg_get_triggerdef\(trigger_row\.oid/i);
  assert.match(checker, /pg_get_function_identity_arguments\(function_row\.oid\)/i);
  assert.match(checker, /trigger_enabled/i);
  assert.match(checker, /enabled-alternate-c-owned-trigger/i);
  assert.match(checker, /inactive_legacy_trigger_count/i);
  assert.match(checker, /compatibility_inactive/i);
});

test("Checker V2 enforces instance isolation and does not silently assign history", () => {
  for (const relation of [
    "board_tasks", "board_workspaces", "board_workflow_definitions",
    "board_workflow_steps", "board_task_vendor_links",
    "board_workspace_notification_settings", "board_task_attachments",
    "board_task_checklist_items", "engineering_activity_log"
  ]) assert.match(checker, new RegExp(relation));
  assert.match(checker, /is\s+distinct\s+from\s+p_board_instance_id/i);
  assert.match(checker, /historical-parentless-activity/i);
  assert.match(checker, /'status',\s*'unknown'/i);
});

test("Checker V2 keeps optional Workflow legal and removes optimistic runtime claims", () => {
  assert.match(checker, /'workflow_optional',\s*true/i);
  assert.match(checker, /'not_applicable'/i);
  assert.match(checker, /v_workflow_invalid/i);
  assert.match(checker, /runtime_route_status\s*:=\s*case/i);
  assert.match(checker, /v_persistence_status\s+text\s*:=\s*'unknown'/i);
  assert.doesNotMatch(checker, /v_legacy_current_route\s*:=\s*false/i);
  assert.doesNotMatch(checker, /'global_reconciler_current_route',\s*false/i);
  assert.match(checker, /'global_reconciler_current_route',\s*v_global_fallback_count\s*>\s*0/i);
  assert.doesNotMatch(checker, /'persistence',\s*'pass'/i);
  assert.doesNotMatch(checker, /'reload',\s*'pass'/i);
  assert.doesNotMatch(checker, /'new_session',\s*'pass'/i);
  assert.match(checker, /runtime static catalog evidence|Cloud static/i);
});

test("Checker V2 preserves the authenticated read-only execute boundary", () => {
  assert.match(checker, /revoke all on function public\.board_c_authority_conformance_check\(uuid\) from public, anon/i);
  assert.match(checker, /grant execute on function public\.board_c_authority_conformance_check\(uuid\) to authenticated/i);
  assert.match(checker, /'read_only_check',\s*true/i);
  assert.match(checker, /'cloud_mutation',\s*0/i);
  assert.match(checker, /'data_mutation',\s*0/i);
  assert.doesNotMatch(checker, /insert\s+into\s+public\.(board_tasks|user_tasks)\b/i);
  assert.doesNotMatch(checker, /update\s+public\.(board_tasks|user_tasks)\b/i);
  assert.doesNotMatch(checker, /delete\s+from\s+public\.(board_tasks|user_tasks)\b/i);
});

test("instance direct movement retirement is scoped away from generic movement", () => {
  assert.match(instanceMovementRetirement, /revoke\s+all\s+on\s+function\s+public\.board_instance_move_task_workspace\(uuid,\s*uuid,\s*text\)/i);
  assert.match(instanceMovementRetirement, /from\s+public,\s*anon,\s*authenticated/i);
  assert.match(instanceMovementRetirement, /grant\s+execute\s+on\s+function\s+public\.board_instance_move_task_workspace\(uuid,\s*uuid,\s*text\)\s+to\s+service_role/i);
  assert.doesNotMatch(instanceMovementRetirement, /board_move_task_workspace\s*\(/i);
  assert.match(instanceMovementRetirement, /board_c_reconcile_workspace_decision_v2/i);
});
