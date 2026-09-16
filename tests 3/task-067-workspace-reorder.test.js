const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("TASK-067 scopes the existing reorder contract to the submitted board instance", () => {
  const sql = read("docs/supabase/20260907_task_067_scope_board_reorder.sql");
  assert.match(sql, /create or replace function public\.board_reorder_workspaces/i);
  assert.match(sql, /select board_instance_id[\s\S]*into board_instance_id_value/i);
  assert.match(sql, /where board_instance_id = board_instance_id_value[\s\S]*and active = true/i);
  assert.match(sql, /workspace\.board_instance_id = board_instance_id_value/i);
  assert.match(sql, /where id = workspace_id_value[\s\S]*and board_instance_id = board_instance_id_value/i);
  assert.doesNotMatch(sql, /待辦|Co區|GPT區|QJC驗證|已完工/);
});

test("TASK-067 keeps the shared runtime dynamic and sends the complete current order", () => {
  const runtime = read("shared/components/golden-master-runtime.js");
  assert.match(runtime, /state\.workspaces\.filter\(workspace => workspace\.active\)/);
  assert.match(runtime, /const fullOrder = ordered\.map/);
  assert.match(runtime, /const workspaceIds = fullOrder\.map\(workspace => workspace\.id\)/);
  assert.match(runtime, /executeSharedTaskAction\(null, "reorderWorkspace"/);
  assert.doesNotMatch(runtime, /workspaceIds\.slice\(0,\s*5\)|\["待辦"|\["Co區"/);
});
