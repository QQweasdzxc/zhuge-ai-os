const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Board = require("../shared/board/board-read-service.js");
const Adapters = require("../shared/components/task-action-adapters.js");
const { createWorkspaceWorkflowGateway } = require("./fixtures/module-c-workspace-workflow-gateway.js");

function fixture(options = {}) {
  const harness = createWorkspaceWorkflowGateway(options);
  return { ...harness, service: Board.createInstanceService({ gateway: harness.gateway, boardInstanceId: harness.boardId, readOnly: options.readOnly, workflowReadOnly: options.workflowReadOnly }) };
}
const writes = state => state.calls.filter(call => !call.name.endsWith("_get"));
const bindingCounts = state => {
  const counts = new Map();
  state.published.steps.forEach(step => counts.set(step.workspace_id, (counts.get(step.workspace_id) || 0) + 1));
  return counts;
};

test("configured Workspace creation auto-binds every active Workspace through save → validate → publish → read-back without adding Edges", async () => {
  const { service, state } = fixture();
  const cardsBefore = structuredClone(state.cards);
  const sourceBefore = structuredClone(state.initial);
  const workspace = await service.createWorkspace("New Workspace");
  assert.deepEqual(writes(state).map(call => call.name), ["board_instance_create_workspace", "board_c_workflow_save_draft", "board_c_workflow_validate_draft", "board_c_workflow_publish"]);
  const save = state.calls.find(call => call.name.endsWith("save_draft")).args;
  assert.deepEqual(save.p_transitions, [{ transition_key: "to_done", from_step_key: "todo", to_step_key: "completed", allowed_roles: ["pm", "qjc"], requires_gate: true }]);
  assert.deepEqual(save.p_gates, [{ step_key: "completed", gate_key: "completion", name: "Completion gate", required: true, human_action_required: true, completion_role: "pm", failure_policy: "stay", sort_order: 9 }]);
  assert.deepEqual(save.p_evidence_requirements, [{ gate_key: "completion", evidence_key: "runtime", label: "Runtime acceptance", required: true, source_kind: "pm_action_context", sort_order: 7 }]);
  assert.equal(save.p_steps.length, state.workspaces.length);
  const added = save.p_steps.filter(step => !state.initial.steps.some(existing => existing.workspace_id === step.workspace_id));
  assert.equal(added.length, 4);
  assert.ok(added.every(step => step.role_key === "co" && step.status_key === "ready"));
  assert.ok(added.every(step => !save.p_transitions.some(edge => edge.from_step_key === step.step_key || edge.to_step_key === step.step_key)));
  assert.ok(state.workspaces.every(row => bindingCounts(state).get(row.id) === 1));
  assert.equal(state.cards.length, cardsBefore.length);
  assert.deepEqual(state.initial, sourceBefore);
  assert.equal(workspace.workflowBinding.state, "published");
  assert.equal(state.calls.find(call => call.name.endsWith("publish")).args.p_expected_published_version_id, "published-1");
  const card = await service.createTask({ title: "Created after binding", workspaceId: workspace.id });
  assert.equal(card.workflowVersionId, "draft-fixture");
});

for (const scope of ["worktodo", "procurement", "c"]) {
  test(`${scope} optional Workflow keeps the original Workspace and TASK path`, async () => {
    const { service, state } = fixture({ scope, optional: true });
    const workspace = await service.createWorkspace("Optional Workspace");
    const card = await service.createTask({ title: "Optional task", workspaceId: workspace.id });
    assert.deepEqual(writes(state).map(call => call.name), ["board_instance_create_workspace", "board_instance_create_task"]);
    assert.equal(card.workflowVersionId, "");
    assert.equal(workspace.workflowBinding, undefined);
  });
  test(`${scope} configured Workflow auto-binds new Workspace without creating a new Edge`, async () => {
    const { service, state } = fixture({ scope });
    await service.createWorkspace("Configured Workspace");
    assert.equal(state.published.steps.length, state.workspaces.length);
    assert.equal(state.published.transitions.length, 1);
    assert.ok(state.workspaces.every(row => bindingCounts(state).get(row.id) === 1));
  });
}

test("legacy missing bindings, including TASK-081, repair through the shared publish authority before TASK creation", async () => {
  const { service, state } = fixture();
  const card = await service.createTask({ title: "TASK-081 remains standalone", workspaceId: "ws-custom-2" });
  assert.deepEqual(writes(state).map(call => call.name), ["board_c_workflow_save_draft", "board_c_workflow_validate_draft", "board_c_workflow_publish", "board_instance_create_task"]);
  assert.equal(state.published.steps.length, state.workspaces.length);
  assert.ok(state.workspaces.every(row => bindingCounts(state).get(row.id) === 1));
  assert.equal(state.published.transitions.length, 1);
  assert.ok(state.published.transitions.every(edge => edge.from_step_id !== "ws-custom-2" && edge.to_step_id !== "ws-custom-2"));
  assert.equal(card.currentWorkflowStepId, state.published.steps.find(step => step.workspace_id === "ws-custom-2").id);
  assert.equal(state.cards.length, 2);
});

test("same-board existing Workspace repair is shared and retry becomes read-only", async () => {
  const { service, state } = fixture();
  const before = structuredClone(state.workspaces);
  const result = await service.bindWorkspaceToWorkflow({ workspaceId: "ws-custom-0" });
  assert.equal(result.workflowBinding.state, "published");
  assert.deepEqual(state.workspaces, before);
  const count = writes(state).length;
  await service.bindWorkspaceToWorkflow({ workspaceId: "ws-custom-0" });
  assert.equal(writes(state).length, count);
});

