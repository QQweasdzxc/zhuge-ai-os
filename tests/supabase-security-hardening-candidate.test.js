const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const migrationPath = path.join(root, "docs/supabase/20260926_security_hardening_candidate.sql");
const rollbackPath = path.join(root, "docs/supabase/ROLLBACK_20260926_security_hardening_candidate.sql");

const read = file => fs.readFileSync(file, "utf8");

test("security hardening candidate is conditional, reversible, and does not mutate product data", () => {
  const sql = read(migrationPath);
  assert.match(sql, /begin;[\s\S]*commit;/i);
  assert.match(sql, /to_regclass\(view_name\)/i);
  assert.match(sql, /security_invoker\s*=\s*true/i);
  assert.match(sql, /revoke all on table %s from public, anon/i);
  assert.match(sql, /grant select on table %s to authenticated/i);
  assert.match(sql, /next_knowledge_id/i);
  assert.match(sql, /set search_path = pg_catalog, public, auth, extensions, private, pg_temp/i);
  assert.match(sql, /claim_legacy_workspace/i);
  assert.match(sql, /get_my_workspace_summary/i);
  assert.match(sql, /link_workspace_identity/i);
  assert.match(sql, /revoke execute on function %s from public, anon/i);
  assert.match(sql, /revoke execute on function %s from authenticated/i);
  assert.doesNotMatch(sql, /\b(insert|update|delete|truncate)\s+into\b/i);
  assert.doesNotMatch(sql, /drop\s+(table|view|function)\b/i);
});

test("security hardening rollback is manual and restores only catalog posture", () => {
  const sql = read(rollbackPath);
  assert.match(sql, /MANUAL PM\/DBA APPROVAL ONLY/i);
  assert.match(sql, /begin;[\s\S]*commit;/i);
  assert.match(sql, /reset \(security_invoker\)/i);
  assert.match(sql, /reset search_path/i);
  assert.match(sql, /grant select on table %s to anon, authenticated/i);
  assert.match(sql, /grant execute on function %s to anon, authenticated/i);
  assert.doesNotMatch(sql, /\b(insert|update|delete|truncate)\s+into\b/i);
  assert.doesNotMatch(sql, /drop\s+(table|view|function)\b/i);
});
