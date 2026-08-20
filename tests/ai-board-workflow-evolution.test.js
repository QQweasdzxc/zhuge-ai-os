const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("Workflow Evolution removes GPT workspace from the active Board without deleting history", () => {
  const runtime = read("app/Board/ai/board-runtime.js");
  const migration = read("docs/supabase/20260820_ai_board_workflow_evolution.sql");
  assert.match(runtime, /key !== "gpt"/);
  assert.match(runtime, /name !== "GPT區"/);
  assert.match(migration, /workspace_key = 'gpt'/);
  assert.match(migration, /active = false/);
  assert.match(migration, /coalesce\(archived_at, now\(\)\)/i);
  assert.doesNotMatch(migration, /drop table|delete from public\.board_tasks|truncate public\.board_tasks/i);
  assert.doesNotMatch(runtime, /data-task-property="assignee"/);
});

test("Drawer replaces PM-visible Assignee with an in-drawer GPT Analysis entry", () => {
  const runtime = read("app/Board/ai/board-runtime.js");
  assert.match(runtime, /key: "gpt-analysis"/);
  assert.match(runtime, /label: "GPT 分析與建議"/);
  assert.match(runtime, /function taskAnalysisViewMarkup\(task\)/);
  assert.match(runtime, /data-task-analysis-view/);
  assert.match(runtime, /data-task-analysis-close/);
  assert.match(runtime, /restoreTaskDetailView/);
  assert.doesNotMatch(runtime, /label: "負責人"/);
  assert.doesNotMatch(runtime, /window\.open\(/);
  assert.doesNotMatch(runtime, /localStorage|sessionStorage/);
});

test("Board cards keep only identity and summary presentation", () => {
  const runtime = read("app/Board/ai/board-runtime.js");
  const taskMarkup = runtime.match(/function taskMarkup\(task, options = \{\}\) \{[\s\S]*?\n  \}\n  function principleMarkup/);
  assert.ok(taskMarkup, "taskMarkup implementation should remain discoverable");
  assert.doesNotMatch(taskMarkup[0], /class=\\\"meta\\\"|workspace-tag|status-tag/);
  assert.match(taskMarkup[0], /task\.workCode/);
  assert.match(taskMarkup[0], /task\.title/);
  assert.match(taskMarkup[0], /task\.summary/);
});

test("GPT Analysis replaces the full Drawer detail grid and restores it", () => {
  const runtime = read("app/Board/ai/board-runtime.js");
  assert.match(runtime, /gridParent\.replaceChild\(analysis, grid\)/);
  assert.match(runtime, /viewState\.gridParent\.replaceChild\(viewState\.grid, viewState\.analysis\)/);
  assert.match(runtime, /data-shared-task-floating-action/);
});

test("GPT Analysis presentation is transparent when formal persistence is unavailable", () => {
  const runtime = read("app/Board/ai/board-runtime.js");
  assert.match(runtime, /AI Analysis Layer · Read-only/);
  assert.match(runtime, /目前正式 Cloud 尚未提供這項分析內容/);
  for (const title of ["需求理解", "分析與判斷", "建議做法", "執行原則／Acceptance Criteria", "交付 Co 的執行摘要"]) {
    assert.match(runtime, new RegExp(title));
  }
  assert.doesNotMatch(runtime, /重新分析|採用建議/);
});

test("Legacy Assignee remains an adapter/read compatibility field, not a PM responsibility label", () => {
  const service = read("shared/board/board-read-service.js");
  const runtime = read("app/Board/ai/board-runtime.js");
  assert.match(service, /assignee: String\(row\.assignee/);
  assert.match(runtime, /工作區現在代表這張 TASK 的責任階段/);
  assert.doesNotMatch(runtime, /目前：\$\{?esc\(task\.assignee/);
});
