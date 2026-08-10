const test = require("node:test");
const assert = require("node:assert/strict");
const Tool = require("../tools/engineering-transition.js");

test("controlled transition permits the approved Co handoff", () => {
  assert.doesNotThrow(() => Tool.validateTransition({
    actor: "Co", currentStatus: "ready", targetStatus: "inprogress", targetAssignee: "Co"
  }));
});

test("controlled transition permits Co to hand GPT", () => {
  assert.doesNotThrow(() => Tool.validateTransition({
    actor: "Co", currentStatus: "inprogress", targetStatus: "qa", targetAssignee: "GPT"
  }));
});

test("controlled transition permits GPT fail and pass handoffs", () => {
  assert.doesNotThrow(() => Tool.validateTransition({
    actor: "GPT", currentStatus: "qa", targetStatus: "inprogress", targetAssignee: "Co"
  }));
  assert.doesNotThrow(() => Tool.validateTransition({
    actor: "GPT", currentStatus: "qa", targetStatus: "qa", targetAssignee: "QJC"
  }));
});

test("unapproved transitions and actors are rejected", () => {
  assert.throws(() => Tool.validateTransition({
    actor: "Co", currentStatus: "ready", targetStatus: "done", targetAssignee: "QJC"
  }));
  assert.throws(() => Tool.validateTransition({
    actor: "QJC", currentStatus: "ready", targetStatus: "inprogress", targetAssignee: "Co"
  }));
});

test("service key is required and only read from protected environment", () => {
  assert.throws(() => Tool.configFromEnvironment({ SUPABASE_URL: "https://example.supabase.co" }), /SERVICE_ROLE_KEY/);
  assert.deepEqual(Tool.configFromEnvironment({
    SUPABASE_URL: "https://example.supabase.co/",
    SUPABASE_SERVICE_ROLE_KEY: "secret"
  }), { url: "https://example.supabase.co", serviceRoleKey: "secret", functionUrl: "https://example.supabase.co/functions/v1/engineering-transition" });
});

test("argument parser requires explicit confirmation for writes", () => {
  assert.equal(Tool.parseArgs(["transition", "--task", "TASK-001", "--actor", "Co"]).confirm, undefined);
  assert.equal(Tool.parseArgs(["transition", "--confirm"]).confirm, true);
});
