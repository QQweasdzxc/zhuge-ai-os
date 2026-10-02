const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const authority = require("../shared/board/workspace-ordering-authority.js");

function workspaces() {
  return [
    { id: "todo", key: "todo", name: "待開始", active: true, sortOrder: 10 },
    { id: "system", key: "system", name: "系統", active: true, sortOrder: 20 },
    { id: "new", key: "new-workspace", name: "新工作區", active: true, sortOrder: 30 },
    { id: "done", key: "worktodo-completed", name: "完成", active: true, sortOrder: 40 }
  ];
}

test("Every visible Module C workspace supports first, middle, and last placement", () => {
  const rows = workspaces();
  assert.deepEqual(
    authority.buildReorderedOrder(rows, "done", "todo", "before").workspaceIds,
    ["done", "todo", "system", "new"]
  );
  assert.deepEqual(
    authority.buildReorderedOrder(rows, "todo", "system", "after").workspaceIds,
    ["system", "todo", "new", "done"]
  );
  assert.deepEqual(
    authority.buildReorderedOrder(rows, "todo", "done", "after").workspaceIds,
    ["system", "new", "done", "todo"]
  );
});

test("system, newly-created, and completion workspaces are not protection-excluded", () => {
  const rows = workspaces();
  for (const [source, target] of [["system", "new"], ["new", "done"], ["done", "todo"]]) {
    const plan = authority.buildReorderedOrder(rows, source, target, "after");
    assert.equal(plan.workspaceIds.includes(source), true);
    assert.equal(plan.workspaceIds.length, rows.length);
    assert.deepEqual(new Set(plan.workspaceIds), new Set(rows.map(row => row.id)));
  }
});

test("completion workspace can move from last to first, first to middle, and middle to last", () => {
  const rows = workspaces();
  assert.deepEqual(
    authority.buildReorderedOrder(rows, "done", "todo", "before").workspaceIds,
    ["done", "todo", "system", "new"]
  );
  assert.deepEqual(
    authority.buildReorderedOrder(rows, "done", "system", "after").workspaceIds,
    ["todo", "system", "done", "new"]
  );
  assert.deepEqual(
    authority.buildReorderedOrder(rows, "done", "new", "after").workspaceIds,
    ["todo", "system", "new", "done"]
  );
});

test("full order validation rejects duplicate, missing, and cross-board ids", () => {
  const rows = workspaces();
  assert.throws(
    () => authority.validateFullOrder(rows, ["todo", "system", "system", "done"]),
    error => error.code === "WORKSPACE_ORDER_DUPLICATE"
  );
  assert.throws(
    () => authority.validateFullOrder(rows, ["todo", "system", "done"]),
    error => error.code === "WORKSPACE_ORDER_INCOMPLETE"
  );
  assert.throws(
    () => authority.validateFullOrder(rows, ["todo", "system", "new", "other"]),
    error => error.code === "WORKSPACE_ORDER_INCOMPLETE"
  );
});

test("ordering delegates persistence, reloads canonical rows, and does not fabricate audit", async () => {
  const rows = workspaces();
  let persisted = null;
  let reloadCount = 0;
  const result = await authority.reorder({
    workspaces: rows,
    draggedId: "done",
    targetId: "todo",
    placement: "before",
    persist: workspaceIds => {
      persisted = workspaceIds;
      return { updated: workspaceIds.length, audit_id: 42 };
    },
    reload: () => {
      reloadCount += 1;
      return authority.normalizeOrder(persisted.map(id => rows.find(row => row.id === id)));
    }
  });
  assert.deepEqual(persisted, ["done", "todo", "system", "new"]);
  assert.deepEqual(result.workspaceIds, persisted);
  assert.equal(reloadCount, 1);
  assert.equal(Object.prototype.hasOwnProperty.call(authority, "audit"), false);
});

test("read-back mismatch is a hard failure", async () => {
  await assert.rejects(
    authority.reorder({
      workspaces: workspaces(),
      draggedId: "todo",
      targetId: "done",
      placement: "after",
      persist: async () => ({ updated: 4 }),
      reload: () => authority.normalizeOrder(workspaces())
    }),
    error => error.code === "WORKSPACE_REORDER_READBACK_MISMATCH"
  );
});

test("shared runtime uses the ordering authority and keeps protection separate", () => {
  const runtime = read("shared/components/golden-master-runtime.js");
  const board = read("shared/components/task-board.js");
  const sql = read("supabase/migrations/20261002193217_task_35_module_c_workspace_ordering_authority.sql");
  assert.match(runtime, /reorderable: !state\.readOnly && isMainBoardWorkspace\(workspace\)/);
  assert.match(runtime, /authority\.reorder\(/);
  assert.match(runtime, /resolveDropPlacement/);
  assert.match(runtime, /executeSharedTaskAction\(null, "reorderWorkspace"/);
  assert.match(runtime, /refreshBoard\(\{ quiet: true \}\)/);
  assert.doesNotMatch(runtime, /canReorderColumn: id =>[\s\S]{0,240}!isCompletionWorkspace\(workspace\)/);
  assert.match(board, /onColumnDrop\?\.\(\{ id, sourceId: event\.dataTransfer\.getData\(COLUMN_DRAG_TYPE\), column, event \}\)/);
  assert.match(board, /onCardDrop\?\.\(\{ id, cardId, column, event \}\)/);
  assert.match(sql, /module_c_workspace_ordering_authority/);
  assert.match(sql, /set_config\('zhuge\.module_c_workspace_ordering', '1', true\)/);
  assert.match(sql, /to_jsonb\(new\) - array\['sort_order', 'updated_by', 'updated_at'\]/);
  assert.match(sql, /workspace_order_changed/);
  assert.match(sql, /board_instance_reorder_workspaces/);
  assert.match(sql, /board_reorder_workspaces/);
  assert.match(sql, /WorkTodo completion workspace or uncontrolled delete is not allowed/);
  assert.match(sql, /WorkTodo workspace identity is immutable/);
});

test("all shared Module C entry points load one ordering authority", () => {
  for (const file of [
    "app/Board/ai/index.html",
    "app/Board/worktodo/index.html",
    "app/Board/procurement/index.html",
    "app/Board/template-preview/index.html"
  ]) {
    const html = read(file);
    const authorityScript = html.indexOf("workspace-ordering-authority.js");
    const runtimeScript = html.indexOf("golden-master-runtime.js");
    assert.ok(authorityScript >= 0 && authorityScript < runtimeScript, `${file} must load the shared authority before the runtime`);
  }
});
