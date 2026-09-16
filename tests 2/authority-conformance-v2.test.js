const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const checker = fs.readFileSync(
  path.join(ROOT, "docs/supabase/20260915_c_authority_conformance_workspace_delete_fail_closed.sql"),
  "utf8"
);
const checkerGap2Migration = fs.readFileSync(
  path.join(ROOT, "docs/supabase/20260915_c_authority_conformance_checker_gap2.sql"),
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

test("Checker V2 aligns canonical contracts with explicit authority scope", () => {
  const canonicalStart = checker.indexOf("v_canonical_function_names");
  const alternateStart = checker.indexOf("v_known_alternate_functions");
  assert.match(checker.slice(canonicalStart, alternateStart), /'board_provision_c_consumer_v2'/i);
  assert.doesNotMatch(checker.slice(canonicalStart, alternateStart), /'board_provision_consumer'/i);
  assert.match(checker, /v_canonical_provisioning/i);
  assert.match(checker, /board_provision_consumer' then 'COMPATIBILITY_PROVISIONING'/i);
  assert.match(checker, /'contract',\s*'public\.board_provision_c_consumer_v2\(text,text,text,text,jsonb,jsonb,text\)'/i);
  assert.match(checker, /v_c_authority_relevant\s*:=/i);
  assert.match(checker, /v_is_shared_capability/i);
  assert.match(checker, /v_is_domain_extension/i);
  assert.match(checker, /v_is_worklog_compatibility/i);
  assert.match(checker, /'c_health_relevant',\s*v_c_health_relevant/i);
});

test("Checker V2 excludes legitimate shared, domain, and WorkLog surfaces without disabling C detection", () => {
  assert.match(checker, /v_is_alternate\s*:=\s*v_application_reachable\s+and\s*v_c_authority_relevant/i);
  assert.match(checker, /'repair_investment_ivtk_identity'/i);
  assert.match(checker, /'sync_investment_ivtk_projection'/i);
  assert.match(checker, /v_function\.function_name\s*~\*\s*'\^worktodo_'/i);
  assert.match(checker, /'authority_scope',\s*case/i);
  assert.match(checker, /'DOMAIN_EXTENSION'/i);
  assert.match(checker, /'COMPATIBILITY_PROVISIONING'/i);
  assert.match(checker, /'LEGACY_COMPATIBILITY_REACHABLE'/i);
  assert.match(checker, /v_trigger_c_health_relevant/i);
  assert.match(checker, /else 'pass'/i);
});

test("Checker V2 keeps WorkLog compatibility outside C overall health", () => {
  const compatibilitySummary = checker.slice(
    checker.indexOf("-- WorkLog/user_tasks compatibility writers"),
    checker.indexOf("if v_reachable_48h_writer_count > 0 then")
  );
  assert.match(compatibilitySummary, /outside the\s+-- Module C Health scope/i);
  assert.doesNotMatch(compatibilitySummary, /v_has_unhealthy\s*:=\s*true/i);
  assert.doesNotMatch(compatibilitySummary, /v_gap_count\s*:=\s*v_gap_count\s*\+/i);
  assert.match(checker, /'worklog_compatibility_outside_c_health',\s*true/i);
});

test("Checker V2 uses instance-first adoption evidence and fails closed on ambiguous aliases", () => {
  assert.match(checker, /v_adoption_resolution\s*:=\s*'instance_uuid'/i);
  assert.match(checker, /v_adoption_resolution\s*:=\s*'canonical_scope_alias'/i);
  assert.match(checker, /v_adoption_resolution\s*:=\s*'ambiguous_scope_alias'/i);
  assert.match(checker, /'adoption_candidate_count',\s*v_adoption_candidate_count/i);
  assert.match(checker, /'unscoped_attachment_orphans',\s*v_unscoped_attachment_orphan_count/i);
  assert.match(checker, /'unscoped_checklist_orphans',\s*v_unscoped_checklist_orphan_count/i);
});

test("Checker Final Alignment #2 classifies the canonical shared task checklist writer", () => {
  const sharedStart = checker.indexOf("v_shared_capability_functions");
  const domainStart = checker.indexOf("v_domain_extension_functions");
  assert.ok(sharedStart >= 0 && domainStart > sharedStart);
  assert.match(checker.slice(sharedStart, domainStart), /'board_update_task_checklist_item'/i);
  assert.match(checkerGap2Migration, /board_update_task_checklist_item/i);
});

test("Checker Final Alignment #2 counts only true unscoped child rows as orphan evidence", () => {
  assert.match(checker, /v_attachment_orphan_count\s*:=\s*0/i);
  assert.match(checker, /v_checklist_orphan_count\s*:=\s*0/i);
  assert.match(checker, /attachment\.task_id\s+is\s+null/i);
  assert.match(checker, /checklist\.task_id\s+is\s+null/i);
  const scopeErrorStart = checker.indexOf("v_data_scope_errors :=");
  const isolationStart = checker.indexOf("v_data_isolation_status :=", scopeErrorStart);
  assert.ok(scopeErrorStart >= 0 && isolationStart > scopeErrorStart);
  const scopeErrorBlock = checker.slice(scopeErrorStart, isolationStart);
  assert.doesNotMatch(scopeErrorBlock, /v_attachment_orphan_count|v_checklist_orphan_count/);
  assert.match(checkerGap2Migration, /only the global unscoped checks below represent/i);
});

test("Checker V2 treats fail-closed populated delete as canonical empty-workspace authority", () => {
  const canonicalStart = checker.indexOf("v_canonical_function_names");
  const alternateStart = checker.indexOf("v_known_alternate_functions");
  const alternateEnd = checker.indexOf("v_canonical_trigger_names", alternateStart);
  assert.ok(canonicalStart >= 0 && alternateStart > canonicalStart && alternateEnd > alternateStart);
  assert.match(checker.slice(canonicalStart, alternateStart), /'board_instance_delete_workspace'/i);
  assert.doesNotMatch(checker.slice(alternateStart, alternateEnd), /'board_instance_delete_workspace'/i);
  assert.match(checker, /populated branch is fail-closed/i);
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
