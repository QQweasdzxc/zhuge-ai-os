const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Board = require("../shared/board/board-read-service.js");
const Adapters = require("../shared/components/task-action-adapters.js");
const { createWorkspaceWorkflowGateway } = require("./fixtures/module-c-workspace-workflow-gateway.js");
const binding = { roleKey: "pm", statusKey: "ready", confirmed: true };
function fixture(options = {}) {
  const harness = createWorkspaceWorkflowGateway(options);
  return { ...harness, service: Board.createInstanceService({ gateway: harness.gateway, boardInstanceId: harness.boardId, readOnly: options.readOnly, workflowReadOnly: options.workflowReadOnly }) };
}
const writes = state => state.calls.filter(call => !call.name.endsWith("_get"));

test("configured C workspace creation preserves the full contract and uses save → validate → publish → read-back", async () => {
  const { service, state } = fixture();
  const cardsBefore = structuredClone(state.cards);
  const sourceBefore = structuredClone(state.initial);
  const workspace = await service.createWorkspace("New Workspace", { workflowBinding: binding });
  assert.deepEqual(writes(state).map(call => call.name), ["board_instance_create_workspace", "board_c_workflow_save_draft", "board_c_workflow_validate_draft", "board_c_workflow_publish"]);
  const save = state.calls.find(call => call.name.endsWith("save_draft")).args;
  assert.deepEqual(save.p_steps.slice(0, 5), state.initial.steps.map(({ id, ...step }) => step));
  assert.deepEqual(save.p_transitions, [{ transition_key: "to_done", from_step_key: "todo", to_step_key: "completed", allowed_roles: ["pm", "qjc"], requires_gate: true }]);
  assert.deepEqual(save.p_gates, [{ step_key: "completed", gate_key: "completion", name: "Completion gate", required: true, human_action_required: true, completion_role: "pm", failure_policy: "stay", sort_order: 9 }]);
  assert.deepEqual(save.p_evidence_requirements, [{ gate_key: "completion", evidence_key: "runtime", label: "Runtime acceptance", required: true, source_kind: "pm_action_context", sort_order: 7 }]);
  const added = save.p_steps.at(-1);
  assert.equal(added.workspace_id, workspace.id);
  assert.equal(added.role_key, "pm");
  assert.equal(added.status_key, "ready");
  assert.equal(added.is_initial, false);
  assert.equal(added.is_completion, false);
  assert.equal(added.sort_order, 41);
  assert.equal(workspace.workflowBinding.state, "published");
  assert.equal(state.published.steps.filter(step => step.workspace_id === workspace.id).length, 1);
  assert.deepEqual(state.initial, sourceBefore);
  assert.deepEqual(state.cards, cardsBefore);
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
  test(`${scope} configured Workflow uses the same integration capability`, async () => {
    const { service, state } = fixture({ scope });
    await service.createWorkspace("Configured Workspace", { workflowBinding: binding });
    assert.equal(state.published.steps.length, 6);
    assert.equal(state.cards.length, 1);
  });
}

for (const workspaceId of ["ws-custom-0", "ws-custom-1"]) {
  test(`authorized AI Board existing workspace ${workspaceId} binds without recreation and retry is read-only`, async () => {
    const { service, state } = fixture();
    const before = structuredClone(state.workspaces);
    const result = await service.bindWorkspaceToWorkflow({ workspaceId, ...binding });
    assert.equal(result.workflowBinding.state, "published");
    assert.deepEqual(state.workspaces, before);
    const count = writes(state).length;
    await service.bindWorkspaceToWorkflow({ workspaceId, ...binding });
    assert.equal(writes(state).length, count);
    assert.equal(state.published.steps.filter(step => step.workspace_id === "ws-custom-2").length, 0);
  });
}

test("TASK-081, other existing workspaces and cross-board/inactive IDs fail without writes", async () => {
  for (const workspaceId of ["ws-custom-2", "ws-todo", "foreign-workspace"]) {
    const { service, state } = fixture();
    await assert.rejects(() => service.bindWorkspaceToWorkflow({ workspaceId, ...binding }));
    assert.equal(writes(state).length, 0);
  }
  const { service, state } = fixture();
  state.workspaces[5].active = false;
  await assert.rejects(() => service.bindWorkspaceToWorkflow({ workspaceId: "ws-custom-0", ...binding }));
  assert.equal(writes(state).length, 0);
});

test("explicit confirmation, role/status, read-only, existing draft and missing Workflow fail before Workspace creation", async () => {
  for (const [options, input] of [
    [{}, { ...binding, confirmed: false }], [{}, { ...binding, roleKey: "" }], [{}, { ...binding, statusKey: "done" }],
    [{ readOnly: true }, binding], [{ workflowReadOnly: true }, binding], [{ draft: true }, binding], [{ optional: true }, binding]
  ]) {
    const { service, state } = fixture(options);
    await assert.rejects(() => service.createWorkspace("Blocked", { workflowBinding: input }));
    assert.equal(writes(state).length, 0);
  }
});

test("configured Workflow cannot be bypassed by a caller omitting binding options", async () => {
  const { service, state } = fixture();
  await assert.rejects(() => service.createWorkspace("Missing binding options"), /明確選擇角色/);
  assert.equal(writes(state).length, 0);
});

test("Workflow change detected after Workspace creation reports partial progress without saving", async () => {
  for (const options of [{ changeOnGet: 2 }, { draftOnGet: 2 }]) {
    const { service, state } = fixture(options);
    await assert.rejects(() => service.createWorkspace("Partial", { workflowBinding: binding }), error => error.code === "C_WORKFLOW_CHANGED" && error.workspace.id === "ws-created-1");
    assert.deepEqual(writes(state).map(call => call.name), ["board_instance_create_workspace"]);
  }
});

test("failed save can retry the existing Workspace without a second create", async () => {
  const { service, state } = fixture({ failAt: "board_c_workflow_save_draft" });
  await assert.rejects(() => service.createWorkspace("Recoverable", { workflowBinding: binding }), error => error.workspace.id === "ws-created-1" && error.bindingStage === "save_draft");
  state.failAt = "";
  await service.bindWorkspaceToWorkflow({ workspaceId: "ws-created-1", ...binding });
  assert.equal(state.createdCount, 1);
  assert.equal(state.published.steps.filter(step => step.workspace_id === "ws-created-1").length, 1);
});

test("uncertain Workspace creation recovers by canonical key read-back, never a second INSERT", async () => {
  const { service, state } = fixture({ createResponseLost: true });
  await assert.rejects(() => service.createWorkspace("Uncertain creation", { workflowBinding: binding }), error => error.workspaceCreationUncertain === true);
  const recovered = await service.createWorkspace("Uncertain creation", { workflowBinding: binding });
  assert.equal(state.createdCount, 1);
  assert.equal(recovered.id, "ws-created-1");
  assert.equal(recovered.workflowBinding.state, "published");
  const blocked = fixture({ failAt: "board_instance_create_workspace" });
  await assert.rejects(() => blocked.service.createWorkspace("Unknown", { workflowBinding: binding }));
  await assert.rejects(() => blocked.service.createWorkspace("Unknown", { workflowBinding: binding }), error => error.workspaceCreationUncertain === true);
  assert.equal(blocked.state.calls.filter(call => call.name === "board_instance_create_workspace").length, 1);
});

test("validation and publish failures retain the draft and never claim acceptance", async () => {
  for (const options of [{ invalidDraft: true }, { failAt: "board_c_workflow_validate_draft" }, { publishConflict: true }]) {
    const { service, state } = fixture(options);
    await assert.rejects(() => service.createWorkspace("Pending", { workflowBinding: binding }), error => Boolean(error.workspace && error.workflowVersionId === "draft-fixture"));
    assert.equal(state.published.id, "published-1");
    assert.equal(state.draft.id, "draft-fixture");
    if (!options.publishConflict) assert.equal(state.calls.some(call => call.name.endsWith("publish")), false);
    const writeCount = writes(state).length;
    await assert.rejects(() => service.bindWorkspaceToWorkflow({ workspaceId: "ws-created-1", ...binding }), error => error.code === "C_WORKFLOW_DRAFT_EXISTS");
    assert.equal(writes(state).length, writeCount);
    assert.equal(state.createdCount, 1);
  }
});

test("draft edits and Published version changes during validation stop before publish", async () => {
  for (const options of [{ editDraftOnGet: 3 }, { changeOnGet: 3 }, { draftOnGet: 3 }]) {
    const { service, state } = fixture(options);
    await assert.rejects(() => service.createWorkspace("Concurrent change", { workflowBinding: binding }), error => error.code === "C_WORKFLOW_CHANGED" && error.bindingStage === "publish");
    assert.equal(state.calls.some(call => call.name.endsWith("publish")), false);
  }
});

test("bad published read-back is an uncertain result, not PASS", async () => {
  const { service } = fixture({ badReadBack: true });
  await assert.rejects(() => service.createWorkspace("Uncertain", { workflowBinding: binding }), error => error.bindingStage === "read_back" && Boolean(error.workspace));
});

test("same-session duplicate submissions are rejected", async () => {
  const { service, state } = fixture();
  const first = service.createWorkspace("Only once", { workflowBinding: binding });
  await assert.rejects(() => service.createWorkspace("Duplicate", { workflowBinding: binding }), /正在進行/);
  await first;
  assert.equal(state.createdCount, 1);
});

test("shared adapters forward explicit binding without altering the existing TASK guard", async () => {
  const { service, state } = fixture();
  const adapter = Adapters.create({ applicationScope: "ai_board", service });
  await adapter.actions.createWorkspace({ name: "Adapter Workspace", workflowBinding: binding });
  assert.equal(state.published.steps.length, 6);
  await assert.rejects(() => service.createTask({ title: "Excluded Workspace", workspaceId: "ws-custom-2" }), /exactly one Workflow Step binding/);
  const sql = fs.readFileSync(path.join(__dirname, "../docs/supabase/20260914_c_shared_create_workflow_resolution.sql"), "utf8");
  assert.match(sql, /Module C workspace does not have exactly one Workflow Step binding/);
});
