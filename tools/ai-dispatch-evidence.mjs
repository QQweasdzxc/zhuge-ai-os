/**
 * CO-03 read-only dispatch evidence contract.
 *
 * This module deliberately has no network, provider SDK, token, or write path.
 * It classifies evidence supplied by a controlled adapter so UI state cannot
 * claim that an assignment was accepted or running without provider proof.
 */

const STATES = Object.freeze([
  "ACK_PENDING", "ASSIGNED", "RUNNING", "BLOCKED", "STALE", "UNKNOWN", "COMPLETED"
]);

const hasText = value => typeof value === "string" && value.trim().length > 0;
const isoTime = value => {
  const time = Date.parse(value || "");
  return Number.isFinite(time) ? time : null;
};

export function normalizeRegistry(entries = []) {
  return entries.map(entry => Object.freeze({
    executorId: String(entry.executorId || "").trim(),
    provider: String(entry.provider || "").trim(),
    runner: String(entry.runner || "").trim(),
    enabled: entry.enabled === true,
    capabilities: Object.freeze(Array.isArray(entry.capabilities) ? [...new Set(entry.capabilities.map(String))] : [])
  })).filter(entry => entry.executorId && entry.provider && entry.runner);
}

export function resolveExecutor(registry, executorId) {
  const id = String(executorId || "").trim();
  if (!id) return { state: "UNKNOWN", reason: "EXECUTOR_ID_MISSING" };
  const executor = registry.find(item => item.executorId === id);
  if (!executor) return { state: "UNKNOWN", reason: "EXECUTOR_NOT_REGISTERED" };
  if (!executor.enabled) return { state: "BLOCKED", reason: "EXECUTOR_DISABLED", executor };
  return { state: "ACK_PENDING", reason: "AWAITING_PROVIDER_ACK", executor };
}

export function classifyDispatch({ assignment, ack, run, now = new Date().toISOString(), staleAfterMs = 15 * 60 * 1000 } = {}) {
  if (!assignment?.taskId || !assignment?.executorId) return { state: "UNKNOWN", reason: "ASSIGNMENT_INCOMPLETE" };
  if (assignment.quotaBlocked === true) return { state: "BLOCKED", reason: "TOKEN_OR_QUOTA_EXHAUSTED" };
  if (!ack) return { state: "ACK_PENDING", reason: "PROVIDER_ACK_MISSING" };
  if (ack.accepted !== true || ack.taskId !== assignment.taskId || ack.executorId !== assignment.executorId) {
    return { state: "UNKNOWN", reason: "ACK_MISMATCH" };
  }
  if (!run) return { state: "ASSIGNED", reason: "ACK_CONFIRMED_RUN_MISSING" };
  if (run.taskId !== assignment.taskId || run.executorId !== assignment.executorId || !hasText(run.runId) || !isoTime(run.startedAt)) {
    return { state: "UNKNOWN", reason: "RUN_EVIDENCE_INVALID" };
  }
  const age = Date.parse(now) - Date.parse(run.startedAt);
  if (!Number.isFinite(age) || age > staleAfterMs && run.heartbeatAt && Date.parse(now) - Date.parse(run.heartbeatAt) > staleAfterMs) {
    return { state: "STALE", reason: "RUN_HEARTBEAT_EXPIRED", runId: run.runId };
  }
  if (run.status === "blocked") return { state: "BLOCKED", reason: run.reason || "PROVIDER_BLOCKED", runId: run.runId };
  if (["completed", "failed"].includes(run.status)) return { state: "COMPLETED", outcome: run.status, runId: run.runId };
  return { state: "RUNNING", reason: "RUN_EVIDENCE_CONFIRMED", runId: run.runId };
}

export function preserveReassignment(history = [], nextAssignment) {
  const previous = history.at(-1);
  if (previous && previous.taskId === nextAssignment?.taskId && previous.executorId === nextAssignment?.executorId) {
    return { history, duplicate: true };
  }
  return { history: [...history, { ...nextAssignment, assignedAt: nextAssignment.assignedAt || new Date().toISOString() }], duplicate: false };
}

export function traceability({ taskId, assignment, ack, run, github } = {}) {
  const evidence = { taskId, assignmentId: assignment?.assignmentId || null, providerAckId: ack?.ackId || null, runId: run?.runId || null, githubPr: github?.pr || null, githubSha: github?.sha || null, ciRun: github?.ciRun || null };
  return Object.freeze({ complete: Object.values(evidence).every(value => value !== null && value !== ""), evidence });
}

export { STATES };
