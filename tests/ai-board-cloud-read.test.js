const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const BoardRead = require("../shared/board/board-read-service.js");

const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("AI Board canonical status vocabulary maps to the four approved workspaces", () => {
  assert.deepEqual(
    ["ready", "inprogress", "qa", "done"].map(BoardRead.normalizeStatus),
    ["ready", "inprogress", "qa", "done"]
  );
  assert.equal(BoardRead.normalizeStatus("progress"), "inprogress");
  assert.equal(BoardRead.workspaceForStatus("inprogress").uiKey, "progress");
  assert.deepEqual(
    BoardRead.STATUS_WORKSPACES.map(item => item.label),
    ["待辦", "推進", "驗證", "完成"]
  );
});

test("Board read adapter normalizes task ownership and keeps principles separate", () => {
  const task = BoardRead.normalizeTask({
    id: "task-1",
    work_code: "TASK-001",
    title: "正式讀取",
    status: "qa",
    assignee: "GPT",
    objective: "驗證 Cloud Read",
    usage_scenario: "GPT 先讀取正式來源，再由 QJC 驗收。"
  });
  assert.equal(task.workCode, "TASK-001");
  assert.equal(task.status, "qa");
  assert.equal(task.workspace, "qa");
  assert.equal(task.assignee, "GPT");
  assert.equal(task.usageScenario, "GPT 先讀取正式來源，再由 QJC 驗收。");
  assert.equal(BoardRead.normalizeTask({ usage_scenario: null }).usageScenario, "");
  assert.equal(BoardRead.isPrinciple({ knowledge_type: "approved_principle" }), true);
  assert.equal(BoardRead.isPrinciple({ knowledge_type: "task" }), false);
});

test("formal Board load reads tasks and approved principles through the injected shared gateway", async () => {
  const previousSnapshot = global.getSharedSessionSnapshot;
  global.getSharedSessionSnapshot = () => ({ user_id: USER_ID, email: "qjc@example.com", isAuthenticated: true });
  const calls = [];
  const gateway = {
    select: async (table, query) => {
      calls.push({ table, query });
      if (table === "board_tasks") return [{ id: "1", title: "TASK-001", status: "inprogress", assignee: "Co", usage_scenario: "Co 執行並交給 GPT Review。" }];
      if (table === "engineering_knowledge") return [
        { knowledge_code: "PRINCIPLE-001", knowledge_type: "principle", title: "PM 決策權", status: "approved" },
        { knowledge_code: "TASK-001", knowledge_type: "task", title: "不要混入 TASK" }
      ];
      return [];
    }
  };
  try {
    const result = await BoardRead.load({ gateway });
    assert.equal(result.readOnly, false);
    assert.equal(result.source, "Supabase Shared Data Gateway");
    assert.equal(result.tasks[0].workspace, "progress");
    assert.equal(result.tasks[0].assignee, "Co");
    assert.equal(result.tasks[0].usageScenario, "Co 執行並交給 GPT Review。");
    assert.deepEqual(result.principles.map(item => item.code), ["PRINCIPLE-001"]);
    assert.deepEqual(calls.map(call => call.table), ["board_tasks", "engineering_knowledge"]);
    assert.match(calls[0].query, /select=/);
    assert.match(calls[1].query, /status=/);
  } finally {
    if (previousSnapshot) global.getSharedSessionSnapshot = previousSnapshot;
    else delete global.getSharedSessionSnapshot;
  }
});

test("Board entry loads Shared runtime and read adapter, not legacy prototype runtime", () => {
  const index = read("app/Board/ai/index.html");
  assert.match(index, /shared\/board\/board-read-service\.js/);
  assert.match(index, /\.\/board-runtime\.js/);
  assert.doesNotMatch(index, /<script[^>]+app\.js/);
  assert.doesNotMatch(index, /TASK-014|TASK-016|PRINCIPLE-001/);
  assert.match(read("app/dashboard/zhuge-dashboard.js"), /data-root-module-card="ai-board"/);
});

test("Board runtime uses controlled workflow RPCs and clears prototype fixtures before Cloud Read", () => {
  const runtime = read("app/Board/ai/board-runtime.js");
  const index = read("app/Board/ai/index.html");
  assert.match(runtime, /controlled RPC writes/);
  assert.match(runtime, /Realtime/);
  assert.match(runtime, /renderPrinciples\(\[\]\)/);
  assert.match(runtime, /renderTasks\(\[\]\)/);
  assert.doesNotMatch(runtime, /\.(insert|update|delete)\s*\(/);
  assert.doesNotMatch(runtime, /board_tasks.*(?:INSERT|UPDATE|DELETE)/i);
  assert.match(runtime, /usageScenario/);
  assert.match(runtime, /Development Contract／PM QA Checklist/);
  assert.match(index, /id="boardSearch"/);
  assert.match(index, /id="taskUsageScenario"/);
  assert.doesNotMatch(index, /新增工作區/);
  assert.doesNotMatch(index, /Interactive Prototype v0\.9/);
});
