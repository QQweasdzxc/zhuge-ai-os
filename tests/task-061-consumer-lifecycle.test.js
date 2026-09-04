const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("TASK-061 lifecycle source is generic and does not infer ownership from a prefix", () => {
  const migration = read("docs/supabase/20260903_board_consumer_route_lifecycle.sql");
  const runtime = read("shared/components/golden-master-runtime.js");
  const goldenMaster = read("shared/components/golden-master.js");

  assert.match(migration, /p_application_scope\s+text/);
  assert.match(migration, /board_rename_instance/);
  assert.match(migration, /board_assign_consumer_scope/);
  assert.match(migration, /board_archive_instance/);
  assert.match(migration, /board_delete_instance/);
  assert.match(migration, /board_instances_route_scope_lower_idx/);
  assert.match(migration, /Keep the audit vocabulary explicit before the compatibility backfill/);
  assert.match(migration, /delete from public\.board_workspaces where board_instance_id = v_instance\.id/);
  assert.match(migration, /BOARD_INSTANCE_DELETE_REQUIRES_NO_CLAIMS/);
  assert.doesNotMatch(migration, /prefix does not match the requested route/);
  assert.doesNotMatch(runtime, /const routeScope = prefix === "GAS"/);
  assert.match(runtime, /if \(state\.applicationScope !== "c" \|\| !state\.boardIsTemplate\) return;/);
  assert.match(runtime, /if \(!isMotherTemplate\) \{\s*return \{\s*hidden: true/);
  assert.match(goldenMaster, /id="consumerBoardScope"/);
});

test("TASK-061 service boundary exposes create, rename, move, archive, and delete RPCs", async () => {
  const BoardReadService = require("../shared/board/board-read-service.js");
  const calls = [];
  const gateway = {
    async rpc(name, args) {
      calls.push({ name, args });
      return { id: "consumer-1", active: true, template_key: "c", is_template_instance: false };
    }
  };

  await BoardReadService.provisionConsumer({ name: "HR", prefix: "HR", templateKey: "c", applicationScope: "hr" }, { gateway });
  await BoardReadService.renameBoardInstance({ id: "consumer-1", name: "HR 2" }, { gateway });
  await BoardReadService.assignConsumerScope({ id: "consumer-1", applicationScope: "finance" }, { gateway });
  await BoardReadService.archiveBoardInstance({ id: "consumer-1" }, { gateway });
  await BoardReadService.deleteBoardInstance({ id: "consumer-1" }, { gateway });

  assert.deepEqual(calls.map(call => call.name), [
    "board_provision_consumer",
    "board_rename_instance",
    "board_assign_consumer_scope",
    "board_archive_instance",
    "board_delete_instance"
  ]);
  assert.equal(calls[0].args.p_application_scope, "hr");
  assert.equal(calls[2].args.p_application_scope, "finance");
});

test("TASK-061 checklist starts unverified and requires evidence for every gate", () => {
  const checklist = read("docs/TASK_061_CONSUMER_LIFECYCLE_CHECKLIST.md");
  assert.match(checklist, /Status: NOT VERIFIED/);
  assert.doesNotMatch(checklist, /\| PASS \|/);
  assert.match(checklist, /Board rename/);
  assert.match(checklist, /Board ownership\/route move/);
  assert.match(checklist, /Board archive/);
  assert.match(checklist, /Board delete/);
  assert.match(checklist, /Current Candidate ZIP and SHA-256/);
});
