const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const source = fs.readFileSync(path.join(root, "supabase/functions/engineering-actor-broker/index.ts"), "utf8");
const migration = fs.readFileSync(path.join(root, "docs/supabase/20260921_engineering_actor_broker_issuer.sql"), "utf8");

test("Broker is a protected GPT-only issuance surface, not a Board transition surface", () => {
  assert.match(source, /ENGINEERING_BROKER_CALLER_JWKS/);
  assert.match(source, /ENGINEERING_ACTOR_PRIVATE_JWK/);
  assert.match(source, /x-zhuge-broker-signature/);
  assert.match(source, /actor_label: ACTOR_LABEL/);
  assert.match(source, /const ACTOR_LABEL = "GPT"/);
  assert.match(source, /const MAX_TTL_SECONDS = 300/);
  assert.match(source, /record_engineering_actor_token_issuance/);
  assert.match(source, /CAPABILITY_NOT_ALLOWLISTED/);
  assert.doesNotMatch(source, /rpc\/board_/);
  assert.doesNotMatch(source, /console\.(log|error|warn)/);
});

test("Broker issuance audit is server-role-only, replay-safe, and stores no token", () => {
  assert.match(migration, /private\.engineering_actor_token_issuances/);
  assert.match(migration, /request_id uuid not null unique/);
  assert.match(migration, /jti uuid not null unique/);
  assert.match(migration, /auth\.jwt\(\) ->> 'role'.*service_role/s);
  assert.match(migration, /grant execute on function public\.record_engineering_actor_token_issuance/);
  assert.match(migration, /to service_role/);
  assert.doesNotMatch(migration, /token text|private_jwk|service_role_key/i);
});

test("Broker cannot issue governance-write or non-GPT capabilities", () => {
  assert.match(source, /text\(value\.profile, 80\) !== ACTOR_PROFILE/);
  assert.match(source, /text\(value\.actor, 40\) !== ACTOR_LABEL/);
  assert.match(source, /text\(value\.purpose, 120\) !== "engineering-transition"/);
  assert.match(source, /CALLER_REQUEST_REPLAYED/);
});
