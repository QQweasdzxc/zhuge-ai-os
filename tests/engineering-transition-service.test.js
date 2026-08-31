const test = require("node:test");
const assert = require("node:assert/strict");
const Tool = require("../tools/engineering-transition.js");

test("controlled transition requires Cloud Claim for Co ready handoff", () => {
  assert.throws(() => Tool.validateTransition({
    actor: "Co", currentStatus: "ready", targetStatus: "inprogress", targetAssignee: "Co"
  }), /board_claim_next_task/);
});

test("controlled transition permits Co to hand GPT", () => {
  assert.doesNotThrow(() => Tool.validateTransition({
    actor: "Co", currentStatus: "inprogress", targetStatus: "qa", targetAssignee: "GPT"
  }));
});

test("controlled transition permits Co to return work to ready", () => {
  assert.doesNotThrow(() => Tool.validateTransition({
    actor: "Co", currentStatus: "inprogress", targetStatus: "ready", targetAssignee: "Co"
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

test("controlled checklist evidence is limited to the matching AI stage", () => {
  assert.doesNotThrow(() => Tool.validateChecklist({
    actor: "Co", stage: "co", state: "pass", evidenceNote: "Developer QA passed"
  }));
  assert.doesNotThrow(() => Tool.validateChecklist({
    actor: "GPT", stage: "gpt", state: "fail", evidenceRef: "commit:abc123"
  }));
  assert.throws(() => Tool.validateChecklist({
    actor: "Co", stage: "gpt", state: "pass", evidenceNote: "wrong stage"
  }), /only update/);
  assert.throws(() => Tool.validateChecklist({
    actor: "GPT", stage: "gpt", state: "pass"
  }), /Evidence/);
});

test("actor token is required and service key is not read by the tool", () => {
  assert.throws(() => Tool.configFromEnvironment({ SUPABASE_URL: "https://example.supabase.co" }), /ACTOR_TOKEN/);
  assert.deepEqual(Tool.configFromEnvironment({
    SUPABASE_URL: "https://example.supabase.co/",
    ENGINEERING_ACTOR_TOKEN: "actor-token"
  }), { url: "https://example.supabase.co", actorToken: "actor-token", functionUrl: "https://example.supabase.co/functions/v1/engineering-transition" });
});

test("argument parser requires explicit confirmation for writes", () => {
  assert.equal(Tool.parseArgs(["transition", "--task", "TASK-001", "--actor", "Co"]).confirm, undefined);
  assert.equal(Tool.parseArgs(["transition", "--confirm"]).confirm, true);
});

test("claim contract validates bounded idempotency and lease values", () => {
  assert.equal(Tool.boundedIdempotencyKey("co-claim-001"), "co-claim-001");
  assert.equal(Tool.boundedLeaseSeconds("900"), 900);
  assert.throws(() => Tool.boundedIdempotencyKey("short"), /idempotency-key/);
  assert.throws(() => Tool.boundedLeaseSeconds("30"), /lease-seconds/);
});

test("expired Claim reclaim requires an explicit target and is dry-run by default", async () => {
  const result = await Tool.reclaimExpiredClaim({
    functionUrl: "https://example.supabase.co/functions/v1/engineering-transition"
  }, {
    task: "TASK-055",
    actor: "Co",
    "expired-claim-token": "00000000-0000-0000-0000-000000000001",
    "idempotency-key": "co-reclaim-001",
    "lease-seconds": "900"
  });
  assert.deepEqual(result, {
    dryRun: true,
    service: "https://example.supabase.co/functions/v1/engineering-transition",
    operation: "reclaim_expired_claim",
    actor: "Co",
    task: "TASK-055",
    expiredClaimTokenProvided: true,
    idempotencyKey: "co-reclaim-001",
    leaseSeconds: 900
  });
});

test("Specific Task Claim requires an explicit Co target and is dry-run by default", async () => {
  const result = await Tool.claimSpecificTask({
    functionUrl: "https://example.supabase.co/functions/v1/engineering-transition"
  }, {
    task: "TASK-058",
    actor: "Co",
    "idempotency-key": "co-specific-001",
    "lease-seconds": "900"
  });
  assert.deepEqual(result, {
    dryRun: true,
    service: "https://example.supabase.co/functions/v1/engineering-transition",
    operation: "claim_specific_task",
    actor: "Co",
    task: "TASK-058",
    idempotencyKey: "co-specific-001",
    leaseSeconds: 900
  });
});

test("Specific Task Claim rejects non-Co actors before any Cloud request", async () => {
  await assert.rejects(
    Tool.claimSpecificTask({ functionUrl: "https://example.supabase.co/functions/v1/engineering-transition" }, {
      task: "TASK-058",
      actor: "GPT",
      "idempotency-key": "gpt-specific-001"
    }),
    /actor Co/
  );
});

test("QJC reconciliation requires the GPT actor and is dry-run by default", async () => {
  const result = await Tool.reconcileQjcToCoReady({
    functionUrl: "https://example.supabase.co/functions/v1/engineering-transition"
  }, {
    task: "TASK-055",
    actor: "GPT",
    "idempotency-key": "qjc-reconcile-001"
  });
  assert.deepEqual(result, {
    dryRun: true,
    service: "https://example.supabase.co/functions/v1/engineering-transition",
    operation: "reconcile_qjc_to_co_ready",
    actor: "GPT",
    task: "TASK-055",
    idempotencyKey: "qjc-reconcile-001"
  });
});
