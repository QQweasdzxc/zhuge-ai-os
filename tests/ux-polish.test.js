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
  assert.match(dashboard, /function zhugeRootWorklogCalendarMarkup/);
  assert.match(dashboard, /data-open-worklog-date/);
  assert.match(dashboard, /登入後顯示本月與今日工時/);
  assert.doesNotMatch(dashboard, /zhuge-root-principle/);
});

test("Control Console owns engineering destinations instead of global sidebar children", () => {
  const worklog = read("modules/worklog/worklog-app.js");
  for (const label of ["系統狀態", "AI Board", "工作看板", "工程準則", "系統藍圖"]) assert.match(worklog, new RegExp(label));
  assert.match(worklog, /control-center-entry/);
  const syncBlock = worklog.slice(worklog.indexOf("function sync()"), worklog.indexOf("function nextKnowledgeId()"));
  assert.doesNotMatch(syncBlock, /console-tabs/);
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
  assert.match(source, /taskFilter === "open" \? task.status !== "completed"/);
});

test("Shared hamburger visibility is controlled by shell breakpoints", () => {
  const shell = read("shared/theme/zhuge-shell.css");
  assert.match(shell, /min-width: 768px.*max-width: 1180px.*zhuge-shared-menu\{display:inline-flex\}/s);
  assert.match(shell, /zhuge-module-shell\.zhuge-nav-collapsed \.zhuge-shared-menu\{display:inline-flex\}/);
});
