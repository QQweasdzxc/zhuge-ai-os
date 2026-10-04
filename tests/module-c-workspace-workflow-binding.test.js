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
  assert.deepEqual(writes(state).map(call => call.name), ["board_instance_create_workspace"]);
  assert.deepEqual(state.published.transitions, sourceBefore.transitions);
  assert.deepEqual(state.published.gates, sourceBefore.gates);
  assert.deepEqual(state.published.evidence_requirements, sourceBefore.evidence_requirements);
  assert.equal(state.published.steps.length, state.workspaces.length);
  const added=state.published.steps.filter(step=>!state.initial.steps.some(existing=>existing.workspace_id===step.workspace_id));
  assert.equal(added.length,4);
  assert.ok(added.every(step=>step.role_key==="co" && step.status_key==="ready"));
  assert.ok(added.every(step=>!state.published.transitions.some(edge=>edge.from_step_id===step.id||edge.to_step_id===step.id)));
  assert.ok(state.workspaces.every(row => bindingCounts(state).get(row.id) === 1));
  assert.equal(state.cards.length, cardsBefore.length);
  assert.deepEqual(state.initial, sourceBefore);
  assert.equal(workspace.workflowBinding.state, "published");
  assert.deepEqual(state.lifecycle, ["save", "validate", "publish", "readback"]);
  const card = await service.createTask({ title: "Created after binding", workspaceId: workspace.id });
  assert.equal(card.workflowVersionId, "draft-fixture");
});

for (const scope of ["worktodo", "procurement", "c"]) {
  test(`${scope} unconfigured Workflow initializes standalone Steps and keeps the Workspace/TASK path`, async () => {
    const { service, state } = fixture({ scope, optional: true });
    const workspace = await service.createWorkspace("Optional Workspace");
    const card = await service.createTask({ title: "Optional task", workspaceId: workspace.id });
    assert.deepEqual(writes(state).map(call => call.name), ["board_instance_create_workspace", "board_instance_create_task"]);
    assert.equal(card.workflowVersionId, "draft-fixture");
    assert.equal(state.published.transitions.length,0);
    assert.deepEqual(workspace.workflowBinding,{state:"published",workflowVersionId:"draft-fixture"});
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
  assert.deepEqual(writes(state).map(call => call.name), ["board_instance_create_task"]);
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

test("system validation failure rolls back Workspace creation and retry reuses its request key", async () => {
  const {service,state}=fixture({failAt:"board_c_workflow_save_draft"});
  const before=structuredClone(state.workspaces);
  await assert.rejects(()=>service.createWorkspace("Recoverable"),e=>e.workspaceCreationUncertain===true);
  assert.deepEqual(state.workspaces,before);assert.equal(state.createdCount,0);assert.equal(state.published.id,"published-1");
  state.failAt="";
  const recovered=await service.createWorkspace("Recoverable");
  assert.equal(recovered.id,"ws-created-1");assert.equal(state.createdCount,1);
  const calls=state.calls.filter(c=>c.name==="board_instance_create_workspace");
  assert.equal(calls.length,2);assert.equal(calls[0].args.p_workspace_key,calls[1].args.p_workspace_key);
});

test("uncertain Workspace response retries the idempotent writer and never inserts twice",async()=>{
 const {service,state}=fixture({createResponseLost:true});
 await assert.rejects(()=>service.createWorkspace("Uncertain creation"),e=>e.workspaceCreationUncertain===true);
 const recovered=await service.createWorkspace("Uncertain creation");assert.equal(recovered.id,"ws-created-1");assert.equal(state.createdCount,1);
 const calls=state.calls.filter(c=>c.name==="board_instance_create_workspace");assert.equal(calls.length,2);assert.deepEqual(calls[0].args,calls[1].args);
});

test("system validation/publish failures roll back and read-back failures cannot report acceptance",async()=>{
 for(const options of [{invalidDraft:true},{failAt:"board_c_workflow_validate_draft"},{publishConflict:true},{badReadBack:true}]){
  const {service,state}=fixture(options);const before=structuredClone(state.workspaces);
  await assert.rejects(()=>service.createWorkspace("Pending"),e=>e.workspaceCreationUncertain===true);
  if(options.badReadBack){assert.equal(state.createdCount,1);assert.equal(state.published.id,"draft-fixture");}
  else{assert.equal(state.createdCount,0);assert.deepEqual(state.workspaces,before);assert.equal(state.published.id,"published-1");}
  assert.equal(state.calls.some(c=>c.name==="board_c_workflow_publish"),false,'Browser never owns publish');
 }
});

test("existing user Draft remains Draft and browser sends no save/validate/publish RPC",async()=>{
 const {service,state}=fixture();
 state.draft={...structuredClone(state.published),id:"user-draft",status:"draft",name:"Unconfirmed workflow",description:"Preserve user setting",based_on_workflow_version_id:state.published.id};
 state.draft.transitions.push({transition_key:"user-only",from_step_id:"step-1",to_step_id:"step-0",allowed_roles:["gpt"]});
 const draftEdges=structuredClone(state.draft.transitions);
 await service.createWorkspace("Independent");
 assert.equal(state.draft.id,"user-draft");assert.equal(state.draft.status,"draft");assert.equal(state.draft.name,"Unconfirmed workflow");assert.deepEqual(state.draft.transitions,draftEdges);
 assert.equal(state.published.transitions.some(e=>e.transition_key==="user-only"),false);
 assert.deepEqual(writes(state).map(c=>c.name),["board_instance_create_workspace"]);
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
