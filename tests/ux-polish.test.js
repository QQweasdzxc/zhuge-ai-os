const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("WorkLog Quick Add keeps one primary add flow and compact suggestions", () => {
  const source = read("modules/worklog/worklog-app.js");
  assert.match(source, /today-add-top/);
  assert.match(source, /data-action=["']add["']>＋ 加入工時/);
  assert.match(source, /工作建議/);
  assert.match(source, /function suggestionBatchSize\(viewportWidth = window\.innerWidth\)/);
  assert.match(source, /Number\(viewportWidth\) >= 768 \? 8 : 6/);
  assert.match(source, /data-accept/);
  assert.match(read("modules/worklog/worklog.css"), /data-accept\].*background:linear-gradient/);
  assert.doesNotMatch(source, /Mr\. KM 建議/);
});

test("Dashboard exposes a current-user mini WorkLog calendar without engineering copy", () => {
  const dashboard = read("app/dashboard/zhuge-dashboard.js");
  const dashboardCss = read("shared/theme/zhuge-dashboard.css");
  assert.match(dashboard, /function zhugeRootWorklogCalendarMarkup/);
  assert.match(dashboard, /data-open-worklog-date/);
  assert.match(dashboard, /data-mini-calendar-grid/);
  assert.match(dashboard, /data-root-worklog-entry/);
  assert.doesNotMatch(dashboard, /zhuge-worklog-module-card/);
  assert.match(dashboardCss, /grid-template-columns:repeat\(7/);
  assert.doesNotMatch(dashboard, /zhuge-root-principle/);
});

test("Dashboard WorkLog calendar reuses WorkLog month cells without nested interactive cards", () => {
  const dashboard = read("app/dashboard/zhuge-dashboard.js");
  const worklog = read("modules/worklog/worklog-app.js");
  const osCss = read("shared/theme/zhuge-os.css");
  assert.match(worklog, /function worklogCalendarCells\(year, month/);
  assert.match(worklog, /worklogCalendarCells\(y, m\)/);
  assert.match(dashboard, /worklogCalendarCells\(year, month, monthRows\)/);
  assert.match(dashboard, /data-dashboard-add-worklog/);
  assert.match(dashboard, /zhuge-dashboard-worklog-entry/);
  assert.doesNotMatch(dashboard, /data-root-module-card=\\"worklog\\"/);
  assert.match(dashboard, /zhuge-module-card-main/);
  assert.doesNotMatch(dashboard, /<button class="zhuge-module-card"/);
  assert.match(osCss, /\.zhuge-module-card-main[\s\S]*\.zhuge-module-card-detail/);
});

test("Dashboard workspace layout gives the calendar the wider column and keeps secondary cards compact", () => {
  const os = read("shared/theme/zhuge-os.css");
  const dashboard = read("shared/theme/zhuge-dashboard.css");
  assert.match(os, /zhuge-dashboard-workspace-layout\s*\{[^}]*grid-template-columns:\s*minmax\(0, 2\.1fr\) minmax\(280px, 1fr\)/s);
  assert.match(os, /zhuge-dashboard-workspace-list\s*\{[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(os, /zhuge-dashboard-worklog-entry\s*\{[^}]*grid-column:\s*1 \/ -1/s);
  assert.match(os, /@media \(max-width: 900px\)[\s\S]*zhuge-dashboard-workspace-list\s*\{\s*grid-template-columns: 1fr/s);
  assert.match(dashboard, /dashboard-workspace-layout[\s\S]*grid-template-columns: minmax\(0, 2\.1fr\) minmax\(280px, 1fr\)/s);
});

test("Control Console owns engineering destinations instead of global sidebar children", () => {
  const worklog = read("modules/worklog/worklog-app.js");
  for (const label of ["系統狀態", "工作看板", "工程準則", "系統藍圖"]) assert.match(worklog, new RegExp(label));
  assert.match(worklog, /control-center-entry/);
  const syncBlock = worklog.slice(worklog.indexOf("function sync()"), worklog.indexOf("function nextKnowledgeId()"));
  assert.doesNotMatch(syncBlock, /\["ai-board",/);
  assert.doesNotMatch(syncBlock, /console-tabs/);
});

test("Batch 4 moves work journal into a shared dynamic drawer and keeps Board actions available", () => {
  const worklog = read("modules/worklog/worklog-app.js");
  const board = read("app/Board/ai/board-runtime.js");
  const boardHtml = read("app/Board/ai/index.html");
  assert.match(worklog, /task-journal-drawer/);
  assert.match(worklog, /data-journal-close/);
  assert.doesNotMatch(worklog, /\$\{taskJournalPanel\(task\)\}/);
  assert.match(board, /data-board-create-card/);
  assert.match(board, /data-board-create-workspace/);
  assert.match(boardHtml, /class="toolbar board-toolbar"/);
  assert.match(boardHtml, /workspaceCreateDrawer/);
});

test("Tasks default to active items and open the existing form in a drawer", () => {
  const state = read("shared/app-state.js");
  const source = read("modules/worklog/worklog-app.js");
  const css = read("modules/worklog/worklog.css");
  assert.match(state, /let taskFilter = "open"/);
  assert.match(state, /let taskDrawerOpen = false/);
  assert.match(source, /data-task-new/);
  assert.match(source, /data-task-drawer-close/);
  assert.match(source, /taskDrawerOpen = true/);
  assert.match(source, /taskDrawerOpen = false/);
  assert.match(css, /\.task-drawer-backdrop/);
  assert.match(css, /\.task-drawer\.is-open/);
  assert.match(css, /task-workspace-grid\{display:block/);
  assert.match(source, /taskFilter === "open" \? task.status !== "completed"/);
});

test("Full-site UX polish keeps collapsible regions out of layout flow and uses shared tab/action semantics", () => {
  const workspaceCss = read("shared/theme/zhuge-workspace.css");
  const worklogCss = read("modules/worklog/worklog.css");
  const settings = read("modules/worklog/worklog-app.js");
  assert.match(workspaceCss, /workspace-tabs[\s\S]*border-bottom/);
  assert.match(workspaceCss, /workspace-worklog[\s\S]*summary-dashboard/);
  assert.match(workspaceCss, /task-drawer:not\(\.is-open\)/);
  assert.match(settings, /settings-reset-action/);
  assert.match(settings, /settings-logout-action/);
  assert.match(read("shared/theme/zhuge-os.css"), /zhuge-mini-calendar-grid/);
});

test("Shared hamburger visibility is controlled by shell breakpoints", () => {
  const shell = read("shared/theme/zhuge-shell.css");
  assert.match(shell, /min-width: 768px.*max-width: 1180px.*zhuge-shared-menu\{display:inline-flex\}/s);
  assert.match(shell, /min-width: 1181px[\s\S]*zhuge-shared-menu\{display:none!important\}/);
  const navigation = read("shared/theme/zhuge-navigation.css");
  assert.match(navigation, /min-width: 1181px[\s\S]*sidebar-menu-mark[\s\S]*display: none !important/);
});
