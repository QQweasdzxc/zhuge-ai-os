const test = require("node:test");
const assert = require("node:assert/strict");

test("DM-04 keeps executor registry and conservative runtime states", async () => {
  const mod = await import("../labs/taskflow/pages-client/dispatch-workbench.mjs");
  assert.deepEqual(mod.DISPATCH_EXECUTORS, ["CO-01", "CO-02", "GEM-01", "GH-HELPER"]);
  assert.equal(mod.normalizeDispatchStatus("RUNNING", {providerRunId: "run-1", heartbeatAt: new Date().toISOString(), observedAt: new Date().toISOString()}), "RUNNING");
  assert.equal(mod.normalizeDispatchStatus("RUNNING", {providerRunId: "run-1"}), "STALE");
  assert.equal(mod.normalizeDispatchStatus("RUNNING", {heartbeatAt: new Date().toISOString(), observedAt: new Date().toISOString()}), "UNKNOWN");
});

test("DM-04 adapter reads native issues and applies executor filter without fake data", async () => {
  const {createDispatchAdapter} = await import("../labs/taskflow/pages-client/dispatch-workbench.mjs");
  const adapter = createDispatchAdapter({listIssues: async () => ({total: 2, issues: [
    {id: "a", title: "A", metadata: {zhuge_work_code: "DM-04", zhuge_executor: "CO-02", zhuge_dispatch_status: "ASSIGNED"}},
    {id: "b", title: "B", metadata: {zhuge_work_code: "DM-04", zhuge_executor: "GEM-01", zhuge_dispatch_status: "RUNNING", zhuge_provider_run_id: "r", zhuge_provider_heartbeat_at: new Date().toISOString(), zhuge_observed_at: new Date().toISOString()}}
  ]})});
  assert.equal((await adapter.list("ws", {executor: "CO-02"})).length, 1);
  assert.equal((await adapter.list("ws", {executor: "GEM-01"}))[0].status, "RUNNING");
});

test("DM-04 evidence rejects mismatched identities, duplicate active runs, and bad SHA", async () => {
  const {validateEvidence} = await import("../labs/taskflow/pages-client/dispatch-workbench.mjs");
  const issue = {id: "issue-1", assignee_id: "CO-02", metadata: {
    zhuge_executor: "CO-02", zhuge_task_id: "task-1", zhuge_provider_run_id: "run-1", zhuge_github_sha: "bad-sha"
  }};
  const result = validateEvidence(issue, [{id: "task-1", provider_run_id: "run-2", status: "running"}, {id: "task-2", provider_run_id: "run-2", status: "running"}]);
  assert.equal(result.valid, false);
  assert.deepEqual(result.errors.sort(), ["DUPLICATE_ACTIVE_RUN", "INVALID_GITHUB_SHA", "PROVIDER_RUN_ID_MISMATCH"].sort());
});
