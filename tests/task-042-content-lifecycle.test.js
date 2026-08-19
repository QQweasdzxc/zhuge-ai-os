const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("TASK-042 migration keeps lifecycle changes in canonical tables and controlled paths", () => {
  const sql = read("docs/supabase/20260819_task_042_content_lifecycle.sql");
  assert.match(sql, /board_task_attachments[\s\S]*add column if not exists deletion_status/i);
  assert.match(sql, /engineering_activity_log[\s\S]*add column if not exists revision_of bigint/i);
  assert.match(sql, /foreign key \(revision_of\)[\s\S]*engineering_activity_log\(id\)/i);
  assert.match(sql, /foreign key \(tombstone_of\)[\s\S]*engineering_activity_log\(id\)/i);
  assert.match(sql, /board_update_task_title/);
  assert.match(sql, /board_request_delete_task_attachment/);
  assert.match(sql, /board_finalize_delete_task_attachment/);
  assert.match(sql, /board_edit_task_progress_note/);
  assert.match(sql, /board_delete_task_progress_note/);
  assert.match(sql, /revoke insert, update, delete on public\.board_task_attachments from authenticated/i);
  assert.match(sql, /revoke insert, update, delete on public\.engineering_activity_log from authenticated/i);
  assert.match(sql, /create policy board_task_attachment_storage_delete/i);
  assert.doesNotMatch(sql, /drop table|drop column|alter table public\.engineering_activity_log[\s\S]*alter column id/i);
});

test("TASK-042 adapters use the shared gateway and canonical Storage API", () => {
  const service = read("shared/board/board-read-service.js");
  const gateway = read("shared/supabase/supabase-gateway.js");
  assert.match(service, /updateTaskTitle/);
  assert.match(service, /board_update_task_title/);
  assert.match(service, /deleteTaskAttachment/);
  assert.match(service, /board_request_delete_task_attachment/);
  assert.match(service, /board_finalize_delete_task_attachment/);
  assert.match(service, /removeStorageObject/);
  assert.match(service, /board_edit_task_progress_note/);
  assert.match(service, /board_delete_task_progress_note/);
  assert.match(gateway, /storage\.from\(String\(bucket \|\| ""\)\)\.remove\(\[/);
  assert.doesNotMatch(service, /board_task_attachments["'`]\)\.(insert|update|delete)/i);
});

test("TASK-042 AI Board presentation keeps identity immutable and exposes lifecycle controls", () => {
  const runtime = read("app/Board/ai/board-runtime.js");
  const drawer = read("shared/components/task-drawer.js");
  const board = read("app/Board/ai/index.html");
  assert.match(drawer, /data-shared-task-title-code/);
  assert.match(drawer, /data-task-title-edit/);
  assert.match(runtime, /titleEditable: !archiveOnly/);
  assert.match(runtime, /wireTaskTitleEditor/);
  assert.match(runtime, /data-progress-note-open/);
  assert.match(runtime, /data-progress-note-panel/);
  assert.match(runtime, /data-task-attachment-delete/);
  assert.match(runtime, /data-progress-note-edit/);
  assert.match(runtime, /data-progress-note-delete/);
  assert.match(runtime, /visibleHumanProgressRows/);
  assert.match(runtime, /readOnly: archiveOnly/);
  assert.match(board, /\.taskcard\{height:156px;min-height:156px/);
  assert.doesNotMatch(runtime, /task\.workCode \|\| "TASK"\}\｜\$\{task\.title/);
});
