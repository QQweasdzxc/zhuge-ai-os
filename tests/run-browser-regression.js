const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const browserTests = [
  "tests/ai-board-batch-2-browser.test.js",
  "tests/ai-board-completion-gate-browser.test.js",
  "tests/c-template-publish-browser.test.js",
  "tests/creator-mfa-control-browser.test.js",
  "tests/investment/ivtk-parity-browser.test.js",
  "tests/shared-navigation-collapsed.test.js",
  "tests/task-088-core-components.test.js",
  "tests/task-088-part1-shared-foundation.test.js",
  "tests/task-088-shared-foundation.test.js",
  "tests/task-088-shared-shell.test.js",
  "tests/worktodo-shared-drawer-browser.test.js",
  "tests/skyeye-mobile-browser.test.js"
];
const standaloneScripts = [
  "tests/task-088-responsive-browser.js",
  "tests/task-088-desktop-preview.js",
  "tests/investment/screenshot-import-browser-regression.js",
  "tests/investment/sprint-3-browser-regression.js"
];

function fail(message) {
  console.error(`BROWSER_REGRESSION_FAIL: ${message}`);
  process.exitCode = 1;
}

function run(args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit"
  });
  if (result.error) {
    fail(`${label}: ${result.error.message}`);
    return false;
  }
  if (result.status !== 0) {
    fail(`${label}: exit=${result.status}`);
    return false;
  }
  return true;
}

const executable = process.env.BROWSER_EXECUTABLE || process.env.CHROME_PATH || process.env.CHROMIUM_PATH;
if (!executable || !fs.existsSync(executable)) {
  fail("BROWSER_EXECUTABLE/CHROME_PATH/CHROMIUM_PATH must point to the installed CI Chromium binary");
} else {
  const browserPassed = run(["--test", ...browserTests], "browser test suite");
  const scriptPassed = standaloneScripts.every(file => run([file], file));
  if (browserPassed && scriptPassed) {
    console.log(JSON.stringify({
      status: "PASS",
      browserExecutable: path.basename(executable),
      browserTests,
      standaloneScripts,
      skipped: 0
    }, null, 2));
  }
}
