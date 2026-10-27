import test from "node:test";
import assert from "node:assert/strict";
import { createTaskflowCodexHandoffBridge,
  verifyApprovalRefUnconfigured, verifyZeroAdditionalCostUnconfigured
} from "../labs/cloud-handoff/taskflow-provider-bridge.mjs";

test("default PM and zero-cost verifiers deny", async () => {
  assert.equal(await verifyApprovalRefUnconfigured({}), false);
  assert.equal(await verifyZeroAdditionalCostUnconfigured({}), false);
});

test("cloud-handoff bridge cannot authorize through untrusted envelope functions", async () => {
  let launched = 0;
  const bridge = createTaskflowCodexHandoffBridge({
    launchGithubMention: async () => { launched++; return { state: "PENDING_ACK" }; }
  });
  await assert.rejects(bridge.dispatch({
    snapshot: { next_actor: "co" },
    approvalId: "legitimate-reference-001",
    verifyApprovalRef: async () => true,
    verifyZeroAdditionalCost: async () => true
  }), /trusted adapters required|taskflow|approval|mapping/i);
  assert.equal(launched, 0);
});

test("missing official transport never emits a run", async () => {
  const bridge = createTaskflowCodexHandoffBridge();
  await assert.rejects(bridge.dispatch({
    snapshot: { next_actor: "co" },
    approvalId: "legitimate-reference-001"
  }));
});
