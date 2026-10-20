const test = require("node:test");
const assert = require("node:assert/strict");

test("DM-04 keeps executor registry and conservative runtime states", async () => {
  const mod = await import("../labs/taskflow/pages-client/dispatch-workbench.mjs");
  assert.deepEqual(mod.DISPATCH_EXECUTORS, ["CO-01", "CO-02", "CO-03", "GEM-01", "GH-HELPER"]);
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

test("Phase 2 exposes authorization, checkpoint and conservative failure reasons", async () => {
  const {normalizeDispatchIssue} = await import("../labs/taskflow/pages-client/dispatch-workbench.mjs");
  const item = normalizeDispatchIssue({id: "blocked", metadata: {
    zhuge_owner: "CO-03", zhuge_authorized_by: "CTO-01", zhuge_dispatch_status: "BLOCKED",
    zhuge_block_reason: "quota exhausted", zhuge_provider_checkpoint: "checkpoint-7", zhuge_next_step: "request quota"
  }});
  assert.equal(item.authorizedBy, "CTO-01");
  assert.equal(item.checkpoint, "checkpoint-7");
  assert.equal(item.reason, "quota exhausted");
  assert.equal(item.nextStep, "request quota");
});

test("Phase 2 accepts CO-02 runtime read-model shape without calling it a fixture", async () => {
  const {normalizeDispatchIssue} = await import("../labs/taskflow/pages-client/dispatch-workbench.mjs");
  const now = new Date().toISOString();
  const item = normalizeDispatchIssue({id: "runtime-1", runtime_read_model: {
    schema: "zhuge-taskflow-dispatch-persistence-v1", work_code: "DM-04", executor_id: "CO-03",
    provider: "codex", state: "RUNNING", authorization: "AUTHORIZED", task_id: "task-1",
    provider_run_id: "run-1", checkpoint_ref: "cp-1", last_heartbeat_at: now,
    observed_at: now, quota_state: "UNKNOWN", evidence: {provider_ack: "VERIFIED", provider_run_id_source: "provider_event"}
  }});
  assert.equal(item.status, "RUNNING");
  assert.equal(item.evidenceSource, "TASKFLOW_RUNTIME_READ_MODEL");
  assert.equal(item.providerAck, "VERIFIED");
  assert.equal(item.providerRunIdSource, "provider_event");
});

test("Workbench keeps provider execution fail-closed and classifies PM Inbox from explicit evidence", async () => {
  const {buildPmInboxEntries, normalizeDispatchIssue} = await import("../labs/taskflow/pages-client/dispatch-workbench.mjs");
  const now = new Date().toISOString();
  const items = [
    normalizeDispatchIssue({id: "decision", title: "需要 CTO 裁示", metadata: {
      zhuge_work_code: "DM-01", zhuge_dispatch_status: "ASSIGNED", zhuge_pm_decision_required: "true"
    }}),
    normalizeDispatchIssue({id: "acceptance", title: "待 PM 驗收", metadata: {
      zhuge_work_code: "DM-02", zhuge_dispatch_status: "REVIEW", zhuge_observed_at: now
    }}),
    normalizeDispatchIssue({id: "blocked", title: "Provider 尚未授權", runtime_read_model: {
      work_code: "DM-03", executor_id: "CO-02", state: "BLOCKED", observed_at: now,
      evidence: {blocked_reason: "PROVIDER_NOT_AUTHORIZED"}
    }}),
    normalizeDispatchIssue({id: "failed", title: "執行失敗", metadata: {
      zhuge_work_code: "DM-04", zhuge_dispatch_status: "FAILED"
    }}),
    normalizeDispatchIssue({id: "ordinary", title: "一般 TaskFlow 任務", status: "todo"})
  ];
  assert.equal(normalizeDispatchIssue({id: "unverified", runtime_read_model: {
    work_code: "DM-05", executor_id: "CO-01", state: "RUNNING", observed_at: now
  }}).status, "UNKNOWN");
  const entries = buildPmInboxEntries(items);
  assert.deepEqual(entries.map(entry => entry.category), [
    "PM_DECISION", "PM_ACCEPTANCE", "ENGINEERING_BLOCKED", "ENGINEERING_FAILED"
  ]);
  assert.equal(entries.some(entry => entry.id === "ordinary"), false);
});
