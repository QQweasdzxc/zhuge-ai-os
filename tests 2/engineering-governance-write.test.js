const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Broker = require("../tools/engineering-actor-broker.js");
const GovernanceTool = require("../tools/engineering-governance-write.js");

const root = path.resolve(__dirname, "..");

test("governance-write reuses the existing Edge Function with a GPT-only profile and operation boundary", () => {
  const source = fs.readFileSync(path.join(root, "supabase/functions/engineering-transition/index.ts"), "utf8");
  assert.match(source, /engineering-governance-write/);
  assert.match(source, /engineering-governance:write/);
  assert.match(source, /new Set\(\["GPT"\]\)/);
  assert.match(source, /operation !== "governance_write"/);
  assert.match(source, /execute_engineering_governance_write/);
  assert.match(source, /create_task_contract/);
  assert.match(source, /update_task_contract/);
  assert.match(source, /update_checkpoint/);
  assert.match(source, /register_artifact/);
  assert.match(source, /create_engineering_principle/);
  const governanceStart = source.indexOf('if (actorToken.profile === "governance-write")');
  const governanceEnd = source.indexOf('if (actorToken.profile === "memory-read")', governanceStart);
  assert.ok(governanceStart >= 0 && governanceEnd > governanceStart);
  assert.doesNotMatch(source.slice(governanceStart, governanceEnd), /knowledge_code|engineering_knowledge|board_create_task.*(?:insert|update|delete)/i);
});

test("governance write tool requires both capabilities and has no direct SQL or service key", () => {
  const source = fs.readFileSync(path.join(root, "tools/engineering-governance-write.js"), "utf8");
  assert.match(source, /ENGINEERING_ACTOR_TOKEN/);
  assert.match(source, /PM_AUTHORIZATION_TOKEN/);
  assert.doesNotMatch(source, /SERVICE_ROLE|service_role|supabase_execute_sql|insert into|update .*set|delete from/i);
  assert.deepEqual([...GovernanceTool.ALLOWED_OPERATIONS], ["create_task_contract", "update_task_contract", "update_checkpoint", "register_artifact", "create_engineering_principle"]);
  assert.throws(() => GovernanceTool.parsePayload("[]"), /JSON object/);
  return assert.rejects(
    GovernanceTool.writeGovernance({ actorToken: "a", pmAuthorizationToken: "p", functionUrl: "https://example.com" }, "set_baseline", {}),
    /not allowlisted/
  );
});

test("governance migration binds PM authorization to an opaque one-time token and existing write RPCs", () => {
  const migration = fs.readFileSync(path.join(root, "docs/supabase/20260814_pm_authorized_governance_write.sql"), "utf8");
  assert.match(migration, /create table if not exists public\.engineering_governance_authorizations/i);
  assert.match(migration, /public\.is_engineering_member\(array\['owner'\]\)/i);
  assert.match(migration, /extensions\.gen_random_bytes\(32\)/i);
  assert.match(migration, /request_hash/);
  assert.match(migration, /used_at/);
  assert.match(migration, /public\.board_create_task\(/i);
  assert.match(migration, /public\.board_tasks/);
  assert.match(migration, /pm_authorized_task_contract_update/);
  assert.match(migration, /public\.write_engineering_checkpoint\(/i);
  assert.match(migration, /grant execute on function public\.execute_engineering_governance_write\(text, text, jsonb, text\) to service_role/i);
  assert.match(migration, /revoke all on function public\.execute_engineering_governance_write\(text, text, jsonb, text\) from public, anon, authenticated/i);
  assert.doesNotMatch(migration, /engineering_knowledge\s+(?:insert|update|delete)/i);
  assert.match(migration, /register_engineering_artifact/);
  assert.match(migration, /register_artifact/);
  assert.doesNotMatch(migration, /set_engineering_pm_accepted_baseline/);

  const principleMigration = fs.readFileSync(path.join(root, "docs/supabase/20260821_ep_039_principle_write_governance.sql"), "utf8");
  assert.match(principleMigration, /create_engineering_principle/);
  assert.match(principleMigration, /public\.engineering_knowledge/);
  assert.match(principleMigration, /pm_authorized_principle_created/);
  assert.match(principleMigration, /knowledge_code.*EP-\[0-9\]\{3\}/s);
  assert.doesNotMatch(principleMigration, /grant .*engineering_knowledge/i);
});

test("governance broker token has no privileged database claims", () => {
  const { privateKey } = require("node:crypto").generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const token = Broker.issueActorToken("GPT", { privateJwk: privateKey.export({ format: "jwk" }), profile: "governance-write" });
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  assert.equal(payload.actor_type, "ai");
  assert.equal(payload.role, undefined);
  assert.equal(payload.service_role, undefined);
});

test("the task create acceptance-criteria migration extends only the governed create contract", () => {
  const migration = fs.readFileSync(path.join(root, "docs/supabase/20260831_create_task_acceptance_criteria.sql"), "utf8");
  assert.match(migration, /board_create_task\(\s*text,\s*text,\s*text,\s*text,\s*text,\s*text,\s*uuid,\s*text\s*\)/i);
  assert.match(migration, /acceptance_criteria/);
  assert.match(migration, /where name not in \('title', 'summary', 'usage_scenario', 'priority', 'acceptance_criteria'\)/i);
  assert.match(migration, /p_acceptance_criteria\s*=>\s*payload->>'acceptance_criteria'/i);
  assert.match(migration, /revoke all on function public\.board_create_task\(text, text, text, text, text, text, uuid, text\) from public, anon/i);
  assert.match(migration, /grant execute on function public\.board_create_task\(text, text, text, text, text, text, uuid, text\) to authenticated, service_role/i);
  assert.doesNotMatch(migration, /alter table public\.board_tasks/i);
  assert.doesNotMatch(migration, /drop policy|create policy|enable row level security/i);
});
