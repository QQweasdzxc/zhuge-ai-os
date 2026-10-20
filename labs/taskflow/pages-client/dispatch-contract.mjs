export const DISPATCH_WORK_CODES = Object.freeze(["DM-00", "DM-01", "DM-02", "DM-03"]);
export const WORK_CODE_PATTERN = /^[A-Z][A-Z0-9]*-[0-9]{2,}$/;
export const DISPATCH_OWNER_CODES = Object.freeze(["CO-01", "CO-02", "GEM-01", "GPT-CTO"]);
export const DISPATCH_PRIORITIES = Object.freeze(["urgent", "high", "medium", "low", "none"]);
export const DISPATCH_STATES = Object.freeze([
  "CREATED",
  "ASSIGNED",
  "ACK_PENDING",
  "RUNNING",
  "BLOCKED",
  "REVIEW",
  "DONE",
  "UNKNOWN",
  "STALE",
  "FAILED"
]);

export const DISPATCH_STATE_LABELS = Object.freeze({
  CREATED: "已建立",
  ASSIGNED: "已指派",
  ACK_PENDING: "待 ACK",
  RUNNING: "執行中",
  BLOCKED: "阻擋",
  REVIEW: "待驗收",
  DONE: "完成",
  UNKNOWN: "未知",
  STALE: "過期",
  FAILED: "失敗"
});

export const DISPATCH_METADATA_KEYS = Object.freeze({
  workCode: "zhuge_work_code",
  owner: "zhuge_owner",
  nextStep: "zhuge_next_step",
  sourceEvidence: "zhuge_source_evidence",
  acceptance: "zhuge_acceptance",
  dispatchStatus: "zhuge_dispatch_status",
  statusSource: "zhuge_status_source",
  observedAt: "zhuge_observed_at",
  taskId: "zhuge_task_id",
  provider: "zhuge_provider",
  providerRunId: "zhuge_provider_run_id",
  providerError: "zhuge_provider_error",
  githubIssueUrl: "zhuge_github_issue_url",
  githubPrUrl: "zhuge_github_pr_url",
  githubCommitUrl: "zhuge_github_commit_url",
  githubCiUrl: "zhuge_github_ci_url",
  githubSha: "zhuge_github_sha",
  githubShaSource: "zhuge_github_sha_source"
});

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function requiredHttpsUrl(value, label = "URL") {
  const raw = text(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:") throw new Error("https required");
    return url.href;
  } catch {
    throw new Error(`${label} 必須是完整的 https:// URL`);
  }
}

export function requiredGithubUrl(value, label = "GitHub URL") {
  const href = requiredHttpsUrl(value, label);
  if (!href) return "";
  const hostname = new URL(href).hostname.toLowerCase();
  if (hostname !== "github.com" && !hostname.endsWith(".github.com")) {
    throw new Error(`${label} 必須指向 GitHub`);
  }
  return href;
}

export function isExactSha(value) {
  return /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(text(value));
}

export function buildIssueDescription(form) {
  const values = {
    "工作編號": text(form.workCode),
    "負責人": text(form.owner),
    "優先順序": text(form.priority),
    "狀態": text(form.initialState) || "ASSIGNED",
    "下一步": text(form.nextStep),
    "來源證據": text(form.sourceEvidence),
    "驗收條件": text(form.acceptance)
  };
  return Object.entries(values).map(([label, value]) => `- ${label}：${value || "待補"}`).join("\n")
    + "\n\n## TaskFlow / Provider 證據\n- Provider：待實際啟動後由原生執行入口回填\n- Provider Run ID：未取得\n- TaskFlow task ID：尚未建立\n";
}

export function buildIssuePayload(form) {
  const workCode = text(form.workCode);
  const title = text(form.title);
  const owner = text(form.owner);
  const priority = text(form.priority) || "medium";
  if (!WORK_CODE_PATTERN.test(workCode)) throw new Error("工作編號必須符合跨模組格式，例如 DM-00、OPS-001");
  if (!title) throw new Error("任務標題不可空白");
  if (!DISPATCH_OWNER_CODES.includes(owner)) throw new Error("請選擇有效負責人");
  if (!DISPATCH_PRIORITIES.includes(priority)) throw new Error("優先順序不合法");
  const payload = {
    title: `${workCode}｜${title}`,
    description: buildIssueDescription({...form, workCode, owner, priority, initialState: "ASSIGNED"}),
    status: "todo",
    priority
  };
  const agentId = text(form.agentId);
  if (agentId) {
    payload.assignee_type = "agent";
    payload.assignee_id = agentId;
  }
  return payload;
}

