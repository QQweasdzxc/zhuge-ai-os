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
  const board = read("shared/theme/task-board.css");
  assert.match(drawer, /data-shared-task-title-code/);
  assert.match(drawer, /data-task-title-edit/);
  assert.match(drawer, /data-shared-task-floating-action/);
  assert.match(drawer, /floatingHtml/);
  assert.match(runtime, /titleEditable: !archiveOnly/);
  assert.match(runtime, /wireTaskTitleEditor/);
  assert.match(runtime, /data-progress-note-open/);
  assert.match(runtime, /data-progress-note-panel/);
  assert.match(runtime, /progress(?:Composer|NoteComposerMarkup\(archiveOnly\))/);
  assert.match(runtime, /setAttribute\("data-progress-note-composer-open", "true"\)/);
  assert.match(runtime, /aria-label="新增工作進度" title="新增工作進度">新增<\/button>/);
  assert.doesNotMatch(runtime, />➤<\/button>/);
  assert.match(runtime, /data-shared-attachment-delete/);
  assert.match(runtime, /shared-task-attachment-meta/);
  assert.match(runtime, /附件 · \$\{esc\(shortTimestampLabel\(item\.createdAt\)\)\}/);
  assert.match(runtime, /data-progress-note-edit/);
  assert.match(runtime, /data-progress-note-delete/);
  assert.match(runtime, /shared-task-progress-note-header/);
  assert.match(runtime, /shared-task-progress-note-title\">工作進度/);
  assert.doesNotMatch(runtime, /人工工作進度 · Human Progress Note/);
  assert.match(runtime, /progressNoteMetaLabel\(item\)/);
  assert.match(runtime, /visibleHumanProgressRows/);
  assert.match(runtime, /readOnly: archiveOnly/);
  assert.match(board, /\.shared-task-board-column \.shared-task-card\{height:104px;min-height:104px/);
  assert.doesNotMatch(runtime, /task\.workCode \|\| "TASK"\}\｜\$\{task\.title/);
});

test("TASK-042 Progress Note composer is a drawer-level fixed action", () => {
  const css = read("shared/theme/task-drawer.css");
  assert.match(css, /\.shared-task-drawer-floating-action\{position:absolute;/);
  assert.match(css, /\.shared-task-drawer-floating-action>\*\{pointer-events:auto\}/);
  assert.match(css, /\.shared-task-progress-composer-trigger\{[\s\S]*border-radius:50%/);
  assert.match(css, /\.shared-task-progress-composer-body\[hidden\]\{display:none\}/);
  assert.match(css, /\.shared-task-progress-submit\{[\s\S]*min-width:56px/);
  assert.match(css, /\.shared-task-drawer\[data-progress-note-composer-open="true"\]/);
  assert.match(css, /\.shared-task-progress-note-header\{display:flex/);
  assert.match(css, /\.shared-task-progress-note-actions\{display:inline-flex/);
  assert.match(css, /\.shared-task-drawer-activity-list\[data-shared-task-timeline\]\{[^}]*gap:8px/);
  assert.match(css, /\.shared-task-drawer-activity-list\[data-shared-task-timeline\] \.shared-task-drawer-activity-row\{[^}]*border:1px solid #344052[^}]*padding:16px 16px 16px 0/);
  assert.match(css, /\.shared-task-drawer-activity-list\[data-shared-task-timeline\].*min-height:118px/);
  assert.match(css, /\.shared-task-icon-button\{display:grid/);
});

test("Shared progress actions use the same Cloud lifecycle in AI Board and WorkTodo", () => {
  const runtime = read("shared/components/golden-master-runtime.js");
  const css = read("shared/theme/task-drawer.css");
  const aiBoard = read("app/Board/ai/index.html");
  const worktodo = read("app/Board/worktodo/index.html");

  assert.match(runtime, /data-progress-note-edit/);
  assert.match(runtime, /data-progress-note-delete/);
  assert.match(runtime, /data-shared-attachment-scope="progress_note"/);
  assert.match(runtime, /data-shared-attachment-scope="task"/);
  assert.match(runtime, /querySelectorAll\("\[data-shared-attachment-delete\]"\)/);
  assert.doesNotMatch(runtime, /data-task-attachment-delete|data-progress-attachment-delete/);
  assert.match(runtime, /activityMarkup\(activity, attachments, \{ readOnly: archiveOnly, workTodo \}\)/);
  assert.doesNotMatch(runtime, /function wireHumanProgressNoteActions\(task, activity, archiveOnly\) \{\s*if \(archiveOnly \|\| isWorkTodoTask\(task\)\)/);
  assert.match(css, /data-shared-task-timeline\].*gap:8px/);
  assert.match(css, /shared-task-progress-attachment-row\{display:grid;grid-template-columns:34px minmax\(0,1fr\) auto/);
});
