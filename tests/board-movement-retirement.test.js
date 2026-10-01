const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const BoardReadService = require("../shared/board/board-read-service.js");

test("generic board movement application authority is revoked while maintenance evidence remains", () => {
  const migration = read("docs/supabase/20260914_retire_board_move_task_workspace.sql");
  assert.match(migration, /revoke all on function public\.board_move_task_workspace\(uuid, uuid, text\)\s+from public, anon, authenticated/i);
  assert.match(migration, /grant execute on function public\.board_move_task_workspace\(uuid, uuid, text\)\s+to service_role/i);
  assert.match(migration, /comment on function public\.board_move_task_workspace/i);
  assert.doesNotMatch(migration, /drop function public\.board_move_task_workspace/i);
  assert.doesNotMatch(migration, /board_c_reconcile_workspace_decision_v2\s*\(/i);
});

test("generic BoardRead movement surface fails closed before any Cloud call", async () => {
  const calls = [];
  await assert.rejects(
    () => BoardReadService.moveTaskWorkspace("task-1", "workspace-2", "legacy generic move", {
      gateway: {
        async rpc(name, params) {
          calls.push({ name, params });
          return { id: "task-1" };
        }
      }
    }),
    error => error.code === "C_LEGACY_MOVEMENT_RETIRED"
      && error.route === "board_move_task_workspace"
      && error.authority === "board_c_reconcile_workspace_decision_v2"
  );
  assert.deepEqual(calls, []);
});
