const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("TASK-011 keeps WorkTodo workspace operations on a creator-only controlled Cloud path", () => {
  const sql = read("docs/supabase/20260824_template_operation_parity.sql") + read("docs/supabase/20260824_worktodo_operations_fix.sql") + read("docs/supabase/20260824_canonical_template_workspace_add.sql");
  const service = read("shared/board/board-read-service.js");
  const runtime = read("shared/components/golden-master-runtime.js");

  assert.match(sql, /worktodo_rename_workspace/);
  assert.match(sql, /worktodo_reorder_workspaces/);
  assert.match(sql, /worktodo_create_workspace/);
  assert.match(sql, /worktodo_create_task/);
  assert.match(sql, /v_user, 'human', 'QJC', 'system_activity'/);
  assert.match(sql, /workspace_id/);
  assert.match(sql, /is_engineering_member\(array\['owner'\]\)/);
  assert.match(sql, /zhuge\.worktodo_workspace_write/);
  assert.match(sql, /workspace\.application_scope = 'worktodo'/);
  assert.match(sql, /revoke all on function public\.worktodo_rename_workspace/);
  assert.match(sql, /grant execute on function public\.worktodo_reorder_workspaces/);
  assert.match(service, /gateway\.rpc\("worktodo_rename_workspace"/);
  assert.match(service, /gateway\.rpc\("worktodo_reorder_workspaces"/);
  assert.match(service, /worktodoRenameWorkspace,/);
  assert.match(service, /worktodoReorderWorkspaces,/);
  assert.match(service, /gateway\.rpc\("worktodo_create_workspace"/);
  assert.match(service, /p_workspace_id: input\.workspaceId \|\| null/);
  assert.match(service, /worktodoCreateWorkspace,/);
  assert.doesNotMatch(runtime, /WorkTodo 六個工作區由正式 Scope 管理，不能在此重新排序/);
  assert.doesNotMatch(runtime, /WorkTodo 六個工作區由正式 Scope 管理，不能重新命名/);
  assert.match(runtime, /if \(isWorkTodoMode\(\)\) await service\.worktodoReorderWorkspaces\(workspaceIds\)/);
  assert.match(runtime, /else await service\.reorderWorkspaces\(fullOrder\.map\(workspace => workspace\.id\)\)/);
  assert.match(runtime, /const rename = isWorkTodoMode\(\) \? service\.worktodoRenameWorkspace/);
  assert.match(runtime, /addHtml: !completion/);
  assert.match(runtime, /service\.createTask\(\{ title: title, summary: summary, usageScenario: usageScenario, workspaceId \}/);
  assert.match(sql, /create or replace function public\.board_create_task\(/);
  assert.match(sql, /p_workspace_id uuid default null/);
  assert.match(sql, /application_scope = 'ai_board'/);
});

test("TASK-011 shares spacing and attachment presentation across AI Board and WorkTodo", () => {
  const runtime = read("shared/components/golden-master-runtime.js");
  const boardCss = read("shared/theme/task-board.css");
  const drawerCss = read("shared/theme/task-drawer.css");

  assert.match(boardCss, /shared-task-board-column>\.add\{[^}]*margin:16px 10px 10px/);
  assert.match(boardCss, /shared-task-board-add-card\{[^}]*margin:16px 10px 10px/);
  assert.match(drawerCss, /data-shared-task-timeline\].*gap:20px/);
  assert.match(drawerCss, /data-shared-task-timeline\] \.shared-task-drawer-activity-row\{[^}]*border:1px solid #344052[^}]*padding:16px 16px 16px 0/);
  assert.match(runtime, /const files = Array\.from\(attachmentInput\?\.files \|\| \[\]\)/);
  assert.doesNotMatch(runtime, /const files = workTodo \? \[\] : Array\.from/);
  assert.match(runtime, /progressAttachmentIcon/);
  assert.match(runtime, /shared-task-progress-note-attachment-badge/);
  assert.match(runtime, /data-progress-attachment-delete/);
  assert.match(runtime, /shared-task-progress-note-heading/);
});
