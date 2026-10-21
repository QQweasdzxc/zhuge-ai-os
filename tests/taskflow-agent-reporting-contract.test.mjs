import test from "node:test";
import assert from "node:assert/strict";
import {
  buildNativeAgentReportMutation,
  commitNativeAgentReport,
  validateAgentHandoff,
  validateAgentReportEvent
} from "../labs/taskflow/pages-client/agent-reporting-contract.mjs";

const NOW = Date.parse("2026-10-22T12:00:00.000Z");
const context = {
  authorization: "AUTHORIZED",
  issue_id: "issue-113",
  workspace_id: "ws-1",
  executor_id: "CO-02",
  provider: "codex",
  provider_run_id: "run-113",
  session_id: "session-113",
  fencing_token: "fence-1",
  fencing_epoch: 4,
  lease_active: true,
  lease_expires_at: new Date(NOW + 60_000).toISOString(),
  seen_event_ids: []
};

function event(type, values = {}) {
  return {
    type,
    event_id: `event-${type}`,
    issue_id: "issue-113",
    workspace_id: "ws-1",
    executor_id: "CO-02",
    provider: "codex",
    provider_run_id: "run-113",
    session_id: "session-113",
    source: "codex_cloud",
    signature_verified: true,
    fencing_token: "fence-1",
    observed_at: new Date(NOW).toISOString(),
    ...values
  };
}

test("verified accepted/progress reports produce native status and audit mutation", () => {
  const validation = validateAgentReportEvent(event("progress", {progress_percent: 40, progress_summary: "reviewing"}), context, NOW);
  assert.equal(validation.accepted, true);
  assert.equal(validation.native_status, "in_progress");
  const mutation = buildNativeAgentReportMutation(validation);
  assert.equal(mutation.issue_update.status, "in_progress");
  assert.match(mutation.comment.content, /event- progress|event-progress/);
  assert.match(mutation.comment.content, /run-113/);
});

test("missing Provider ACK identity, signature, or authority fails closed", () => {
  for (const [key, value, reason] of [
    ["provider_run_id", "", "EVENT_IDENTITY_INCOMPLETE"],
    ["signature_verified", false, "PROVIDER_SIGNATURE_UNVERIFIED"],
    ["authorization", "UNVERIFIED", "CTO_AUTHORIZATION_UNVERIFIED"]
  ]) {
    const localContext = {...context};
    const input = event("accepted", {});
    if (key === "authorization") localContext.authorization = value;
    else input[key] = value;
    assert.equal(validateAgentReportEvent(input, localContext, NOW).reason, reason);
  }
});

test("scope, owner, run, lease, fencing, replay and untrusted source are rejected", () => {
  assert.equal(validateAgentReportEvent(event("progress", {progress_percent: 1}), {...context, issue_id: "other"}, NOW).reason, "TASKFLOW_SCOPE_MISMATCH");
  assert.equal(validateAgentReportEvent(event("progress", {progress_percent: 1, executor_id: "CO-01"}), context, NOW).reason, "CURRENT_OWNER_MISMATCH");
  assert.equal(validateAgentReportEvent(event("progress", {progress_percent: 1, provider_run_id: "other"}), context, NOW).reason, "RUN_SESSION_MISMATCH");
  assert.equal(validateAgentReportEvent(event("progress", {progress_percent: 1, fencing_token: "old"}), context, NOW).reason, "FENCING_TOKEN_MISMATCH");
  assert.equal(validateAgentReportEvent(event("progress", {progress_percent: 1}), {...context, lease_active: false}, NOW).reason, "LEASE_EXPIRED");
  assert.equal(validateAgentReportEvent(event("progress", {progress_percent: 1}), {...context, seen_event_ids: ["event-progress"]}, NOW).reason, "EVENT_REPLAY");
  assert.equal(validateAgentReportEvent(event("progress", {progress_percent: 1, source: "github_comment"}), context, NOW).reason, "PROVIDER_SOURCE_UNVERIFIED");
});

test("blocked, checkpoint, interruption, review and completion require their evidence", () => {
  for (const [type, reason] of [["blocked", "BLOCKED_REASON_MISSING"], ["checkpoint", "CHECKPOINT_REF_MISSING"], ["interrupted_by_pm", "STOP_EVIDENCE_MISSING"], ["review_requested", "REVIEW_EVIDENCE_MISSING"], ["completed", "COMPLETION_EVIDENCE_MISSING"]]) {
    assert.equal(validateAgentReportEvent(event(type), context, NOW).reason, reason);
  }
  const completed = validateAgentReportEvent(event("completed", {completion_evidence: "commit:abc"}), context, NOW);
  assert.equal(completed.state, "DONE");
  assert.equal(completed.native_status, "done");
});

test("native write cannot claim success without a transactional adapter", async () => {
  const validation = validateAgentReportEvent(event("accepted"), context, NOW);
  const blocked = await commitNativeAgentReport(validation, null);
  assert.equal(blocked.accepted, false);
  assert.equal(blocked.reason, "NATIVE_MUTATION_ADAPTER_UNWIRED");
  const committed = await commitNativeAgentReport(validation, {applyAgentReportMutation: async mutation => ({committed: mutation.issue_update.status === "in_progress"})});
  assert.equal(committed.accepted, true);
});

test("PM stop is required before a cross-engineer handoff", () => {
  const base = {issue_id: "issue-113", fencing_epoch: 4, lease_active: false};
  assert.equal(validateAgentHandoff({issue_id: "issue-113", next_executor_id: "CO-01", next_provider: "codex", next_fencing_epoch: 5}, base).reason, "STOP_EVIDENCE_MISSING");
  const handoff = validateAgentHandoff({issue_id: "issue-113", stop_evidence: "provider-stop-event", next_executor_id: "CO-01", next_provider: "codex", next_fencing_epoch: 5}, base);
  assert.equal(handoff.accepted, true);
  assert.equal(handoff.state, "REASSIGN_REVIEW");
});
