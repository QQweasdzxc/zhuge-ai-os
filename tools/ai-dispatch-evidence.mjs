/** CO-03 read-only evidence classifier; no provider, token, network, or write path. */
const STATES = Object.freeze(["ACK_PENDING", "ASSIGNED", "RUNNING", "FAILED", "BLOCKED", "STALE", "UNKNOWN", "COMPLETED"]);
const text = value => typeof value === "string" && value.trim().length > 0;
const time = value => { const parsed = Date.parse(value || ""); return Number.isFinite(parsed) ? parsed : null; };

export function normalizeRegistry(entries = []) {
  return entries.map(entry => Object.freeze({
    executorId: String(entry.executorId || "").trim(), provider: String(entry.provider || "").trim(),
    runner: String(entry.runner || "").trim(), enabled: entry.enabled === true,
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
  if (ack.accepted !== true || ack.taskId !== assignment.taskId || ack.executorId !== assignment.executorId || !text(ack.ackId)) {
    return { state: "UNKNOWN", reason: "ACK_MISMATCH" };
  }
  if (!run) return { state: "ASSIGNED", reason: "ACK_CONFIRMED_RUN_MISSING" };
  if (run.taskId !== assignment.taskId || run.executorId !== assignment.executorId || !text(run.runId) || !time(run.startedAt)) {
    return { state: "UNKNOWN", reason: "RUN_EVIDENCE_INVALID" };
  }
  const current = time(now);
  const started = time(run.startedAt);
  const heartbeat = time(run.heartbeatAt);
  if (!current || !heartbeat) return { state: "UNKNOWN", reason: "HEARTBEAT_REQUIRED", runId: run.runId };
  if (heartbeat > current || current - heartbeat > staleAfterMs) return { state: "STALE", reason: "RUN_HEARTBEAT_EXPIRED", runId: run.runId };
  if (run.status === "blocked" || run.status === "quota_exhausted") return { state: "BLOCKED", reason: run.reason || "PROVIDER_BLOCKED", runId: run.runId };
  if (["failed", "error"].includes(run.status)) return { state: "FAILED", reason: run.reason || "PROVIDER_RUN_FAILED", runId: run.runId };
  if (run.status === "completed") return { state: "COMPLETED", runId: run.runId };
  if (started > current) return { state: "UNKNOWN", reason: "RUN_START_IN_FUTURE", runId: run.runId };
  return { state: "RUNNING", reason: "RUN_EVIDENCE_CONFIRMED", runId: run.runId };
}

export function preserveReassignment(history = [], nextAssignment) {
  const previous = history.at(-1);
  if (previous && previous.taskId === nextAssignment?.taskId && previous.executorId === nextAssignment?.executorId) return { history, duplicate: true };
  return { history: [...history, { ...nextAssignment, assignedAt: nextAssignment.assignedAt || new Date().toISOString() }], duplicate: false };
}

export function traceability({ taskId, assignment, ack, run, github } = {}) {
  const evidence = { taskId, assignmentId: assignment?.assignmentId || null, providerAckId: ack?.ackId || null, runId: run?.runId || null, githubPr: github?.pr || null, githubSha: github?.sha || null, ciRun: github?.ciRun || null };
  return Object.freeze({ complete: Object.values(evidence).every(value => value !== null && value !== ""), evidence });
}

export { STATES };
