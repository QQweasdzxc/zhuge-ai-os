const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("PROG-003 migration changes only future WorkTodo tombstone semantics", () => {
  const sql = read("docs/supabase/20260826_worktodo_progress_tombstone_consistency.sql");
  assert.match(sql, /create or replace function public\.worktodo_delete_task_progress_note\(\s*p_activity_id bigint/is);
  assert.match(sql, /returns public\.engineering_activity_log/i);
  assert.match(sql, /security definer/i);
  assert.match(sql, /set search_path = public, pg_temp/i);
  assert.match(sql, /t\.application_scope = 'worktodo'[\s\S]*t\.owner_uuid = v_user/i);
  assert.match(sql, /e\.activity_type = 'human_progress_note'[\s\S]*e\.action in \('progress_note_created', 'progress_note_edited'\)/i);
  assert.match(sql, /'progress_note_deleted'[\s\S]*'system_activity', p_activity_id/is);
  assert.doesNotMatch(sql, /update public\.engineering_activity_log|delete from public\.engineering_activity_log/i);
  assert.doesNotMatch(sql, /board_delete_task_progress_note|user_tasks|work_journal_entries|storage\./i);
});

test("PROG-004 formal entrypoints load one shared classifier before the Board read/runtime layers", () => {
  const workTodo = read("app/Board/worktodo/index.html");
  const aiBoard = read("app/Board/ai/index.html");
  const boardRead = read("shared/board/board-read-service.js");
  const runtime = read("shared/components/golden-master-runtime.js");
  const adapter = read("modules/worklog/components/worktodo-task-adapter.js");
  [workTodo, aiBoard].forEach(html => {
    assert.match(html, /shared\/components\/activity-classifier\.js/);
    assert.ok(html.indexOf("activity-classifier.js") < html.indexOf("board-read-service.js"));
  });
  assert.match(boardRead, /function classifyActivity\(/);
  assert.doesNotMatch(boardRead, /action === "progress_note_created" \? "human_progress_note"/);
  assert.match(runtime, /sharedActivityClassifier\?\.isHumanProgressActivity\?\.\(item\) === true/);
  assert.match(adapter, /function normalizeCanonical\(/);
  assert.match(adapter, /sharedActivityClassifier\?\.classify/);
});