export function buildMetadata(form, {taskId = "", provider = "", providerRunId = "", providerError = "", dispatchStatus = "ASSIGNED", observedAt = ""} = {}) {
  const metadata = {
    [DISPATCH_METADATA_KEYS.workCode]: text(form.workCode),
    [DISPATCH_METADATA_KEYS.owner]: text(form.owner),
    [DISPATCH_METADATA_KEYS.nextStep]: text(form.nextStep),
    [DISPATCH_METADATA_KEYS.sourceEvidence]: text(form.sourceEvidence),
    [DISPATCH_METADATA_KEYS.acceptance]: text(form.acceptance),
    [DISPATCH_METADATA_KEYS.dispatchStatus]: text(dispatchStatus) || "ASSIGNED",
    [DISPATCH_METADATA_KEYS.statusSource]: "taskflow_native",
    [DISPATCH_METADATA_KEYS.observedAt]: text(observedAt) || new Date().toISOString()
  };
  for (const [key, value] of [
    [DISPATCH_METADATA_KEYS.taskId, taskId],
    [DISPATCH_METADATA_KEYS.provider, provider],
    [DISPATCH_METADATA_KEYS.providerRunId, providerRunId],
    [DISPATCH_METADATA_KEYS.providerError, providerError]
  ]) if (text(value)) metadata[key] = text(value);
  return {...metadata, ...buildGithubMetadata(form.github || {})};
}

export function buildGithubMetadata(github = {}, {shaSource = "manual_record_pending_native_readback"} = {}) {
  const metadata = {};
  for (const [key, value] of [
    [DISPATCH_METADATA_KEYS.githubIssueUrl, github.issueUrl],
    [DISPATCH_METADATA_KEYS.githubPrUrl, github.prUrl],
    [DISPATCH_METADATA_KEYS.githubCommitUrl, github.commitUrl],
    [DISPATCH_METADATA_KEYS.githubCiUrl, github.ciUrl],
    [DISPATCH_METADATA_KEYS.githubSha, github.sha],
    [DISPATCH_METADATA_KEYS.githubShaSource, github.sha ? shaSource : ""]
  ]) if (text(value)) metadata[key] = text(value);
  return metadata;
}

export function activeTaskRun(runs) {
  if (!Array.isArray(runs)) return null;
  return runs.find(run => ["queued", "dispatched", "running", "in_progress"].includes(String(run?.status).toLowerCase())) || null;
}

export function deriveDispatchState(issue, runs = []) {
  const task = activeTaskRun(runs);
  const taskStatus = String(task?.status || "").toLowerCase();
  if (["running", "in_progress"].includes(taskStatus)) return "RUNNING";
  if (["queued", "dispatched"].includes(taskStatus)) return "ACK_PENDING";
  if (["failed", "error", "cancelled", "canceled"].includes(taskStatus)) return "FAILED";
  const metadataState = text(issue?.metadata?.[DISPATCH_METADATA_KEYS.dispatchStatus]).toUpperCase();
  if (DISPATCH_STATES.includes(metadataState)) {
    const observed = Date.parse(text(issue?.metadata?.[DISPATCH_METADATA_KEYS.observedAt]));
    if (Number.isFinite(observed) && Date.now() - observed > 30 * 60 * 1000 && !["DONE", "FAILED", "BLOCKED"].includes(metadataState)) return "STALE";
    return metadataState;
  }
  if (!issue) return "UNKNOWN";
  if (issue?.status === "done" || issue?.status === "completed") return "DONE";
  if (issue?.status === "in_review") return "REVIEW";
  if (issue?.status === "blocked") return "BLOCKED";
  if (issue?.assignee_id || issue?.assignee_type) return "ASSIGNED";
  return "CREATED";
}

export function evidenceSummary(issue) {
  const metadata = issue?.metadata || {};
  return {
    workCode: text(metadata[DISPATCH_METADATA_KEYS.workCode]),
    owner: text(metadata[DISPATCH_METADATA_KEYS.owner]),
    nextStep: text(metadata[DISPATCH_METADATA_KEYS.nextStep]),
    sourceEvidence: text(metadata[DISPATCH_METADATA_KEYS.sourceEvidence]),
    acceptance: text(metadata[DISPATCH_METADATA_KEYS.acceptance]),
    dispatchStatus: text(metadata[DISPATCH_METADATA_KEYS.dispatchStatus]).toUpperCase(),
    taskId: text(metadata[DISPATCH_METADATA_KEYS.taskId]),
    provider: text(metadata[DISPATCH_METADATA_KEYS.provider]),
    providerRunId: text(metadata[DISPATCH_METADATA_KEYS.providerRunId]),
    providerError: text(metadata[DISPATCH_METADATA_KEYS.providerError]),
    githubIssueUrl: text(metadata[DISPATCH_METADATA_KEYS.githubIssueUrl]),
    githubPrUrl: text(metadata[DISPATCH_METADATA_KEYS.githubPrUrl]),
    githubCommitUrl: text(metadata[DISPATCH_METADATA_KEYS.githubCommitUrl]),
    githubCiUrl: text(metadata[DISPATCH_METADATA_KEYS.githubCiUrl]),
    githubSha: text(metadata[DISPATCH_METADATA_KEYS.githubSha]),
    githubShaSource: text(metadata[DISPATCH_METADATA_KEYS.githubShaSource])
  };
}
