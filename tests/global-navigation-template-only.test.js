const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("formal pages defer navigation mounting to the shared adoption lifecycle", () => {
  const navigation = read("shared/components/zhuge-navigation.js");
  const shell = read("shared/components/zhuge-shell.js");
  const navigationCss = read("shared/theme/zhuge-navigation.css");
  const worklog = read("modules/worklog/worklog-app.js");

  assert.match(navigation, /sharedNavigationDisabled !== "true"/);
  assert.match(shell, /showNavigationMenu: !target\.closest\('\[data-shared-navigation-mode="template-only"\]'\)/);
  assert.match(navigationCss, /data-shared-navigation-mode="template-only"/);
  assert.match(worklog, /function sharedNavigationTargetMarkup/);
  assert.match(worklog, /isNavigationTemplate \? "" : ' data-shared-navigation-disabled="true"'/);
  assert.match(worklog, /SYSTEM_TEMPLATE_VIEW === "navigation" \? "" : ' data-shared-navigation-mode="template-only"'/);

  for (const file of ["app/dashboard/index.html", "app/Board/ai/index.html", "app/Board/worktodo/index.html"]) {
    const source = read(file);
    assert.match(source, /data-shared-navigation-mode="template-only"/);
    assert.match(source, /data-shared-navigation-disabled="true"/);
  }

  for (const file of ["modules/investment/components/module-shell.js", "modules/investment/services/investment-module.js"]) {
    const source = read(file);
    assert.match(source, /data-shared-navigation-mode="template-only"/);
    assert.match(source, /data-shared-navigation-disabled="true"/);
  }
});

test("System Template A/B/C selectors remain distinct and reuse the existing Runtime", () => {
  const worklogIndex = read("modules/worklog/index.html");
  const worklog = read("modules/worklog/worklog-app.js");
  const board = read("app/Board/ai/index.html");
  const worktodo = read("app/Board/worktodo/index.html");
  const css = read("shared/theme/zhuge-workspace.css");

  assert.match(worklogIndex, /templateView/);
  assert.match(worklogIndex, /navigation/);
  assert.match(worklogIndex, /workspace/);
  assert.match(worklog, /const templateClass = SYSTEM_TEMPLATE_VIEW/);
  assert.match(worklog, /template-view-\$\{SYSTEM_TEMPLATE_VIEW\}/);
  assert.match(board, /templateView.*board/);
  assert.match(worktodo, /templateView.*board/);
  assert.match(css, /data-template-view="navigation"/);
  assert.match(css, /data-template-view="workspace"/);
  assert.match(css, /data-template-view="board"/);
});
