/** DM-04 read-only workbench adapter. Native TaskFlow is the source of truth. */
export const DISPATCH_EXECUTORS = Object.freeze(["CO-01", "CO-02", "CO-03", "GEM-01", "GH-HELPER"]);
export const DISPATCH_STATES = Object.freeze(["ACK_PENDING", "ASSIGNED", "RUNNING", "BLOCKED", "REVIEW", "DONE", "FAILED", "STALE", "UNKNOWN"]);
const META = Object.freeze({ workCode: "zhuge_work_code", owner: "zhuge_owner", authorizedBy: "zhuge_authorized_by", status: "zhuge_dispatch_status", runId: "zhuge_provider_run_id", observedAt: "zhuge_observed_at", executor: "zhuge_executor", heartbeat: "zhuge_provider_heartbeat_at", checkpoint: "zhuge_provider_checkpoint", blockReason: "zhuge_block_reason", nextStep: "zhuge_next_step", source: "zhuge_status_source", taskId: "zhuge_task_id", pr: "zhuge_github_pr_url", sha: "zhuge_github_sha", ci: "zhuge_github_ci_url", pmDecision: "zhuge_pm_decision_required" });
const text = value => typeof value === "string" ? value.trim() : "";
const metadataOf = issue => issue?.metadata && typeof issue.metadata === "object" ? issue.metadata : {};
export function metadataKeys() { return META; }
export function normalizeExecutor(value) {
  const v = text(value).toUpperCase();
  if (DISPATCH_EXECUTORS.includes(v)) return v;
  if (/^GH-HELPER(?:-|$)/.test(v)) return "GH-HELPER";
  return "";
}
export function heartbeatFresh(value, now = Date.now(), ttlMs = 15 * 60 * 1000) {
  const time = Date.parse(value || "");
  return Number.isFinite(time) && time <= now && now - time <= ttlMs;
}
export function normalizeDispatchStatus(raw, { providerRunId = "", heartbeatAt = "", observedAt = "", now = Date.now() } = {}) {
  const value = text(raw).toUpperCase().replace(/[- ]/g, "_");
  if (["FAILED", "ERROR"].includes(value)) return "FAILED";
  if (["BLOCKED", "QUOTA_EXHAUSTED", "UNSUPPORTED"].includes(value)) return "BLOCKED";
  if (["COMPLETED", "DONE", "SUCCESS"].includes(value)) return "DONE";
  if (["REVIEW", "IN_REVIEW"].includes(value)) return "REVIEW";
  if (value === "STALE") return "STALE";
  if (["RUNNING", "IN_PROGRESS"].includes(value)) {
    if (!providerRunId) return "UNKNOWN";
    if (!heartbeatFresh(heartbeatAt, now) || !heartbeatFresh(observedAt, now, 60 * 60 * 1000)) return "STALE";
    return "RUNNING";
  }
  if (["ACK_PENDING", "DISPATCH_PENDING", "QUEUED", "DISPATCHED"].includes(value)) return "ACK_PENDING";
  if (value === "ASSIGNED") return "ASSIGNED";
  return "UNKNOWN";
}
export function normalizeDispatchIssue(issue, runs = [], now = Date.now()) {
  const metadata = metadataOf(issue);
  const runtime = issue?.dispatch_runtime || issue?.runtime_read_model || metadata.zhuge_runtime_read_model || null;
  const run = Array.isArray(runs) ? runs.find(item => item && item.id) : null;
  const providerRunId = text(runtime?.provider_run_id || metadata[META.runId] || run?.provider_run_id);
  const heartbeatAt = text(runtime?.last_heartbeat_at || metadata[META.heartbeat] || run?.heartbeat_at || run?.last_heartbeat_at);
  const observedAt = text(runtime?.observed_at || metadata[META.observedAt] || run?.observed_at || run?.updated_at);
  const rawStatus = text(runtime?.state || metadata[META.status] || run?.status || issue?.status);
  let status = normalizeDispatchStatus(rawStatus, { providerRunId, heartbeatAt, observedAt, now });
  if (run?.status && ["failed", "error"].includes(String(run.status).toLowerCase())) status = "FAILED";
  const reason = status === "STALE" ? "heartbeat 或 observed_at 已過期" : status === "UNKNOWN" ? "缺少可信 Provider Run ID／觀測證據" : status === "BLOCKED" || status === "FAILED" ? text(metadata[META.blockReason]) || "原生執行證據回報阻擋或失敗" : "";
  return { id: text(issue?.id), title: text(issue?.title) || "未命名案件", workCode: text(runtime?.work_code || metadata[META.workCode]), owner: normalizeExecutor(runtime?.executor_id || metadata[META.owner]), authorizedBy: text(runtime?.authorization || metadata[META.authorizedBy]), executor: normalizeExecutor(runtime?.executor_id || metadata[META.owner] || metadata[META.executor] || issue?.assignee_id || issue?.assignee), provider: text(runtime?.provider || metadata.zhuge_provider), status, reason: reason || text(runtime?.evidence?.blocked_reason), providerRunId, providerRunIdSource: text(runtime?.provider_run_id_source || runtime?.evidence?.provider_run_id_source), taskId: text(runtime?.task_id || metadata[META.taskId] || run?.id), checkpoint: text(runtime?.checkpoint_ref || metadata[META.checkpoint] || run?.checkpoint), observedAt, heartbeatAt, nextStep: text(metadata[META.nextStep]), quotaState: text(runtime?.quota_state), providerAck: text(runtime?.evidence?.provider_ack), prUrl: text(metadata[META.pr]), sha: text(metadata[META.sha]), ciUrl: text(metadata[META.ci]), evidenceSource: runtime ? "TASKFLOW_RUNTIME_READ_MODEL" : (run ? "TASKFLOW_TASK_RUN" : "TASKFLOW_ISSUE_METADATA"), pmDecisionRequired: metadata[META.pmDecision] === true || text(metadata[META.pmDecision]).toLowerCase() === "true", raw: issue };
}
export function validateEvidence(issue, runs = []) {
  const metadata = metadataOf(issue);
  const list = Array.isArray(runs) ? runs : [];
  const errors = [];
  const issueId = text(issue?.id);
  const taskId = text(metadata[META.taskId]);
  const providerRunId = text(metadata[META.runId]);
  const executor = normalizeExecutor(metadata[META.owner] || metadata[META.executor] || issue?.assignee_id || issue?.assignee);
  const matchingTask = taskId ? list.filter(run => text(run?.id) === taskId) : [];
  const matchingRun = providerRunId ? list.filter(run => text(run?.provider_run_id) === providerRunId) : [];
  if (!issueId) errors.push("MISSING_TASK_ID");
  if (!executor) errors.push("UNKNOWN_EXECUTOR");
  if (taskId && matchingTask.length !== 1) errors.push("TASK_ID_MISMATCH");
  if (providerRunId && matchingRun.length !== 1) errors.push("PROVIDER_RUN_ID_MISMATCH");
  const active = list.filter(run => ["queued", "dispatched", "running", "in_progress"].includes(String(run?.status).toLowerCase()));
  if (active.length > 1) errors.push("DUPLICATE_ACTIVE_RUN");
  const sha = text(metadata.zhuge_github_sha);
  if (sha && !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(sha)) errors.push("INVALID_GITHUB_SHA");
  return {valid: errors.length === 0, errors, issueId, taskId, providerRunId, executor};
}
export function createDispatchAdapter(transport) {
  if (!transport || typeof transport.listIssues !== "function") throw new TypeError("TaskFlow transport required");
  return Object.freeze({
    async list(workspace, { executor = "", query = "" } = {}) {
      const response = await transport.listIssues(workspace, { limit: 100, query });
      const issues = Array.isArray(response) ? response : response?.issues;
      if (!Array.isArray(issues)) throw new Error("TaskFlow issue response invalid");
      const selected = normalizeExecutor(executor);
      return issues.filter(issue => {
        const item = normalizeDispatchIssue(issue);
        return !selected || item.executor === selected;
      }).map(issue => normalizeDispatchIssue(issue));
    },
    async detail(workspace, id) {
      const issue = await transport.getIssue(workspace, id);
      const [runs, pullRequests] = await Promise.allSettled([
        transport.listTaskRuns?.(workspace, id, { active: false }),
        transport.listPullRequests?.(workspace, id)
      ]);
      const runList = runs.status === "fulfilled" ? (Array.isArray(runs.value) ? runs.value : runs.value?.tasks || []) : [];
      const prs = pullRequests.status === "fulfilled" ? (Array.isArray(pullRequests.value) ? pullRequests.value : pullRequests.value?.pull_requests || []) : [];
      return { ...normalizeDispatchIssue(issue, runList), runs: runList, pullRequests: prs, runtimeEvidence: runs.status === "fulfilled" };
    }
  });
}
