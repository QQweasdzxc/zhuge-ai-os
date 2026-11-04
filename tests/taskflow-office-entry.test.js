const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const root = path.resolve(__dirname, "..");

test("office entry installs fail-closed without changing frozen source", () => {
  const run = spawnSync("python3", ["labs/taskflow/tests/test_taskflow_office_entry.py"], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});

test("web build installs the native sidebar entry and no longer ships the overlay", () => {
  const docker = fs.readFileSync(path.join(root, "labs/taskflow/Dockerfile.web"), "utf8");
  assert.match(docker, /COPY third_party\/multica\/ \/src\//);
  assert.match(docker, /apply-taskflow-office-entry\.py --root \/src/);
  assert.doesNotMatch(docker, /taskflow-office-panel/);
  assert.match(docker, /vitest run layout\/app-sidebar\.test\.tsx/);
  assert.ok(!fs.existsSync(path.join(root, "labs/taskflow/overrides/taskflow-office-panel.tsx")), "overlay module removed");
});
