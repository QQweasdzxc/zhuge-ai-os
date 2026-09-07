const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("TASK-063 guards DELETE with OLD before reading NEW", () => {
  const migration = read("docs/supabase/20260907_task_063_fix_board_delete_trigger.sql");
  const deleteStart = migration.indexOf("if tg_op = 'DELETE' then");
  const newGuardStart = migration.indexOf("if new.board_instance_id is null then");
  assert.ok(deleteStart >= 0, "DELETE branch is missing");
  assert.ok(newGuardStart > deleteStart, "NEW must not be read before the DELETE branch");

  const deleteBranch = migration.slice(deleteStart, migration.indexOf("if new.board_instance_id is null then", deleteStart));
  assert.match(deleteBranch, /old\.board_instance_id/);
  assert.doesNotMatch(deleteBranch, /\bnew\./);
  assert.match(deleteBranch, /return old;/);
});

test("TASK-063 migration is a function-only repair with no data mutation", () => {
  const migration = read("docs/supabase/20260907_task_063_fix_board_delete_trigger.sql");
  assert.match(migration, /create or replace function public\.enforce_board_task_scope/);
  assert.doesNotMatch(migration, /\b(insert into|update public\.|delete from|truncate)\b/i);
  assert.doesNotMatch(migration, /alter table|drop table|drop column|create table/i);
});

test("TASK-063 shared C delete adapter exposes the existing board-instance contract", () => {
  const service = read("shared/board/board-read-service.js");
  assert.match(service, /async function deleteTask\(taskId, options = \{\}\)/);
  assert.match(service, /gateway\.rpc\("board_instance_delete_task", \{ p_task_id: taskId \}\)/);
  assert.match(service, /\n\s+deleteTask,\n\s+worktodoCreateTask,/);
});

test("TASK-063 shared C runtime closes the task drawer after delete", () => {
  const runtime = read("shared/components/golden-master-runtime.js");
  assert.match(runtime, /function closeTaskDetail\(\)/);
  assert.match(runtime, /await executeSharedTaskAction\(task, "deleteTask"[\s\S]*?closeTaskDetail\(\)/);
});
