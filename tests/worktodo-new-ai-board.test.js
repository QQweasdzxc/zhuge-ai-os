const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("new WorkTodo is a source-equivalent AI Board consumer with an empty data boundary", () => {
  const aiBoard = read("app/Board/ai/index.html");
  const worktodo = read("app/Board/worktodo/index.html");
  const runtime = read("app/Board/ai/board-runtime.js");
  const navigation = read("shared/components/zhuge-navigation.js");
  const appConfig = read("shared/app-config.js");
  const dashboard = read("app/dashboard/index.html");
  const dashboardRuntime = read("app/dashboard/zhuge-dashboard.js");

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
    "id=\"goldenMasterToolbar\"",
    "id=\"boardColumns\"",
    "id=\"addCardModal\"",
    "id=\"workspaceCreateDrawer\"",
    "id=\"archiveDrawer\""
  ]) {
    assert.match(aiBoard, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(worktodo, new RegExp(marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), marker);
  }
  assert.match(worktodo, /<title>Zhuge AI OS｜工作待辦<\/title>/);
  assert.match(worktodo, /data-active-workspace="tasks-new"/);
  assert.match(worktodo, /src="\.\.\/ai\/board-runtime\.js\?v=/);
  assert.doesNotMatch(worktodo, /worktodo-task-adapter\.js|GM-FIX-|golden-master-preview/i);
  assert.match(navigation, /"tasks-new": \{ icon: "✅", label: "工作待辦"/);
  assert.match(navigation, /"tasks-new": "app\/Board\/worktodo\/"/);
  assert.match(navigation, /tasks: \{ icon: "🗂️", label: "工作待辦（舊）"/);
  assert.match(navigation, /modules\/worklog\/\?app=1&workspace=tasks/);
  assert.match(appConfig, /"tasks-new": \{[\s\S]*externalHref: "\.\.\/\.\.\/app\/Board\/worktodo\/"/);
  assert.match(appConfig, /tasks: \{ icon: "✅", label: "工作待辦", navLabel: "工作待辦（舊）"/);
  assert.match(dashboard, /href="\.\.\/\.\.\/app\/Board\/worktodo\/" data-module="tasks-new"/);
  assert.match(dashboardRuntime, /\["tasks-new", "✅", "工作待辦"/);
  assert.match(dashboardRuntime, /data-open-workspace="tasks-new"/);

  const emptyRuntime = runtime.slice(runtime.indexOf("function startEmptyWorkTodoRuntime"), runtime.indexOf("function startBoardRuntime"));
  assert.match(runtime, /function isEmptyWorkTodoMode\(\)/);
  assert.match(runtime, /if \(isEmptyWorkTodoMode\(\)\) \{/);
  assert.doesNotMatch(emptyRuntime, /service\.(load|subscribe|create|rename|move|reorder|update|delete|upload|governance)/);
});
