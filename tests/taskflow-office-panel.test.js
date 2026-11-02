const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const root = path.resolve(__dirname, "..");

test("office overlay installs fail-closed without changing frozen source", () => {
  const run = spawnSync("python3", ["labs/taskflow/tests/test_taskflow_office_panel_overlay.py"], { cwd: root, encoding: "utf8" });
  assert.equal(run.status, 0, run.stdout + run.stderr);
});

test("web build installs and tests the office component in the copied tree", () => {
  const docker = fs.readFileSync(path.join(root, "labs/taskflow/Dockerfile.web"), "utf8");
  assert.match(docker, /COPY third_party\/multica\/ \/src\//);
  assert.match(docker, /apply-taskflow-office-panel\.py --root \/src --overlays \/taskflow-office/);
  assert.match(docker, /vitest run common\/taskflow-office-panel\.test\.tsx/);
});
