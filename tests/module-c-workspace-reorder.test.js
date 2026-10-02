const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const BoardReadService = require("../shared/board/board-read-service.js");
const Adapters = require("../shared/components/task-action-adapters.js");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const migration = read("supabase/migrations/20261002041546_c_shared_workspace_reorder_guard.sql");

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
});

test("shared drag ordering correctly moves columns both directions, including Completion", () => {
  const context = {
    ZhugeBoardReadService: {},
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
