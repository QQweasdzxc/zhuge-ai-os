const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("WorkLog onboarding is gated by resolved Auth/Profile/Settings initialization", () => {
  const app = read("modules/worklog/worklog-app.js");
  const data = read("shared/api/data-service.js");
  assert.match(data, /getInitializationState\(\)/);
  assert.match(data, /dataServiceInitializationState = "loading"/);
  assert.match(data, /dataServiceInitializationState = "ready"/);
  assert.match(data, /dataServiceInitializationState = "error"/);
  assert.match(app, /function worklogInitializationLoadingScreen\(\)/);
  assert.match(app, /function worklogInitializationErrorScreen\(state = \{\}\)/);
  assert.match(app, /if \(worklogInitializationState\(\)\.state !== "ready"\) return false/);
  assert.match(app, /initialization\.state === "loading" \|\| initialization\.state === "idle"/);
  assert.match(app, /initialization\.state === "error"/);
  assert.match(app, /不會顯示「初次認識工時簿」/);
});

test("AI Board Drawer keeps PM-facing content concise and removes engineering-only entry points", () => {
  const runtime = read("app/Board/ai/board-runtime.js");
  const css = read("shared/theme/task-drawer.css");
  assert.doesNotMatch(runtime, /下一步：由 Co 接球/);
  assert.doesNotMatch(runtime, /工程驗證狀態/);
  assert.match(runtime, /data-pm-action="acceptance"/);
  assert.match(runtime, /PM Acceptance Criteria（PM 實際要驗證）/);
  assert.match(runtime, /驗收通過/);
  assert.match(runtime, /退回修改/);
  assert.match(runtime, /const rows = \(Array\.isArray\(activity\) \? activity : \[\]\)\.slice\(\)\.sort\(\(left, right\) => .*right\.timestamp/);
  assert.match(runtime, /Human Progress Note/);
  assert.match(runtime, /System Activity/);
  assert.match(runtime, /data-progress-note-write="available"/);
  assert.match(runtime, /footerHtml: ""/);
  assert.doesNotMatch(runtime, /taskMoreMarkup|data-engineering-records|⚙️ 工程紀錄|⋯ 更多/);
  assert.match(runtime, /title: "📎 附件"/);
  assert.match(runtime, /aria-label="附件"/);
  assert.match(runtime, /shared-task-attachment-open/);
  assert.match(runtime, /noopener noreferrer/);
  assert.match(runtime, /shared-task-progress-attachment-icon/);
  assert.match(runtime, /附加圖片或文件.*aria-label/);
  assert.doesNotMatch(runtime, /label: "進度"|label: "置頂"|label: "預估時間"|key: "estimated-minutes"/);
  assert.match(runtime, /key: "agreement-schedule"/);
  assert.match(runtime, /約定日期/);
  assert.match(runtime, /topHtml: taskChecklistPanelMarkup\(\)/);
  assert.match(runtime, /function taskChecklistPanelMarkup\(\)/);
  assert.match(runtime, /data-task-checklist-panel/);
  assert.match(runtime, /taskChecklistPanel\.open = false/);
  assert.doesNotMatch(runtime, /id: "task-checklist"/);
  assert.doesNotMatch(runtime, /data-task-due-date-edit/);
  assert.match(css, /shared-task-drawer-checklist-panel/);
  assert.match(css, /shared-agreed-date-editor/);
  assert.match(runtime, /if \(!note\) return ""/);
  assert.match(runtime, /<strong>工作補充<\/strong>/);
  assert.doesNotMatch(runtime, /目前沒有既有 TASK Contract Note/);
  assert.match(runtime, /由目前登入的 QJC／owner 身分/);
  assert.match(runtime, /身分保存至正式 Cloud[\s\S]*shared-task-progress-submit/);
  assert.match(css, /\.shared-task-progress-submit\{/);
  assert.match(css, /min-height:82px/);
  assert.match(css, /opacity:.82/);
});

test("General Task Checklist uses one listener and single-flight controlled create", () => {
  const runtime = read("app/Board/ai/board-runtime.js");
  const start = runtime.indexOf("function wireTaskChecklist");
  const end = runtime.indexOf("async function uploadAttachmentFiles", start);
  const checklist = runtime.slice(start, end);
  assert.match(runtime, /taskChecklistWrites: new Set\(\)/);
  assert.match(checklist, /addForm\.onsubmit = async event/);
  assert.match(checklist, /state\.taskChecklistWrites\.has\(taskKey\)/);
  assert.match(checklist, /state\.taskChecklistWrites\.add\(taskKey\)/);
  assert.match(checklist, /state\.taskChecklistWrites = new Set\(Array\.from\(state\.taskChecklistWrites\)/);
  assert.doesNotMatch(checklist, /addEventListener\("submit"/);
});

test("Human Progress Note stays controlled and append-only", () => {
  const sql = read("docs/supabase/20260816_ai_board_human_progress_note.sql");
  const service = read("shared/board/board-read-service.js");
  assert.match(sql, /board_add_task_progress_note/);
  assert.match(sql, /activity_type\s*\)\s*values\s*\([\s\S]*'human_progress_note'/i);
  assert.match(sql, /revoke insert, update, delete on public\.engineering_activity_log from authenticated/i);
  assert.doesNotMatch(service, /engineering_activity_log["'`]\)\.(insert|update|delete)/i);
  assert.match(service, /order=created_at\.desc/);
});

test("General Task Drawer renders Human Progress only while preserving canonical activity read", () => {
  const runtime = read("app/Board/ai/board-runtime.js");
  const service = read("shared/board/board-read-service.js");
  assert.match(service, /engineering_activity_log/);
  assert.match(service, /loadActivity/);
  assert.match(runtime, /const humanRows = rows\.filter\(item => activityKind\(item\) === "human"\)/);
  assert.match(runtime, /data-human-progress-empty/);
  assert.match(runtime, /System Activity 與 Workspace Audit 保留於正式紀錄/);
  assert.doesNotMatch(runtime, /return rows\.map\(item => \{[\s\S]*System Activity ·/);
});

test("Workspace delete remains blocked while task content editing uses the authenticated controlled path", () => {
  const migration = read("docs/supabase/20260815_ai_board_free_workspace.sql");
  const service = read("shared/board/board-read-service.js");
  const runtime = read("app/Board/ai/board-runtime.js");
  const inlineMigration = read("docs/supabase/20260818_task_039_inline_content_write.sql");
  assert.doesNotMatch(migration, /board_delete_workspace/i);
  assert.doesNotMatch(service, /deleteWorkspace|board_delete_workspace/i);
  assert.doesNotMatch(runtime, /deleteWorkspace|board_delete_workspace/i);
  assert.match(service, /updateTaskContent/);
  assert.match(service, /board_update_task_content/);
  assert.match(runtime, /data-task-inline-edit/);
  assert.match(runtime, /authenticated controlled write path/);
  assert.doesNotMatch(runtime, /requestTaskContractUpdate|送出 PM 核准|ZhugeGovernanceApprovalRunnerUrl/);
  assert.match(inlineMigration, /auth\.uid\(\)/i);
  assert.match(inlineMigration, /board_update_task_content/);
  assert.match(inlineMigration, /task_content_updated/);
  assert.match(inlineMigration, /revoke insert, update, delete on public\.board_tasks from authenticated/i);
  assert.doesNotMatch(service, /localStorage|sessionStorage|\.from\([^)]*board_tasks/i);
  assert.doesNotMatch(runtime, /localStorage|sessionStorage|\.from\([^)]*board_tasks/i);
  assert.match(migration, /on delete restrict/i);
});

test("Task content fields start in read mode and switch in place to one editor", () => {
  const runtime = read("app/Board/ai/board-runtime.js");
  const markupStart = runtime.indexOf("function editableTaskFieldMarkup");
  const markupEnd = runtime.indexOf("function wireTaskInlineEditors");
  const markup = runtime.slice(markupStart, markupEnd);
  assert.doesNotMatch(markup, /<textarea/);
  assert.match(markup, /data-task-inline-mode="read"/);
  assert.match(runtime, /fieldContainer\.appendChild\(editor\)/);
  assert.match(runtime, /fieldContainer\.dataset\.taskInlineMode = "edit"/);
  assert.match(runtime, /function leaveTaskInlineEdit\(fieldContainer\)/);
  assert.match(runtime, /editor\?\.remove\(\)/);
  assert.match(runtime, /leaveTaskInlineEdit\(fieldContainer\)/);
});
