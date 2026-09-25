import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const root = path.resolve(".");
const runtimeSource = fs.readFileSync(path.join(root, "shared/components/golden-master-runtime.js"), "utf8");
const serviceSource = fs.readFileSync(path.join(root, "shared/board/board-read-service.js"), "utf8");

function loadStudio() {
  const document = { readyState: "loading", addEventListener() {} };
  const window = { document, ZhugeBoardReadService: {} };
  window.window = window;
  const context = { window, document, console, Map, Set, JSON, Object, String, Number, Math, Array };
  vm.runInNewContext(runtimeSource, context, { filename: "golden-master-runtime.js" });
  return window.ZhugeWorkflowStudio;
}

test("Workflow Studio exposes canonical visual editing helpers without a second authority", () => {
  const studio = loadStudio();
  assert.equal(typeof studio.clone, "function");
  assert.equal(typeof studio.diff, "function");
  assert.equal(typeof studio.layout, "function");
  const before = {
    name: "工作流程",
    steps: [
      { stepKey: "todo", name: "待辦", workspaceId: "w1" },
      { stepKey: "done", name: "完成", workspaceId: "w2" }
    ],
    transitions: [{ fromStepKey: "todo", toStepKey: "done" }]
  };
  const after = {
    ...before,
    steps: [...before.steps, { stepKey: "review", name: "複核", workspaceId: "w3" }],
    transitions: [
      { fromStepKey: "todo", toStepKey: "review" },
      { fromStepKey: "review", toStepKey: "done" }
    ]
  };
  const diff = studio.diff(before, after);
  assert.deepEqual(JSON.parse(JSON.stringify(diff.addedSteps)), ["review"]);
  assert.deepEqual(JSON.parse(JSON.stringify(diff.removedSteps)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(diff.addedTransitions)), ["todo→review", "review→done"]);
  assert.deepEqual(JSON.parse(JSON.stringify(diff.removedTransitions)), ["todo→done"]);
  assert.equal(diff.changed, true);
  const layout = studio.layout(after);
  assert.equal(layout.positions.size, 3);
  assert.ok(layout.width >= 720);
  assert.ok(layout.height >= 230);
});

test("Workflow Studio UI contains visual canvas, validation, diff, history and bounded connection controls", () => {
  assert.match(runtimeSource, /data-workflow-studio-canvas/);
  assert.match(runtimeSource, /data-workflow-studio-node/);
  assert.match(runtimeSource, /data-workflow-connect/);
  assert.match(runtimeSource, /data-workflow-studio-diff/);
  assert.match(runtimeSource, /data-workflow-validate/);
  assert.match(runtimeSource, /data-workflow-undo/);
  assert.match(runtimeSource, /data-workflow-redo/);
  assert.match(runtimeSource, /data-workflow-load-version/);
  assert.match(serviceSource, /board_c_workflow_save_draft/);
  assert.match(serviceSource, /board_c_workflow_publish/);
  assert.doesNotMatch(runtimeSource, /insert into|update public\./i);
});

test("Workflow capability reads version history through the existing board-scoped gateway", () => {
  assert.match(serviceSource, /const listVersions = async \(\) =>/);
  assert.match(serviceSource, /board_workflow_definitions/);
  assert.match(serviceSource, /board_workflow_steps/);
  assert.match(serviceSource, /board_workflow_transitions/);
  assert.match(serviceSource, /return \{ boardInstanceId: instanceId, versions \};/);
  assert.match(serviceSource, /listVersions,/);
});
