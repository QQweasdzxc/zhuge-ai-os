/** DM-04 read-only workbench adapter. Native TaskFlow is the source of truth. */
export const DISPATCH_EXECUTORS = Object.freeze(["CO-01", "CO-02", "CO-03", "GEM-01", "GH-HELPER"]);
export const DISPATCH_STATES = Object.freeze(["CREATED", "ACK_PENDING", "ASSIGNED", "RUNNING", "BLOCKED", "REVIEW", "DONE", "FAILED", "STALE", "UNKNOWN", "CANCELLED"]);
export const CANONICAL_RUNTIME_SCHEMA = "zhuge-taskflow-dispatch-persistence-v1";
export const CANONICAL_RUNTIME_SOURCE = "TASKFLOW_RUNTIME_READ_MODEL";
const VERIFIED_PROVIDER_RUN_SOURCES = new Set(["provider_event", "native_readback"]);
const HEARTBEAT_TTL_MS = 15 * 60 * 1000;
const OBSERVED_TTL_MS = 60 * 60 * 1000;
const META = Object.freeze({ workCode: "zhuge_work_code", owner: "zhuge_owner", authorizedBy: "zhuge_authorized_by", status: "zhuge_dispatch_status", runId: "zhuge_provider_run_id", observedAt: "zhuge_observed_at", executor: "zhuge_executor", heartbeat: "zhuge_provider_heartbeat_at", checkpoint: "zhuge_provider_checkpoint", blockReason: "zhuge_block_reason", nextStep: "zhuge_next_step", source: "zhuge_status_source", taskId: "zhuge_task_id", pr: "zhuge_github_pr_url", sha: "zhuge_github_sha", ci: "zhuge_github_ci_url", pmDecision: "zhuge_pm_decision_required" });
const text = value => typeof value === "string" ? value.trim() : "";
const metadataOf = issue => issue?.metadata && typeof issue.metadata === "object" ? issue.metadata : {};
const booleanValue = value => value === true || ["true", "1", "yes"].includes(text(value).toLowerCase());
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
function observationState(value, now, ttlMs) {
  const time = Date.parse(value || "");
  if (!Number.isFinite(time) || time > now) return "INVALID";
  return now - time <= ttlMs ? "FRESH" : "STALE";
}
function runtimeSource(runtime) {
  return text(runtime?.status_source || runtime?.source || runtime?.provenance?.source || runtime?.provenance?.runtime);
}
function runtimeIdentityMatches(issue, runtime) {
  const issueId = text(issue?.id);
  const issueWorkspace = text(issue?.workspace_id || issue?.workspace);
  const runtimeIssueId = text(runtime?.issue_id);
  const runtimeWorkspace = text(runtime?.workspace);
  const taskId = text(runtime?.task_id);
  const provider = text(runtime?.provider);
  return Boolean(
    issueId && runtimeIssueId && runtimeIssueId === issueId &&
    issueWorkspace && runtimeWorkspace && runtimeWorkspace === issueWorkspace &&
    taskId && provider
  );
}
export function verifyRunningEvidence(issue, runtime, runs = [], now = Date.now()) {
  const evidence = runtime?.evidence && typeof runtime.evidence === "object" ? runtime.evidence : {};
  const providerRunId = text(runtime?.provider_run_id);
  const providerRunIdSource = text(runtime?.provider_run_id_source || evidence.provider_run_id_source).toLowerCase();
  const heartbeatAt = text(runtime?.last_heartbeat_at || runtime?.heartbeat_at);
  const observedAt = text(runtime?.observed_at || runtime?.last_observed_at || runtime?.observed_time || heartbeatAt);
  const canonical = runtime?.schema === CANONICAL_RUNTIME_SCHEMA && runtimeSource(runtime) === CANONICAL_RUNTIME_SOURCE;
  const authorization = text(runtime?.authorization).toUpperCase();
  const providerAck = text(evidence.provider_ack).toUpperCase();
  const identity = runtimeIdentityMatches(issue, runtime);
  const taskId = text(runtime?.task_id);
  const matchingNativeRuns = Array.isArray(runs) && runs.length
    ? runs.filter(run => text(run?.id || run?.task_id) === taskId)
    : [];
  const taskAssociation = !Array.isArray(runs) || !runs.length || matchingNativeRuns.length > 0;
  const runAssociation = matchingNativeRuns.every(run => {
    const nativeProviderRunId = text(run?.provider_run_id);
    const nativeProvider = text(run?.provider);
    return (!nativeProviderRunId || nativeProviderRunId === providerRunId) && (!nativeProvider || nativeProvider === text(runtime?.provider));
  });
  const baseValid = canonical && identity && authorization === "AUTHORIZED" && providerAck === "VERIFIED" &&
    providerRunId && providerRunId !== taskId && VERIFIED_PROVIDER_RUN_SOURCES.has(providerRunIdSource) && taskAssociation && runAssociation;
  if (!baseValid) {
    return {state: "UNKNOWN", reason: "缺少可信的 canonical Runtime／授權／Provider ACK／Run 綁定", providerRunId, providerRunIdSource, heartbeatAt, observedAt};
  }
  const heartbeatState = observationState(heartbeatAt, now, HEARTBEAT_TTL_MS);
  const observedState = observationState(observedAt, now, OBSERVED_TTL_MS);
  if (heartbeatState === "STALE" || observedState === "STALE") {
    return {state: "STALE", reason: "heartbeat 或 observed_at 已過期", providerRunId, providerRunIdSource, heartbeatAt, observedAt};
  }
  if (heartbeatState !== "FRESH" || observedState !== "FRESH") {
    return {state: "UNKNOWN", reason: "heartbeat／observed_at 無效或缺失", providerRunId, providerRunIdSource, heartbeatAt, observedAt};
  }
  return {state: "RUNNING", reason: "canonical Runtime、Provider ACK、Run 綁定及觀測時間均已驗證", providerRunId, providerRunIdSource, heartbeatAt, observedAt};
}
export function normalizeDispatchStatus(raw, { providerRunId = "", heartbeatAt = "", observedAt = "", now = Date.now(), runningEvidence = null } = {}) {
  const value = text(raw).toUpperCase().replace(/[- ]/g, "_");
  if (["CREATED", "INTENT_CREATED"].includes(value)) return "CREATED";
  if (["FAILED", "ERROR"].includes(value)) return "FAILED";
  if (["BLOCKED", "QUOTA_EXHAUSTED", "UNSUPPORTED"].includes(value)) return "BLOCKED";
  if (["CANCELLED", "CANCELED"].includes(value)) return "CANCELLED";
  if (["COMPLETED", "DONE", "SUCCESS"].includes(value)) return "DONE";
  if (["REVIEW", "IN_REVIEW", "REASSIGN_REVIEW"].includes(value)) return "REVIEW";
  if (value === "PM_ACCEPTED") return "DONE";
  if (value === "OVERDUE") return "STALE";
  if (value === "STALE") return "STALE";
  if (["RUNNING", "IN_PROGRESS"].includes(value)) {
    if (runningEvidence?.state === "RUNNING") return "RUNNING";
    if (runningEvidence?.state === "STALE") return "STALE";
    return "UNKNOWN";
  }
  if (["ACK_PENDING", "DISPATCH_PENDING", "QUEUED", "DISPATCHED"].includes(value)) return "ACK_PENDING";
  if (value === "ASSIGNED") return "ASSIGNED";
  return "UNKNOWN";
}
export function normalizeDispatchIssue(issue, runs = [], now = Date.now(), trustedRuntime = null) {
  const metadata = metadataOf(issue);
  // Runtime evidence is accepted only when supplied by the protected
  // TaskFlow readback endpoint. Issue metadata and runtime-shaped fields are
  // mutable client context and must never establish Provider execution.
  const runtime = trustedRuntime && typeof trustedRuntime === "object" ? trustedRuntime : null;
  const run = Array.isArray(runs) ? runs.find(item => item && item.id) : null;
  const providerRunId = text(runtime ? runtime.provider_run_id : metadata[META.runId] || run?.provider_run_id);
  const heartbeatAt = text(runtime ? runtime.last_heartbeat_at || runtime.heartbeat_at : metadata[META.heartbeat] || run?.heartbeat_at || run?.last_heartbeat_at);
  const observedAt = text(runtime ? runtime.observed_at || runtime.last_observed_at : metadata[META.observedAt] || run?.observed_at || run?.updated_at);
  const rawStatus = text(runtime?.state || metadata[META.status] || run?.status || issue?.status);
  const runningEvidence = ["RUNNING", "IN_PROGRESS"].includes(rawStatus.toUpperCase().replace(/[- ]/g, "_"))
    ? verifyRunningEvidence(issue, runtime, runs, now)
    : null;
  let status = normalizeDispatchStatus(rawStatus, { providerRunId, heartbeatAt, observedAt, now, runningEvidence });
  if (run?.status && ["failed", "error"].includes(String(run.status).toLowerCase())) status = "FAILED";
  const evidenceReason = text(metadata[META.blockReason]) || text(runtime?.evidence?.blocked_reason);
  const reason = status === "STALE" ? (runningEvidence?.reason || "heartbeat 或 observed_at 已過期") : status === "UNKNOWN" ? (runningEvidence?.reason || evidenceReason || "缺少可信 Provider Run ID／觀測證據") : status === "BLOCKED" || status === "FAILED" ? evidenceReason || "原生執行證據回報阻擋或失敗" : "";
  const executor = normalizeExecutor(runtime?.executor_id) || normalizeExecutor(metadata[META.owner] || metadata[META.executor] || issue?.assignee_id || issue?.assignee);
  const pmDecisionRequired = booleanValue(runtime?.pm_decision_required) || booleanValue(runtime?.pmDecisionRequired) || booleanValue(metadata[META.pmDecision]);
  return { id: text(issue?.id), identifier: text(issue?.identifier || issue?.key), title: text(issue?.title) || "未命名案件", workCode: text(runtime?.work_code || metadata[META.workCode]), owner: normalizeExecutor(runtime?.executor_id) || normalizeExecutor(metadata[META.owner]), authorizedBy: text(runtime ? runtime.authorization : metadata[META.authorizedBy]), executor, provider: text(runtime ? runtime.provider : metadata.zhuge_provider), status, rawState: text(rawStatus).toUpperCase().replace(/[- ]/g, "_"), reason: reason || evidenceReason, providerRunId, providerRunIdSource: text(runtime?.provider_run_id_source || runtime?.evidence?.provider_run_id_source), taskId: text(runtime?.task_id || (runtime ? "" : metadata[META.taskId]) || run?.id), checkpoint: text(runtime?.checkpoint_ref || (runtime ? "" : metadata[META.checkpoint]) || run?.checkpoint), observedAt, heartbeatAt, nextStep: text(metadata[META.nextStep]), quotaState: text(runtime?.quota_state), providerAck: text(runtime ? runtime.evidence?.provider_ack : metadata.zhuge_provider_ack), prUrl: text(metadata[META.pr]), sha: text(metadata[META.sha]), ciUrl: text(metadata[META.ci]), statusSource: text(runtime?.status_source || metadata[META.source]) || (runtime ? "TASKFLOW_RUNTIME_READ_MODEL" : run ? "TASKFLOW_TASK_RUN" : "TASKFLOW_ISSUE_METADATA"), evidenceSource: runtime ? "TASKFLOW_RUNTIME_READ_MODEL" : (run ? "TASKFLOW_TASK_RUN" : "TASKFLOW_ISSUE_METADATA"), pmDecisionRequired, raw: issue };
}

