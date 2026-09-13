const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const BoardRead = require("../shared/board/board-read-service.js");

const INSTANCE_ID = "74ff1127-ab98-4543-8f69-872e5d92fd33";
const WORKFLOW_ID = "05557542-2f91-465a-bb14-3518105f9537";

const OPTIONAL_NOT_APPLICABLE_RECONCILIATION = {
  contract: "module-c-lifecycle-acceptance-v2",
  capability: "completion-archive-lifecycle",
  action: "reconcile-completion-archive",
  state: "not_applicable",
  board_instance_id: INSTANCE_ID,
  workflow_version_id: null,
  workflow_status: "not_configured",
  completion_step_id: null,
  completion_workspace_id: null,
  completion_designation_status: "not_configured",
  archive_designation_status: "not_applicable",
  policy_identity: null,
  policy_version: null,
  archive_delay_seconds: null,
  archived_count: 0,
  task_ids: [],
  idempotent: true,
  atomic: true,
  scope_verified: true,
  existing_due_at_retroactive: false
};

const OPTIONAL_CONFIGURED_RECONCILIATION = {
  contract: "module-c-lifecycle-acceptance-v2",
  capability: "completion-archive-lifecycle",
  action: "reconcile-completion-archive",
  state: "reconciled",
  board_instance_id: INSTANCE_ID,
  workflow_version_id: null,
  workflow_status: "not_configured",
  completion_step_id: null,
  completion_workspace_id: "workspace-completed",
  completion_designation_status: "configured",
  archive_designation_status: "configured",
  policy_identity: "module-c-completion-archive-policy",
  policy_version: 1,
  archive_delay_seconds: 86400,
  archived_count: 0,
  task_ids: [],
  idempotent: true,
  atomic: true,
  scope_verified: true,
  existing_due_at_retroactive: false
};

function authenticatedSession() {
  return { user_id: "owner-1", email: "owner@example.com", isAuthenticated: true };
}

function scopedGateway({ workflow = null, reconciliation = OPTIONAL_CONFIGURED_RECONCILIATION } = {}) {
  const calls = [];
  const gateway = {
    calls,
    async select(table, query) {
      calls.push({ type: "select", table, query });
      if (table === "board_instances") {
        return [{
          id: INSTANCE_ID,
          name: "AI Board",
          template_key: "c",
          task_code_prefix: "TASK",
          authorization_mode: "engineering",
          is_template_instance: false,
          active: true
        }];
      }
      if (table === "board_workspaces") {
        return [{ id: "workspace-qjc", workspace_key: "qjc", name: "QJC驗證", sort_order: 30, active: true }];
      }
      if (table === "board_tasks") {
        return [{
          id: "task-066",
          board_instance_id: INSTANCE_ID,
          title: "TASK-066",
          status: "qa",
          assignee: "QJC",
          workspace_id: "workspace-qjc",
          workflow_version_id: WORKFLOW_ID,
          current_workflow_step_id: "step-qjc",
          application_scope: "ai_board"
        }];
      }
      return [];
    },
    async rpc(name, params) {
      calls.push({ type: "rpc", name, params });
      if (name === "board_c_workflow_get") return workflow;
      if (name === "board_c_reconcile_completion_archive_lifecycle_v2") return reconciliation;
      throw new Error(`Unexpected RPC ${name}`);
    }
  };
  return gateway;
}

test("P3 AI Board read adopts the shared instance-scoped C archive path", async () => {
  const previousSnapshot = global.getSharedSessionSnapshot;
  global.getSharedSessionSnapshot = authenticatedSession;
  const gateway = scopedGateway({
    workflow: {
      contract: "module-c-lifecycle-acceptance-v2",
      board_instance_id: INSTANCE_ID,
      state: { published_workflow_version_id: WORKFLOW_ID },
      published: {
        id: WORKFLOW_ID,
        board_instance_id: INSTANCE_ID,
        status: "published",
        steps: []
      },
      draft: null
    },
    reconciliation: {
      contract: "module-c-lifecycle-acceptance-v2",
      capability: "completion-archive-lifecycle",
      action: "reconcile-completion-archive",
      state: "reconciled",
      board_instance_id: INSTANCE_ID,
      workflow_version_id: WORKFLOW_ID,
      completion_step_id: "step-completed",
      completion_workspace_id: "workspace-completed",
      policy_identity: "module-c-completion-archive-policy",
      policy_version: 1,
      archive_delay_seconds: 172800,
      archived_count: 0,
      idempotent: true,
      atomic: true,
      scope_verified: true
    }
  });

  try {
    const service = BoardRead.createInstanceService({
      gateway,
      legacyApplicationScope: "ai_board",
      completionArchiveLifecycle: true,
      allowExistingCardAdoption: true,
      allowWorkspaceMovement: true
    });
    const result = await service.load();
    assert.equal(result.boardInstanceId, INSTANCE_ID);
    assert.equal(result.completionArchive.state, "reconciled");
    assert.equal(result.completionArchive.workflowVersionId, WORKFLOW_ID);
    assert.equal(result.completionArchive.scopeVerified, true);
    assert.equal(gateway.calls.some(call => call.name === "board_reconcile_completion_lifecycle"), false);
    assert.deepEqual(gateway.calls.filter(call => call.type === "rpc").map(call => call.name), [
      "board_c_workflow_get",
      "board_c_reconcile_completion_archive_lifecycle_v2"
    ]);
    assert.equal(
      gateway.calls.find(call => call.name === "board_c_reconcile_completion_archive_lifecycle_v2").params.p_board_instance_id,
      INSTANCE_ID
    );
  } finally {
    if (previousSnapshot) global.getSharedSessionSnapshot = previousSnapshot;
    else delete global.getSharedSessionSnapshot;
  }
});

