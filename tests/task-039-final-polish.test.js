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

test("AI Board Drawer keeps PM-facing content concise and pushes engineering records to progressive disclosure", () => {
  const runtime = read("app/Board/ai/board-runtime.js");
  const css = read("shared/theme/task-drawer.css");
  assert.doesNotMatch(runtime, /下一步：由 Co 接球/);
  assert.doesNotMatch(runtime, /工程驗證狀態/);
  assert.match(runtime, /data-pm-action="acceptance"/);
  assert.match(runtime, /PM Acceptance Criteria（PM 實際要驗證）/);
  assert.match(runtime, /驗收通過/);
  assert.match(runtime, /退回修改/);
  assert.match(runtime, /data-engineering-records/);
  assert.match(runtime, /function hasValidEngineeringEvidence\(item\)/);
  assert.match(runtime, /\.filter\(item => !isTaskChecklistItem\(item\) && !isPmAcceptanceItem\(item\) && hasValidEngineeringEvidence\(item\)\)/);
  assert.match(runtime, /const rows = \(Array\.isArray\(activity\) \? activity : \[\]\)\.slice\(\)\.sort\(\(left, right\) => .*right\.timestamp/);
  assert.match(runtime, /Human Progress Note/);
  assert.match(runtime, /System Activity/);
  assert.match(runtime, /data-progress-note-write="available"/);
  assert.match(css, /\.shared-task-progress-submit\{/);
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
