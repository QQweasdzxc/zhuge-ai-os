const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("Free Workspace migration extends the existing Board TASK and audit model", () => {
  const sql = read("docs/supabase/20260815_ai_board_free_workspace.sql");
  assert.match(sql, /create table if not exists public\.board_workspaces/i);
  assert.match(sql, /workspace_id uuid/i);
  assert.match(sql, /workspace_key text/i);
  for (const workspace of ["待辦", "Co區", "GPT區", "QJC驗證", "已完工"]) {
    assert.match(sql, new RegExp(workspace));
  }
  assert.match(sql, /create or replace function public\.board_create_workspace/i);
  assert.match(sql, /create or replace function public\.board_rename_workspace/i);
  assert.match(sql, /create or replace function public\.board_reorder_workspaces/i);
  assert.match(sql, /create or replace function public\.board_move_task_workspace/i);
  assert.match(sql, /workspace_moved/i);
  assert.match(sql, /is_engineering_member\(array\['owner'\]\)/i);
  assert.match(sql, /revoke insert, update, delete, truncate/i);
  assert.match(sql, /supabase_realtime/i);
  assert.doesNotMatch(sql, /localStorage|sessionStorage/i);
});

test("Free Workspace runtime does not derive card position from status or assignee", () => {
  const service = read("shared/board/board-read-service.js");
  const runtime = read("app/Board/ai/board-runtime.js");
  assert.match(service, /gateway\.select\("board_workspaces"/);
  assert.match(service, /workspace_id/);
  assert.match(service, /moveTaskWorkspace/);
  assert.match(runtime, /data-workspace-id/);
  assert.match(runtime, /data-workspace-rename/);
  assert.match(runtime, /board-workspace-count/);
  assert.match(runtime, /application\/x-zhuge-workspace-id/);
  assert.doesNotMatch(runtime, /process\[data-status/);
  assert.doesNotMatch(runtime, /只能依序交給下一個工作階段/);
});

test("Free Workspace scope leaves WorkLog and existing workflow RPC untouched", () => {
  const runtime = read("app/Board/ai/board-runtime.js");
  const service = read("shared/board/board-read-service.js");
  assert.doesNotMatch(runtime, /modules\/worklog\/.*(?:insert|update|delete)/i);
  assert.match(service, /board_transition_task/);
  assert.match(service, /engineering_activity_log/);
});
