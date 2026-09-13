const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const migration = read("docs/supabase/20260912_c_completion_archive_instance_scope.sql");
const optionalMigration = read("docs/supabase/20260913_c_completion_archive_optional_workflow.sql");
const source = read("shared/board/board-read-service.js");
const BoardRead = require("../shared/board/board-read-service.js");

test("TASK-064 P2 creates one instance/workflow-scoped C archive authority", () => {
  assert.match(migration, /create or replace function private\.board_c_completion_archive_scope/i);
  assert.match(migration, /create or replace function private\.board_c_completion_archive_context/i);
  assert.match(migration, /create or replace function public\.board_c_resolve_completion_archive_context/i);
  assert.match(migration, /create or replace function public\.board_c_reconcile_completion_archive_lifecycle_v2/i);

  const code = migration.replace(/--.*$/gm, "");
  assert.match(code, /set search_path = pg_catalog, public, private, pg_temp/i);
  assert.match(code, /board_instance_workflow_state/i);
  assert.match(code, /board_instance_id\s*=\s*p_board_instance_id/i);
  assert.match(code, /status\s+in\s+\('published',\s*'retired'\)/i);
  assert.match(code, /published_at\s+is\s+not\s+null/i);
  assert.match(code, /published_workflow_version_id/i);
  assert.match(code, /is_completion\s*=\s*true/i);
  assert.match(code, /completion_workspace.*board_instance_id\s*=\s*p_board_instance_id/is);
  assert.match(code, /private\.module_c_completion_archive_policies/i);
  assert.match(code, /archive_due_at\s+<=\s*v_now/i);
  assert.match(code, /for update\s+skip locked/i);
  assert.match(code, /archived_at\s+is\s+null/i);
  assert.match(code, /revoke all on function private\.board_c_completion_archive_scope\(uuid, uuid\)/i);
  assert.match(code, /revoke all on function private\.board_c_completion_archive_context\(uuid, uuid, uuid\)/i);
  assert.match(code, /grant execute on function public\.board_c_resolve_completion_archive_context\(uuid, uuid, uuid\) to authenticated/i);
  assert.match(code, /grant execute on function public\.board_c_reconcile_completion_archive_lifecycle_v2\(uuid, uuid, uuid\) to authenticated/i);
  assert.doesNotMatch(code, /board_reconcile_completion_lifecycle\s*\(/i);
  assert.doesNotMatch(code, /workspace_key/i);
  assert.doesNotMatch(code, /insert\s+into\s+public\.(board_tasks|user_tasks)\b/i);
  assert.doesNotMatch(code, /delete\s+from\s+public\.(board_tasks|user_tasks)\b/i);
});

test("TASK-064 P2 Cloud grants are authenticated-only and fail closed", () => {
  const code = migration.replace(/--.*$/gm, "");
  assert.match(code, /auth\.uid\(\)\s+is\s+null/i);
  assert.match(code, /board_task_can_read\(p_task_id\)/i);
  assert.match(code, /board_instance_can_write\(p_board_instance_id\)/i);
  assert.match(code, /C_ARCHIVE_INSTANCE_REQUIRED/i);
  assert.match(code, /C_ARCHIVE_WORKFLOW_REQUIRED/i);
  assert.match(code, /C_ARCHIVE_WORKFLOW_BINDING_INVALID/i);
  assert.match(code, /C_ARCHIVE_COMPLETION_STEP_REQUIRED/i);
  assert.match(code, /C_ARCHIVE_COMPLETION_WORKSPACE_INVALID/i);
  assert.match(code, /C_ARCHIVE_CURRENT_STEP_INVALID/i);
  assert.match(code, /C_ARCHIVE_CURRENT_WORKSPACE_MISMATCH/i);
  assert.match(code, /revoke all on function public\.board_c_resolve_completion_archive_context\(uuid, uuid, uuid\) from public, anon/i);
  assert.match(code, /revoke all on function public\.board_c_reconcile_completion_archive_lifecycle_v2\(uuid, uuid, uuid\) from public, anon/i);
  assert.doesNotMatch(code, /grant execute on function public\.[^(]+\([^)]*\) to anon/i);
});

test("TASK-064 optional Workflow Cloud contract uses explicit designation or legal N/A", () => {
  const code = optionalMigration.replace(/--.*$/gm, "");
  assert.match(code, /private\.board_c_completion_archive_designation/i);
  assert.match(code, /workspace_key/i);
  assert.match(code, /workflow_optional/i);
  assert.match(code, /'state',\s*'not_applicable'/i);
  assert.match(code, /'state',\s*'configured'/i);
  assert.match(code, /'archive_designation',\s*'task-archive-state'/i);
  assert.match(code, /left\s+join\s+public\.board_instance_workflow_state/i);
  assert.doesNotMatch(code, /insert\s+into\s+public\.(board_tasks|user_tasks)\b/i);
  assert.doesNotMatch(code, /delete\s+from\s+public\.(board_tasks|user_tasks)\b/i);
});

test("P2 browser contract exposes optional scoped context without duplicating policy timing", () => {
  assert.deepEqual(BoardRead.C_COMPLETION_ARCHIVE_LIFECYCLE_CONTRACT, {
    id: "module-c-lifecycle-acceptance-v2",
    capability: "completion-archive-lifecycle",
    source: "module-c-mother",
    owner: "board-instance",
    scope: "board-instance+published-workflow-version-or-explicit-completion-designation",
    completionPosition: "published-workflow-step-or-explicit-designation",
    policy: "module-c-completion-archive-policy",
    workflowOptional: true,
    archiveDesignation: "task-archive-state",
    existingDueAtPolicy: "preserve-no-retroactive-recalculation",
    failureMode: "fail-closed",
    reconciliation: "instance-scoped-idempotent"
  });
  const start = source.indexOf("const C_COMPLETION_ARCHIVE_LIFECYCLE_CONTRACT");
  const end = source.indexOf("function createLifecycleCapability", start);
  assert.ok(start >= 0 && end > start);
  assert.doesNotMatch(source.slice(start, end), /172800|48\s*hours|2\s*days|archiveDelaySeconds/i);
  assert.equal(typeof BoardRead.resolveCompletionArchiveContext, "function");
  assert.equal(typeof BoardRead.reconcileCompletionArchiveLifecycle, "function");
});

test("scoped context adapter sends optional scope and normalizes Cloud read-back", async () => {
  const calls = [];
  const gateway = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === "board_c_resolve_completion_archive_context") {
        return {
          contract: "module-c-lifecycle-acceptance-v2",
          capability: "completion-archive-lifecycle",
          scope: "board-instance+published-workflow-version",
          board_instance_id: "instance-1",
          workflow_version_id: "workflow-1",
          workflow_status: "published",
          workflow_version_no: 1,
          published_workflow_version_id: "workflow-1",
          task_id: "task-1",
          current_step_id: "step-co",
          current_step_name: "Co",
          current_workspace_id: "workspace-co",
          current_workspace_name: "Co區",
          completion_step_id: "step-done",
          completion_step_name: "完成",
          completion_workspace_id: "workspace-done",
          completion_workspace_name: "完成",
          policy_identity: "module-c-completion-archive-policy",
          policy_key: "completion_archive",
          policy_version: 1,
          archive_delay_seconds: 172800,
          policy_source: "module-c-mother",
          completion_at: null,
          archive_due_at: null,
          archived_at: null,
          existing_due_at_retroactive: false,
          scope_verified: true,
          card_identity_preserved: true,
          cloud_source_of_truth: true
        };
      }
      throw new Error(`Unexpected RPC ${name}`);
    }
  };

  const context = await BoardRead.resolveCompletionArchiveContext("task-1", {
    gateway,
    boardInstanceId: "instance-1",
    workflowVersionId: "workflow-1"
  });
  assert.equal(context.boardInstanceId, "instance-1");
  assert.equal(context.workflowVersionId, "workflow-1");
  assert.equal(context.currentWorkspaceId, "workspace-co");
  assert.equal(context.completionWorkspaceId, "workspace-done");
  assert.equal(context.cardIdentityPreserved, true);
  assert.equal(context.scopeVerified, true);
  assert.deepEqual(calls, [{
    name: "board_c_resolve_completion_archive_context",
    args: {
      p_task_id: "task-1",
      p_board_instance_id: "instance-1",
      p_workflow_version_id: "workflow-1"
    }
  }]);
});

