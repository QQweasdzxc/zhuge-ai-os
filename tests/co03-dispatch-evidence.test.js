const test = require("node:test");
const assert = require("node:assert/strict");

async function api() {
  return import("../tools/ai-dispatch-evidence.mjs");
}

const assignment = { taskId: "TASK-CO03-001", executorId: "CO-03", assignmentId: "assign-1" };
const ack = { accepted: true, taskId: assignment.taskId, executorId: assignment.executorId, ackId: "ack-1" };
const run = { taskId: assignment.taskId, executorId: assignment.executorId, runId: "run-1", startedAt: "2026-10-20T00:00:00Z", heartbeatAt: "2026-10-20T00:05:00Z", status: "running" };

test("DM-00 registry resolves CO-03 and reports an enabled executor as ACK_PENDING", async () => {
  const { normalizeRegistry, resolveExecutor } = await api();
  const registry = normalizeRegistry([{ executorId: "CO-03", provider: "codex", runner: "codex-03", enabled: true, capabilities: ["qa", "qa"] }]);
  assert.deepEqual(registry[0].capabilities, ["qa"]);
  assert.equal(resolveExecutor(registry, "CO-03").state, "ACK_PENDING");
});

test("DM-01 unknown or disabled executors never become assigned", async () => {
  const { resolveExecutor } = await api();
  assert.equal(resolveExecutor([], "CO-03").state, "UNKNOWN");
  assert.equal(resolveExecutor([{ executorId: "CO-03", provider: "codex", runner: "r", enabled: false }], "CO-03").state, "BLOCKED");
});

test("DM-02 missing or mismatched ACK cannot claim acceptance", async () => {
  const { classifyDispatch } = await api();
  assert.equal(classifyDispatch({ assignment }).state, "ACK_PENDING");
  assert.equal(classifyDispatch({ assignment, ack: { ...ack, executorId: "CO-02" } }).state, "UNKNOWN");
  assert.equal(classifyDispatch({ assignment, ack }).state, "ASSIGNED");
});

test("DM-03 RUNNING requires provider run evidence after ACK", async () => {
  const { classifyDispatch } = await api();
  assert.equal(classifyDispatch({ assignment, ack, run, now: "2026-10-20T00:06:00Z" }).state, "RUNNING");
  assert.equal(classifyDispatch({ assignment, ack, run: { ...run, runId: "" } }).state, "UNKNOWN");
});

test("DM-04 quota exhaustion is BLOCKED and never starts a run", async () => {
  const { classifyDispatch } = await api();
  assert.equal(classifyDispatch({ assignment: { ...assignment, quotaBlocked: true }, ack, run }).state, "BLOCKED");
});

test("reassignment preserves the prior execution record and rejects duplicate assignment", async () => {
  const { preserveReassignment } = await api();
  const first = preserveReassignment([], assignment);
  const duplicate = preserveReassignment(first.history, assignment);
  const reassigned = preserveReassignment(first.history, { ...assignment, assignmentId: "assign-2", executorId: "CO-02" });
  assert.equal(duplicate.duplicate, true);
  assert.equal(reassigned.duplicate, false);
  assert.equal(reassigned.history.length, 2);
  assert.equal(reassigned.history[0].executorId, "CO-03");
});

test("stale provider heartbeat is visible and does not remain RUNNING", async () => {
  const { classifyDispatch } = await api();
  assert.equal(classifyDispatch({ assignment, ack, run, now: "2026-10-20T00:30:01Z", staleAfterMs: 15 * 60 * 1000 }).state, "STALE");
});

test("traceability requires assignment, ACK, run, PR, SHA and CI evidence", async () => {
  const { traceability } = await api();
  assert.equal(traceability({ taskId: assignment.taskId, assignment, ack, run }).complete, false);
  assert.equal(traceability({ taskId: assignment.taskId, assignment, ack, run, github: { pr: 50, sha: "abc123", ciRun: 99 } }).complete, true);
});
