const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const BoardRead = require("../shared/board/board-read-service.js");

test("TASK-039 inline content path is authenticated, allowlisted, audited, and not PM Governance", () => {
  const sql = read("docs/supabase/20260818_task_039_inline_content_write.sql");
  const service = read("shared/board/board-read-service.js");
  const runtime = read("app/Board/ai/board-runtime.js");
  assert.match(sql, /create or replace function public\.board_update_task_content/);
  assert.match(sql, /is_engineering_member\(array\['owner'\]\)/);
  assert.match(sql, /auth\.uid\(\)/);
  assert.match(sql, /task_content_updated/);
  assert.match(sql, /revoke insert, update, delete on public\.board_tasks from authenticated/);
  assert.match(service, /gateway\.rpc\("board_update_task_content"/);
  assert.doesNotMatch(runtime, /requestTaskContractUpdate|taskContractUpdateStatus|送出 PM 核准|ZhugeGovernanceApprovalRunnerUrl/);
});

test("TASK-041 Phase 1 keeps Due Date and General Checklist separate from Engineering Evidence", () => {
  const sql = read("docs/supabase/20260818_task_041_phase1_due_date_checklist.sql");
  const service = read("shared/board/board-read-service.js");
  assert.match(sql, /alter table public\.board_tasks[\s\S]*add column if not exists due_date date/i);
  assert.match(sql, /create table if not exists public\.board_task_checklist_items/i);
  assert.match(sql, /board_update_task_due_date/);
  assert.match(sql, /board_add_task_checklist_item/);
  assert.match(sql, /board_update_task_checklist_item/);
  assert.match(sql, /board_delete_task_checklist_item/);
  assert.match(sql, /revoke insert, update, delete.*public\.board_task_checklist_items from authenticated/i);
  assert.match(service, /loadTaskChecklist/);
  assert.match(service, /updateTaskDueDate/);
  assert.match(service, /addTaskChecklistItem/);
  assert.doesNotMatch(sql, /engineering_checklist_items.*board_task_checklist_items/i);
});

test("TASK-041 Phase 2 uses private Storage plus controlled attachment metadata RPCs", () => {
  const sql = read("docs/supabase/20260818_task_041_phase2_task_attachments.sql");
  const service = read("shared/board/board-read-service.js");
  const gateway = read("shared/supabase/supabase-gateway.js");
  const runtime = read("app/Board/ai/board-runtime.js");
  assert.match(sql, /create table if not exists public\.board_task_attachments/i);
  assert.match(sql, /storage\.buckets[\s\S]*?values[\s\S]*?false/i);
  assert.match(sql, /board-task-attachments/);
  assert.match(sql, /board_prepare_task_attachment/);
  assert.match(sql, /board_complete_task_attachment/);
  assert.match(sql, /storage\.objects/);
  assert.match(sql, /upload_status = 'uploading'/i);
  assert.match(sql, /revoke insert, update, delete.*public\.board_task_attachments from authenticated/i);
  assert.match(service, /prepareTaskAttachment/);
  assert.match(service, /uploadTaskAttachment/);
  assert.match(service, /completeTaskAttachment/);
  assert.match(gateway, /uploadStorageObject/);
  assert.match(gateway, /createStorageSignedUrl/);
  assert.doesNotMatch(service, /\.from\([^)]*board_task_attachments/i);
  assert.match(runtime, /attachmentScope !== "progress_note"/);
});

test("TASK-041 Phase 3 binds Progress Note attachments to Human Progress Note activity", () => {
  const sql = read("docs/supabase/20260818_task_041_phase3_progress_note_attachments.sql");
  assert.match(sql, /board_prepare_progress_note_attachment/);
  assert.match(sql, /activity_type = 'human_progress_note'/i);
  assert.match(sql, /board_prepare_task_attachment/);
  assert.doesNotMatch(sql, /create table.*notes/i);
});

test("Board adapter normalizes new Phase 1 and attachment records", () => {
  const task = BoardRead.normalizeTask({ id: "task-1", due_date: "2026-08-31" });
  const checklist = BoardRead.normalizeTaskChecklistItem({ id: "item-1", task_id: "task-1", label: "驗證畫面", completed: true });
  const attachment = BoardRead.normalizeTaskAttachment({ id: "file-1", task_id: "task-1", filename: "qa.png", mime_type: "image/png", byte_size: 1024, storage_path: "task/file/qa.png", upload_status: "ready" });
  assert.equal(task.dueDate, "2026-08-31");
  assert.equal(checklist.completed, true);
  assert.equal(attachment.attachmentScope, "task");
  assert.equal(attachment.uploadStatus, "ready");
});

test("Board adapter writes inline content through the new RPC", async () => {
  const calls = [];
  const gateway = {
    rpc: async (name, params) => {
      calls.push({ name, params });
      return { id: "task-1", summary: params.p_summary, usage_scenario: params.p_usage_scenario, due_date: null };
    }
  };
  const task = await BoardRead.updateTaskContent({ taskId: "task-1", summary: "新的工作內容", usageScenario: "新的使用情境" }, { gateway });
  assert.equal(task.summary, "新的工作內容");
  assert.deepEqual(calls, [{ name: "board_update_task_content", params: { p_task_id: "task-1", p_summary: "新的工作內容", p_usage_scenario: "新的使用情境" } }]);
});
