const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const BoardReadService = require("../shared/board/board-read-service.js");

test("Module C exposes one Board Instance-owned Workflow v2 capability", async () => {
  const calls = [];
  const gateway = {
    async select(table, query) {
      calls.push({ type: "select", table, query });
      return [{ id: "board-1", name: "QA 子板", template_key: "c", active: true }];
    },
    async rpc(name, args) {
      calls.push({ type: "rpc", name, args });
      if (name === "board_c_workflow_get") {
        return {
          contract: "module-c-lifecycle-acceptance-v2",
          board_instance_id: args.p_board_instance_id,
          state: null,
          published: null,
          draft: null
        };
      }
      return { contract: "module-c-lifecycle-acceptance-v2", action: name };
    }
  };
  const workflow = BoardReadService.createWorkflowCapability({ gateway, boardInstanceId: "board-1" });

  assert.equal(workflow.contract.id, "module-c-lifecycle-acceptance-v2");
  assert.equal(workflow.contract.source, "module-c-mother");
  assert.equal(workflow.contract.owner, "board-instance");
  assert.equal(workflow.capabilities.settings, true);
  assert.equal(workflow.capabilities.workspaceDecision, true);
  assert.equal(await workflow.boardInstanceId(), "board-1");
  await workflow.get({ includeDraft: true });
  await workflow.reconcileWorkspaceDecision({
    taskId: "task-1",
    targetWorkspaceId: "workspace-2",
    idempotencyKey: "workflow-action-1"
  });

  const getCall = calls.find(call => call.name === "board_c_workflow_get");
  const reconcileCall = calls.find(call => call.name === "board_c_reconcile_workspace_decision_v2");
  assert.equal(getCall.args.p_board_instance_id, "board-1");
  assert.equal(getCall.args.p_include_draft, true);
  assert.deepEqual(reconcileCall.args, {
    p_task_id: "task-1",
    p_target_workspace_id: "workspace-2",
    p_decision_note: null,
    p_idempotency_key: "workflow-action-1"
  });
});

test("read-only C capability cannot write workflow definitions or decisions", async () => {
  const gateway = {
    async select() { return [{ id: "investment-board", name: "Investment", active: true }]; },
    async rpc() { throw new Error("write must not reach Cloud"); }
  };
  const workflow = BoardReadService.createWorkflowCapability({ gateway, boardInstanceId: "investment-board", readOnly: true });

  assert.equal(workflow.capabilities.workspaceDecision, false);
  assert.equal(workflow.capabilities.completion, false);
  await assert.rejects(() => workflow.saveDraft({ name: "不應寫入" }), /唯讀/);
  await assert.rejects(() => workflow.reconcileWorkspaceDecision({ taskId: "task-1", targetWorkspaceId: "workspace-2" }), /唯讀/);
});

test("C Workflow write boundary normalizes the editor model to the RPC contract", async () => {
  const calls = [];
  const workflow = BoardReadService.createWorkflowCapability({
    gateway: {
      async select() { return [{ id: "board-1", name: "QA 子板", active: true }]; },
      async rpc(name, args) {
        calls.push({ name, args });
        return { contract: "module-c-lifecycle-acceptance-v2", board_instance_id: "board-1", draft: null, state: null };
      }
    },
    boardInstanceId: "board-1"
  });
  await workflow.saveDraft({
    name: "AI Board 流程",
    steps: [{ stepKey: "todo", name: "待辦", sortOrder: 0, roleKey: "co", workspaceId: "workspace-1", statusKey: "ready", isInitial: true, isCompletion: false }],
    transitions: [{ transitionKey: "todo_to_done", fromStepKey: "todo", toStepKey: "done", allowedRoles: ["pm"], requiresGate: true }],
    gates: [{ stepKey: "done", gateKey: "gate-done", name: "完成確認", required: true, humanActionRequired: true, completionRole: "pm", failurePolicy: "stay", sortOrder: 1 }],
    evidenceRequirements: [{ gateKey: "gate-done", evidenceKey: "pm-action", label: "PM 完成操作", required: true, sourceKind: "pm_action_context", sortOrder: 0 }]
  });
  const call = calls.find(item => item.name === "board_c_workflow_save_draft");
  assert.deepEqual(call.args.p_steps[0], {
    step_key: "todo",
    name: "待辦",
    sort_order: 0,
    role_key: "co",
    workspace_id: "workspace-1",
    status_key: "ready",
    is_initial: true,
    is_completion: false
  });
  assert.deepEqual(call.args.p_transitions[0], {
    transition_key: "todo_to_done",
    from_step_key: "todo",
    to_step_key: "done",
    allowed_roles: ["pm"],
    requires_gate: true
  });
  assert.equal(call.args.p_gates[0].step_key, "done");
  assert.equal(call.args.p_evidence_requirements[0].source_kind, "pm_action_context");
});

test("C Workflow runtime is shared by the C routes and keeps card bindings explicit", () => {
  const runtime = read("shared/components/golden-master-runtime.js");
  const service = read("shared/board/board-read-service.js");
  const migration = read("docs/supabase/20260910_c_workflow_capability_v2.sql");
  const binding = read("docs/supabase/20260910_c_workflow_card_binding_v2.sql");
  const publishFix = read("docs/supabase/20260910_c_workflow_publish_state_fix.sql");
  const lineage = read("docs/supabase/20260910_c_workflow_draft_lineage.sql");
  const privateHelperSecurity = read("docs/supabase/20260910_c_workflow_private_helper_security.sql");

  for (const page of ["app/Board/template-preview/index.html", "app/Board/ai/index.html", "app/Board/worktodo/index.html", "app/Board/procurement/index.html"]) {
    assert.match(read(page), /shared\/components\/golden-master-runtime\.js/);
  }
  assert.match(service, /module-c-lifecycle-acceptance-v2/);
  assert.match(service, /workflow_version_id,current_workflow_step_id/);
  assert.match(runtime, /workflow\.reconcileWorkspaceDecision/);
  assert.match(runtime, /boardTab\.dataset\.boardNav = "board"/);
  assert.match(runtime, /if \(!accepted\) return/);
  assert.match(runtime, /tab\.dataset\.boardNav = "workflow-settings"/);
  assert.match(migration, /board_workflow_definitions/);
  assert.match(migration, /board_workflow_action_idempotency/);
  assert.match(binding, /before insert on public\.board_tasks/);
  assert.match(binding, /never.*historical backfill|historical backfill/i);
  assert.doesNotMatch(binding, /update public\.board_tasks/i);
  assert.match(publishFix, /draft_workflow_version_id = null/);
  assert.match(publishFix, /board_c_workflow_publish/);
  assert.match(lineage, /based_on_workflow_version_id/);
  assert.match(lineage, /status = 'published'/);
  assert.match(lineage, /before insert on public\.board_workflow_definitions/);
  assert.match(privateHelperSecurity, /revoke all on function private\.board_workflow_bind_new_task\(\) from public, anon, authenticated/);
  assert.match(privateHelperSecurity, /revoke all on function private\.board_workflow_snapshot\(uuid\) from public, anon, authenticated/);
  assert.match(privateHelperSecurity, /revoke all on function private\.board_workflow_validate\(uuid\) from public, anon, authenticated/);
});
