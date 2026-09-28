const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("WorkTodo progress-note corrective migration uses the canonical human actor label", () => {
  const sql = read("docs/supabase/20260824_worktodo_progress_note_actor_label.sql");
  assert.match(sql, /create or replace function public\.worktodo_add_task_progress_note\(\s*p_task_id uuid,\s*p_note text/is);
  assert.match(sql, /application_scope = 'worktodo'/i);
  assert.match(sql, /actor_type,\s*actor_label,\s*activity_type/is);
  assert.match(sql, /'human',\s*'QJC',\s*'human_progress_note'/is);
  assert.doesNotMatch(sql, /actor_label[\s\S]{0,220}'WorkTodo'/i);
  assert.match(sql, /revoke all on function public\.worktodo_add_task_progress_note\(uuid, text\) from public, anon/i);
  assert.match(sql, /grant execute on function public\.worktodo_add_task_progress_note\(uuid, text\) to authenticated/i);
});
