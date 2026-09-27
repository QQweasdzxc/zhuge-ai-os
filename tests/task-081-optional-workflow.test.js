const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const BoardReadService = require("../shared/board/board-read-service.js");

const ROOT = path.join(__dirname, "..");
const migration = fs.readFileSync(path.join(ROOT, "docs/supabase/20260922_task_081_optional_workflow.sql"), "utf8");
const correctiveMigration = fs.readFileSync(path.join(ROOT, "docs/supabase/20260922_task_081_unbound_create_record_fix.sql"), "utf8");
const movementMigration = fs.readFileSync(path.join(ROOT, "docs/supabase/20260922_task_081_shared_movement_decision_orchestration.sql"), "utf8");
const service = fs.readFileSync(path.join(ROOT, "shared/board/board-read-service.js"), "utf8");
const adapters = fs.readFileSync(path.join(ROOT, "shared/components/task-action-adapters.js"), "utf8");
const approval = fs.readFileSync(path.join(ROOT, "tools/pm-governance-approval.js"), "utf8");

test("TASK-081 migration keeps Published binding as default and exposes explicit unbound paths", () => {
  assert.match(migration, /p_workflow_mode text/);
  assert.match(migration, /'published', 'unbound'/);
  assert.match(migration, /zhuge\.module_c_workflow_mode/);
  assert.match(migration, /board_c_detach_workflow_and_move_task_v1/);
  assert.match(migration, /grant execute on function public\.board_c_detach_workflow_and_move_task_v1\(uuid, uuid, text, text\) to authenticated/);
  assert.match(migration, /board_instance_create_task\(uuid, text, text, text, text, uuid, text\)/);
  assert.match(migration, /board_create_task\(text, text, text, text, text, text, uuid, text, text\)/);
  assert.match(migration, /old\.workflow_version_id is not null/);
  assert.match(migration, /Existing unbound cards stay unbound/);
  assert.doesNotMatch(migration, /172800/);
  assert.match(correctiveMigration, /v_workflow_version_id uuid/);
  assert.match(correctiveMigration, /v_current_workflow_step_id uuid/);
  assert.match(correctiveMigration, /p_workflow_mode text/);
  assert.match(movementMigration, /board_c_move_workspace_decision_v1/);
  assert.match(movementMigration, /board_c_detach_workflow_and_move_task_v1/);
  assert.match(movementMigration, /board_instance_workflow_state/);
  assert.match(movementMigration, /decision_route/);
});

test("TASK-081 source routes every consumer through shared movement authority", async () => {
  assert.match(service, /board_c_detach_workflow_and_move_task_v1/);
  assert.match(service, /board_c_move_workspace_decision_v1/);
  assert.doesNotMatch(adapters, /detachWorkflow: payload\.detachWorkflow/);
  assert.match(service, /input\.adoptWorkflow === true/);
  assert.match(service, /p_workflow_mode: input\.workflowMode \|\| "published"/);
  assert.match(approval, /workflow_mode/);
  assert.match(approval, /Published GPT TASK read-back is missing the current Workflow binding/);
  assert.match(approval, /Unbound GPT TASK read-back unexpectedly contains a Workflow binding/);

  const calls = [];
  const workflow = BoardReadService.createWorkflowCapability({
    gateway: {
      async select() { return [{ id: "consumer-board", name: "Consumer", template_key: "c", active: true }]; },
      async rpc(name, args) {
        calls.push({ name, args });
        if (name === "board_c_move_workspace_decision_v1") return { action: "workflow-detach-workspace-decision", workflow_bound: false, decision_route: "bound_detach" };
        throw new Error(`Unexpected RPC: ${name}`);
      }
    },
    boardInstanceId: "consumer-board",
    allowWorkspaceMovement: true
  });

  const result = await workflow.moveWorkspaceDecision({
    taskId: "task-081",
    targetWorkspaceId: "paused-workspace",
    decisionNote: "Leave published workflow through shared authority",
    idempotencyKey: "task-081-detach"
  });
  assert.equal(result.decision_route, "bound_detach");
  assert.deepEqual(calls, [{
    name: "board_c_move_workspace_decision_v1",
    args: {
      p_task_id: "task-081",
      p_target_workspace_id: "paused-workspace",
      p_decision_note: "Leave published workflow through shared authority",
      p_idempotency_key: "task-081-detach"
    }
  }]);
});

test("TASK-081 unbound movement does not auto-adopt a published workflow", async () => {
  const calls = [];
  const workflow = BoardReadService.createWorkflowCapability({
    gateway: {
      async select() { return [{ id: "consumer-board", name: "Consumer", template_key: "c", active: true }]; },
      async rpc(name, args) {
        calls.push({ name, args });
        if (name === "board_c_move_workspace_decision_v1") return { workflow_bound: false, workflow_optional: true, decision_route: "unbound" };
        throw new Error(`Unexpected RPC: ${name}`);
      }
    },
    boardInstanceId: "consumer-board",
    allowExistingCardAdoption: true,
    allowWorkspaceMovement: true
  });

  const result = await workflow.moveWorkspaceDecision({ taskId: "task-081", targetWorkspaceId: "paused-workspace" });
  assert.equal(result.workflow_bound, false);
  assert.equal(result.decision_route, "unbound");
  assert.deepEqual(calls.map(call => call.name), [
    "board_c_move_workspace_decision_v1"
  ]);
});
