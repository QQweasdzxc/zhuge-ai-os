const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const BoardRead = require("../shared/board/board-read-service.js");

const USER_ID = "550e8400-e29b-41d4-a716-446655440000";
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("AI Board keeps engineering status independent from Cloud workspace position", () => {
  assert.deepEqual(
    ["ready", "inprogress", "qa", "done"].map(BoardRead.normalizeStatus),
    ["ready", "inprogress", "qa", "done"]
  );
  assert.equal(BoardRead.normalizeStatus("progress"), "inprogress");
  assert.equal(BoardRead.statusDescriptorFor("inprogress").label, "推進中");
  assert.equal(BoardRead.normalizeTask({ status: "qa" }).workspace, "");
  assert.equal(BoardRead.normalizeTask({ status: "qa", workspace_id: "ws-1", workspace_key: "gpt", workspace_name: "GPT區" }).workspace, "gpt");
});

test("Archive read model derives only from existing done and terminal governance state", () => {
  assert.equal(BoardRead.isArchiveTask({ status: "done" }), true);
  assert.equal(BoardRead.isArchiveTask({ status: "merged" }), true);
  assert.equal(BoardRead.isArchiveTask({ status: "cancelled" }), true);
  assert.equal(BoardRead.isArchiveTask({ status: "ready" }), false);
  assert.equal(BoardRead.isArchiveTask({ status: "inprogress" }), false);
  assert.equal(BoardRead.isArchiveTask({ status: "qa" }), false);
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
  assert.equal(BoardRead.planTransition(qjcQa, "done").allowed, false);
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

test("Case D/E: QJC PASS uses the controlled acceptance path; workflow transition cannot bypass it", () => {
  const task = BoardRead.normalizeTask({ status: "qa", assignee: "QJC" });
  const coPass = { stage: "co", required: true, state: "pass", evidenceNote: "Co PASS" };
  const qjcPass = { stage: "qjc", required: true, state: "pass", evidenceNote: "QJC PASS" };
  const gptPending = { stage: "gpt", required: true, state: "not_verified" };
  assert.equal(BoardRead.completionGateStatus([coPass, qjcPass, gptPending]).allowed, true);
  const donePlan = BoardRead.planTransition(task, "done");
  assert.equal(donePlan.allowed, false);
  assert.match(donePlan.reason, /只能依序/);
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

test("AI Board workspace movement uses an independent controlled Cloud path", () => {
  const runtime = read("app/Board/ai/board-runtime.js");
  const sharedBoard = read("shared/components/task-board.js");
  assert.match(runtime, /moveTaskToWorkspace/);
  assert.match(sharedBoard, /application\/x-zhuge-shared-task-card/);
  assert.match(runtime, /ZhugeSharedTaskBoard/);
  assert.match(runtime, /工作區現在代表這張 TASK 的責任階段/);
  assert.doesNotMatch(runtime, /只能依序交給下一個工作階段/);
});

test("Board read adapter normalizes task ownership and keeps principles separate", () => {
  const task = BoardRead.normalizeTask({
    id: "task-1",
    work_code: "TASK-001",
    title: "正式讀取",
    status: "qa",
    assignee: "GPT",
    objective: "驗證 Cloud Read",
    usage_scenario: "GPT 先讀取正式來源，再由 QJC 驗收。",
    workspace_id: "workspace-gpt",
    workspace_key: "gpt",
    workspace_name: "GPT區"
  });
  assert.equal(task.workCode, "TASK-001");
  assert.equal(task.status, "qa");
  assert.equal(task.workspaceId, "workspace-gpt");
  assert.equal(task.workspace, "gpt");
  assert.equal(task.workspaceName, "GPT區");
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
      if (table === "board_workspaces") return [{ id: "workspace-co", workspace_key: "co", name: "Co區", sort_order: 20, active: true }];
      if (table === "board_tasks") return [{ id: "1", title: "TASK-001", status: "inprogress", assignee: "Co", workspace_id: "workspace-co", usage_scenario: "Co 執行並交給 GPT Review。" }];
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
    assert.equal(result.workspaces[0].name, "Co區");
    assert.equal(result.tasks[0].workspace, "co");
    assert.equal(result.tasks[0].workspaceName, "Co區");
    assert.equal(result.tasks[0].assignee, "Co");
    assert.equal(result.tasks[0].usageScenario, "Co 執行並交給 GPT Review。");
    assert.deepEqual(result.principles.map(item => item.code), ["PRINCIPLE-001"]);
    assert.deepEqual(new Set(calls.map(call => call.table)), new Set(["board_tasks", "board_workspaces"]));
    assert.ok(calls.every(call => /select=/.test(call.query)));
  } finally {
    if (previousSnapshot) global.getSharedSessionSnapshot = previousSnapshot;
    else delete global.getSharedSessionSnapshot;
  }
});

test("WorkTodo read and write adapters keep Application Scope and Owner UUID in the shared board layer", async () => {
  const previousSnapshot = global.getSharedSessionSnapshot;
  global.getSharedSessionSnapshot = () => ({ user_id: USER_ID, email: "owner@example.com", isAuthenticated: true });
  const calls = [];
  const taskRow = {
    id: "worktodo-task-1",
    work_code: "WLTK-004",
    title: "WorkTodo task",
    status: "blocked",
    application_scope: "worktodo",
    owner_uuid: USER_ID,
    workspace_id: "worktodo-blocked-id",
    summary: "工作內容",
    usage_scenario: "使用情境"
  };
  const gateway = {
    select: async (table, query) => {
      calls.push({ type: "select", table, query });
      if (table === "board_workspaces") return [{ id: "worktodo-blocked-id", workspace_key: "worktodo-blocked", name: "阻塞", sort_order: 50, active: true, application_scope: "worktodo", owner_uuid: null }];
      if (table === "board_tasks") return [taskRow];
      return [];
    },
    rpc: async (name, params) => {
      calls.push({ type: "rpc", name, params });
      if (name === "worktodo_add_task_progress_note") return { id: "activity-1", entity_type: "board_task", entity_id: taskRow.id, action: "progress_note_created", activity_type: "human_progress_note", note: params.p_note };
      return taskRow;
    }
  };
  try {
    const result = await BoardRead.load({ gateway, applicationScope: "worktodo" });
    assert.equal(result.source, "Supabase Shared Data Gateway → WorkTodo Application Scope");
    assert.equal(result.tasks[0].rawStatus, "blocked");
    assert.equal(result.tasks[0].applicationScope, "worktodo");
    assert.equal(result.tasks[0].ownerUuid, USER_ID);
    const scopedReads = calls.filter(call => call.type === "select" && ["board_workspaces", "board_tasks"].includes(call.table));
    assert.ok(scopedReads.every(call => /application_scope=eq\.worktodo/.test(call.query)));
    const progressRead = calls.find(call => call.type === "select" && call.table === "engineering_activity_log");
    assert.match(progressRead?.query || "", /entity_id=in\.\(/);

    await BoardRead.worktodoCreateTask({ title: "New", summary: "Body", status: "not_started", usageScenario: "Scenario" }, { gateway });
    await BoardRead.worktodoUpdateTask({ taskId: taskRow.id, patch: { status: "waiting_reply" } }, { gateway });
    await BoardRead.worktodoAddTaskProgressNote({ taskId: taskRow.id, note: "Progress" }, { gateway });
    await BoardRead.worktodoMigrateTask("WLTK-004", { gateway });
    assert.deepEqual(calls.filter(call => call.type === "rpc").map(call => call.name), [
      "worktodo_create_task",
      "worktodo_update_task",
      "worktodo_add_task_progress_note",
      "worktodo_migrate_task"
    ]);
    assert.equal(calls.find(call => call.name === "worktodo_create_task").params.p_status, "not_started");
    assert.deepEqual(calls.find(call => call.name === "worktodo_update_task").params.p_patch, { status: "waiting_reply" });
  } finally {
    if (previousSnapshot) global.getSharedSessionSnapshot = previousSnapshot;
    else delete global.getSharedSessionSnapshot;
  }
});

test("Board workspace mutations and movement history stay behind controlled RPC/read adapters", async () => {
  const calls = [];
  const gateway = {
    rpc: async (name, params) => {
      calls.push({ type: "rpc", name, params });
      if (name === "board_create_workspace" || name === "board_rename_workspace") {
        return { id: "workspace-1", workspace_key: "", name: params.p_name, sort_order: 60, active: true };
      }
      if (name === "board_move_task_workspace") return { id: params.p_task_id, status: "qa", assignee: "GPT", workspace_id: params.p_target_workspace_id };
      return { success: true };
    },
    select: async (table, query) => {
      calls.push({ type: "select", table, query });
      return [{ id: "audit-1", entity_id: "task-1", before_data: { workspace_id: "a", workspace_name: "Co區" }, after_data: { workspace_id: "b", workspace_name: "GPT區" }, actor_label: "QJC", created_at: "2026-08-15T00:00:00Z", action: "workspace_moved" }];
    }
  };
  const created = await BoardRead.createWorkspace("測試區", { gateway });
  const renamed = await BoardRead.renameWorkspace(created.id, "測試區2", { gateway });
  await BoardRead.reorderWorkspaces(["a", "b"], { gateway });
  const moved = await BoardRead.moveTaskWorkspace("task-1", "b", "QJC QA", { gateway });
  const movements = await BoardRead.loadMovementHistory("task-1", { gateway });
  assert.equal(created.name, "測試區");
  assert.equal(renamed.name, "測試區2");
  assert.equal(moved.workspaceId, "b");
  assert.equal(movements[0].fromWorkspace, "Co區");
  assert.equal(movements[0].toWorkspace, "GPT區");
  assert.deepEqual(calls.filter(call => call.type === "rpc").map(call => call.name), [
    "board_create_workspace",
    "board_rename_workspace",
    "board_reorder_workspaces",
    "board_move_task_workspace"
  ]);
  assert.deepEqual(calls.find(call => call.name === "board_move_task_workspace").params, {
    p_task_id: "task-1",
    p_target_workspace_id: "b",
    p_note: "QJC QA"
  });
  assert.match(calls.find(call => call.type === "select").query, /workspace_moved/);
});

test("TASK Drawer v2 reads canonical Activity and Artifact sources without browser DML", async () => {
  const activityRow = {
    id: "activity-1",
    entity_type: "board_task",
    entity_id: "task-1",
    action: "workspace_moved",
    before_data: { workspace_name: "Co區" },
    after_data: { workspace_name: "GPT區" },
    actor_type: "human",
    actor_label: "QJC",
    note: "PM QA movement",
    created_at: "2026-08-15T00:00:00Z"
  };
  const checklistActivity = {
    id: "activity-2",
    entity_type: "engineering_checklist_item",
    entity_id: "check-1",
    action: "checklist_item_updated",
    actor_type: "human",
    actor_label: "QJC",
    note: "PM QA PASS",
    created_at: "2026-08-15T00:01:00Z"
  };
  const artifactRow = {
    artifact_id: "artifact-1",
    filename: "candidate.zip",
    product_version: "0.9.0-alpha.9.13",
    runtime_build: "20260815-2314",
    artifact_timestamp: "2026-08-15T15:14:00Z",
    git_commit: "abc123",
    sha256: "a".repeat(64),
    artifact_type: "candidate",
    qa_status: "pass",
    pm_acceptance_status: "pending",
    related_task: "TASK-001",
    lineage: { source: "test" }
  };
  const gateway = {
    select: async (table, query) => {
      if (table === "engineering_activity_log" && query.includes("entity_type=eq.board_task")) return [activityRow];
      if (table === "engineering_activity_log") return [checklistActivity];
      if (table === "engineering_artifacts") return [artifactRow];
      return [];
    }
  };
  const activity = await BoardRead.loadActivity("task-1", { gateway, checklistItems: [{ id: "check-1" }] });
  const artifacts = await BoardRead.loadArtifacts({ id: "task-1", workCode: "TASK-001" }, { gateway });
  assert.deepEqual(activity.map(item => item.action), ["checklist_item_updated", "workspace_moved"]);
  assert.equal(activity[0].actorLabel, "QJC");
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].runtimeBuild, "20260815-2314");
  assert.equal(artifacts[0].pmAcceptanceStatus, "pending");
});

test("TASK Drawer keeps PM summary, canonical notes, audit, and governance in existing boundaries", () => {
  const runtime = read("app/Board/ai/board-runtime.js");
  assert.doesNotMatch(runtime, /工程驗證狀態/);
  assert.match(runtime, /⚠️ 需要你的確認/);
  assert.match(runtime, /isPmTurn/);
  assert.match(runtime, /data-pm-accept/);
  assert.match(runtime, /data-pm-reject/);
  assert.match(runtime, /工作 Checklist/);
  assert.match(runtime, /data-progress-note-write="available"/);
  assert.match(runtime, /Human Progress Note/);
  assert.match(runtime, /System Activity/);
  assert.doesNotMatch(runtime, /items\.length \? items\.map\(item => checklistMarkup/);
  assert.doesNotMatch(runtime, /Checklist／Evidence 原始資料/);
  assert.match(runtime, /💬 工作進度/);
  assert.match(runtime, /readableWorkStatus/);
  assert.match(runtime, /attachmentMarkup/);
  assert.match(runtime, /shared-task-attachment/);
  assert.match(runtime, /composerHtml/);
  assert.doesNotMatch(runtime, /⚙️ 工程詳細資料/);
  assert.match(runtime, /loadActivity/);
  assert.match(runtime, /loadArtifacts/);
  assert.match(runtime, /developerNotes/);
  assert.match(runtime, /footerHtml: ""/);
  assert.match(runtime, /title: "📎 附件"/);
  assert.doesNotMatch(runtime, /taskMoreMarkup|data-engineering-records|taskEngineeringRecordsModal/);
  assert.doesNotMatch(runtime, /board_(?:create|update|delete)_activity|activity.*localStorage/i);
  assert.doesNotMatch(runtime, /data-(?:restore|reopen)|board_(?:restore|reopen)_/i);
});

test("Board entry loads Shared runtime and read adapter, not legacy prototype runtime", () => {
  const index = read("app/Board/ai/index.html");
  assert.match(index, /shared\/board\/board-read-service\.js/);
  assert.match(index, /shared\/components\/golden-master-runtime\.js/);
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
  assert.match(runtime, /executeSharedTaskAction\(null, "createTask"/);
  assert.match(index, /shared\/components\/task-action-contract\.js/);
  assert.match(runtime, /Realtime/);
  assert.match(runtime, /renderPrinciples\(\[\]\)/);
  assert.match(runtime, /renderTasks\(\[\]\)/);
  assert.doesNotMatch(runtime, /\.(insert|update|delete)\s*\(/);
  assert.doesNotMatch(runtime, /board_tasks.*(?:INSERT|UPDATE|DELETE)/i);
  assert.match(runtime, /usageScenario/);
  assert.doesNotMatch(runtime, /工程驗證狀態/);
  assert.match(runtime, /⚠️ 需要你的確認/);
  assert.doesNotMatch(runtime, /data-engineering-records|⚙️ 工程紀錄|⋯ 更多/);
  assert.match(runtime, /searchId: "boardSearch"/);
  assert.match(read("shared/components/golden-master.js"), /id="taskUsageScenario"/);
  assert.match(read("shared/components/golden-master.js"), /新增工作區/);
  assert.match(read("shared/components/golden-master.js"), /id="workspaceCreateDrawer"/);
  assert.doesNotMatch(index, /Interactive Prototype v0\.9/);
});

test("AI Board Task Drawer uses Need-to-Act presentation and progressive engineering disclosure", () => {
  const runtime = read("app/Board/ai/board-runtime.js");
  const index = read("app/Board/ai/index.html");
  assert.match(index, /shared\/components\/task-drawer\.js/);
  assert.match(index, /shared\/theme\/task-drawer\.css/);
  assert.match(runtime, /ZhugeSharedTaskDrawer/);
  assert.match(runtime, /shared-task-drawer/);
  assert.match(runtime, /isPmTurn/);
  assert.match(runtime, /data-pm-accept/);
  assert.match(runtime, /data-pm-reject/);
  assert.match(runtime, /🙋 需要你的操作/);
  assert.match(runtime, /⚠️ 需要你的確認/);
  assert.doesNotMatch(runtime, /engineeringEvidenceSummaryMarkup/);
  assert.doesNotMatch(runtime, /engineeringVerificationStatusMarkup/);
  assert.match(runtime, /Acceptance Criteria/);
  assert.match(runtime, /pmAcceptanceMarkup/);
  assert.match(runtime, /progressNoteComposerMarkup/);
  assert.match(runtime, /activityKindLabel/);
  assert.doesNotMatch(runtime, /QJC 驗收通過/);
  assert.match(runtime, /目前狀態/);
  assert.match(runtime, /工作內容/);
  assert.match(runtime, /title: "📎 附件"/);
  assert.match(runtime, /shared-task-attachment-list/);
  assert.match(runtime, /data-activity-type="human_progress_note"/);
  assert.match(runtime, /shared-task-progress-note-title">工作進度/);
  assert.doesNotMatch(runtime, /人工工作進度 · Human Progress Note/);
  assert.match(runtime, /footerHtml: ""/);
  assert.doesNotMatch(runtime, /data-(?:restore|reopen)|board_(?:restore|reopen)_/i);
});

test("AI Board writes Human Progress Note through the canonical controlled RPC", () => {
  const runtime = read("app/Board/ai/board-runtime.js");
  const adapter = read("shared/board/board-read-service.js");
  const governance = read("docs/supabase/20260814_pm_authorized_governance_write.sql");
  const progressMigration = read("docs/supabase/20260816_ai_board_human_progress_note.sql");
  assert.match(adapter, /developer_notes/);
  assert.match(adapter, /pm_notes/);
  assert.match(adapter, /engineering_activity_log/);
  assert.match(governance, /'developer_notes', 'pm_notes'/);
  assert.match(adapter, /addTaskProgressNote/);
  assert.match(progressMigration, /activity_type/);
  assert.match(progressMigration, /board_add_task_progress_note/);
  assert.match(progressMigration, /human_progress_note/);
  assert.match(runtime, /data-progress-note-write="available"/);
  assert.match(runtime, /新增工作進度/);
  assert.doesNotMatch(runtime, /data-progress-note-write="unavailable"/);
  assert.doesNotMatch(runtime, /沒有 issuance／bridge/);
  assert.doesNotMatch(runtime, /localStorage.*(?:note|progress)|(?:note|progress).*localStorage/i);
  assert.doesNotMatch(runtime, /engineering_activity_log.*(?:INSERT|UPDATE|DELETE)/i);
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
