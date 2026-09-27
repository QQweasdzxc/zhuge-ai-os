const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("Management keeps its canonical entry and Template Management Center composition", () => {
  const runtime = read("modules/worklog/worklog-app.js");
  assert.match(runtime, /function management\(\)\s*\{[\s\S]*<h2 id="management-entry-title">管理入口<\/h2>/);
  assert.match(runtime, /<div class="control-center-entry-grid">\$\{controlCenterEntryMarkup\(\)\}\$\{templateManagementMarkup\(\)\}<\/div>/);
  assert.match(runtime, /function controlCenterEntryMarkup\(\)[\s\S]*data-open-workspace="\$\{id\}"/);
  assert.match(runtime, /function templateManagementMarkup\(\)[\s\S]*ZhugeTemplateManagementCenter\.render\(\)/);
});

test("Management Layout R1 uses a scoped 25/75 desktop split", () => {
  const css = read("modules/worklog/worklog.css");
  assert.match(css, /@media\(min-width:1024px\)\{[\s\S]*\.zhuge-module-shell \.management-center \.control-center-entry-grid\{grid-template-columns:minmax\(200px,1fr\) minmax\(0,3fr\)/);
  assert.match(css, /\.zhuge-module-shell \.management-center \.control-center-entry-grid>\.control-center-entry:nth-child\(1\)\{grid-row:1\}/);
  assert.match(css, /\.zhuge-module-shell \.management-center \.control-center-entry-grid>\.template-management-center\{grid-column:2;grid-row:1 \/ span 3/);
});

test("Management Layout R1 collapses the entry and template areas on narrow screens", () => {
  const css = read("modules/worklog/worklog.css");
  assert.match(css, /@media\(max-width:1023px\)\{[\s\S]*\.zhuge-module-shell \.management-center \.control-center-entry-grid\{grid-template-columns:1fr;grid-template-rows:none\}/);
  assert.match(css, /\.zhuge-module-shell \.management-center \.control-center-entry-grid>\.template-management-center\{height:auto\}/);
});