test("P3 missing Published Workflow is a legal optional state when no designation exists", async () => {
  const previousSnapshot = global.getSharedSessionSnapshot;
  global.getSharedSessionSnapshot = authenticatedSession;
  const gateway = scopedGateway({
    workflow: {
      contract: "module-c-lifecycle-acceptance-v2",
      board_instance_id: INSTANCE_ID,
      state: null,
      published: null,
      draft: null
    },
    reconciliation: OPTIONAL_NOT_APPLICABLE_RECONCILIATION
  });

  try {
    const service = BoardRead.createInstanceService({ gateway, boardInstanceId: INSTANCE_ID, completionArchiveLifecycle: true });
    const result = await service.load();
    assert.equal(result.completionArchive.state, "not_applicable");
    assert.equal(result.completionArchive.workflowStatus, "not_configured");
    assert.equal(result.completionArchive.completionDesignationStatus, "not_configured");
    assert.equal(result.completionArchive.archiveDesignationStatus, "not_applicable");
    assert.notEqual(result.completionArchive.failClosed, true);
    assert.equal(gateway.calls.some(call => call.name === "board_c_reconcile_completion_archive_lifecycle_v2"), true);
    assert.equal(gateway.calls.some(call => call.name === "board_reconcile_completion_lifecycle"), false);
  } finally {
    if (previousSnapshot) global.getSharedSessionSnapshot = previousSnapshot;
    else delete global.getSharedSessionSnapshot;
  }
});

test("P3 malformed Published Workflow binding fails closed", async () => {
  const previousSnapshot = global.getSharedSessionSnapshot;
  global.getSharedSessionSnapshot = authenticatedSession;
  const gateway = scopedGateway({
    workflow: {
      contract: "module-c-lifecycle-acceptance-v2",
      board_instance_id: INSTANCE_ID,
      state: { published_workflow_version_id: WORKFLOW_ID },
      published: { id: "other-workflow", board_instance_id: INSTANCE_ID, status: "published", steps: [] }
    }
  });

  try {
    const service = BoardRead.createInstanceService({ gateway, boardInstanceId: INSTANCE_ID, completionArchiveLifecycle: true });
    await assert.rejects(
      () => service.load(),
      error => {
        assert.equal(error.code, "C_ARCHIVE_WORKFLOW_BINDING_INVALID");
        return true;
      }
    );
    assert.equal(gateway.calls.some(call => call.name === "board_c_reconcile_completion_archive_lifecycle_v2"), false);
    assert.equal(gateway.calls.some(call => call.name === "board_reconcile_completion_lifecycle"), false);
  } finally {
    if (previousSnapshot) global.getSharedSessionSnapshot = previousSnapshot;
    else delete global.getSharedSessionSnapshot;
  }
});

test("P3 disabled capability does not resolve or reconcile a workflow", async () => {
  const previousSnapshot = global.getSharedSessionSnapshot;
  global.getSharedSessionSnapshot = authenticatedSession;
  const gateway = scopedGateway({
    workflow: {
      contract: "module-c-lifecycle-acceptance-v2",
      board_instance_id: INSTANCE_ID,
      state: { published_workflow_version_id: WORKFLOW_ID },
      published: { id: WORKFLOW_ID, board_instance_id: INSTANCE_ID, status: "published", steps: [] }
    }
  });

  try {
    const service = BoardRead.createInstanceService({ gateway, boardInstanceId: INSTANCE_ID, completionArchiveLifecycle: false });
    const result = await service.load();
    assert.equal(result.completionArchive.state, "not_enabled");
    assert.equal(result.completionArchive.reasonCode, "C_ARCHIVE_CAPABILITY_NOT_ENABLED");
    assert.equal(gateway.calls.some(call => call.name === "board_c_workflow_get"), false);
    assert.equal(gateway.calls.some(call => call.name === "board_c_reconcile_completion_archive_lifecycle_v2"), false);
  } finally {
    if (previousSnapshot) global.getSharedSessionSnapshot = previousSnapshot;
    else delete global.getSharedSessionSnapshot;
  }
});

