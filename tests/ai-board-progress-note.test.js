const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const BoardRead = require("../shared/board/board-read-service.js");

test("Human Progress Note migration types history and closes direct table writes", () => {
  const sql = read("docs/supabase/20260816_ai_board_human_progress_note.sql");
  assert.match(sql, /add column if not exists activity_type text/i);
  assert.match(sql, /set activity_type = 'system_activity'/i);
  assert.match(sql, /activity_type in \('system_activity', 'human_progress_note'\)/i);
  assert.match(sql, /drop policy if exists engineering_activity_insert/i);
  assert.match(sql, /revoke insert, update, delete on public\.engineering_activity_log from authenticated/i);
  assert.match(sql, /create or replace function public\.board_add_task_progress_note\(\s*p_task_id uuid,\s*p_note text/is);
  assert.match(sql, /auth\.uid\(\)/i);
  assert.match(sql, /is_engineering_member\(array\['owner'\]\)/i);
  assert.match(sql, /activity_type\s*\)\s*values\s*\([\s\S]*'human_progress_note'/i);
  assert.match(sql, /revoke all on function public\.board_add_task_progress_note/i);
  assert.match(sql, /grant execute on function public\.board_add_task_progress_note.*to authenticated/i);
});

test("Activity normalization keeps Human Progress Note distinct from System Activity", () => {
  const human = BoardRead.normalizeActivity({
    action: "progress_note_created",
    activity_type: "human_progress_note",
    actor_type: "human",
    actor_label: "QJC",
    note: "已完成同步測試。"
  });
  const system = BoardRead.normalizeActivity({ action: "workspace_moved" });
  assert.equal(human.activityType, "human_progress_note");
  assert.equal(human.actorLabel, "QJC");
  assert.equal(system.activityType, "system_activity");
});

test("Activity read path sorts Human Progress Note and System Activity together", async () => {
  const calls = [];
  const gateway = {
    select: async (table, query) => {
      calls.push({ table, query });
      if (table !== "engineering_activity_log") return [];
      return [
        { id: "system", entity_type: "board_task", entity_id: "task-1", action: "task_created", activity_type: "system_activity", actor_label: "System", created_at: "2026-08-16T00:02:00Z" },
        { id: "human", entity_type: "board_task", entity_id: "task-1", action: "progress_note_created", activity_type: "human_progress_note", actor_label: "QJC", note: "進度一", created_at: "2026-08-16T00:01:00Z" }
      ];
    }
  };
  const rows = await BoardRead.loadActivity("task-1", { gateway, checklistItems: [] });
  assert.deepEqual(rows.map(item => item.id), ["system", "human"]);
  assert.ok(calls.every(call => call.query.includes("order=created_at.desc")));
  assert.ok(calls[0].query.includes("activity_type"));
});

test("Progress Note adapter uses the controlled RPC and never direct DML", async () => {
  const calls = [];
  const gateway = {
    rpc: async (name, params) => {
      calls.push({ name, params });
      return { id: "note-1", action: "progress_note_created", activity_type: "human_progress_note", actor_label: "QJC", note: params.p_note };
    }
  };
  const row = await BoardRead.addTaskProgressNote("task-1", "已完成同步測試。", { gateway });
  assert.equal(row.activityType, "human_progress_note");
  assert.deepEqual(calls, [{ name: "board_add_task_progress_note", params: { p_task_id: "task-1", p_note: "已完成同步測試。" } }]);
  assert.doesNotMatch(read("shared/board/board-read-service.js"), /\.from\(["']engineering_activity_log["']\)\.(insert|update|delete)/i);
});

test("Engineering Details is read-only evidence detail, not a second checklist", () => {
  const runtime = read("app/Board/ai/board-runtime.js");
  assert.match(runtime, /engineeringEvidenceDetailMarkup/);
  assert.match(runtime, /Engineering Evidence Detail/);
  assert.doesNotMatch(runtime, /items\.length \? items\.map\(item => checklistMarkup/);
  assert.match(runtime, /data-progress-note-write="available"/);
  assert.match(runtime, /activityType === "human_progress_note"/);
});
