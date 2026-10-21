import test from "node:test";
import assert from "node:assert/strict";
import {authorizeCtoCompletion, buildNativeAgentReportMutation, commitCtoCompletion, commitNativeAgentReport, validateAgentHandoff, validateAgentReportEvent} from "../labs/taskflow/pages-client/agent-reporting-contract.mjs";

const NOW = Date.parse("2026-10-22T12:00:00.000Z");
const context = {
  authorization: "AUTHORIZED", issue_id: "issue-113", workspace_id: "ws-1", dispatch_id: "dispatch-113", executor_id: "CO-02", provider: "codex", provider_run_id: "run-113", session_id: "session-113", fencing_token: "fence-1", fencing_epoch: 4, lease_active: true, lease_expires_at: new Date(NOW + 60_000).toISOString(), native_status: "in_progress", last_event_sequence: 0,
  provider_attestation: {verified: true, source: "SERVER_PROVIDER_VERIFIER", event_id: "event-progress", provider: "codex", provider_run_id: "run-113", session_id: "session-113", transport: "codex_cloud"},
  atomic_event_claim: {status: "CLAIMED", event_id: "event-progress", sequence: 1, fencing_epoch: 4}
};

function event(type, values = {}) {
  return {type, event_id: `event-${type}`, sequence: 1, fencing_epoch: 4, issue_id: "issue-113", workspace_id: "ws-1", dispatch_id: "dispatch-113", executor_id: "CO-02", provider: "codex", provider_run_id: "run-113", session_id: "session-113", source: "codex_cloud", signature_verified: true, fencing_token: "fence-1", observed_at: new Date(NOW).toISOString(), ...values};
}

function trustedContext(type, overrides = {}) {
  const e = event(type);
  return {...context, provider_attestation: {...context.provider_attestation, event_id: e.event_id}, atomic_event_claim: {...context.atomic_event_claim, event_id: e.event_id}, ...overrides};
}

test("completed is review request, never native DONE", () => {
  const result = validateAgentReportEvent(event("completed", {completion_evidence: "commit:abc"}), trustedContext("completed"), NOW);
  assert.equal(result.accepted, true);
  assert.equal(result.state, "REVIEW");
  assert.equal(result.native_status, "in_review");
  assert.notEqual(result.native_status, "done");
});

test("only server-bound CTO review can authorize DONE", async () => {
  const review = {issue_id: "issue-113", workspace_id: "ws-1", task_revision: 7, completion_event_id: "event-completed", review_event_id: "cto-review-1", reviewer_user_id: "cto-1", reviewed_at: new Date(NOW).toISOString()};
  const base = {server_authority: "CTO_ALLOWLIST_VERIFIED", native_status: "in_review", issue_id: "issue-113", workspace_id: "ws-1", completion_event_id: "event-completed", issue_revision: 7, server_now: NOW, server_reviewer_principal: {verified: true, source: "TASKFLOW_AUTHORITY", allowlisted: true, role: "CTO", user_id: "cto-1", workspace_id: "ws-1"}, atomic_event_claim: {status: "CLAIMED", event_id: "cto-review-1", task_revision: 7}};
  const completion = authorizeCtoCompletion(review, base);
  assert.equal(completion.accepted, true);
  assert.equal(completion.state, "CTO_REVIEW_AUTHORIZED");
  assert.equal((await commitCtoCompletion(completion, null)).reason, "NATIVE_WRITE_UNWIRED");
  const committed = await commitCtoCompletion(completion, {applyCtoCompletion: async () => ({committed: true, status: "done", review_event_id: "cto-review-1", atomic: true})});
  assert.equal(committed.native_status, "done");
  assert.equal(authorizeCtoCompletion({...review, reviewer_user_id: "attacker"}, base).reason, "CTO_REVIEWER_IDENTITY_MISMATCH");
  assert.equal(authorizeCtoCompletion(review, {...base, server_reviewer_principal: {...base.server_reviewer_principal, verified: false}}).reason, "CTO_REVIEWER_IDENTITY_UNVERIFIED");
  assert.equal(authorizeCtoCompletion(review, {...base, issue_revision: 6}).reason, "REVIEW_REVISION_MISMATCH");
  assert.equal(authorizeCtoCompletion(review, {...base, review_replay_claimed: true}).reason, "REVIEW_EVENT_REPLAY");
});

test("readable reports contain summary, blockers, questions, checkpoint, stop and next step without secrets", () => {
  const result = validateAgentReportEvent(event("blocked", {progress_percent: 45, progress_summary: "token=secret-value completed analysis", blocked_reason: "waiting for API", next_step: "ask CTO"}), trustedContext("blocked"), NOW);
  const mutation = buildNativeAgentReportMutation(result);
  assert.match(mutation.comment.content, /工作進度|Agent 回報工程卡關/);
  assert.match(mutation.comment.content, /摘要：token=\[REDACTED\]/);
  assert.match(mutation.comment.content, /卡關原因：waiting for API/);
  assert.match(mutation.comment.content, /下一步：ask CTO/);
  assert.doesNotMatch(mutation.comment.content, /secret-value/);
  assert.match(mutation.comment.content, /event-blocked/);
  assert.match(mutation.comment.content, /run-113/);
  assert.doesNotMatch(mutation.comment.content, /secret-value/);
  assert.deepEqual(Object.keys(mutation.audit).sort(), ["detail_refs", "dispatch_id", "event_id", "executor_id", "fencing_epoch", "issue_id", "observed_at", "provider", "provider_run_id", "schema", "sequence", "session_id", "source", "state", "type", "workspace_id"].sort());
});

