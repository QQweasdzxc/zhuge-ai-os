const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(ROOT, relative), "utf8");

test("desktop modernization does not override shared frame, board, WorkLog, or feedback geometry", () => {
  const css = read("shared/theme/desktop-modernization.css");
  assert.doesNotMatch(css, /\.workspace-(?:canvas|content|main|content-container)\b/);
  assert.doesNotMatch(css, /\.workspace-worklog\b/);
  assert.doesNotMatch(css, /\.(?:shared-task-board(?:-shell|-column)?|task-board(?:-shell|-column)?|board-shell|board-column|shared-task-card|board-task-card)\b/);
  assert.doesNotMatch(css, /\.(?:state-card|empty-state|error-state|loading-state|unavailable-state|insufficient-evidence-state)\s*\{/);
  assert.match(css, /\.management-center[\s,{]/, "P3 management presentation remains semantically scoped");
  assert.match(css, /\.settings-first-screen[\s,{]/, "P4 settings presentation remains semantically scoped");
  assert.match(css, /\.shared-task-drawer-panel/, "the shared drawer may keep its own component-level presentation");
});

test("canonical Shared Shell remains the only desktop outer-frame authority", () => {
  const tokens = read("shared/theme/tokens.css");
  const shell = read("shared/theme/zhuge-shell.css");
  const workspace = read("shared/theme/zhuge-workspace.css");
  const navigation = read("shared/theme/zhuge-navigation.css");

  assert.match(tokens, /--shell-page-padding-x:\s*24px/);
  assert.match(tokens, /--shell-page-padding-y:\s*24px/);
  assert.match(tokens, /--shell-sidebar-width:\s*232px/);
  assert.match(shell, /\.workspace-content-container,\.workspace-canvas\{min-width:0;max-width:none\}/);
  assert.match(workspace, /\.zhuge-module-shell \.workspace-canvas\s*\{\s*padding:\s*var\(--shell-page-padding-y\) var\(--shell-page-padding-x\)/);
  assert.match(navigation, /\.workspace-content-container\{width:100%;min-width:0;padding:18px 22px 28px\}/);
  assert.match(navigation, /\.workspace-shell \.workspace-content-container\{max-width:none\}/);
});

test("responsive outer-canvas spacing is limited to tablet and mobile breakpoints", () => {
  const css = read("shared/theme/responsive-modernization.css");
  assert.match(css, /@media \(min-width: 768px\) and \(max-width: 1180px\)[\s\S]*?\.workspace-canvas, \.workspace-content-container, \.page-shell\)\s*\{\s*padding-inline:/);
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*?\.workspace-canvas, \.workspace-content-container, \.page-shell\)\s*\{\s*padding-inline:/);
  assert.doesNotMatch(css, /@media\s*\(\s*min-width:\s*(?:1181|12\d{2}|1[3-9]\d{2}|\d{4,})px\s*\)[\s\S]{0,600}\.workspace-canvas/);
});

test("affected product entry points continue to consume the shared presentation authority", () => {
  const worktodo = read("app/Board/worktodo/index.html");
  const procurement = read("app/Board/procurement/index.html");
  const investment = read("modules/investment/index.html");
  const worklog = read("modules/worklog/index.html");
  const skyeye = read("modules/skyeye/index.html");

  for (const [name, html] of [["WorkTodo", worktodo], ["庶務行政", procurement], ["Investment", investment]]) {
    assert.match(html, /desktop-modernization\.css/, `${name} retains the shared presentation layer`);
    assert.match(html, /responsive-modernization\.css/, `${name} retains responsive protections`);
  }
  assert.match(worklog, /desktop-modernization\.css/, "WorkLog loads the layer through its canonical stylesheet list");
  assert.match(worklog, /responsive-modernization\.css/);
  assert.doesNotMatch(skyeye, /desktop-modernization\.css/, "SkyEye remains isolated from product desktop modernization");
  assert.match(skyeye, /skyeye\.css/);
});
