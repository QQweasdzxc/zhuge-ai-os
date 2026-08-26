const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const Adapters = require("../shared/components/task-action-adapters.js");
const Contract = require("../shared/components/task-action-contract.js");

function createChecklistHarness() {
  const rows = [];
  const calls = [];
  const legacyCalls = [];
  const service = {
    async loadTaskChecklist(taskId) {
      calls.push({ name: "loadTaskChecklist", taskId });
      return rows.filter(row => row.task_id === taskId).map(row => ({ ...row }));
    },
    async addTaskChecklistItem(input) {
      calls.push({ name: "board_add_task_checklist_item", input: { ...input } });
      const item = {
        id: `check-${rows.length + 1}`,
        task_id: input.taskId,
        label: input.label,
        completed: false,
        sort_order: Number(input.sortOrder || 0)
      };
      rows.push(item);
      return { ...item };
    },
    async updateTaskChecklistItem(input) {
      calls.push({ name: "board_update_task_checklist_item", input: { ...input } });
      const item = rows.find(row => row.id === input.id);
      assert.ok(item, "canonical update must find the checklist item");
      if (Object.prototype.hasOwnProperty.call(input, "label") && input.label != null) item.label = input.label;
      if (Object.prototype.hasOwnProperty.call(input, "completed") && input.completed != null) item.completed = Boolean(input.completed);
      if (Object.prototype.hasOwnProperty.call(input, "sortOrder") && input.sortOrder != null) item.sort_order = Number(input.sortOrder);
      return { ...item };
    },
    async deleteTaskChecklistItem(itemId) {
      calls.push({ name: "board_delete_task_checklist_item", itemId });
      const index = rows.findIndex(row => row.id === itemId);
      assert.notEqual(index, -1, "canonical delete must find the checklist item");
      rows.splice(index, 1);
      return { success: true, item_id: itemId };
    }
  };
  const dataService = {
    async loadWorkTodoTaskAttachments(taskId) {
      calls.push({ name: "loadWorkTodoTaskAttachments", taskId });
      return [];
    },
    async loadWorkTodoTaskCapabilities() {
      legacyCalls.push("loadWorkTodoTaskCapabilities");
      throw new Error("formal WorkTodo Checklist must not call the legacy aggregate");
    },
    async addWorkTodoChecklistItem() {
      legacyCalls.push("addWorkTodoChecklistItem");
      throw new Error("formal WorkTodo Checklist must not call the legacy add RPC");
    },
    async updateWorkTodoChecklistItem() {
      legacyCalls.push("updateWorkTodoChecklistItem");
      throw new Error("formal WorkTodo Checklist must not call the legacy update RPC");
    },
    async deleteWorkTodoChecklistItem() {
      legacyCalls.push("deleteWorkTodoChecklistItem");
      throw new Error("formal WorkTodo Checklist must not call the legacy delete RPC");
    }
  };
  return { rows, calls, legacyCalls, service, dataService };
}

async function exerciseChecklist(adapter) {
  const contract = Contract.create({ consumer: adapter.consumer, adapter });
  const taskId = "worktodo-task-1";
  const readChecklist = async () => adapter.consumer === "worktodo"
    ? (await contract.read("capabilities", { taskId })).checklist
    : await contract.read("checklist", { taskId });
  const initial = await readChecklist();
  assert.deepEqual(initial, []);

  const added = await contract.execute("addChecklist", { taskId, label: "確認 canonical Checklist", sortOrder: 0 });
  const afterAddReload = await readChecklist();
  assert.equal(afterAddReload.length, 1);
  assert.equal(afterAddReload[0].label, "確認 canonical Checklist");

  await contract.execute("updateChecklist", { taskId, id: added.id, completed: true });
  const afterToggleReload = await readChecklist();
  assert.equal(afterToggleReload[0].completed, true);

  await contract.execute("deleteChecklist", { taskId, id: added.id });
  const afterDeleteReload = await readChecklist();
  assert.deepEqual(afterDeleteReload, []);
}

test("WorkTodo formal Checklist uses canonical Board path for Add → Reload → Toggle → Reload → Delete → Reload", async () => {
  const harness = createChecklistHarness();
  const adapter = Adapters.createWorkTodoAdapter({
    task: { id: "worktodo-task-1" },
    service: harness.service,
    dataService: harness.dataService,
    repository: {}
  });

  await exerciseChecklist(adapter);

  assert.deepEqual(harness.calls.map(call => call.name), [
    "loadTaskChecklist", "loadWorkTodoTaskAttachments",
    "board_add_task_checklist_item",
    "loadTaskChecklist", "loadWorkTodoTaskAttachments",
    "board_update_task_checklist_item",
    "loadTaskChecklist", "loadWorkTodoTaskAttachments",
    "board_delete_task_checklist_item",
    "loadTaskChecklist", "loadWorkTodoTaskAttachments"
  ]);
  assert.deepEqual(harness.legacyCalls, []);
});

test("AI Board Checklist keeps the same canonical Board service operations", async () => {
  const harness = createChecklistHarness();
  const adapter = Adapters.createAiBoardAdapter({ task: { id: "ai-task-1" }, service: harness.service });

  await exerciseChecklist(adapter);

  assert.deepEqual(harness.calls.map(call => call.name), [
    "loadTaskChecklist",
    "board_add_task_checklist_item",
    "loadTaskChecklist",
    "board_update_task_checklist_item",
    "loadTaskChecklist",
    "board_delete_task_checklist_item",
    "loadTaskChecklist"
  ]);
});

test("Formal WorkTodo adapter has no legacy Checklist action or aggregate mapping", () => {
  const source = read("shared/components/task-action-adapters.js");
  const worktodo = source.match(/function createWorkTodoAdapter[\s\S]*?\n  function create\(/)?.[0] || "";
  assert.match(worktodo, /addChecklist: payload => required\(service, "addTaskChecklistItem"\)/);
  assert.match(worktodo, /updateChecklist: payload => required\(service, "updateTaskChecklistItem"\)/);
  assert.match(worktodo, /deleteChecklist: payload => required\(service, "deleteTaskChecklistItem"\)/);
  assert.match(worktodo, /required\(service, "loadTaskChecklist"\)/);
  assert.doesNotMatch(worktodo, /addWorkTodoChecklistItem|updateWorkTodoChecklistItem|deleteWorkTodoChecklistItem|loadWorkTodoTaskCapabilities/);
});

test("Checklist Cloud migration artifact is limited to the three existing RPC authorization guards", () => {
  const sql = read("docs/supabase/20260826_worktodo_task_checklist_canonical.sql");
  const executableSql = sql.replace(/--.*$/gm, "");
  for (const functionName of [
    "board_add_task_checklist_item",
    "board_update_task_checklist_item",
    "board_delete_task_checklist_item"
  ]) assert.match(sql, new RegExp(`create or replace function public\\.${functionName}`, "i"));
  assert.match(sql, /application_scope = 'ai_board'[\s\S]*is_engineering_member\(array\['owner'\]\)/i);
  assert.match(sql, /application_scope = 'worktodo'[\s\S]*owner_uuid is distinct from auth\.uid\(\)/i);
  assert.doesNotMatch(executableSql, /create table|alter table|create policy|drop policy|storage\.objects|grant |revoke /i);
  assert.doesNotMatch(executableSql, /worktodo_checklist_items|user_tasks|worktodo_.*checklist_item/i);
});
