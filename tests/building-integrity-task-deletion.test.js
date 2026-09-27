const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

const migration = read("docs/supabase/20260915_c_task_deletion_lineage_manifest.sql");

test("Building Integrity Item 2 defines one private immutable C deletion manifest", () => {
  assert.match(migration, /create table if not exists private\.module_c_task_deletion_manifests/i);
  for (const column of [
    "task_id uuid not null unique",
    "board_instance_id uuid not null",
    "consumer_id text not null",
    "consumer_identity jsonb not null",
    "template_key text not null",
    "module_id text not null",
    "workspace_id uuid not null",
    "work_code text not null",
    "task_snapshot jsonb not null",
    "child_snapshot jsonb not null",
    "deleted_at timestamptz not null",
    "deleted_by uuid",
    "contract_version text not null",
    "deletion_event_id bigint not null",
    "idempotency_key text not null unique",
  ]) {
    assert.match(migration, new RegExp(column.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  assert.match(migration, /before update or delete on private\.module_c_task_deletion_manifests/i);
  assert.match(migration, /module-c-task-deletion-lineage-v1/);
  assert.match(migration, /revoke all on table private\.module_c_task_deletion_manifests from public, anon, authenticated, service_role/i);
});

test("Canonical delete writes task_deleted activity and manifest before the hard delete", () => {
  const deleteStart = migration.indexOf("create or replace function public.board_instance_delete_task");
  const deleteBody = migration.slice(deleteStart);
  const activityInsert = deleteBody.indexOf("insert into public.engineering_activity_log");
  const manifestInsert = deleteBody.indexOf("insert into private.module_c_task_deletion_manifests");
  const parentDelete = deleteBody.indexOf("delete from public.board_tasks");

  assert.ok(deleteStart >= 0, "canonical delete function is missing");
  assert.ok(activityInsert >= 0, "task_deleted activity insert is missing");
  assert.ok(manifestInsert > activityInsert, "manifest must be persisted after the activity event is allocated");
  assert.ok(parentDelete > manifestInsert, "parent hard-delete must follow both evidence writes");
  assert.match(deleteBody, /'task_deleted'/);
  assert.match(deleteBody, /'actor_label',?\s*'System'|\n\s*'System',/);
  assert.match(deleteBody, /v_task_snapshot\s*:=\s*to_jsonb\(v_task\)/);
  assert.match(deleteBody, /v_child_snapshot\s*:=\s*jsonb_build_object/);
  assert.match(deleteBody, /v_idempotency_key\s*:=\s*'module-c-task-delete:'/);
  assert.match(deleteBody, /for update/);
  assert.match(deleteBody, /'atomic', true/);
});

test("Deletion evidence covers every current board-task child relation without migrating child data", () => {
  for (const relation of [
    "board_task_checklist_items",
    "board_task_attachments",
    "board_task_vendor_links",
    "engineering_checklist_items",
    "investment_ivtk_card_links",
  ]) {
    assert.match(migration, new RegExp(`'${relation}'[\\s\\S]*?\\'count\\'`, "i"));
    assert.match(migration, new RegExp(`public\\.${relation}`, "i"));
  }
  assert.doesNotMatch(migration, /insert into public\.(user_tasks|work_journal_entries)/i);
  assert.doesNotMatch(migration, /update public\.(board_tasks|board_workspaces|user_tasks|work_journal_entries)/i);
  assert.doesNotMatch(migration, /delete from public\.(user_tasks|work_journal_entries)/i);
});

test("task_deleted activity is guarded as immutable and uses the existing System taxonomy", () => {
  assert.match(migration, /create or replace function private\.prevent_module_c_task_deleted_activity_mutation/i);
  assert.match(migration, /new\.action = 'task_deleted'[\s\S]*deletion_manifest_id/i);
  assert.match(migration, /task_deleted activity is immutable/i);
  assert.match(migration, /'system',[\s\S]*'System',[\s\S]*'system_activity'/i);
  assert.match(migration, /before insert or update or delete on public\.engineering_activity_log/i);
});

test("Deletion manifest read-back is authenticated and Board Instance scoped", () => {
  assert.match(migration, /create or replace function public\.board_instance_read_task_deletion_manifest\(p_task_id uuid\)/i);
  assert.match(migration, /if auth\.uid\(\) is null/);
  assert.match(migration, /public\.board_instance_can_read\(v_manifest\.board_instance_id\)/);
  assert.match(migration, /'lineage_verified', v_activity\.id is not null and v_activity\.id = v_manifest\.deletion_event_id/);
  assert.match(migration, /revoke all on function public\.board_instance_read_task_deletion_manifest\(uuid\) from public, anon/i);
  assert.match(migration, /grant execute on function public\.board_instance_read_task_deletion_manifest\(uuid\) to authenticated/i);
});

test("Shared C delete callers still use the one canonical parent delete RPC", () => {
  const service = read("shared/board/board-read-service.js");
  const adapters = read("shared/components/task-action-adapters.js");
  assert.match(service, /gateway\.rpc\("board_instance_delete_task", \{ p_task_id: taskId \}\)/);
  assert.match(adapters, /function createAiBoardAdapter[\s\S]*?deleteTask: payload => required\(service, "deleteTask"\)/);
  assert.match(adapters, /function createCTemplateAdapter[\s\S]*?deleteTask: payload => required\(service, "deleteTask"\)/);
  assert.match(adapters, /function createWorkTodoAdapter[\s\S]*?worktodoDeleteTask/);
});
