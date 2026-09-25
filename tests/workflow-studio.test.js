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
  assert.equal(typeof studio.runtimeTaskMatches, "function");
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

test("Workflow Studio does not treat an empty workspace id as a runtime scope", () => {
  const studio = loadStudio();
  const unbound = { workspaceId: "", currentWorkflowStepId: "" };
  const workspaceStep = { id: "step-1", workspaceId: "workspace-1" };
  assert.equal(studio.runtimeTaskMatches(unbound, workspaceStep), false);
  assert.equal(studio.runtimeTaskMatches({ workspaceId: "workspace-1" }, workspaceStep), true);
  assert.equal(studio.runtimeTaskMatches({ currentWorkflowStepId: "step-1" }, workspaceStep), true);
});

test("Workflow Studio accepts an Optional Workflow with zero connections", () => {
  const studio = loadStudio();
  const validation = studio.validate({
    name: "可選流程",
    steps: [
      { stepKey: "inspiration", name: "小靈感", workspaceId: "w1", isInitial: true, isCompletion: false },
      { stepKey: "suspended", name: "暫緩", workspaceId: "w2", isInitial: false, isCompletion: true }
    ],
    transitions: []
  });
  assert.deepEqual(JSON.parse(JSON.stringify(validation.errors)), []);
  assert.equal(validation.warnings.length, 1);
  assert.match(validation.warnings[0], /沒有流程連線/);
});

test("Workflow Studio diff reports definition metadata changes", () => {
  const studio = loadStudio();
  const before = {
    name: "一般流程",
    description: "原本的說明",
    steps: [
      { stepKey: "todo", name: "待辦", workspaceId: "w1" },
      { stepKey: "done", name: "完成", workspaceId: "w2" }
    ],
    transitions: []
  };
  const after = { ...before, name: "可選流程", description: "更新後的說明" };
  const diff = studio.diff(before, after);
  assert.deepEqual(JSON.parse(JSON.stringify(diff.changedDefinition)), ["流程名稱", "流程說明"]);
  assert.equal(diff.changed, true);
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

test("Workflow Studio exposes a read-only runtime overlay without becoming workflow authority", () => {
  assert.match(runtimeSource, /workflowStudioRuntimeOverlay/);
  assert.match(runtimeSource, /activeClaim \|\| task\?\.active_claim \|\| task\?\.claim/);
  assert.match(runtimeSource, /data-workflow-runtime-overlay/);
  assert.match(runtimeSource, /等待 \$\{runtime\.waiting\} · 阻塞 \$\{runtime\.blocked\}/);
  assert.match(runtimeSource, /不需確認/);
  assert.match(runtimeSource, /Never infer/);
  assert.match(fs.readFileSync(path.join(root, "shared/theme/golden-master.css"), "utf8"), /\.workflow-studio-node-runtime/);
});

test("Workflow Studio preserves an explicit zero-connection Optional Workflow", () => {
  assert.match(runtimeSource, /const hasTransitionContract = Array\.isArray\(source\?\.transitions\)/);
  assert.match(runtimeSource, /transitions: hasTransitionContract \? existingTransitions : workflowDefaultTransitions\(steps\)/);
  assert.doesNotMatch(runtimeSource, /editor\.transitions = workflowDefaultTransitions\(editor\.steps\)/);
  assert.match(runtimeSource, /Optional Workflow permits a valid definition/);
  assert.match(runtimeSource, /目前沒有流程連線；這張流程允許獨立工作區/);
});

test("Workflow capability reads version history through the existing board-scoped gateway", () => {
  assert.match(serviceSource, /const listVersions = async \(\) =>/);
  assert.match(serviceSource, /board_workflow_definitions/);
  assert.match(serviceSource, /board_workflow_steps/);
  assert.match(serviceSource, /board_workflow_transitions/);
  assert.match(serviceSource, /return \{ boardInstanceId: instanceId, versions \};/);
  assert.match(serviceSource, /listVersions,/);
});
