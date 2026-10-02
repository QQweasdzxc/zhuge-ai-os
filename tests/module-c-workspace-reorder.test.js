const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const BoardReadService = require("../shared/board/board-read-service.js");
const Adapters = require("../shared/components/task-action-adapters.js");
const WorkspaceOrderingAuthority = require("../shared/board/workspace-ordering-authority.js");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const migration = read("supabase/migrations/20261002041546_c_shared_workspace_reorder_guard.sql");
const auditMigration = read("supabase/migrations/20261002063558_task_34_workspace_reorder_audit.sql");

test("all Module C consumer adapters send workspace order through the same service capability", async () => {
  const ordered = [];
  const service = {
    async reorderWorkspaces(workspaceIds) { ordered.push(workspaceIds); return { updated: workspaceIds.length }; },
    async worktodoReorderWorkspaces() { throw new Error("retired WorkTodo reorder path must not be called"); }
  };
  const adapters = [
    Adapters.createAiBoardAdapter({ service }),
    Adapters.createWorkTodoAdapter({ service }),
    Adapters.createCTemplateAdapter({ service })
  ];

  for (const adapter of adapters) {
    await adapter.actions.reorderWorkspace({ workspaceIds: ["todo", "custom", "completed"] });
  }

  assert.deepEqual(ordered, [
    ["todo", "custom", "completed"],
    ["todo", "custom", "completed"],
    ["todo", "custom", "completed"]
  ]);
});

test("instance service dispatches all active columns to the canonical board-instance RPC", async () => {
  const calls = [];
  const service = BoardReadService.createInstanceService({
    boardInstanceId: "worktodo-instance",
    gateway: {
      async select(table) {
        assert.equal(table, "board_instances");
        return [{ id: "worktodo-instance", active: true, template_key: "c", legacy_application_scope: "worktodo" }];
      },
      async rpc(name, args) {
        calls.push({ name, args });
        return { updated: args.p_workspace_ids.length, board_instance_id: "worktodo-instance" };
      }
    }
  });

  await service.reorderWorkspaces(["worktodo-first", "worktodo-custom", "worktodo-completed"]);

  assert.deepEqual(calls, [{
    name: "board_instance_reorder_workspaces",
    args: { p_workspace_ids: ["worktodo-first", "worktodo-custom", "worktodo-completed"] }
  }]);
});

test("Module C exposes reorder handles for every visible active workspace, including Completion and Procurement", () => {
  const runtime = read("shared/components/golden-master-runtime.js");
  const renderStart = runtime.indexOf("function renderWorkspaceColumns()");
  const renderEnd = runtime.indexOf("function renderBoard", renderStart);
  const renderBody = runtime.slice(renderStart, renderEnd);
  const bindStart = runtime.indexOf("const boardHandlers = {");
  const bindEnd = runtime.indexOf("if (root.ZhugeGoldenMaster?.bindBoard", bindStart);
  const bindBody = runtime.slice(bindStart, bindEnd);

  assert.ok(renderStart >= 0 && renderEnd > renderStart);
  assert.match(renderBody, /reorderable:\s*!state\.readOnly/);
  assert.doesNotMatch(renderBody, /reorderable:[^,\n]*(?:completion|legacyTerminal|procurement)/);
  assert.match(bindBody, /canReorderColumn:[\s\S]*?isMainBoardWorkspace\(workspace\)/);
  assert.doesNotMatch(bindBody, /canReorderColumn:[\s\S]*?isCompletionWorkspace\(workspace\)/);
  assert.match(runtime, /const cInstanceRuntime = \["c", "ai_board", "procurement"\]\.includes\(state\.applicationScope\) \|\| state\.applicationScope === "worktodo"/);
});

test("shared drag ordering correctly moves columns both directions, including Completion", () => {
  const context = {
    ZhugeBoardReadService: {},
    ZhugeModuleCWorkspaceOrderingAuthority: WorkspaceOrderingAuthority,
    document: { readyState: "loading", addEventListener() {} },
    console,
    setTimeout,
    clearTimeout
  };
  context.window = context;
  vm.runInNewContext(read("shared/components/golden-master-runtime.js"), context);

  const workspaces = ["todo", "new-a", "new-b", "completed"].map((id, index) => ({
    id,
    key: id === "completed" ? "completed" : id,
    active: true,
    sortOrder: (index + 1) * 10
  }));
  const ids = (source, target) => context.ZhugeBoardRuntime
    .computeWorkspaceDropOrder(workspaces, source, target)
    .map(workspace => workspace.id);

  assert.deepEqual(ids("todo", "completed"), ["new-a", "new-b", "todo", "completed"]);
  assert.deepEqual(ids("completed", "todo"), ["completed", "todo", "new-a", "new-b"]);
  assert.deepEqual(ids("new-a", "new-b"), ["todo", "new-a", "new-b", "completed"]);
  assert.deepEqual(ids("new-b", "new-a"), ["todo", "new-b", "new-a", "completed"]);

  const completionInMiddle = ["todo", "new-a", "completed", "new-b"].map((id, index) => ({
    id,
    key: id === "completed" ? "completed" : id,
    active: true,
    sortOrder: (index + 1) * 10
  }));
  assert.deepEqual(
    context.ZhugeBoardRuntime.computeWorkspaceDropOrder(completionInMiddle, "completed", "new-b", "after").map(workspace => workspace.id),
    ["todo", "new-a", "new-b", "completed"]
  );
  assert.deepEqual(
    context.ZhugeBoardRuntime.computeWorkspaceDropOrder(completionInMiddle, "todo", "new-a", "after").map(workspace => workspace.id),
    ["new-a", "todo", "completed", "new-b"]
  );
});

