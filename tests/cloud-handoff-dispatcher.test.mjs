import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { transitionHandoff } from "../labs/cloud-handoff/contract.mjs";
import { dispatchCloud } from "../labs/cloud-handoff/dispatcher.mjs";

function ready() {
  const path = new URL("../labs/cloud-handoff/examples/issue45-quota-blocked.json", import.meta.url);
  const r = JSON.parse(readFileSync(path, "utf8"));
  r.source.clean = true; r.source.dirty_files = 0;
  return transitionHandoff(r, {
    action: "writer_stopped", actor: "co", expected_revision: 0,
    at: "2026-10-15T06:00:00Z", stop_evidence: "provider-worker-stop-receipt"
  });
}
function args(overrides = {}) {
  return {
    snapshot: ready(), actor: "gem", now: "2026-10-15T06:05:00Z",
    leaseId: "unique-dispatcher-lease-123", leaseUntil: "2026-10-15T07:05:00Z",
    verifyGitHead: async () => true,
    verifyWorkerStopped: async () => true,
    claimWithCas: async ({ next }) => ({ committed: true, revision: next.revision }),
    launchProvider: async () => ({ runId: "gem-run-id" }),
    ...overrides
  };
}
test("never launch blocked dirty Issue #45", async () => {
  let launches = 0;
  const a = args({ snapshot: JSON.parse(readFileSync(new URL("../labs/cloud-handoff/examples/issue45-quota-blocked.json", import.meta.url), "utf8")), launchProvider: async()=>{launches++;return {runId:"unsafe"};} });
  await assert.rejects(dispatchCloud(a), /handoff_not_ready/);
  assert.equal(launches, 0);
});
test("live Git or old worker stop mismatch blocks before CAS and launch", async () => {
  for (const override of [
    { verifyGitHead: async () => false },
    { verifyWorkerStopped: async () => false }
  ]) {
    let claimed = 0; let launched = 0;
    const a = args({
      ...override,
      claimWithCas: async () => { claimed++; return { committed: true, revision: 2 }; },
      launchProvider: async () => { launched++; return {runId:"x"}; }
    });
    await assert.rejects(dispatchCloud(a), /dispatch blocked/);
    assert.equal(claimed, 0); assert.equal(launched, 0);
  }
});
test("stale CAS cannot launch and successful CAS launches exactly once", async () => {
  let launches = 0;
  const a = args({ claimWithCas: async () => ({ committed: false }), launchProvider: async () => { launches++; return {runId:"bad"}; } });
  await assert.rejects(dispatchCloud(a), /atomic ownership claim/);
  assert.equal(launches, 0);
  const b = args({ launchProvider: async () => { launches++;return { runId: "real-gem-job" }; } });
  const launched = await dispatchCloud(b);
  assert.deepEqual(launched, { state: "LAUNCHED", runId: "real-gem-job", claimedRevision: 2 });
  assert.equal(launches, 1);
});
test("unknown provider launch result quarantines existing claim; no implicit retry", async () => {
  let claims = 0;
  const a = args({
    claimWithCas: async ({next}) => { claims++;return {committed:true,revision:next.revision}; },
    launchProvider: async () => { throw new Error("timeout after task request"); }
  });
  await assert.rejects(dispatchCloud(a), /needs reconciliation/);
  assert.equal(claims, 1);
});
test("missing trusted adapter cannot execute a cloud task", async () => {
  await assert.rejects(dispatchCloud(args({ launchProvider:null })), /trusted provider and CAS adapters/);
});
