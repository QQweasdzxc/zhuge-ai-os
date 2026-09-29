const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const BoardRead = require("../shared/board/board-read-service.js");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("retired AI lifecycle wrappers fail closed without invoking a Cloud writer", async () => {
  const calls = [];
  const gateway = {
    rpc: async (...args) => {
      calls.push(args);
      throw new Error("retired route must not reach gateway");
    }
  };

  await assert.rejects(
    () => BoardRead.acceptTaskFromQjcDrop({ taskId: "task", itemId: "item" }, { gateway }),
    error => error.code === "C_LEGACY_LIFECYCLE_RETIRED"
      && error.route === "board_pm_acceptance_from_qjc_drop"
  );
  await assert.rejects(
    () => BoardRead.pmAcceptTaskFromQjcDrop({ taskId: "task", itemId: "item" }, { gateway }),
    error => error.code === "C_LEGACY_LIFECYCLE_RETIRED"
      && error.route === "board_pm_acceptance_from_qjc_drop"
  );
  await assert.rejects(
    () => BoardRead.reconcileWorkspaceDecision({ taskId: "task", targetWorkspaceId: "workspace" }, { gateway }),
    error => error.code === "C_LEGACY_LIFECYCLE_RETIRED"
      && error.route === "board_c_reconcile_workspace_decision"
  );

  assert.deepEqual(calls, []);
  assert.equal(BoardRead.lifecycle.capabilities.pmAcceptanceFromQjcDrop, false);
  assert.equal(BoardRead.lifecycle.capabilities.pmWorkspaceAuthority, false);
  assert.equal(BoardRead.lifecycle.reconcileWorkspaceDecision, undefined);
});

test("closure migration removes application execution from v1 lifecycle surfaces", () => {
  const migration = read("docs/supabase/20260914_c_lifecycle_authority_closure.sql");
  assert.match(migration, /revoke all on function public\.board_pm_acceptance_from_qjc_drop\(uuid, uuid, text, text\)[\s\S]*from public, anon, authenticated/i);
  assert.match(migration, /revoke all on function public\.board_c_reconcile_workspace_decision\(uuid, uuid, text\)[\s\S]*from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /grant execute on function public\.(?:board_pm_acceptance_from_qjc_drop|board_c_reconcile_workspace_decision)[^;]*authenticated/i);
  assert.match(migration, /service_role/i);
});

test("AI current source still routes completion and movement through C v2", () => {
  const runtime = read("shared/components/golden-master-runtime.js");
  const service = read("shared/board/board-read-service.js");
  assert.match(runtime, /acceptThroughCContract/);
  assert.match(runtime, /workflow\.reconcileWorkspaceDecision/);
  assert.match(service, /board_c_reconcile_workspace_decision_v2/);
  assert.doesNotMatch(runtime, /board_pm_acceptance_from_qjc_drop/);
});