test("full public comment never re-emits credential values in audit JSON", () => {
  for (const [label, value] of [["Token", "token=private-token-113"], ["Password", "password=private-password-113"], ["API Key", "api_key=private-api-key-113"], ["Secret", "secret=private-secret-113"]]) {
    const result = validateAgentReportEvent(event("blocked", {progress_summary: `${label} ${value}`, blocked_reason: value, next_step: value, checkpoint_ref: value}), trustedContext("blocked"), NOW);
    const comment = buildNativeAgentReportMutation(result).comment.content;
    assert.doesNotMatch(comment, /private-(token|password|api-key|secret)-113/);
    assert.match(comment, /protected:/);
  }
});

test("client signature and stop strings cannot establish trust", () => {
  const forged = event("progress", {progress_percent: 1, signature_verified: true});
  assert.equal(validateAgentReportEvent(forged, {...trustedContext("progress"), provider_attestation: undefined}, NOW).reason, "PROVIDER_ATTESTATION_UNVERIFIED");
  const handoff = {issue_id: "issue-113", stop_evidence: "I stopped", next_executor_id: "CO-01", next_provider: "codex", next_fencing_epoch: 5};
  assert.equal(validateAgentHandoff(handoff, {issue_id: "issue-113", provider_run_id: "run-113", server_runtime_readback: {source: "TASKFLOW_RUNTIME_READ_MODEL", issue_id: "issue-113", lease_active: false, fencing_epoch: 4}, stop_attestation: undefined}).reason, "STOP_ATTESTATION_UNVERIFIED");
});

test("handoff requires server stop attestation and monotonic fencing", () => {
  const base = {issue_id: "issue-113", provider_run_id: "run-113", server_runtime_readback: {source: "TASKFLOW_RUNTIME_READ_MODEL", issue_id: "issue-113", lease_active: false, fencing_epoch: 4}};
  const input = {issue_id: "issue-113", stop_evidence: "client claim", next_executor_id: "CO-01", next_provider: "codex", next_fencing_epoch: 5};
  assert.equal(validateAgentHandoff(input, base).reason, "STOP_ATTESTATION_UNVERIFIED");
  const verified = validateAgentHandoff(input, {...base, stop_attestation: {verified: true, source: "SERVER_PROVIDER_VERIFIER", issue_id: "issue-113", provider_run_id: "run-113"}});
  assert.equal(verified.accepted, true);
  assert.equal(validateAgentHandoff({...input, next_fencing_epoch: 4}, {...base, stop_attestation: {verified: true, source: "SERVER_PROVIDER_VERIFIER", issue_id: "issue-113", provider_run_id: "run-113"}}).reason, "FENCING_EPOCH_NOT_MONOTONIC");
});

test("replay, out-of-order, old epoch and review-gate regressions fail closed", () => {
  assert.equal(validateAgentReportEvent(event("progress", {progress_percent: 1}), trustedContext("progress", {last_event_sequence: 1}), NOW).reason, "EVENT_OUT_OF_ORDER");
  assert.equal(validateAgentReportEvent(event("progress", {progress_percent: 1, sequence: 0}), trustedContext("progress", {atomic_event_claim: {...trustedContext("progress").atomic_event_claim, sequence: 0}, last_event_sequence: 1}), NOW).reason, "EVENT_OUT_OF_ORDER");
  assert.equal(validateAgentReportEvent(event("progress", {progress_percent: 1, fencing_epoch: 3}), trustedContext("progress"), NOW).reason, "FENCING_EPOCH_MISMATCH");
  assert.equal(validateAgentReportEvent(event("progress", {progress_percent: 1}), trustedContext("progress", {native_status: "in_review"}), NOW).reason, "REVIEW_GATE_LOCKED");
});

test("question waits for CTO decision and does not enter review", () => {
  const result = validateAgentReportEvent(event("question_to_cto", {question: "Which scope should I use?"}), trustedContext("question_to_cto"), NOW);
  assert.equal(result.state, "WAITING_CTO_DECISION");
  assert.equal(result.native_status, "blocked");
  assert.equal(buildNativeAgentReportMutation(result).issue_update.decision_scope, "CTO_QUESTION");
});

test("native mutation remains blocked without atomic commit evidence", async () => {
  const validation = validateAgentReportEvent(event("accepted"), trustedContext("accepted"), NOW);
  assert.equal((await commitNativeAgentReport(validation, null)).reason, "NATIVE_MUTATION_ADAPTER_UNWIRED");
  assert.equal((await commitNativeAgentReport(validation, {applyAgentReportMutation: async () => ({committed: true, event_id: "wrong", atomic_event_claimed: false})})).reason, "NATIVE_MUTATION_NOT_ATOMIC");
  const committed = await commitNativeAgentReport(validation, {applyAgentReportMutation: async mutation => ({committed: true, event_id: mutation.atomic_event_claim.event_id, atomic_event_claimed: true})});
  assert.equal(committed.accepted, true);
});

test("CO-01 compatibility fixture keeps unsupported runtime evidence fail-closed", async () => {
  const result = validateAgentReportEvent(event("progress", {progress_percent: 20}), trustedContext("progress"), NOW);
  assert.equal(result.accepted, true);
  assert.equal(result.event.dispatch_id, "dispatch-113");
  assert.equal(result.event.provider_run_id, "run-113");
  assert.equal(result.event.session_id, "session-113");
  assert.equal((await commitCtoCompletion({accepted: true, review: {issue_id: "issue-113", workspace_id: "ws-1", task_revision: 1, completion_event_id: "done-1", review_event_id: "review-1", reviewer_user_id: "cto-1"}}, null)).reason, "NATIVE_WRITE_UNWIRED");
});
