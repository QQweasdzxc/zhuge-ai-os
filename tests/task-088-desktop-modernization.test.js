const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = relative => fs.readFileSync(path.join(ROOT, relative), "utf8");

test("TASK-088 P3-P6 shared desktop layer is loaded by canonical surfaces", () => {
  const expected = [
    "modules/worklog/index.html",
    "app/dashboard/index.html",
    "app/Board/ai/index.html",
    "app/Board/worktodo/index.html",
    "app/Board/procurement/index.html",
    "app/Board/template-preview/index.html",
    "app/Board/investment/index.html",
    "modules/investment/index.html"
  ];
  for (const file of expected) {
    assert.match(read(file), /desktop-modernization\.css/);
  }
  assert.match(read("shared/theme/desktop-modernization.css"), /@media \(min-width: 1024px\)/);
});

test("TASK-088 P3 management and control surfaces explain impact before diagnostics", () => {
  const source = read("modules/worklog/worklog-app.js");
  assert.match(source, /management-first-screen/);
  assert.match(source, /control-center-first-screen/);
  assert.match(source, /影響/);
  assert.match(source, /系統技術細節/);
  assert.match(source, /control-center-entry-grid/);
});

test("TASK-088 P4 settings and knowledge keep detail actions available in second layer", () => {
  const source = read("modules/worklog/worklog-app.js");
  assert.match(source, /帳號與安全/);
  assert.match(source, /個人偏好/);
  assert.match(source, /工作設定/);
  assert.match(source, /進階系統/);
  assert.match(source, /settings-secondary-section settings-work-section/);
  assert.match(source, /data-knowledge-library/);
  assert.match(source, /knowledge-card-details/);
  assert.match(source, /data-edit-library/);
  assert.match(source, /data-archive-library/);
  assert.match(source, /data-del-library/);
});

test("TASK-088 P5 shared board and drawer styling is consumer-neutral", () => {
  const css = read("shared/theme/desktop-modernization.css");
  assert.match(css, /\.shared-task-board/);
  assert.match(css, /\.shared-task-board-column/);
  assert.match(css, /\.shared-task-card/);
  assert.match(css, /\.shared-task-drawer-panel/);
  assert.match(css, /\.shared-task-board-empty/);
  assert.doesNotMatch(css, /暫緩|資源分享與參考/);
});

test("TASK-088 P6 leaves WorkLog as a scoped reference surface", () => {
  const css = read("shared/theme/desktop-modernization.css");
  assert.match(css, /\.workspace-worklog/);
  assert.match(css, /WorkLog remains the reference surface/);
});
