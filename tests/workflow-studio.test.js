import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const root = path.resolve(".");
const runtimeSource = fs.readFileSync(path.join(root, "shared/components/golden-master-runtime.js"), "utf8");
const serviceSource = fs.readFileSync(path.join(root, "shared/board/board-read-service.js"), "utf8");
const migration = fs.readFileSync(path.join(root, "supabase/migrations/20261003021318_task37_module_c_workflow_canvas_simplification.sql"), "utf8");

function loadStudio() {
  const document = { readyState: "loading", addEventListener() {} };
  const window = { document, ZhugeBoardReadService: {} };
  window.window = window;
  const context = { window, document, console, Map, Set, JSON, Object, String, Number, Math, Array };
  vm.runInNewContext(runtimeSource, context, { filename: "golden-master-runtime.js" });
  return window.ZhugeWorkflowStudio;
}

test("Workflow Studio uses the canonical Workflow service and exposes pure canvas helpers", () => {
  const studio = loadStudio();
  assert.equal(typeof studio.clone, "function");
  assert.equal(typeof studio.diff, "function");
  assert.equal(typeof studio.layout, "function");
  assert.equal(typeof studio.validate, "function");
  assert.equal(typeof studio.topology, "function");
  assert.equal(typeof studio.payload, "function");
  assert.match(serviceSource, /board_c_workflow_save_draft/);
  assert.match(serviceSource, /board_c_workflow_validate_draft/);
  assert.match(serviceSource, /board_c_workflow_publish/);
  assert.doesNotMatch(runtimeSource, /insert into|update public\./i);
});

test("Workflow Studio topology drives start/end flags and an empty graph is legal", () => {
  const studio = loadStudio();
  const editor = {
    name: "獨立 Workspace",
    steps: [
      { stepKey: "one", name: "第一個", workspaceId: "w1", roleKey: "co", statusKey: "ready" },
      { stepKey: "two", name: "第二個", workspaceId: "w2", roleKey: "co", statusKey: "ready" }
    ],
    transitions: []
  };
  const validation = studio.validate(editor);
  assert.deepEqual(JSON.parse(JSON.stringify(validation.errors)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(validation.warnings)), []);
  const payload = studio.payload(editor);
  assert.equal(payload.transitions.length, 0);
  assert.ok(payload.steps.every(step => step.isInitial && step.isCompletion));
  assert.deepEqual(Array.from(studio.topology(editor).incoming), []);
  assert.deepEqual(Array.from(studio.topology(editor).outgoing), []);
});

test("Workflow Studio derives topology for a connected graph and gives new edges no role or Gate barrier", () => {
  const studio = loadStudio();
  const editor = {
    name: "Connected",
    steps: [
      { stepKey: "todo", name: "待辦", workspaceId: "w1", roleKey: "co", statusKey: "ready" },
      { stepKey: "review", name: "驗收", workspaceId: "w2", roleKey: "qjc", statusKey: "qa" },
      { stepKey: "done", name: "完成", workspaceId: "w3", roleKey: "pm", statusKey: "done" }
    ],
    transitions: [
      { fromStepKey: "todo", toStepKey: "review" },
      { fromStepKey: "review", toStepKey: "done" }
    ]
  };
  const payload = studio.payload(editor);
  assert.deepEqual(payload.steps.map(step => [step.isInitial, step.isCompletion]), [[true, false], [false, false], [false, true]]);
  assert.ok(payload.transitions.every(edge => edge.allowedRoles.includes("co") && edge.allowedRoles.includes("gpt") && edge.allowedRoles.includes("qjc") && edge.allowedRoles.includes("pm") && edge.requiresGate === false));
});

test("Workflow Studio diff still reports graph and definition edits", () => {
  const studio = loadStudio();
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
    name: "獨立流程",
    steps: [...before.steps, { stepKey: "review", name: "複核", workspaceId: "w3" }],
    transitions: [{ fromStepKey: "todo", toStepKey: "review" }]
  };
  const diff = studio.diff(before, after);
  assert.deepEqual(JSON.parse(JSON.stringify(diff.addedSteps)), ["review"]);
  assert.deepEqual(JSON.parse(JSON.stringify(diff.addedTransitions)), ["todo→review"]);
  assert.deepEqual(JSON.parse(JSON.stringify(diff.removedTransitions)), ["todo→done"]);
  assert.equal(diff.changed, true);
});

test("Workflow Studio does not treat an empty Workspace id as a task scope", () => {
  const studio = loadStudio();
  const unbound = { workspaceId: "", currentWorkflowStepId: "" };
  const workspaceStep = { id: "step-1", workspaceId: "workspace-1" };
  assert.equal(studio.runtimeTaskMatches(unbound, workspaceStep), false);
  assert.equal(studio.runtimeTaskMatches({ workspaceId: "workspace-1" }, workspaceStep), true);
  assert.equal(studio.runtimeTaskMatches({ currentWorkflowStepId: "step-1" }, workspaceStep), true);
});

