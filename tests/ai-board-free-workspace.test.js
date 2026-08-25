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
assert.match(runtime, /renderColumns/);
  assert.match(runtime, /data-workspace-rename/);
  assert.match(runtime, /board-workspace-count/);
  assert.match(runtime, /ZhugeSharedTaskBoard/);
  assert.match(runtime, /onColumnDrop/);
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

test("Free Workspace Board keeps Trello-style fixed desktop columns and header controls", () => {
  const html = read("app/Board/ai/index.html");
  const runtime = read("app/Board/ai/board-runtime.js");
  const goldenMasterCss = read("shared/theme/golden-master.css");
  const goldenMaster = read("shared/components/golden-master.js");
  assert.match(goldenMasterCss, /\.zhuge-module-shell \.board\{display:flex;gap:14px;align-items:flex-start;min-width:max-content/);
  assert.match(goldenMasterCss, /\.zhuge-module-shell \.column\{flex:0 0 300px;width:300px;min-width:300px/);
  assert.match(goldenMasterCss, /\.zhuge-module-shell \.board-shell\{padding:18px 0 28px;overflow-x:auto/);
  assert.match(html, /class="workspace-canvas"/);
  assert.doesNotMatch(html, /data-archive-close|id="addCardModal"|id="workspaceCreateDrawer"|id="archiveDrawer"/);
  assert.doesNotMatch(html, /workspace-add-column/);
  assert.match(goldenMaster, /renderOperations/);
  assert.match(runtime, /mountOperations/);
  assert.match(runtime, /data-board-create-workspace/);
  assert.match(runtime, /data-board-open-archive/);
  assert.match(runtime, /isArchiveTask/);
  assert.doesNotMatch(runtime, /historyTaskCards/);
});

test("Archive derives read-only records from canonical task status and governance state", () => {
  const service = read("shared/board/board-read-service.js");
  const runtime = read("app/Board/ai/board-runtime.js");
  assert.match(service, /function isArchiveTask\(taskOrStatus\)/);
  assert.match(service, /status === "done"/);
  assert.match(service, /isGovernanceTerminal\(value\)/);
  assert.match(runtime, /封存資料僅供查閱/);
  assert.match(runtime, /readOnly: true/);
  assert.match(runtime, /archiveOnly/);
  assert.doesNotMatch(runtime, /data-(?:restore|reopen)|board_(?:restore|reopen)/i);
});

test("Main Board hides the legacy done workspace while retaining canonical 已完成 and Archive", () => {
  const runtime = read("app/Board/ai/board-runtime.js");
  assert.match(runtime, /function isMainBoardWorkspace\(workspace\)/);
  assert.match(runtime, /key !== "done"/);
  assert.match(runtime, /name !== "已完工"/);
  assert.match(runtime, /isCompletionWorkspace/);
  assert.match(runtime, /state\.workspaces\.filter\(isMainBoardWorkspace\)/);
  assert.match(runtime, /const fullOrder = ordered\.map/);
  assert.match(runtime, /executeSharedTaskAction\(null, "reorderWorkspace"/);
  assert.match(runtime, /state\.tasks\.filter\(task => !isArchiveTask\(task\)\)/);
  assert.doesNotMatch(runtime, /deleteWorkspace|board_delete_workspace|board_restore_workspace|board_reopen_workspace/i);
});