test("foreign and inactive Workspaces fail without writes", async () => {
  const { service, state } = fixture();
  await assert.rejects(() => service.bindWorkspaceToWorkflow({ workspaceId: "foreign-workspace" }));
  assert.equal(writes(state).length, 0);
  state.workspaces.find(row => row.id === "ws-custom-0").active = false;
  await assert.rejects(() => service.bindWorkspaceToWorkflow({ workspaceId: "ws-custom-0" }));
  assert.equal(writes(state).length, 0);
});

test("read-only consumers cannot create or reconcile Workspace bindings", async () => {
  for (const options of [{ readOnly: true }, { workflowReadOnly: true }]) {
    const { service, state } = fixture(options);
    await assert.rejects(() => service.createWorkspace("Blocked"));
    assert.equal(writes(state).length, 0);
  }
});

test("Workspace and Published version changes during reconciliation stop before publish", async () => {
  for (const options of [{ changeOnGet: 2 }, { draftOnGet: 2 }]) {
    const { service, state } = fixture(options);
    await assert.rejects(() => service.createWorkspace("Partial"), error => error.code === "C_WORKFLOW_CHANGED" && error.workspace.id === "ws-created-1");
    assert.deepEqual(writes(state).map(call => call.name), ["board_instance_create_workspace"]);
  }
});

test("failed reconciliation retries the existing Workspace and never creates a duplicate", async () => {
  const { service, state } = fixture({ failAt: "board_c_workflow_save_draft" });
  await assert.rejects(() => service.createWorkspace("Recoverable"), error => error.workspace.id === "ws-created-1" && error.bindingStage === "save_draft");
  state.failAt = "";
  const result = await service.bindWorkspaceToWorkflow({ workspaceId: "ws-created-1" });
  assert.equal(result.workflowBinding.state, "published");
  assert.equal(state.createdCount, 1);
  assert.equal(bindingCounts(state).get("ws-created-1"), 1);
});

test("uncertain Workspace creation recovers by canonical key and does not insert twice", async () => {
  const { service, state } = fixture({ createResponseLost: true });
  await assert.rejects(() => service.createWorkspace("Uncertain creation"), error => error.workspaceCreationUncertain === true);
  const recovered = await service.createWorkspace("Uncertain creation");
  assert.equal(state.createdCount, 1);
  assert.equal(recovered.id, "ws-created-1");
  assert.equal(recovered.workflowBinding.state, "published");
  const blocked = fixture({ failAt: "board_instance_create_workspace" });
  await assert.rejects(() => blocked.service.createWorkspace("Unknown"));
  await assert.rejects(() => blocked.service.createWorkspace("Unknown"), error => error.workspaceCreationUncertain === true);
  assert.equal(blocked.state.calls.filter(call => call.name === "board_instance_create_workspace").length, 1);
});

test("validation, publish, and read-back failures never report binding acceptance", async () => {
  for (const options of [{ invalidDraft: true }, { failAt: "board_c_workflow_validate_draft" }, { publishConflict: true }, { badReadBack: true }]) {
    const { service, state } = fixture(options);
    await assert.rejects(() => service.createWorkspace("Pending"), error => Boolean(error.workspace && error.workflowVersionId === "draft-fixture"));
    assert.equal(state.published.id, options.badReadBack ? "draft-fixture" : "published-1");
    if (!options.badReadBack && !options.publishConflict) assert.equal(state.calls.some(call => call.name.endsWith("publish")), false);
    assert.equal(state.createdCount, 1);
  }
});

test("draft edits or Published version changes during validation stop before publish", async () => {
  for (const options of [{ editDraftOnGet: 3 }, { changeOnGet: 3 }, { draftOnGet: 3 }]) {
    const { service, state } = fixture(options);
    await assert.rejects(() => service.createWorkspace("Concurrent change"), error => error.code === "C_WORKFLOW_CHANGED" && error.bindingStage === "publish");
    assert.equal(state.calls.some(call => call.name.endsWith("publish")), false);
  }
});

test("same-session duplicate Workspace submissions are rejected", async () => {
  const { service, state } = fixture();
  const first = service.createWorkspace("Only once");
  await assert.rejects(() => service.createWorkspace("Duplicate"), /同步正在進行/);
  await first;
  assert.equal(state.createdCount, 1);
});

test("shared adapters use automatic binding and Published mode cannot be bypassed", async () => {
  const { service, state } = fixture();
  const adapter = Adapters.create({ applicationScope: "ai_board", service });
  await adapter.actions.createWorkspace({ name: "Adapter Workspace" });
  assert.equal(state.published.steps.length, state.workspaces.length);
  const task = await service.createTask({ title: "No unbound bypass", workspaceId: "ws-custom-2", workflowMode: "unbound" });
  assert.ok(task.workflowVersionId);
  assert.equal(state.calls.filter(call => call.name === "board_instance_create_task").at(-1).args.p_workflow_mode, "published");
  const migration = fs.readFileSync(path.join(__dirname, "../supabase/migrations/20261003021318_task37_module_c_workflow_canvas_simplification.sql"), "utf8");
  assert.match(migration, /drop index if exists public\.board_workflow_one_initial_step_idx/i);
  assert.match(migration, /board_c_workflow_save_draft/);
  assert.match(migration, /'transitions', '\[\]'::jsonb/);
  const guard = fs.readFileSync(path.join(__dirname, "../docs/supabase/20260914_c_shared_create_workflow_resolution.sql"), "utf8");
  assert.match(guard, /Module C workspace does not have exactly one Workflow Step binding/);
});
