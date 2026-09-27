const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const read = relativePath => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

test("TASK-088 shared management actions use the shared control and status vocabulary", () => {
  const access = read("shared/components/user-access-management.js");
  const accessCss = read("shared/theme/user-access-management.css");
  const template = read("shared/components/template-management-center.js");

  assert.match(access, /使用者存取管理/);
  assert.match(access, /class="btn2 zhuge-core-button"[^>]*data-access-refresh/);
  assert.match(access, /data-variant="primary"[^>]*type="button"[^>]*data-review-decision="approve"/);
  assert.match(access, /data-variant="danger"[^>]*type="button"[^>]*data-review-decision="reject"/);
  assert.match(access, /data-zhuge-state="loading"/);
  assert.match(access, /state\.applications\.length \? "" : "empty"/);
  assert.match(accessCss, /@import url\("\.\/core-components\.css"\)/);
  assert.match(template, /template-management-card-header zhuge-core-button/);
  assert.match(template, /btn2 zhuge-core-button[^>]*data-template-management-preview/);
});

test("TASK-088 shared Task Drawer exposes touch-safe actions without changing lifecycle authority", () => {
  const drawerCss = read("shared/theme/task-drawer.css");
  const drawer = read("shared/components/task-drawer.js");
  const workspaceCss = read("shared/theme/zhuge-workspace.css");

  assert.match(drawer, /shared-task-drawer-title-edit zhuge-core-button/);
  assert.match(drawer, /shared-task-drawer-close zhuge-core-button/);
  assert.match(drawerCss, /shared-task-drawer :where\([^)]*shared-task-icon-button/);
  assert.match(drawerCss, /@media\(pointer:coarse\)/);
  assert.match(drawerCss, /var\(--zhuge-touch-target-min\)/);
  assert.match(workspaceCss, /\.zhuge-module-shell \.zhuge-core-button \{ min-height: var\(--zhuge-touch-target-min\); \}/);
});

test("TASK-088 known Investment UX repairs remain connected to existing consumers", () => {
  const overview = read("modules/investment/pages/overview-page.js");
  const service = read("modules/investment/services/investment-module.js");
  const transactions = read("modules/investment/pages/transactions-page.js");
  const hub = read("shared/components/global-floating-hub.js");

  assert.match(overview, /data-investment-research-symbol/);
  assert.match(overview, /查看研究 →/);
  assert.match(service, /function openResearchForSymbol\(symbol, market = "AUTO"\)/);
  assert.match(service, /openResearchForSymbol/);
  assert.match(transactions, /現金流/);
  assert.match(transactions, /買入支出/);
  assert.match(hub, /dataset\.presenceState/);
  assert.match(hub, /無法確認在線狀態/);
});
