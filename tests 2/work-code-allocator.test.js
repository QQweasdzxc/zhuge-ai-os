const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

const migration = read("docs/supabase/20260901_work_code_allocator_collision_guard.sql");
const allocatorStart = migration.indexOf("create or replace function public.allocate_board_task_work_code");
const legacyStart = migration.indexOf("create or replace function public.worktodo_assign_work_code");
const genericStart = migration.indexOf("create or replace function public.board_instance_create_task");
const allocator = migration.slice(allocatorStart, legacyStart);
const legacyAllocator = migration.slice(legacyStart, genericStart);
const genericCreate = migration.slice(genericStart);

test("shared work-code allocator skips stale registry and sequence candidates", () => {
  assert.ok(allocatorStart >= 0);
  assert.ok(legacyStart > allocatorStart);
  assert.ok(genericStart > legacyStart);
  assert.match(allocator, /pg_advisory_xact_lock[\s\S]*prefix:/);
  assert.match(allocator, /v_candidate text/);
  assert.match(allocator, /exit when not exists[\s\S]*existing\.work_code = v_candidate/);
  assert.match(allocator, /nextval\('public\.worktodo_wltk_seq'\)/);
  assert.match(allocator, /v_next := v_next \+ 1/);
  assert.match(allocator, /No available (?:board|WorkTodo|AI Board) work code could be allocated/);
});

test("legacy WorkTodo allocator uses the same collision guard", () => {
  assert.match(legacyAllocator, /pg_advisory_xact_lock[\s\S]*prefix:WLTK/);
  assert.match(legacyAllocator, /nextval\('public\.worktodo_wltk_seq'\)/);
  assert.match(legacyAllocator, /exit when not exists[\s\S]*public\.user_tasks existing/);
});

test("generic board task creation delegates work-code ownership to the shared trigger", () => {
  assert.doesNotMatch(genericCreate, /v_number/);
  assert.doesNotMatch(genericCreate, /next_task_number\s*=\s*next_task_number\s*\+/);
  assert.doesNotMatch(genericCreate, /\bwork_code\b/);
  assert.match(genericCreate, /insert into public\.board_tasks/);
  assert.match(genericCreate, /board_instance_id, workspace_id, title, summary, status, usage_scenario/);
});

test("all formal task-create RPC paths leave automatic identity allocation to Cloud", () => {
  const service = read("shared/board/board-read-service.js");
  const contract = read("docs/supabase/20260831_create_task_acceptance_criteria.sql")
    + read("docs/supabase/20260828_universal_board_contract_completion.sql");
  assert.match(service, /gateway\.rpc\("board_create_task"/);
  assert.match(service, /gateway\.rpc\("worktodo_create_task"/);
  assert.match(service, /gateway\.rpc\("board_instance_create_task"/);
  assert.match(contract, /insert into public\.board_tasks \(/);
  assert.doesNotMatch(contract, /board_instance_create_task[\s\S]{0,800}next_task_number\s*=\s*next_task_number\s*\+/);
});