test("canonical SQL validates the complete instance order and preserves WorkTodo's guarded identity boundary", () => {
  const normalized = migration.replace(/\s+/g, " ").toLowerCase();

  assert.match(normalized, /create or replace function public\.board_instance_reorder_workspaces\(\s*p_workspace_ids uuid\[\]\s*\)/);
  assert.match(normalized, /public\.board_instance_can_write\(v_instance\)/);
  assert.match(normalized, /count\(distinct supplied\.id\)/);
  assert.match(normalized, /board_instance_id = v_instance and active = true/);
  assert.match(normalized, /application_scope = 'worktodo'/);
  assert.match(normalized, /set_config\('zhuge\.worktodo_workspace_write', '1', true\)/);
  assert.match(normalized, /set_config\(\s*'zhuge\.worktodo_workspace_write',\s*coalesce\(v_previous_worktodo_guard, ''\),\s*true\s*\)/);
  assert.match(normalized, /set sort_order = v_order, updated_by = auth\.uid\(\), updated_at = now\(\)/);
  assert.doesNotMatch(normalized, /set [^;]*(?:name|workspace_key|application_scope|owner_uuid)\s*=/);
  assert.match(normalized, /revoke all on function public\.board_instance_reorder_workspaces\(uuid\[\]\) from public, anon, service_role/);
  assert.match(normalized, /grant execute on function public\.board_instance_reorder_workspaces\(uuid\[\]\) to authenticated/);
  assert.doesNotMatch(normalized, /\b(insert into|delete from) public\.(board_tasks|board_workspaces)/);
});

test("all visible, newly-created, system, and Completion workspaces remain in the shared sortable set", () => {
  const runtime = read("shared/components/golden-master-runtime.js");
  const service = read("shared/board/board-read-service.js");
  const normalized = auditMigration.replace(/\s+/g, " ").toLowerCase();

  assert.match(runtime, /reorderable:\s*!state\.readOnly/);
  assert.match(runtime, /function workspaceOrderAfterDrop\(/);
  assert.match(service, /async function instanceReorderWorkspaces\(/);
  assert.match(service, /board_instance_reorder_workspaces/);
  assert.match(normalized, /where workspace\.board_instance_id = v_instance and workspace\.active = true/);
  assert.match(normalized, /sort_order = v_order/);
  assert.match(normalized, /v_order := v_order \+ 10/);
  assert.match(normalized, /workspace_ids', v_ordered_ids/);
});

test("successful canonical reorder emits before/after audit and returns its audit identity", () => {
  const normalized = auditMigration.replace(/\s+/g, " ").toLowerCase();

  assert.match(normalized, /insert into public\.engineering_activity_log/);
  assert.match(normalized, /'board_instance', v_instance::text, 'workspace_order_changed'/);
  assert.match(normalized, /'workspaces', v_before_workspaces/);
  assert.match(normalized, /'workspace_ids', v_ordered_ids, 'workspaces', v_after_workspaces/);
  assert.match(normalized, /auth\.uid\(\), 'human', 'qjc', 'system_activity'/);
  assert.match(normalized, /returning id into v_audit_id/);
  assert.match(normalized, /'audit_id', v_audit_id/);
});

test("workspace reorder audit read-back is scoped to canonical board-instance authorization", () => {
  const normalized = auditMigration.replace(/\s+/g, " ").toLowerCase();

  assert.match(normalized, /create policy engineering_activity_board_instance_read/);
  assert.match(normalized, /entity_type = 'board_instance'/);
  assert.match(normalized, /then public\.board_instance_can_read\(entity_id::uuid\)/);
  assert.match(normalized, /to authenticated/);
});

test("reorder migration does not relax workspace deletion or identity protections", () => {
  const normalized = auditMigration.replace(/\s+/g, " ").toLowerCase();
  const identityGuard = read("docs/supabase/20260826_custom_workspace_delete.sql").toLowerCase();
  const deleteAuthority = read("docs/supabase/20260902_workspace_delete_non_completion.sql").toLowerCase();

  assert.match(identityGuard, /worktodo workspace identity is immutable/);
  assert.match(deleteAuthority, /completion workspace/);
  assert.doesNotMatch(normalized, /drop trigger|create or replace function public\.enforce_worktodo_workspace_scope/);
  assert.doesNotMatch(normalized, /delete from public\.board_workspaces|drop policy[^;]*board_workspaces/);
  const updateSetClause = normalized.match(/update public\.board_workspaces set (.*?) where id = v_workspace_id/);
  assert.ok(updateSetClause, "canonical reorder contains its expected scoped workspace update");
  assert.match(updateSetClause[1], /sort_order = v_order/);
  assert.doesNotMatch(updateSetClause[1], /(?:workspace_key|application_scope|owner_uuid|active)\s*=/);
});
