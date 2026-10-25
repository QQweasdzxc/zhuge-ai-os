import test from "node:test";
import assert from "node:assert/strict";
import {attachProtectedDetailRefs, authorizeCtoCompletion, buildNativeAgentReportMutation, commitCtoCompletion, commitNativeAgentReport, createNativeAgentAtomicWriteAdapter, receiveNativeAgentReport, validateAgentHandoff, validateAgentReportEvent} from "../labs/taskflow/pages-client/agent-reporting-contract.mjs";

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
  assert.match(mutation.comment.content, /公開摘要：詳細內容已存於受保護 Detail Store/);
  assert.match(mutation.comment.content, /詳情：需經授權後由 Detail Store 查閱/);
  assert.doesNotMatch(mutation.comment.content, /waiting for API|ask CTO|secret-value/);
  assert.match(mutation.comment.content, /event-blocked/);
  assert.match(mutation.comment.content, /run-113/);
  assert.doesNotMatch(mutation.comment.content, /secret-value/);
  assert.doesNotMatch(mutation.comment.content, /稽核識別|detail_refs|vault:\/\//);
  assert.deepEqual(Object.keys(mutation.audit).sort(), ["detail_ref_mode", "detail_refs", "dispatch_id", "event_id", "executor_id", "fencing_epoch", "issue_id", "observed_at", "provider", "provider_run_id", "schema", "sequence", "session_id", "source", "state", "type", "workspace_id"].sort());
});