test("Workflow canvas has side plus handles, a dashed connection preview, and Edge-only deletion", () => {
  assert.match(runtimeSource, /data-workflow-studio-canvas/);
  assert.match(runtimeSource, /data-workflow-studio-node/);
  assert.match(runtimeSource, /data-workflow-connector="left"/);
  assert.match(runtimeSource, /data-workflow-connector="right"/);
  assert.match(runtimeSource, /data-workflow-edge-preview/);
  assert.match(runtimeSource, /data-workflow-remove-transition/);
  assert.match(runtimeSource, /pointerdown/);
  assert.match(runtimeSource, /setPointerCapture/);
  assert.match(runtimeSource, /event\.pointerType === "touch"/);
  assert.ok(runtimeSource.includes("next.transitions = next.transitions.filter"));
  assert.doesNotMatch(runtimeSource, /data-workflow-connect-from|data-workflow-connect-to|data-workflow-save|data-workflow-validate|data-workflow-step-delete/);
  assert.doesNotMatch(runtimeSource, /data-workflow-studio-diff|data-workflow-studio-validation|流程摘要|變更預覽|發布前檢查|檢查流程|儲存草稿/);
});

test("Node inspector keeps required fields compact and advanced Gate/Claim details out of the main editor", () => {
  assert.match(runtimeSource, /data-workflow-inspector/);
  assert.match(runtimeSource, /data-workflow-field="name"/);
  assert.match(runtimeSource, /data-workflow-field="workspaceId"/);
  assert.match(runtimeSource, /data-workflow-field="statusKey"/);
  assert.doesNotMatch(runtimeSource, /Claim：|Gate：|data-workflow-field="gateRequired"|data-workflow-field="evidenceLabel"/);
  assert.match(fs.readFileSync(path.join(root, "shared/components/golden-master.js"), "utf8"), /Workspace 可獨立存在/);
});

test("Workflow publish runs save → validate → publish → read-back and keeps failures user-readable", () => {
  const start = runtimeSource.indexOf("async function saveWorkflowSettings()");
  const end = runtimeSource.indexOf("function bindWorkflowSettingsModal", start);
  const publish = runtimeSource.slice(start, end);
  assert.ok(publish.indexOf("workflow.saveDraft") < publish.indexOf("workflow.validateDraft"));
  assert.ok(publish.indexOf("workflow.validateDraft") < publish.indexOf("workflow.publish"));
  assert.ok(publish.indexOf("workflow.publish") < publish.lastIndexOf("workflow.get"));
  assert.match(publish, /workflowUserError\(error\)/);
  assert.doesNotMatch(publish, /error\.message\s*\|\|/);
});

test("Migration permits zero Edges, requires one Step per active Workspace, and preserves the exact-one task guard", () => {
  assert.match(migration, /drop index if exists public\.board_workflow_one_initial_step_idx/i);
  assert.match(migration, /drop index if exists public\.board_workflow_one_completion_step_idx/i);
  assert.match(migration, /每個啟用中的 Workspace 必須恰好對應一個階段/);
  assert.match(migration, /'transitions', '\[\]'::jsonb/);
  assert.match(migration, /board_c_workflow_save_draft/);
  assert.match(migration, /board_c_workflow_publish/);
  assert.match(migration, /board_provision_c_consumer_v2/);
  assert.match(migration, /and v_published/);
  assert.doesNotMatch(migration, /insert into public\.board_tasks|delete from public\.board_workspaces|update public\.board_workspaces/i);
});

test("new C consumers initialize generic active Workspace blueprints as standalone Steps", () => {
  const branchStart = migration.indexOf("if p_workflow_blueprint is null then");
  const branchEnd = migration.indexOf("\n    else\n      if jsonb_typeof(p_workflow_blueprint", branchStart);
  assert.ok(branchStart >= 0 && branchEnd > branchStart);
  const defaultWorkflow = migration.slice(branchStart, branchEnd);
  assert.match(defaultWorkflow, /'transitions', '\[\]'::jsonb/);
  assert.match(defaultWorkflow, /for v_workspace in select value from jsonb_array_elements\(v_workspace_blueprint\)/i);
  assert.match(defaultWorkflow, /'workspace_id', v_workspace_map->>v_workspace_key/i);
  assert.doesNotMatch(defaultWorkflow, /'workspace_id', v_workspace_map->>'todo'|'step_key', 'todo'/i);
});