test("scoped archive reconciliation adapter requires and preserves instance scope", async () => {
  const calls = [];
  const gateway = {
    async rpc(name, args) {
      calls.push({ name, args });
      return {
        contract: "module-c-lifecycle-acceptance-v2",
        capability: "completion-archive-lifecycle",
        action: "reconcile-completion-archive",
        state: "reconciled",
        board_instance_id: "instance-1",
        workflow_version_id: "workflow-1",
        completion_step_id: "step-done",
        completion_workspace_id: "workspace-done",
        policy_identity: "module-c-completion-archive-policy",
        policy_version: 1,
        archive_delay_seconds: 172800,
        archived_count: 0,
        task_ids: [],
        idempotent: true,
        atomic: true,
        scope_verified: true,
        existing_due_at_retroactive: false
      };
    }
  };

  const result = await BoardRead.reconcileCompletionArchiveLifecycle({
    gateway,
    boardInstanceId: "instance-1",
    workflowVersionId: "workflow-1",
    taskId: "task-1"
  });
  assert.equal(result.boardInstanceId, "instance-1");
  assert.equal(result.workflowVersionId, "workflow-1");
  assert.equal(result.atomic, true);
  assert.equal(result.idempotent, true);
  assert.deepEqual(calls, [{
    name: "board_c_reconcile_completion_archive_lifecycle_v2",
    args: {
      p_board_instance_id: "instance-1",
      p_workflow_version_id: "workflow-1",
      p_task_id: "task-1"
    }
  }]);
});