test("full public comment never re-emits credential values in audit JSON", () => {
  for (const [label, value] of [["Token", "token=private-token-113"], ["Password", "password=private-password-113"], ["API Key", "api_key=private-api-key-113"], ["Secret", "secret=private-secret-113"]]) {
    const result = validateAgentReportEvent(event("blocked", {progress_summary: `${label} ${value}`, blocked_reason: value, next_step: value, checkpoint_ref: value}), trustedContext("blocked"), NOW);
    const comment = buildNativeAgentReportMutation(result).comment.content;
    assert.doesNotMatch(comment, /private-(token|password|api-key|secret)-113/);
    assert.doesNotMatch(comment, /detail_ref_mode|detail_refs|vault:\/\//);
    assert.equal(buildNativeAgentReportMutation(result).audit.detail_ref_mode, "UNWIRED_NO_REFERENCE");
  }
});

test("public comment never exposes natural language, personal data or mixed protected details", () => {
  const privateText = "客戶王小明 phone=0912-345-678 email=ming@example.com，請 CTO 回答：使用 production API；token=private-混合";
  const result = validateAgentReportEvent(event("blocked", {progress_summary: privateText, blocked_reason: privateText, question: privateText, next_step: privateText}), trustedContext("blocked"), NOW);
  const comment = buildNativeAgentReportMutation(result).comment.content;
  assert.match(comment, /公開摘要：詳細內容已存於受保護 Detail Store/);
  assert.doesNotMatch(comment, /王小明|0912-345-678|ming@example.com|production API|private-混合|稽核識別|vault:\/\//);
});

test("public comment keeps protected references in structured audit only", async () => {
  const validation = validateAgentReportEvent(event("blocked", {blocked_reason: "private detail"}), trustedContext("blocked"), NOW);
  const mutation = buildNativeAgentReportMutation({...validation, protected_detail_refs: {blocked_reason: "vault://event/blocked"}});
  assert.doesNotMatch(mutation.comment.content, /vault:\/\/|detail_refs|稽核識別/);
  assert.equal(mutation.audit.detail_refs.blocked_reason, "vault://event/blocked");
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


test("native atomic write adapter exposes the TaskFlow Authority seam and fails closed when unwired", async () => {
  const unwired = createNativeAgentAtomicWriteAdapter({issueId: "issue-113", idempotencyKey: "idem-113", expectedVersion: 1});
  assert.equal(unwired.configured, false);
  assert.equal((await unwired.applyAgentReportMutation({})).reason, "NATIVE_WRITE_UNWIRED");
  assert.equal(unwired.contract.authority, "existing_taskflow_native_issue_and_agent_task_queue");
});

test("native report receiver keeps the existing correlation contract and fails closed without a Provider or Native writer", async () => {
  const result = await receiveNativeAgentReport({event: event("progress", {progress_percent: 30, progress_summary: "進度已保存"}), context: trustedContext("progress"), now: NOW});
  assert.equal(result.reason, "DETAIL_STORE_UNWIRED");
  assert.equal(result.detail_store_state, "DETAIL_STORE_UNWIRED");
  assert.equal(result.mutation, null);
});

test("native report receiver writes protected details before allowing Native Mutation", async () => {
  const order = [];
  const detailStore = {putDetail: async () => { order.push("detail"); return {accepted: true, protected_ref: "vault://event/event-progress"}; }};
  const nativeAdapter = {applyAgentReportMutation: async mutation => { order.push("native"); return {committed: true, event_id: mutation.atomic_event_claim.event_id, atomic_event_claimed: true}; }};
  const result = await receiveNativeAgentReport({event: event("progress", {progress_percent: 30, progress_summary: "進度已保存"}), context: trustedContext("progress"), now: NOW, detailStore, nativeAdapter});
  assert.equal(result.accepted, true);
  assert.deepEqual(order, ["detail", "native"]);
  assert.equal(result.detail_store_state, "PROTECTED_STORE");
});

test("native report receiver rejects detail write failure and ACL denial without Native Mutation", async () => {
  for (const detailStore of [
    null,
    {putDetail: async () => ({accepted: false, reason: "DETAIL_STORE_WRITE_FAILED"})},
    {putDetail: async () => ({accepted: false, reason: "DETAIL_SCOPE_UNVERIFIED"})}
  ]) {
    let nativeCalled = false;
    const result = await receiveNativeAgentReport({event: event("blocked", {blocked_reason: "需要受保護證據"}), context: trustedContext("blocked"), now: NOW, detailStore, nativeAdapter: {applyAgentReportMutation: async () => { nativeCalled = true; return {}; }}});
    assert.equal(nativeCalled, false);
    assert.equal(result.accepted, false);
    assert.match(result.reason, /DETAIL_(STORE|SCOPE)/);
  }
});

test("native report receiver rolls back the whole report when a later protected detail write fails", async () => {
  let writes = 0;
  let nativeCalled = false;
  const detailStore = {putDetail: async () => {
    writes += 1;
    return writes === 1 ? {accepted: true, protected_ref: "vault://first"} : {accepted: false, reason: "DETAIL_STORE_WRITE_FAILED"};
  }};
  const result = await receiveNativeAgentReport({event: event("blocked", {blocked_reason: "private blocker", next_step: "private next step"}), context: trustedContext("blocked"), now: NOW, detailStore, nativeAdapter: {applyAgentReportMutation: async () => { nativeCalled = true; return {}; }}});
  assert.equal(writes, 2);
  assert.equal(nativeCalled, false);
  assert.equal(result.reason, "DETAIL_STORE_WRITE_FAILED");
});

test("native report receiver rejects duplicate or stale events using the authority sequence and fencing fields", async () => {
  const duplicate = await receiveNativeAgentReport({event: event("progress", {progress_percent: 30}), context: trustedContext("progress", {last_event_sequence: 1}), now: NOW});
  assert.equal(duplicate.reason, "EVENT_OUT_OF_ORDER");
  const wrongEpoch = await receiveNativeAgentReport({event: event("progress", {progress_percent: 30, fencing_epoch: 9}), context: trustedContext("progress"), now: NOW});
  assert.equal(wrongEpoch.reason, "FENCING_EPOCH_MISMATCH");
  const wrongToken = await receiveNativeAgentReport({event: event("progress", {progress_percent: 30, fencing_token: "forged-token"}), context: trustedContext("progress"), now: NOW});
  assert.equal(wrongToken.reason, "FENCING_TOKEN_MISMATCH");
});


test("validated reports can attach server protected references before native mutation", async () => {
  const validation = validateAgentReportEvent(event("blocked", {blocked_reason: "waiting for protected provider detail", next_step: "ask CTO"}), trustedContext("blocked", {expected_version: 3}), NOW);
  const attached = await attachProtectedDetailRefs(validation, {putDetail: async ({label}) => ({accepted: true, protected_ref: `vault://event/${label}`})}, {authority_scope: "TASKFLOW_AUTHORITY_VERIFIED", server_principal: {verified: true, source: "TASKFLOW_AUTHORITY", user_id: "agent-1"}, workspace_acl: "ALLOW", issue_acl: "ALLOW"});
  assert.equal(attached.detail_store_state, "PROTECTED_STORE");
  const mutation = buildNativeAgentReportMutation(attached);
  assert.equal(mutation.audit.detail_ref_mode, "PROTECTED_STORE");
  assert.match(mutation.audit.detail_refs.blocked_reason, /^vault:\/\//);
  assert.equal(mutation.expected_version, 3);
});
