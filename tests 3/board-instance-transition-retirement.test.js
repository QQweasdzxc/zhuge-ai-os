const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

const retirement = read("docs/supabase/20260915_retire_board_instance_transition_task.sql");
const definition = read("docs/supabase/20260828_universal_board_contract_completion.sql");
const boardService = read("shared/board/board-read-service.js");
const engineeringTransition = read("supabase/functions/engineering-transition/index.ts");

test("board_instance_transition_task keeps its historical definition but closes application Execute", () => {
  assert.match(
    retirement,
    /revoke all on function public\.board_instance_transition_task\(\s*uuid, text, text, text\s*\)\s+from public, anon, authenticated/i
  );
  assert.match(
    retirement,
    /grant execute on function public\.board_instance_transition_task\(\s*uuid, text, text, text\s*\)\s+to service_role/i
  );
  assert.match(retirement, /comment on function public\.board_instance_transition_task/i);
  assert.doesNotMatch(retirement, /drop function public\.board_instance_transition_task/i);
  assert.doesNotMatch(retirement, /create or replace function public\.board_instance_transition_task/i);
  assert.match(definition, /create or replace function public\.board_instance_transition_task\(/i);
});

test("formal source routes do not call the retired instance transition RPC", () => {
  assert.doesNotMatch(boardService, /board_instance_transition_task/i);
  assert.doesNotMatch(engineeringTransition, /board_instance_transition_task/i);
});

test("formal C movement and the generic transition route remain distinct", () => {
  assert.match(boardService, /board_c_reconcile_workspace_decision_v2/i);
  assert.match(boardService, /board_transition_task/i);
  assert.match(engineeringTransition, /rpc\/board_transition_task/i);
});
