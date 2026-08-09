const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("AI Board is mounted inside the shared Zhuge AI OS navigation shell", () => {
  const index = read("app/Board/ai/index.html");
  const nav = read("shared/components/global-navigation.js");
  const css = read("shared/theme/global-navigation.css");
  assert.match(index, /id="zhugeGlobalNavigation"/);
  assert.match(index, /shared\/components\/global-navigation\.js/);
  assert.match(index, /shared\/theme\/global-navigation\.css/);
  for (const label of ["WorkLog", "待辦事項", "Investment", "Knowledge", "控制台", "設定"]) assert.match(nav, new RegExp(label));
  assert.match(css, /\.zhuge-module-shell/);
  assert.match(css, /\.zhuge-global-nav-link\.is-active/);
});

test("Shared Navigation opens WorkLog internal destinations without a private Board router", () => {
  const nav = read("shared/components/global-navigation.js");
  const worklog = read("modules/worklog/index.html");
  assert.match(nav, /modules\/worklog\/\?app=1&workspace=tasks/);
  assert.match(nav, /modules\/worklog\/\?app=1&workspace=library/);
  assert.match(nav, /modules\/worklog\/\?app=1&workspace=sync/);
  assert.match(nav, /modules\/worklog\/\?app=1&workspace=settings/);
  assert.match(worklog, /allowedWorkspaces = new Set/);
  assert.match(worklog, /zhuge_os_open_tabs_v1/);
  assert.match(worklog, /zhuge_os_active_workspace_v1/);
  assert.doesNotMatch(indexSource(), /window\.history\.back\(/);
});

function indexSource() { return read("app/Board/ai/index.html"); }
