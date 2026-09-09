const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const BoardRead = require("../shared/board/board-read-service.js");

const runtime = fs.readFileSync(path.join(__dirname, "../shared/components/golden-master-runtime.js"), "utf8");
function sourceFunction(name, nextName) {
  const start = runtime.indexOf(`  function ${name}(`);
  const end = runtime.indexOf(`  function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start);
  return runtime.slice(start, end);
}

// Execute the production selection/rendering functions, without starting auth,
// subscriptions or the Cloud completion reconciliation performed by app startup.
function harness(workspaces, applicationScope = "ai_board", boardInstanceId = "board") {
  const banners = [];
  const columns = workspaces.map(workspace => {
    const cards = { innerHTML: "", replaceChildren() { this.innerHTML = ""; } };
    const count = { textContent: "" };
    return {
      dataset: { workspaceId: workspace.id }, cards, count,
      querySelector(selector) { return selector.includes("cards") ? cards : count; }
    };
  });
  const context = vm.createContext({
    state: { workspaces, applicationScope, boardInstanceId },
    document: { querySelectorAll: () => columns },
    renderWorkspaceColumns() {}, wireTaskCards() {},
    isArchiveTask: BoardRead.isArchiveTask,
    sortTasksForDisplay: rows => rows.slice(),
    taskMarkup: task => `[${task.id}]`,
    setBanner: (message, kind) => banners.push({ message, kind }),
    boardTaskPrefix: () => "test",
    defaultBoardWorkspaceKey() { throw new Error("Rendering must not choose a fallback workspace"); }
  });
  vm.runInContext(sourceFunction("isMainBoardWorkspace", "isWorkspaceDeletable")
    + sourceFunction("renderTasks", "visibleTasks"), context);
  return { context, columns, banners };
}
const workspace = (id, key, extra = {}) => BoardRead.normalizeWorkspace({
  id, workspace_key: key, name: key, active: true,
  application_scope: "ai_board", board_instance_id: "board", ...extra
});
const task = (id, workspaceId, extra = {}) => BoardRead.normalizeTask({
  id, workspace_id: workspaceId, status: "qa", assignee: "GPT", ...extra
});

test("every active Cloud workspace including GPT and renamed/custom rows remains visible", () => {
  const rows = [workspace("todo", "todo"), workspace("gpt", "gpt"),
    workspace("qjc", "qjc"), workspace("custom", "", { name: "新工作區" }),
    workspace("done", "done"), workspace("inactive", "gpt", { active: false }),
    workspace("archived", "custom", { archived_at: "2026-01-01T00:00:00Z" })];
  const { context } = harness(rows);
  assert.deepEqual(rows.filter(context.isMainBoardWorkspace).map(row => row.id), ["todo", "gpt", "qjc", "custom", "done"]);
});

test("Cloud UUID alone places cards; status and assignee do not select another workspace", () => {
  const { context, columns, banners } = harness([workspace("todo", "todo"), workspace("gpt", "gpt"), workspace("qjc", "qjc")]);
  const tasks = Object.freeze([
    task("gpt-task", "gpt"), task("qjc-task", "qjc"),
    task("todo-task", "todo", { status: "inprogress", assignee: "Co" })
  ]);
  const before = JSON.stringify(tasks);
  context.renderTasks(tasks);
  assert.deepEqual(columns.map(column => column.cards.innerHTML), ["[todo-task]", "[gpt-task]", "[qjc-task]"]);
  assert.deepEqual(columns.map(column => column.count.textContent), ["1", "1", "1"]);
  assert.equal(JSON.stringify(tasks), before);
  assert.equal(banners.length, 0);
  context.renderTasks(tasks); // Cloud read-back/re-render must retain placement.
  assert.equal(columns[1].cards.innerHTML, "[gpt-task]");
});

test("unknown, inactive and missing workspace IDs fail visibly without moving cards to todo", () => {
  const { context, columns, banners } = harness([workspace("todo", "todo"), workspace("inactive", "custom", { active: false })]);
  context.renderTasks([task("missing", "unknown"), task("empty", ""), task("inactive-task", "inactive")]);
  assert.equal(columns[0].count.textContent, "0");
  assert.doesNotMatch(columns[0].cards.innerHTML, /\[(missing|empty|inactive-task)\]/);
  assert.equal(banners.length, 1);
  assert.equal(banners[0].kind, "error");
  assert.match(banners[0].message, /3 張卡片/);
  assert.match(banners[0].message, /未將卡片移到其他工作區/);
});

test("archived/cancelled tasks remain excluded and do not trigger phantom placement", () => {
  const { context, columns, banners } = harness([workspace("todo", "todo")]);
  context.renderTasks([
    task("archived", "gone", { archived_at: "2026-01-01T00:00:00Z" }),
    task("cancelled", "gone", { status: "cancelled" })
  ]);
  assert.equal(columns[0].count.textContent, "0");
  assert.equal(banners.length, 0);
});

test("existing C instance and WorkTodo/GAS scope boundaries remain enforced", () => {
  const rows = [workspace("own", "test-todo"), workspace("other", "test-todo", { board_instance_id: "other-board" }),
    workspace("work", "worktodo-todo", { application_scope: "worktodo", board_instance_id: "work-board" }),
    workspace("gas", "gas-todo", { application_scope: "procurement", board_instance_id: "gas-board" })];
  assert.deepEqual(rows.filter(harness(rows, "c").context.isMainBoardWorkspace).map(row => row.id), ["own"]);
  assert.deepEqual(rows.filter(harness(rows, "worktodo").context.isMainBoardWorkspace).map(row => row.id), ["work"]);
  assert.deepEqual(rows.filter(harness(rows, "procurement").context.isMainBoardWorkspace).map(row => row.id), ["gas"]);
});

test("the uncalled sequential planner is retired, not retained as a competing workflow", () => {
  const source = fs.readFileSync(path.join(__dirname, "../shared/board/board-read-service.js"), "utf8");
  assert.doesNotMatch(source, /QJC_TRANSITIONS|function planTransition|function availableTransitions/);
  assert.equal(BoardRead.planTransition, undefined);
  assert.equal(BoardRead.availableTransitions, undefined);
  assert.equal(BoardRead.lifecycle.contract.id, "module-c-lifecycle-acceptance-v1");
  assert.equal(typeof BoardRead.lifecycle.reconcileWorkspaceDecision, "function");
});
