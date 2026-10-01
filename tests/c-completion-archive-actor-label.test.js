const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const migration = fs.readFileSync(
  path.join(__dirname, "../docs/supabase/20260915_c_completion_archive_actor_label_system.sql"),
  "utf8"
);

test("C archive hotfix keeps System as the persisted actor taxonomy", () => {
  assert.match(migration, /p_actor_label\s+text\s+default\s+'Module C'/);
  assert.match(migration, /p_actor_id,\s*'system',\s*'System',\s*'system_activity'/);
  assert.doesNotMatch(migration, /p_actor_id,\s*'system',\s*coalesce\([^;]+p_actor_label/);
  assert.match(migration, /'stored_actor_label',\s*'System'/);
});

test("C archive hotfix preserves Module C and scheduler provenance without adding actor labels", () => {
  assert.match(migration, /'source_actor_label',\s*v_source_actor_label/);
  assert.match(migration, /'source_actor_label',\s*'Module C Background Scheduler'/);
  assert.match(migration, /'Module C optional-Workflow completion archive reconciliation'/);
  assert.match(migration, /'Module C instance-scoped completion archive reconciliation'/);
  assert.match(migration, /'Module C Background Scheduler error evidence'/);
  assert.doesNotMatch(migration, /actor_label\s+text\s+default\s+'Module C Background Scheduler'/);
  assert.match(migration, /'board_instance',\s*v_instance\.board_instance_id::text/);
  assert.doesNotMatch(migration, /'completion_archive_scheduler',\s*v_instance\.board_instance_id::text/);
});

test("C archive hotfix preserves the canonical 24h policy and shared authority", () => {
  assert.match(migration, /module-c-canonical-completion-archive-lifecycle/);
  assert.match(migration, /module-c-lifecycle-acceptance-v2/);
  assert.doesNotMatch(migration, /172800|48\s*hours|2\s*days/i);
  assert.match(migration, /existing_due_at_retroactive',\s*false/);
});

test("C archive scheduler has a private, archive-only trigger authorization gate", () => {
  assert.match(migration, /set_config\('zhuge\.module_c_completion_archive_scheduler',\s*'1',\s*true\)/);
  assert.match(migration, /current_user\s*=\s*'postgres'/);
  assert.match(migration, /v_instance\.template_key\s*=\s*'c'/);
  assert.match(migration, /old\.archived_at\s+is\s+null/);
  assert.match(migration, /new\.archived_at\s+is\s+not\s+null/);
  assert.match(migration, /new\.archive_due_at\s+<=\s*clock_timestamp\(\)/);
  assert.match(migration, /to_jsonb\(old\)\s*-\s*'archived_at'\s*-\s*'archived_by'\s*-\s*'updated_at'/);
});
