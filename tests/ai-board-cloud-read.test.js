const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

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

test("TASK-022 QJC drag planning follows the controlled workflow and keeps the receiver explicit", () => {
  const ready = BoardRead.normalizeTask({ status: "ready", assignee: "Co" });
  const start = BoardRead.planTransition(ready, "progress");
  assert.deepEqual(
    { allowed: start.allowed, status: start.status, assignee: start.assignee, targetWorkspace: start.targetWorkspace },
    { allowed: true, status: "inprogress", assignee: "Co", targetWorkspace: "progress" }
  );

  const inProgress = BoardRead.normalizeTask({ status: "inprogress", assignee: "Co" });
  const rollback = BoardRead.planTransition(inProgress, "todo");
  assert.deepEqual(
    { allowed: rollback.allowed, status: rollback.status, assignee: rollback.assignee, targetWorkspace: rollback.targetWorkspace },
    { allowed: true, status: "ready", assignee: "Co", targetWorkspace: "todo" }
  );
  assert.match(rollback.action, /退回/);
  const handoff = BoardRead.planTransition(inProgress, "qa");
  assert.equal(handoff.status, "qa");
  assert.equal(handoff.assignee, "GPT");

  const gptQa = BoardRead.normalizeTask({ status: "qa", assignee: "GPT" });
  assert.equal(BoardRead.planTransition(gptQa, "qa").assignee, "QJC");
  assert.equal(BoardRead.planTransition(gptQa, "progress").assignee, "Co");
  assert.equal(BoardRead.planTransition(gptQa, "done").allowed, false);

  const qjcQa = BoardRead.normalizeTask({ status: "qa", assignee: "QJC" });
  assert.equal(BoardRead.planTransition(qjcQa, "done").status, "done");
  assert.equal(BoardRead.planTransition(qjcQa, "todo").allowed, false);
  assert.match(BoardRead.planTransition(qjcQa, "todo").reason, /只能依序/);

  const completed = BoardRead.normalizeTask({ status: "done", assignee: "QJC" });
  assert.equal(BoardRead.availableTransitions(completed).length, 0);
});

test("shared completion gate requires Co and QJC evidence, not GPT checkbox", () => {
  const coPass = { id: "co", stage: "co", required: true, state: "pass", evidenceNote: "Co Developer QA PASS" };
  const qjcPass = { id: "qjc", stage: "qjc", required: true, state: "pass", evidenceNote: "QJC PM QA PASS" };
  const gptPending = { id: "gpt", stage: "gpt", required: true, state: "not_verified", evidenceNote: "" };
  const gate = BoardRead.completionGateStatus([coPass, qjcPass, gptPending]);
  assert.equal(gate.allowed, true, "GPT engineering review is not a QJC completion checkbox");
  assert.deepEqual(gate.required.map(item => item.id), ["co", "qjc"]);
  assert.equal(gptPending.state, "not_verified", "historical/current GPT evidence must not be fabricated");
});

test("completion gate blocks failed or missing Co/QJC evidence and keeps done immutable", () => {
  const coPass = { stage: "co", required: true, state: "pass", evidenceNote: "Co PASS" };
  const qjcPass = { stage: "qjc", required: true, state: "pass", evidenceNote: "QJC PASS" };
  const qjcFail = { stage: "qjc", required: true, state: "fail", evidenceNote: "QJC FAIL" };
  const coMissing = { stage: "co", required: true, state: "not_verified", evidenceNote: "" };
  assert.equal(BoardRead.completionGateStatus([coPass, qjcFail]).allowed, false);
  assert.equal(BoardRead.completionGateStatus([coMissing, qjcPass]).allowed, false);
  assert.equal(BoardRead.planTransition(BoardRead.normalizeTask({ status: "done", assignee: "QJC" }), "done").allowed, false);
});

test("Case D/E: QJC PASS permits both the drag and button transition to Done", () => {
  const task = BoardRead.normalizeTask({ status: "qa", assignee: "QJC" });
  const coPass = { stage: "co", required: true, state: "pass", evidenceNote: "Co PASS" };
  const qjcPass = { stage: "qjc", required: true, state: "pass", evidenceNote: "QJC PASS" };
  const gptPending = { stage: "gpt", required: true, state: "not_verified" };
  assert.equal(BoardRead.completionGateStatus([coPass, qjcPass, gptPending]).allowed, true);
  const donePlan = BoardRead.planTransition(task, "done");
  assert.equal(donePlan.allowed, true);
  assert.equal(donePlan.action, "PM QA 通過 → 完成");
});