/** Return true only when a native issue carries dispatch evidence. Ordinary
 * TaskFlow issues must not appear in PM's engineering inbox as UNKNOWN. */
export function hasDispatchEvidence(item) {
  if (!item || typeof item !== "object") return false;
  return Boolean(item.workCode || item.provider || item.taskId || item.providerRunId || item.pmDecisionRequired || item.raw?.dispatch_runtime || item.raw?.runtime_read_model || item.raw?.metadata?.[META.workCode] || item.raw?.metadata?.[META.status] || item.raw?.metadata?.[META.executor] || item.raw?.metadata?.[META.pmDecision]);
}

/** Classify only observable workbench evidence for the PM Inbox. This never
 * infers work from a title, GitHub PR, or an HTTP 202 response. */
export function classifyInboxItem(item) {
  if (!hasDispatchEvidence(item)) return "";
  if (item.pmDecisionRequired || item.rawState === "REASSIGN_REVIEW") return "PM_DECISION";
  if (item.status === "REVIEW") return "PM_ACCEPTANCE";
  if (item.status === "FAILED") return "ENGINEERING_FAILED";
  if (["BLOCKED", "STALE", "UNKNOWN", "CANCELLED"].includes(item.status)) return "ENGINEERING_BLOCKED";
  return "";
}

