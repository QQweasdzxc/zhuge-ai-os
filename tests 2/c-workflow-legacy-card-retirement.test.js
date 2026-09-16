const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const BoardReadService = require("../shared/board/board-read-service.js");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("legacy-card retirement migration closes application Execute and keeps maintenance only", () => {
  const migration = read("docs/supabase/20260915_c_workflow_legacy_card_retirement.sql");
  assert.match(
    migration,
    /revoke all on function public\.board_c_workflow_reconcile_legacy_card_v2\(\s*uuid, text, uuid, uuid, jsonb, text, text\s*\)\s*from public, anon, authenticated/i
  );
  assert.match(
    migration,
    /grant execute on function public\.board_c_workflow_reconcile_legacy_card_v2\(\s*uuid, text, uuid, uuid, jsonb, text, text\s*\)\s*to service_role/i
  );
  assert.match(migration, /historical\/migration evidence only/i);
  assert.doesNotMatch(migration, /drop function/i);
  assert.doesNotMatch(migration, /create or replace function public\.board_c_workflow_reconcile_legacy_card_v2/i);
});

test("C Runtime exposes legacy-card reconciliation only as a fail-closed sentinel", async () => {
  const calls = [];
  const workflow = BoardReadService.createWorkflowCapability({
    boardInstanceId: "board-1",
    gateway: {
      async rpc(...args) {
        calls.push(args);
        throw new Error("retired legacy route must not reach the gateway");
      }
    }
  });

  assert.equal(workflow.capabilities.legacyReconciliation, false);
  await assert.rejects(
    () => workflow.reconcileLegacyCard({
      taskId: "task-1",
      classification: "legacy_unbound",
      idempotencyKey: "legacy-retire-test"
    }),
    error => error.code === "C_LEGACY_LIFECYCLE_RETIRED"
      && error.route === "board_c_workflow_reconcile_legacy_card_v2"
  );
  assert.deepEqual(calls, []);
});

test("legacy-card retirement leaves the canonical C movement and lifecycle routes intact", () => {
  const service = read("shared/board/board-read-service.js");
  const legacyStart = service.indexOf("const reconcileLegacyCard");
  const legacyEnd = service.indexOf("const retireLegacyWorkspace", legacyStart);
  assert.ok(legacyStart >= 0);
  assert.ok(legacyEnd > legacyStart);
  const legacyBlock = service.slice(legacyStart, legacyEnd);

  assert.doesNotMatch(legacyBlock, /gateway\.rpc/);
  assert.doesNotMatch(legacyBlock, /board_c_workflow_reconcile_legacy_card_v2.*gateway/i);
  assert.match(service, /board_c_reconcile_workspace_decision_v2/);
  assert.match(service, /board_c_reconcile_completion_archive_lifecycle_v2/);
});
