const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const GoldenMaster = require("../shared/components/golden-master.js");
const SharedTaskBoard = require("../shared/components/task-board.js");

test("new WorkTodo is a source-equivalent AI Board consumer with a scoped data boundary", () => {
  const aiBoard = read("app/Board/ai/index.html");
  const worktodo = read("app/Board/worktodo/index.html");
  const runtime = read("app/Board/ai/board-runtime.js");
  const actionAdapters = read("shared/components/task-action-adapters.js");
  const navigation = read("shared/components/zhuge-navigation.js");
  const appConfig = read("shared/app-config.js");
  const dashboard = read("app/dashboard/index.html");
  const dashboardRuntime = read("app/dashboard/zhuge-dashboard.js");
  const scopeMigration = read("docs/supabase/20260821_worktodo_application_scope_owner.sql");

  for (const marker of [
    "shared/theme/zhuge-navigation.css",
    "shared/theme/zhuge-shell.css",
    "shared/theme/task-card.css",
    "shared/theme/task-drawer.css",
    "shared/theme/task-board.css",
    "shared/theme/golden-master.css",
    "shared/components/task-card.js",
    "shared/components/task-drawer.js",
    "shared/components/task-board.js",
    "shared/components/golden-master.js",
    "shared/components/golden-master-runtime.js",
    "data-golden-master-surface"
  ]) {
    assert.match(aiBoard, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(worktodo, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), marker);
  }
  assert.match(worktodo, /<title>Zhuge AI OS｜工作待辦<\/title>/);
  assert.match(worktodo, /data-active-workspace="tasks-new"/);
  assert.match(worktodo, /src="\.\.\/\.\.\/\.\.\/shared\/components\/golden-master-runtime\.js\?v=/);
  assert.doesNotMatch(aiBoard, /<style[\s>]/i);
  assert.doesNotMatch(worktodo, /<style[\s>]/i);
  assert.doesNotMatch(aiBoard, /id="addCardModal"|id="workspaceCreateDrawer"|id="archiveDrawer"/);
  assert.doesNotMatch(worktodo, /id="addCardModal"|id="workspaceCreateDrawer"|id="archiveDrawer"/);
  assert.doesNotMatch(aiBoard, /class="(?:board-shell|board-toolbar|board)"/);
  assert.doesNotMatch(worktodo, /class="(?:board-shell|board-toolbar|board)"/);
  assert.match(worktodo, /worktodo-task-adapter\.js/);
  assert.match(worktodo, /shared\/api\/data-service\.js/);
  assert.doesNotMatch(worktodo, /GM-FIX-|golden-master-preview/i);
  assert.match(aiBoard, /title="工程準則" data-board-nav="principles"/);
  assert.match(aiBoard, /title="系統藍圖" data-board-nav="system-map"/);
  assert.doesNotMatch(worktodo, /工程準則|系統藍圖|data-board-nav="principles"|data-board-nav="system-map"/);
  assert.deepEqual(worktodo.match(/data-board-nav="[^"]+"/g), ['data-board-nav="board"']);
  assert.match(navigation, /"tasks-new": \{ icon: "✅", label: "工作待辦"/);
  assert.match(navigation, /"tasks-new": "app\/Board\/worktodo\/"/);
  assert.doesNotMatch(navigation, /工作待辦（舊）/);
  assert.doesNotMatch(navigation, /modules\/worklog\/\?app=1&workspace=tasks/);
  assert.match(appConfig, /"tasks-new": \{[\s\S]*externalHref: "\.\.\/\.\.\/app\/Board\/worktodo\/"/);
  assert.doesNotMatch(appConfig, /工作待辦（舊）/);
  assert.match(dashboard, /href="\.\.\/\.\.\/app\/Board\/worktodo\/" data-module="tasks-new"/);
  assert.match(dashboardRuntime, /\["tasks-new", "✅", "工作待辦"/);
  assert.match(dashboardRuntime, /data-open-workspace="tasks-new"/);

  assert.match(runtime, /function isWorkTodoMode\(\)/);
  assert.match(runtime, /service\.load\(\{ applicationScope: state\.applicationScope \}\)/);
  assert.match(runtime, /executeSharedTaskAction\(null, "createTask"/);
  assert.match(runtime, /executeSharedTaskAction\(task, "updateContent"/);
  assert.match(actionAdapters, /worktodoCreateTask/);
  assert.match(actionAdapters, /worktodoUpdateTask/);
  assert.match(runtime, /startBoardRuntime\(\{ applicationScope: "worktodo" \}\)/);
  assert.doesNotMatch(runtime, /emptyWorkTodo|GM-FIX-|golden-master-preview/i);
  for (const workspace of ["待開始", "進行中", "等待回覆", "等待驗收", "阻塞", "完成"]) {
    assert.match(scopeMigration, new RegExp(`'[^']+', '${workspace}',`));
  }
  assert.match(scopeMigration, /application_scope = 'worktodo'/);
  assert.match(scopeMigration, /owner_uuid = \(select auth\.uid\(\)\)/);
  assert.match(scopeMigration, /create or replace function public\.worktodo_create_task/);
  assert.match(scopeMigration, /create or replace function public\.worktodo_migrate_task/);
});

test("AI Board and new WorkTodo receive the same Golden Master column UI change", () => {
  const aiBoard = read("app/Board/ai/index.html");
  const worktodo = read("app/Board/worktodo/index.html");
  const runtime = read("app/Board/ai/board-runtime.js");
  const boardCss = read("shared/theme/task-board.css");
  const html = GoldenMaster.renderColumns([{ id: "shared-column", key: "shared", name: "共用欄位" }], {}, { board: SharedTaskBoard });

  assert.match(html, /class="shared-task-board-column column process golden-master-column"/);
  assert.match(boardCss, /\.golden-master-column \.shared-task-board-column-header/);
  assert.match(boardCss, /\.shared-task-board-column\{[^}]*background:#10161f[^}]*border:1px solid #293241[^}]*border-radius:12px/);
  assert.match(boardCss, /\.shared-task-board-column-header\{height:55px;padding:0 14px/);
  assert.match(boardCss, /\.shared-task-board-cards\{display:flex;flex-direction:column;gap:9px;min-height:570px;padding:10px/);
  assert.match(boardCss, /\.shared-task-board-column \.shared-task-card\{height:104px;min-height:104px/);
  assert.match(aiBoard, /shared\/components\/golden-master\.js/);
  assert.match(worktodo, /shared\/components\/golden-master\.js/);
  assert.match(runtime, /root\.ZhugeGoldenMaster\?\.renderColumns/);
  assert.match(worktodo, /src="\.\.\/\.\.\/\.\.\/shared\/components\/golden-master-runtime\.js\?v=/);
});