export const INBOX_CATEGORY_LABELS = Object.freeze({
  PM_DECISION: "待 PM 裁示",
  PM_ACCEPTANCE: "待 PM 驗收",
  ENGINEERING_BLOCKED: "工程阻擋／未驗證",
  ENGINEERING_FAILED: "工程失敗"
});

export function buildPmInboxEntries(items = []) {
  if (!Array.isArray(items)) return [];
  return items.map(item => {
    const category = classifyInboxItem(item);
    return category ? { ...item, category, categoryLabel: INBOX_CATEGORY_LABELS[category] } : null;
  }).filter(Boolean);
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
  function runtimeModel(value) {
    const model = value?.runtime || value?.read_model || value;
    if (!model || typeof model !== "object") throw new Error("TaskFlow Runtime Readback response invalid");
    return model;
  }
  async function readRuntime(workspace, issue) {
    if (typeof transport.getDispatchRuntime !== "function") throw new Error("TaskFlow Runtime Readback endpoint unavailable");
    return runtimeModel(await transport.getDispatchRuntime(workspace, issue.id));
  }
  return Object.freeze({
    async list(workspace, { executor = "", query = "" } = {}) {
      const response = await transport.listIssues(workspace, { limit: 100, query });
      const issues = Array.isArray(response) ? response : response?.issues;
      if (!Array.isArray(issues)) throw new Error("TaskFlow issue response invalid");
      const selected = normalizeExecutor(executor);
      const candidates = issues.filter(issue => {
        const item = normalizeDispatchIssue(issue);
        return !selected || item.executor === selected;
      });
      // Keep the native issue list intact for the workbench, but only query
      // the protected readback route for issues that carry explicit dispatch
      // evidence. Ordinary TaskFlow issues remain visible without being
      // relabeled as dispatch work or causing an unnecessary API fan-out.
      const readbacks = await Promise.all(candidates.map(issue => {
        const item = normalizeDispatchIssue(issue);
        return hasDispatchEvidence(item) ? readRuntime(workspace, issue) : null;
      }));
      return candidates.map((issue, index) => normalizeDispatchIssue(issue, [], Date.now(), readbacks[index]));
    },
    async detail(workspace, id) {
      const issue = await transport.getIssue(workspace, id);
      const [runs, pullRequests, runtime] = await Promise.allSettled([
        transport.listTaskRuns?.(workspace, id, { active: false }),
        transport.listPullRequests?.(workspace, id),
        readRuntime(workspace, issue)
      ]);
      if (runtime.status === "rejected") throw runtime.reason;
      const runList = runs.status === "fulfilled" ? (Array.isArray(runs.value) ? runs.value : runs.value?.tasks || []) : [];
      const prs = pullRequests.status === "fulfilled" ? (Array.isArray(pullRequests.value) ? pullRequests.value : pullRequests.value?.pull_requests || []) : [];
      return { ...normalizeDispatchIssue(issue, runList, Date.now(), runtime.value), runs: runList, pullRequests: prs, runtimeEvidence: true };
    }
  });
}
