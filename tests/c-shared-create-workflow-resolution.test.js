const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const migration = read("docs/supabase/20260914_c_shared_create_workflow_resolution.sql");
const governedMigration = read("docs/supabase/20260914_c_governed_create_workflow_resolution.sql");
const runtime = read("shared/components/golden-master-runtime.js");

test("C shared Create resolves configured Workflow state from Instance and workspace", () => {
  assert.match(migration, /private\.board_c_resolve_workflow_create_state/);
  assert.match(migration, /board_instance_workflow_state/);
  assert.match(migration, /board_workflow_definitions/);
  assert.match(migration, /board_workflow_steps/);
  assert.match(migration, /workflow_version_id/);
  assert.match(migration, /current_workflow_step_id/);
  assert.match(migration, /workflow_status/);
  assert.match(migration, /workflow_assignee/);
  assert.match(migration, /private\.board_workflow_role_label/);
  assert.match(migration, /create or replace function public\.board_instance_create_task/);
  assert.match(migration, /insert into public\.board_tasks \([\s\S]*workflow_version_id[\s\S]*current_workflow_step_id/);
  assert.match(migration, /Workflow is optional/);
  assert.match(migration, /exactly one Workflow Step binding/);
});

test("C shared Create does not embed AI Board lifecycle values", () => {
  const createStart = migration.indexOf("create or replace function public.board_instance_create_task");
  const invariantStart = migration.indexOf("create or replace function public.enforce_module_c_workflow_invariant");
  const createContract = migration.slice(createStart, invariantStart);
  assert.doesNotMatch(createContract, /ai_board/);
  assert.doesNotMatch(createContract, /when\s+'todo'\s+then/i);
  assert.doesNotMatch(createContract, /v_expected_status\s*:=\s*'ready'/i);
  assert.doesNotMatch(createContract, /v_expected_assignee\s*:=\s*'Co'/i);
});

test("governed AI Board create remains an adapter over the same C resolver", () => {
  const start = governedMigration.indexOf("create or replace function public.board_create_task");
  const end = governedMigration.indexOf("create or replace function public.board_create_task(", start + 1);
  const governedCreate = governedMigration.slice(start, end > start ? end : undefined);
  assert.ok(start >= 0 && end > start);
  assert.match(governedCreate, /private\.board_c_resolve_workflow_create_state/);
  assert.match(governedCreate, /workflow_version_id/);
  assert.match(governedCreate, /current_workflow_step_id/);
  assert.doesNotMatch(governedCreate, /\) values \([\s\S]*['"]ready['"]\s*,\s*['"]Co['"]/i);
});

test("AI-only invariant is retired behind one generic C validation trigger", () => {
  assert.match(migration, /drop trigger if exists trg_ai_board_lifecycle_workspace_consistency/i);
  assert.match(migration, /create trigger trg_module_c_workflow_invariant/i);
  assert.match(migration, /enforce_module_c_workflow_invariant/);
  assert.match(migration, /Published Workflow truth/);
  assert.match(migration, /revoke all on function public\.enforce_ai_board_lifecycle_workspace_consistency\(\) from public, anon, authenticated, service_role/i);
  assert.doesNotMatch(migration, /when\s+'todo'\s+then/i);
  assert.doesNotMatch(migration, /when\s+'completed'\s+then/i);
});

test("shared runtime sends only the generic C non-workflow default", () => {
  assert.match(runtime, /status: "not_started", usageScenario, workspaceId/);
  assert.doesNotMatch(runtime, /status: state\.applicationScope === "c" \? "not_started" : "ready"/);
});

test("binding validation runs after the existing new-card binding trigger", () => {
  assert.ok(migration.indexOf("board_tasks_workflow_binding_before_insert") < migration.indexOf("trg_module_c_workflow_invariant"));
  assert.match(migration, /workflow binding trigger runs first by trigger name/);
});
