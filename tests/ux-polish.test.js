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
  assert.match(source, /suggestionBatchSize\(viewportWidth = window\.innerWidth\)\s*\{\s*return 6;/);
  assert.doesNotMatch(source, /Mr\. KM 建議/);
});

test("Dashboard exposes the current user's compact WorkLog entry point", () => {
  const dashboard = read("app/dashboard/index.html");
  assert.match(dashboard, /data-module=\"worklog\"/);
  assert.match(dashboard, /登入後顯示本月與今日工時/);
  assert.match(dashboard, /modules\/worklog\//);
});

test("Control Console owns engineering destinations instead of global sidebar children", () => {
  const navigation = read("shared/components/zhuge-navigation.js");
  const worklog = read("modules/worklog/worklog-app.js");
  assert.match(navigation, /global rail exposes one compact entry only/);
  for (const label of ["系統狀態", "AI Board", "工作看板", "工程準則", "系統藍圖"]) assert.match(worklog, new RegExp(label));
  assert.match(worklog, /console-tabs/);
});

test("Shared hamburger visibility is controlled by shell breakpoints", () => {
  const shell = read("shared/theme/zhuge-shell.css");
  assert.match(shell, /min-width: 768px.*max-width: 1180px.*zhuge-shared-menu\{display:inline-flex\}/s);
  assert.match(shell, /zhuge-module-shell\.zhuge-nav-collapsed \.zhuge-shared-menu\{display:inline-flex\}/);
});
