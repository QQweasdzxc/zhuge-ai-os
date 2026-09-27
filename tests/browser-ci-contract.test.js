const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const workflow = fs.readFileSync(path.join(root, ".github/workflows/browser-regression.yml"), "utf8");
const runner = fs.readFileSync(path.join(root, "tests/run-browser-regression.js"), "utf8");

test("Browser CI installs a real Chromium and runs the required Desktop/Mobile surfaces", () => {
  assert.match(workflow, /playwright install --with-deps chromium/);
  assert.match(workflow, /BROWSER_EXECUTABLE=/);
  assert.doesNotMatch(workflow, /continue-on-error:\s*true/);
  assert.match(runner, /tests\/shared-navigation-collapsed\.test\.js/);
  assert.match(runner, /tests\/task-088-shared-shell\.test\.js/);
  assert.match(runner, /tests\/worktodo-shared-drawer-browser\.test\.js/);
  assert.match(runner, /tests\/investment\/ivtk-parity-browser\.test\.js/);
  assert.match(runner, /tests\/skyeye-mobile-browser\.test\.js/);
  assert.match(runner, /skipped:\s*0/);
});