test("Case F: historical GPT evidence is retained without becoming a completion gate", () => {
  const gptEvidence = { id: "gpt-history", stage: "gpt", required: true, state: "pass", evidenceNote: "GPT Review PASS — retained audit" };
  const gate = BoardRead.completionGateStatus([
    { stage: "co", required: true, state: "pass", evidenceNote: "Co PASS" },
    { stage: "qjc", required: true, state: "pass", evidenceNote: "QJC PASS" },
    gptEvidence
  ]);
  assert.equal(gate.allowed, true);
  assert.equal(gate.required.some(item => item.id === "gpt-history"), false);
  assert.equal(gptEvidence.evidenceNote, "GPT Review PASS — retained audit");
});

test("QJC completion button and drag use the same controlled transition contract", () => {
  const runtime = read("app/Board/ai/board-runtime.js");
  assert.match(runtime, /transitionTask\(task, target\)/);
  assert.match(runtime, /QJC 拖曳交接/);
  assert.match(runtime, /GPT 工程審查紀錄會保留，但不列入 QJC 完成 Gate/);
  assert.match(runtime, /completionGateStatus/);
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
  assert.equal(BoardRead.normalizeTask({ problem: "要解決的問題", objective: "要完成的目標", acceptance_criteria: "完成判定" }).problem, "要解決的問題");
  assert.equal(BoardRead.normalizeTask({ problem: "要解決的問題", objective: "要完成的目標", acceptance_criteria: "完成判定" }).acceptanceCriteria, "完成判定");
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
      return [];
    }
  };
  try {
    const result = await BoardRead.load({
      gateway,
      engineeringMemory: {
        status: "ready",
        records: [{ knowledgeCode: "PRINCIPLE-001", knowledgeType: "principle", title: "PM 決策權", summary: "", content: "", version: "1", updatedAt: null }],
        failures: []
      }
    });
    assert.equal(result.readOnly, false);
    assert.match(result.source, /Canonical Engineering Memory Resolver/);
    assert.equal(result.tasks[0].workspace, "progress");
    assert.equal(result.tasks[0].assignee, "Co");
    assert.equal(result.tasks[0].usageScenario, "Co 執行並交給 GPT Review。");
    assert.deepEqual(result.principles.map(item => item.code), ["PRINCIPLE-001"]);
    assert.deepEqual(calls.map(call => call.table), ["board_tasks"]);
    assert.match(calls[0].query, /select=/);
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
  // AI Board is an engineering/admin destination reached from the Control
  // Console, not a general-user Dashboard launcher card.
  assert.doesNotMatch(read("app/dashboard/zhuge-dashboard.js"), /data-root-module-card="ai-board"/);
  assert.match(read("modules/worklog/worklog-app.js"), /control-center-entry/);
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
  assert.match(runtime, /開發契約與驗收清單/);
  assert.match(index, /id="boardSearch"/);
  assert.match(index, /id="taskUsageScenario"/);
  assert.match(index, /新增工作區/);
  assert.match(index, /workspaceCreateDrawer/);
  assert.doesNotMatch(index, /Interactive Prototype v0\.9/);
});

test("AI Board sorts valid TASK codes numerically and keeps invalid codes in stable fallback order", () => {
  const runtime = read("app/Board/ai/board-runtime.js");
  const context = {
    ZhugeBoardReadService: {},
    document: { readyState: "loading", addEventListener() {} }
  };
  context.window = context;
  vm.runInNewContext(runtime, context, { filename: "board-runtime.js" });
  const sorted = context.ZhugeBoardRuntime.sortTasksByCode([
    { workCode: "TASK-002", id: "two" },
    { workCode: "TASK-010", id: "ten" },
    { workCode: "TASK-003", id: "three" },
    { workCode: "LEGACY", id: "legacy-a" },
    { id: "missing" },
    { workCode: "LEGACY", id: "legacy-b" }
  ]);
  assert.deepEqual(sorted.map(task => task.id), ["two", "three", "ten", "legacy-a", "missing", "legacy-b"]);
});
