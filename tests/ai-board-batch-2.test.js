const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("Batch 2 migration defines authenticated Board boundary and no AI Auth users", () => {
  const sql = read("docs/supabase/20260809_ai_board_batch_2.sql");
  assert.match(sql, /revoke all on public\.board_tasks from anon/i);
  assert.match(sql, /board_tasks_authenticated_select/);
  assert.match(sql, /engineering_checklist_items/);
  assert.match(sql, /actor_type/);
  assert.match(sql, /actor_label/);
  assert.match(sql, /auth\.role\(\).*service_role/);
  assert.match(sql, /supabase_realtime/);
  assert.doesNotMatch(sql, /insert into auth\.users/i);
});

test("Board read service exposes workflow, checklist, RPC, and Realtime adapters", () => {
  const source = read("shared/board/board-read-service.js");
  const usageMigration = read("docs/supabase/20260809_ai_board_batch_2_usage_scenario.sql");
  assert.match(source, /loadChecklist/);
  assert.match(source, /transitionTask/);
  assert.match(source, /createChecklistItem/);
  assert.match(source, /updateChecklistItem/);
  assert.match(source, /subscribe/);
  assert.match(source, /board_transition_task/);
  assert.match(source, /board_update_checklist_item/);
  assert.match(source, /usage_scenario/);
  assert.match(source, /p_usage_scenario/);
  assert.match(usageMigration, /add column if not exists usage_scenario/i);
  assert.match(usageMigration, /p_usage_scenario/);
});

test("Shared Supabase Gateway keeps RPC and Realtime behind the shared boundary", () => {
  const source = read("shared/supabase/supabase-gateway.js");
  assert.match(source, /rpc:/);
  assert.match(source, /postgres_changes/);
  assert.match(source, /setAuth\(currentAccessToken\(\)\)/);
});