test("same-data WorkTodo comparison service is read-only at the shared service boundary", async () => {
  const previousSnapshot = global.getSharedSessionSnapshot;
  global.getSharedSessionSnapshot = authenticatedSession;
  const gateway = scopedGateway({
    workflow: {
      contract: "module-c-lifecycle-acceptance-v2",
      board_instance_id: INSTANCE_ID,
      state: null,
      published: null,
      draft: null
    }
  });

  try {
    const service = BoardRead.createInstanceService({
      gateway,
      boardInstanceId: INSTANCE_ID,
      consumerId: "worktodo-old",
      readOnly: true,
      completionArchiveLifecycle: true
    });
    const result = await service.load();
    assert.equal(result.boardInstanceId, INSTANCE_ID);
    assert.equal(result.readOnly, true);
    assert.equal(result.completionArchive.state, "read_only");
    assert.equal(result.completionArchive.reasonCode, "C_ARCHIVE_READ_ONLY_COMPARISON");
    assert.equal(service.workflow.readOnly, true);
    await assert.rejects(
      () => service.moveTaskWorkspace("task-066", "workspace-qjc"),
      error => error.code === "WORKTODO_OLD_READ_ONLY"
    );
    await assert.rejects(
      () => service.createTask({ title: "must not write" }),
      error => error.code === "WORKTODO_OLD_READ_ONLY"
    );
    await assert.rejects(
      () => service.acceptTaskFromQjcDrop({ taskId: "task-066" }),
      error => error.code === "WORKTODO_OLD_READ_ONLY"
    );
    assert.equal(gateway.calls.some(call => call.type === "rpc" && call.name === "board_c_reconcile_completion_archive_lifecycle_v2"), false);
    assert.equal(gateway.calls.some(call => call.type === "rpc" && call.name === "board_instance_move_task_workspace"), false);
  } finally {
    if (previousSnapshot) global.getSharedSessionSnapshot = previousSnapshot;
    else delete global.getSharedSessionSnapshot;
  }
});

test("same-data WorkTodo formal entry resolves the existing Board Instance through C", async () => {
  const previousSnapshot = global.getSharedSessionSnapshot;
  global.getSharedSessionSnapshot = authenticatedSession;
  const gateway = scopedGateway();

  try {
    const service = BoardRead.createInstanceService({
      gateway,
      templateKey: "c",
      legacyApplicationScope: "worktodo",
      consumerId: "worktodo",
      completionArchiveLifecycle: true,
      allowExistingCardAdoption: true,
      allowWorkspaceMovement: true
    });
    const result = await service.load();
    assert.equal(result.boardInstanceId, INSTANCE_ID);
    assert.equal(result.readOnly, false);
    assert.equal(result.completionArchive.state, "reconciled");
    assert.equal(result.completionArchive.workflowStatus, "not_configured");
    assert.equal(result.completionArchive.completionDesignationStatus, "configured");
    assert.equal(result.completionArchive.archiveDesignationStatus, "configured");
    assert.equal(result.completionArchive.workflowVersionId, "");
    assert.equal(result.tasks.length, 1);
    assert.equal(result.tasks[0].id, "task-066");
    assert.equal(gateway.calls.some(call => call.type === "select"
      && call.table === "board_instances"
      && call.query.includes("legacy_application_scope=eq.worktodo")), true);
    assert.equal(gateway.calls.some(call => call.type === "select"
      && call.table === "board_tasks"
      && call.query.includes(`board_instance_id=eq.${INSTANCE_ID}`)), true);
    assert.equal(gateway.calls.some(call => call.type === "rpc"
      && /^(board_provision|worktodo_)/.test(call.name)), false);
  } finally {
    if (previousSnapshot) global.getSharedSessionSnapshot = previousSnapshot;
    else delete global.getSharedSessionSnapshot;
  }
});

test("P3 runtime routes AI Board through the shared C Instance Service", () => {
  const runtime = read("shared/components/golden-master-runtime.js");
  assert.match(runtime, /const cInstanceRuntime = \["c", "ai_board", "procurement"\]\.includes\(state\.applicationScope\) \|\| state\.applicationScope === "worktodo"/);
  assert.match(runtime, /completionArchiveLifecycle: completionArchiveRuntime/);
  assert.match(runtime, /legacyApplicationScope: state\.applicationScope === "procurement"[\s\S]*state\.applicationScope === "ai_board" \? "ai_board"/);
  assert.match(runtime, /AI Board is a C Board Instance consumer too/);
});

test("P3 consumers share the optional C archive contract without a Consumer policy value", () => {
  const source = read("shared/board/board-read-service.js");
  const runtime = read("shared/components/golden-master-runtime.js");
  const currentSource = `${source}\n${runtime}`;
  const executableSource = currentSource
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
  assert.match(source, /completionArchiveLifecycleEnabled = instanceOptions\.completionArchiveLifecycle === true/);
  assert.match(source, /board_c_reconcile_completion_archive_lifecycle_v2/);
  assert.match(source, /workflowOptional:\s*true/);
  assert.match(source, /board-instance\+optional-workflow-or-completion-designation/);
  assert.match(source, /C_WORKFLOW_OPTIONAL_NOT_CONFIGURED/);
  assert.doesNotMatch(executableSource, /48\s*hours|48\s*hour|2\s*days|archive interval/i);
  assert.doesNotMatch(runtime, /board_reconcile_completion_lifecycle/);
});
