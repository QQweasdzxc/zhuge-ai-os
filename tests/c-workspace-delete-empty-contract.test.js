const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const migration = read("docs/supabase/20260915_c_workspace_delete_populated_fail_closed.sql");
const service = read("shared/board/board-read-service.js");
const runtime = read("shared/components/golden-master-runtime.js");

test("C shared delete counts cards before resolving any default target", () => {
  const countAt = migration.indexOf("select count(*)");
  const emptyBranchAt = migration.indexOf("if v_count = 0 then");
  const targetResolutionAt = migration.indexOf("select id\n    into v_target");
  assert.ok(countAt >= 0);
  assert.ok(emptyBranchAt > countAt);
  assert.equal(targetResolutionAt, -1);
  assert.match(migration, /'empty_workspace', true/);
  assert.match(migration, /'target_workspace_id', null/);
  assert.match(migration, /set active = false/);
});

test("empty C Workspace delete has no consumer-specific default assumption", () => {
  const emptyBranchStart = migration.indexOf("if v_count = 0 then");
  const emptyBranchEnd = migration.indexOf("-- Populated deletion", emptyBranchStart);
  const emptyBranch = migration.slice(emptyBranchStart, emptyBranchEnd);
  assert.doesNotMatch(emptyBranch, /task_code_prefix/i);
  assert.doesNotMatch(emptyBranch, /workspace_key/i);
  assert.doesNotMatch(emptyBranch, /ai_board|gpt|todo/i);
  assert.match(migration, /board_instance_can_write\(v_workspace\.board_instance_id\)/);
});

test("populated C Workspace deletion fails closed before any target or task update", () => {
  const populatedStart = migration.indexOf("-- Populated deletion");
  const populated = migration.slice(populatedStart);
  assert.match(populated, /Workspace 內仍有卡片，必須先移動／清空卡片，才能刪除 Workspace/);
  assert.doesNotMatch(populated, /select id\s+into v_target/);
  assert.doesNotMatch(populated, /update public\.board_tasks/);
  assert.doesNotMatch(populated, /target_workspace_id.*v_target/);
});

test("C populated deletion cannot bypass the canonical movement authority", () => {
  assert.match(service, /gateway\.rpc\("board_instance_delete_workspace", \{ p_workspace_id: workspaceId \}\)/);
  assert.match(service, /legacyMovementRetiredError\("board_instance_move_task_workspace"\)/);
  assert.match(runtime, /executeSharedTaskAction\(null, "deleteWorkspace"/);
  assert.match(migration, /canonical C movement contract/i);
  assert.doesNotMatch(migration, /update public\.board_tasks/);
});

test("AI Board reaches the shared C instance delete contract", () => {
  assert.match(runtime, /executeSharedTaskAction\(null, "deleteWorkspace"/);
  assert.match(service, /async function instanceDeleteWorkspace\(workspaceId\)/);
  assert.match(service, /gateway\.rpc\("board_instance_delete_workspace", \{ p_workspace_id: workspaceId \}\)/);
  assert.doesNotMatch(service, /instanceDeleteWorkspace[\s\S]*board_request_delete_workspace/);
});

test("C repair does not add cross-consumer workspace access", () => {
  assert.doesNotMatch(migration, /from public\.(worktodo|ai_board|c_mother)_/i);
  assert.doesNotMatch(migration, /global workspace/i);
  assert.match(migration, /where workspace_id = p_workspace_id/);
});
