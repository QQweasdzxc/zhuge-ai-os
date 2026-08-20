const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");
const BoardRead = require("../shared/board/board-read-service.js");

test("TASK-039 completion drag migration uses the existing Cloud lifecycle boundary", () => {
  const sql = read("docs/supabase/20260820_task_039_completion_drag_lifecycle.sql");
  assert.match(sql, /create or replace function public\.board_move_task_workspace/i);
  assert.match(sql, /accepted_at = now\(\)/i);
  assert.match(sql, /completion_at = now\(\)/i);
  assert.match(sql, /archive_due_at = now\(\) \+ interval '48 hours'/i);
  assert.match(sql, /archive_due_at = null/i);
  assert.match(sql, /started_48h_window/i);
  assert.match(sql, /cancelled_48h_window/i);
  assert.match(sql, /task_auto_archived/i);
  assert.match(sql, /engineering_activity_log/i);
  assert.doesNotMatch(sql, /Only PM Acceptance PASS can enter 已完成/i);
  assert.doesNotMatch(sql.replace(/--.*$/gm, ""), /localStorage|sessionStorage|browser timer/i);
});

test("completion drag leaves a cancelled timer active and archives only by due timestamp", () => {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const taskOutsideCompleted = BoardRead.normalizeTask({
    status: "done",
    workspace_key: "qjc",
    workspace_name: "QJC驗證",
    completion_at: future,
    archive_due_at: null,
    archived_at: null
  });
  assert.equal(BoardRead.isArchiveTask(taskOutsideCompleted), false);

  const taskInCompleted = BoardRead.normalizeTask({
    status: "ready",
    workspace_key: "completed",
    workspace_name: "已完成",
    completion_at: future,
    archive_due_at: future,
    archived_at: null
  });
  assert.equal(BoardRead.isArchiveTask(taskInCompleted), false);

  const expired = BoardRead.normalizeTask({
    status: "ready",
    workspace_key: "completed",
    workspace_name: "已完成",
    completion_at: new Date(Date.now() - 49 * 60 * 60 * 1000).toISOString(),
    archive_due_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
    archived_at: null
  });
  assert.equal(BoardRead.isArchiveTask(expired), true);
});

test("TASK-039 final closing presentation keeps cards compact and progress cards readable", () => {
  const runtime = read("app/Board/ai/board-runtime.js");
  const board = read("app/Board/ai/index.html");
  const drawerCss = read("shared/theme/task-drawer.css");
  assert.doesNotMatch(runtime, /lifecycleLocked/);
  assert.doesNotMatch(runtime, /只能由 PM Acceptance PASS 的正式 lifecycle/);
  assert.match(runtime, /可拖曳至任意工作區/);
  assert.match(runtime, /data-task-attachment-delete/);
  assert.match(runtime, /shared-task-attachment-meta/);
  assert.match(runtime, /shared-task-progress-note-title\">工作進度/);
  assert.match(board, /\.taskcard\{height:136px;min-height:136px/);
  assert.match(drawerCss, /shared-task-attachment\{[^}]*grid-template-columns:58px minmax\(0,1fr\) auto/);
  assert.match(drawerCss, /data-shared-task-timeline\].*min-height:118px/);
});
