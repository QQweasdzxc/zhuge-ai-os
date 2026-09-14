const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

const RETIRED = [
  "worktodo_update_task(uuid, jsonb)",
  "worktodo_delete_task(uuid)",
  "worktodo_create_workspace(text)",
  "worktodo_rename_workspace(uuid, text)",
  "worktodo_reorder_workspaces(uuid[])",
  "worktodo_add_task_progress_note(uuid, text)",
  "worktodo_edit_task_progress_note(bigint, text)",
  "worktodo_delete_task_progress_note(bigint)",
  "worktodo_set_agreement_schedule(uuid, text, date, date)",
  "worktodo_request_delete_workspace(uuid)",
  "worktodo_finalize_delete_workspace(uuid, uuid, uuid[])"
];

const CANONICAL = [
  "board_instance_update_task_title",
  "board_instance_update_task_content",
  "board_instance_delete_task",
  "board_instance_create_workspace",
  "board_instance_rename_workspace",
  "board_instance_reorder_workspaces",
  "board_instance_add_progress_note",
  "board_instance_edit_progress_note",
  "board_instance_delete_progress_note",
  "board_instance_set_agreement_schedule",
  "board_instance_delete_workspace"
];

test("WorkTodo C writer closure revokes application Execute for every retired writer", () => {
  const sql = read("docs/supabase/20260914_worktodo_c_writer_authority_closure.sql");
  const normalized = sql.replace(/\s+/g, " ").toLowerCase();
  for (const signature of RETIRED) {
    assert.ok(normalized.includes(`revoke all on function public.${signature.toLowerCase()} from public, anon, authenticated, service_role;`), signature);
  }
  assert.doesNotMatch(sql, /\bdrop\s+(function|table|trigger)\b/i);
  assert.doesNotMatch(sql, /\b(insert|update|delete)\s+(into\s+)?public\./i);
});

test("Formal WorkTodo runtime uses C shared action wiring and not retired direct RPCs", () => {
  const page = read("app/Board/worktodo/index.html");
  const runtime = read("shared/components/golden-master-runtime.js");
  const service = read("shared/board/board-read-service.js");

  assert.ok(page.includes("shared/components/task-action-contract.js?v="));
  assert.ok(page.includes("shared/components/task-action-adapters.js?v="));
  assert.ok(runtime.includes("cNativeWorkTodo"));
  assert.ok(service.includes("board_instance_create_task"));
  assert.ok(service.includes("board_instance_update_task_title"));
  for (const name of RETIRED.map(signature => signature.slice(0, signature.indexOf("(")))) {
    assert.doesNotMatch(runtime, new RegExp(`\\b${name}\\s*\\(`));
    assert.doesNotMatch(page, new RegExp(`\\b${name}\\s*\\(`));
  }
  for (const name of CANONICAL) assert.ok(service.includes(name), name);
});

test("Legacy WorkTodo lifecycle writer remains historical and not an application authority", () => {
  const sql = read("docs/supabase/20260913_task_064_worktodo_legacy_retirement.sql");
  assert.match(sql, /worktodo_apply_completion_lifecycle\(\)/);
  assert.match(sql, /worktodo_reconcile_completion_lifecycle\(\)/);
  assert.match(sql, /revoke\s+all\s+on\s+function/i);
  assert.match(sql, /Historical user_tasks/i);
});