test("optional completion archive adapter accepts legal N/A and configured states", async () => {
  const responses = [
    {
      contract: "module-c-lifecycle-acceptance-v2",
      capability: "completion-archive-lifecycle",
      state: "not_applicable",
      board_instance_id: "instance-1",
      workflow_version_id: null,
      workflow_status: "not_configured",
      completion_step_id: null,
      completion_workspace_id: null,
      completion_designation_status: "not_configured",
      archive_designation_status: "not_applicable",
      idempotent: true,
      atomic: true,
      scope_verified: true
    },
    {
      contract: "module-c-lifecycle-acceptance-v2",
      capability: "completion-archive-lifecycle",
      state: "reconciled",
      board_instance_id: "instance-1",
      workflow_version_id: null,
      workflow_status: "not_configured",
      completion_step_id: null,
      completion_workspace_id: "workspace-completed",
      completion_designation_status: "configured",
      archive_designation_status: "configured",
      policy_identity: "module-c-completion-archive-policy",
      policy_version: 1,
      archive_delay_seconds: 86400,
      idempotent: true,
      atomic: true,
      scope_verified: true
    }
  ];
  for (const response of responses) {
    const gateway = { rpc: async () => response };
    const result = await BoardRead.reconcileCompletionArchiveLifecycle({
      gateway,
      boardInstanceId: "instance-1",
      workflowVersionId: null
    });
    assert.equal(result.boardInstanceId, "instance-1");
    assert.equal(result.workflowVersionId, "");
    assert.equal(result.atomic, true);
    assert.equal(result.idempotent, true);
  }
});

test("Board Instance service pins P2 operations to its resolved instance", async () => {
  const calls = [];
  const gateway = {
    async select() {
      return [{ id: "instance-1", name: "C Mother", active: true }];
    },
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === "board_c_resolve_completion_archive_context") {
        return {
          board_instance_id: "instance-1",
          workflow_version_id: "workflow-1",
          task_id: "task-1",
          current_step_id: "step-co",
          current_workspace_id: "workspace-co",
          completion_step_id: "step-done",
          completion_workspace_id: "workspace-done",
          policy_version: 1,
          archive_delay_seconds: 172800,
          scope_verified: true,
          card_identity_preserved: true
        };
      }
      return {
        board_instance_id: "instance-1",
        workflow_version_id: "workflow-1",
        completion_step_id: "step-done",
        completion_workspace_id: "workspace-done",
        policy_version: 1,
        archive_delay_seconds: 172800,
        idempotent: true,
        atomic: true,
        scope_verified: true
      };
    }
  };
  const instance = BoardRead.createInstanceService({
    gateway,
    boardInstanceId: "instance-1"
  });
  const context = await instance.resolveCompletionArchiveContext("task-1", { workflowVersionId: "workflow-1" });
  const reconciliation = await instance.reconcileCompletionArchiveLifecycle({ workflowVersionId: "workflow-1" });
  assert.equal(context.boardInstanceId, "instance-1");
  assert.equal(reconciliation.boardInstanceId, "instance-1");
  assert.deepEqual(calls.map(call => call.name), [
    "board_c_resolve_completion_archive_context",
    "board_c_reconcile_completion_archive_lifecycle_v2"
  ]);
  assert.equal(calls[0].args.p_board_instance_id, "instance-1");
  assert.equal(calls[1].args.p_board_instance_id, "instance-1");
});

test("P2 adapters fail closed when Cloud omits binding scope", async () => {
  const gateway = { rpc: async () => ({ task_id: "task-1", scope_verified: false }) };
  await assert.rejects(
    () => BoardRead.resolveCompletionArchiveContext("task-1", { gateway }),
    error => error.code === "C_COMPLETION_ARCHIVE_CONTEXT_INVALID"
  );
  await assert.rejects(
    () => BoardRead.resolveCompletionArchiveContext("", { gateway }),
    error => error.code === "C_ARCHIVE_TASK_REQUIRED"
  );
  await assert.rejects(
    () => BoardRead.reconcileCompletionArchiveLifecycle({ gateway }),
    error => error.code === "C_ARCHIVE_INSTANCE_REQUIRED"
  );
});
