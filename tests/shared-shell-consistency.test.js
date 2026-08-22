const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(root, relative), "utf8");

test("all formal workspace entry points mount the canonical Shared OS Shell", () => {
  const dashboard = read("app/dashboard/index.html");
  const worklog = read("modules/worklog/index.html");
  const board = read("app/Board/ai/index.html");
  const investment = read("modules/investment/components/module-shell.js");
  assert.match(dashboard, /zhugeSharedNavigation/);
  assert.match(dashboard, /zhugeSharedHeader/);
  assert.match(worklog, /zhuge-navigation\.js/);
  assert.match(worklog, /zhuge-shell\.js/);
  assert.match(board, /zhugeSharedNavigation/);
  assert.match(board, /data-golden-master-surface/);
  assert.match(board, /shared\/components\/golden-master\.js/);
  assert.match(investment, /zhugeSharedNavigation/);
  assert.match(investment, /zhugeSharedHeader/);
  assert.match(dashboard, /zhuge-dashboard-shell/);
  assert.match(investment, /investment-module-shell/);
});

test("Shared Shell owns the canonical geometry and appearance tokens", () => {
  const shell = read("shared/theme/zhuge-shell.css");
  for (const token of [
    "--shell-sidebar-width",
    "--shell-main-gap",
    "--shell-page-padding-x",
    "--shell-page-padding-y",
    "--shell-header-height",
    "--shell-header-content-gap",
    "--shell-section-gap",
    "--shell-radius"
  ]) assert.match(shell, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(shell, /data-theme="light"/);
  assert.match(read("shared/theme/zhuge-appearance.js"), /system.*light.*dark|allowed/si);
});

test("AI Board content blocks use the canonical shell boundary", () => {
  const workspace = read("shared/theme/zhuge-workspace.css");
  assert.match(workspace, /\.zhuge-module-shell > \.workspace-app,\s*\.zhuge-module-shell > \.app\.workspace-app/);
  assert.match(workspace, /\.zhuge-module-shell\.workspace-shell > \.workspace-app > \.main > \.workspace-canvas\s*\{\s*padding:\s*0;/);
});

test("Dashboard workspace surface stretches with the stacked right column", () => {
  const dashboard = read("shared/theme/zhuge-dashboard.css");
  assert.match(dashboard, /\.zhuge-dashboard-shell \.dashboard-workspace-layout\s*\{[\s\S]*?align-items:\s*stretch;/);
  assert.match(dashboard, /\.zhuge-dashboard-shell \.dashboard-right-column\s*\{[\s\S]*?display:\s*grid;/);
});

test("Canonical Navigation hides disabled construction placeholders", () => {
  const navigation = read("shared/components/zhuge-navigation.js");
  assert.match(navigation, /enabled: false, visible: false/);
  assert.match(navigation, /function isVisible/);
  assert.match(navigation, /!item\.comingSoon/);
});

test("tablet and mobile layout retain a usable rail/drawer without horizontal overflow rules", () => {
  const navigation = read("shared/theme/zhuge-navigation.css");
  assert.match(navigation, /min-width: 768px.*max-width: 1180px/s);
  assert.match(navigation, /--zhuge-sidebar-collapsed-width:\s*72px/);
  assert.match(navigation, /grid-template-columns:\s*var\(--zhuge-sidebar-collapsed-width\) minmax\(0, 1fr\)/);
  assert.match(navigation, /position:fixed/);
  assert.match(navigation, /transform:translateX\(-105%\)/);
});
