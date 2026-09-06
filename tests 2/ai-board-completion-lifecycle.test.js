const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const BoardRead = require("../shared/board/board-read-service.js");

test("completion lifecycle migration uses canonical timestamps and controlled audit paths", () => {
  const sql = read("docs/supabase/20260820_board_completion_lifecycle.sql");
  for (const column of ["accepted_at", "accepted_by", "completion_at", "completion_by", "archive_due_at", "archived_at", "archived_by"]) {
    assert.match(sql, new RegExp(`add column if not exists ${column}`, "i"));
  }
  assert.match(sql, /name = '測試'[\s\S]*name = '已完成'/i);
  assert.match(sql, /interval '48 hours'/i);
  assert.match(sql, /board_reconcile_completion_lifecycle/);
  assert.match(sql, /task_auto_archived/);
  assert.match(sql, /task_completed_after_pm_acceptance/);
  assert.match(sql, /PM Acceptance controlled path is required/i);
  assert.match(sql, /Only PM Acceptance PASS can enter 已完成/i);
  assert.match(sql, /grant execute on function public\.board_reconcile_completion_lifecycle\(\) to authenticated/i);
  assert.match(sql, /revoke execute on function public\.board_reconcile_completion_lifecycle\(\) from anon/i);
  assert.doesNotMatch(sql.replace(/--.*$/gm, ""), /localStorage|sessionStorage|browser timer/i);
});

test("completion archive presentation distinguishes the 48-hour window from Archive", () => {
  const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const past = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  assert.equal(BoardRead.isArchiveTask({ status: "done", completionAt: future, archiveDueAt: future, archivedAt: null }), false);
  assert.equal(BoardRead.isArchiveTask({ status: "done", completionAt: past, archiveDueAt: past, archivedAt: null }), true);
  assert.equal(BoardRead.isArchiveTask({ status: "done", completionAt: future, archiveDueAt: future, archivedAt: future }), true);
  assert.equal(BoardRead.isArchiveTask({ status: "done" }), true, "legacy done rows remain read-only Archive");
  assert.equal(BoardRead.isArchiveTask({ status: "merged", completionAt: future }), true);
});

test("board adapter exposes lifecycle timestamps without a second status model", () => {
  const lifecycleDueAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const task = BoardRead.normalizeTask({
    status: "done",
    workspace_key: "completed",
    workspace_name: "已完成",
    accepted_at: "2026-08-20T01:00:00Z",
    accepted_by: "owner-1",
    completion_at: "2026-08-20T01:00:00Z",
    completion_by: "owner-1",
    archive_due_at: lifecycleDueAt,
    archived_at: null
  });
  assert.equal(task.workspaceKey, "completed");
  assert.equal(task.workspaceName, "已完成");
  assert.equal(task.acceptedBy, "owner-1");
  assert.equal(task.completionAt, "2026-08-20T01:00:00Z");
  assert.equal(task.archiveDueAt, lifecycleDueAt);
  assert.equal(task.archivedAt, null);
  assert.equal(BoardRead.isArchiveTask(task), false);
});

test("board read path invokes server reconciliation before canonical task reads", async () => {
  const calls = [];
  const gateway = {
    rpc: async (name, params) => { calls.push({ name, params }); return { success: true, archived_count: 0 }; },
    select: async () => []
  };
  const resolver = { resolveCurrentCanonical: async () => ({ records: [], failures: [] }) };
  const previousIdentity = global.getSharedSessionSnapshot;
  const previousIdentityObject = global.ZhugeIdentity;
  global.getSharedSessionSnapshot = () => ({ isAuthenticated: true, userId: "owner-1" });
  global.ZhugeIdentity = { normalize: value => value };
  try {
    await BoardRead.load({ gateway, memoryResolver: resolver });
  } finally {
    global.getSharedSessionSnapshot = previousIdentity;
    global.ZhugeIdentity = previousIdentityObject;
  }
  assert.deepEqual(calls, [{ name: "board_reconcile_completion_lifecycle", params: {} }]);
});
