const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Broker = require("../tools/engineering-actor-broker.js");
const MemoryTool = require("../tools/engineering-memory-startup-gate.js");

const root = path.resolve(__dirname, "..");

test("existing engineering-transition Edge Function has an isolated read-only memory capability", () => {
  const source = fs.readFileSync(path.join(root, "supabase/functions/engineering-transition/index.ts"), "utf8");
  assert.match(source, /engineering-memory-read/);
  assert.match(source, /engineering-memory:read/);
  assert.match(source, /operation !== "startup_gate"/);
  assert.match(source, /rpc\/resolve_engineering_startup_gate/);
  assert.match(source, /cannot write or transition/);
  const readStart = source.indexOf('if (actorToken.profile === "memory-read")');
  const readEnd = source.indexOf("const task = await findTask", readStart);
  assert.ok(readStart >= 0 && readEnd > readStart);
  assert.doesNotMatch(source.slice(readStart, readEnd), /board_transition_task|board_update_checklist_item|findTask/);
});

test("protected Startup Gate consumer has no browser or write credential path", () => {
  const source = fs.readFileSync(path.join(root, "tools/engineering-memory-startup-gate.js"), "utf8");
  assert.match(source, /ENGINEERING_ACTOR_TOKEN/);
  assert.doesNotMatch(source, /SERVICE_ROLE|service.role|service_role/i);
  assert.doesNotMatch(source, /operation\s*===\s*["'](?:inspect|checklist|transition)["']/i);
  const config = MemoryTool.configFromEnvironment({
    SUPABASE_URL: "https://example.supabase.co",
    ENGINEERING_ACTOR_TOKEN: "short-lived"
  });
  assert.equal(config.functionUrl, "https://example.supabase.co/functions/v1/engineering-transition");
});

test("memory-read token reuses the existing Co/GPT actor identity with least privilege claims", () => {
  const { privateKey } = require("node:crypto").generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const token = Broker.issueActorToken("Co", { privateJwk: privateKey.export({ format: "jwk" }), profile: "memory-read" });
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  assert.equal(payload.sub, "ai:Co");
  assert.equal(payload.aud, "engineering-memory-read");
  assert.equal(payload.scope, "engineering-memory:read");
  assert.equal(payload.actor_type, "ai");
  assert.equal(payload.service_role, undefined);
});
