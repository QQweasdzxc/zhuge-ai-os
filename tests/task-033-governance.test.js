const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const BoardRead = require("../shared/board/board-read-service.js");

test("TASK-033 migration uses minimum metadata, QJC-only controlled action, and existing audit", () => {
  const sql = read("docs/supabase/20260810_task_033_governance_metadata.sql");
  for (const column of ["resolution_action", "merged_into", "linked_to", "resolution_reason", "resolved_at", "resolved_by"]) {
    assert.match(sql, new RegExp(`add column if not exists ${column}`, "i"));
  }
  assert.match(sql, /create or replace function public\.board_governance_action/i);
  assert.match(sql, /is_engineering_member\(array\['owner'\]\)/i);
  assert.match(sql, /insert into public\.engineering_activity_log/i);
  assert.match(sql, /revoke execute on function public\.board_governance_action.*from anon/i);
  assert.doesNotMatch(sql, /drop policy|disable row level security|service_role_key/i);
});

test("governance terminal statuses stay out of the four active Kanban workspaces", () => {
  const merged = BoardRead.normalizeTask({ status: "merged", resolution_action: "merged" });
  const cancelled = BoardRead.normalizeTask({ status: "cancelled", resolution_action: "cancelled" });
  assert.equal(merged.workspace, "history");
  assert.equal(cancelled.workspace, "history");
  assert.equal(BoardRead.isGovernanceTerminal(merged), true);
  assert.equal(BoardRead.isGovernanceTerminal(cancelled), true);
  assert.equal(BoardRead.availableTransitions(merged).length, 0);
});

test("governance action adapter uses the controlled RPC rather than direct DML", async () => {
  const calls = [];
  const gateway = { rpc: async (name, params) => { calls.push({ name, params }); return { id: "1", status: "ready", resolution_action: "ignored" }; } };
  const result = await BoardRead.governanceAction("1", "ignored", null, "歷史資料保留並忽略", { gateway });
  assert.equal(result.resolutionAction, "ignored");
  assert.equal(calls[0].name, "board_governance_action");
  assert.deepEqual(calls[0].params, { p_task_id: "1", p_action: "ignored", p_target_task_id: null, p_reason: "歷史資料保留並忽略" });
});
