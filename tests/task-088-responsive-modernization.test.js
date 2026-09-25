const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("TASK-088 successor owns one shared responsive/accessibility layer", () => {
  const css = read("shared/theme/responsive-modernization.css");
  assert.match(css, /--zhuge-responsive-gutter/);
  assert.match(css, /text-size-adjust: 100%/);
  assert.match(css, /min-height: var\(--zhuge-touch-target-min\)/);
  assert.match(css, /safe-area-bottom/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /forced-colors/);
  assert.match(css, /prefers-contrast/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /zhuge-responsive-table/);
  assert.doesNotMatch(css, /(?:investment|worktodo|ai-board|worklog|procurement)/i);
});

test("canonical product and public surfaces opt into the successor layer", () => {
  const surfaces = [
    "index.html",
    "app/dashboard/index.html",
    "app/Board/worktodo/index.html",
    "app/Board/ai/index.html",
    "app/Board/procurement/index.html",
    "app/Board/template-preview/index.html",
    "app/Board/investment/index.html",
    "modules/investment/index.html",
    "modules/worklog/index.html",
    "modules/worklog/chat/index.html",
    "product/index.html",
    "privacy/index.html",
    "terms/index.html",
    "scopes/index.html",
    "google-data/index.html",
    "support/index.html",
    "contact/index.html"
  ];
  for (const file of surfaces) {
    const source = read(file);
    assert.match(source, /responsive-modernization\.css\?v=20260926-0043/, `${file} must load successor CSS`);
    assert.match(source, /viewport-fit=cover/, `${file} must preserve safe-area viewport metadata`);
    assert.doesNotMatch(source, /user-scalable\s*=\s*no|max(?:imum)?-scale\s*=\s*1/i, `${file} must not disable zoom`);
  }
});

test("responsive source preview covers shared board, drawer, states and long content", () => {
  const fixture = read("tests/task-088-responsive-preview.html");
  for (const marker of [
    "responsive-board", "responsive-table", "shared-task-drawer-panel",
    "zhuge-state", "insufficient-evidence", "zhuge-floating-hub",
    "viewport-fit"
  ]) assert.match(fixture, new RegExp(marker), `${marker} preview marker missing`);
});
