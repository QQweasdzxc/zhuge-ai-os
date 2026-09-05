/*
 * Formal WorkTodo summary adapter.
 *
 * The root Dashboard is a presentation surface.  This adapter keeps its
 * input on the canonical, authenticated Board read contract and turns the
 * normalized WorkTodo rows into a small PM-readable summary.  It is
 * deliberately read-only: no browser cache, fixture, or mutation path is
 * used here.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeWorkTodoDashboardAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const SOURCE = "Supabase Shared Data Gateway → WorkTodo Application Scope";
  const STATUS_LABELS = Object.freeze({
    not_started: "待開始",
    in_progress: "進行中",
    waiting_reply: "等待回覆",
    waiting_acceptance: "等待驗收",
    blocked: "阻塞",
    completed: "完成"
  });
  const WORKSPACE_STATUS = Object.freeze({
    "worktodo-todo": "not_started",
    "worktodo-inprogress": "in_progress",
    "worktodo-waiting-reply": "waiting_reply",
    "worktodo-waiting-acceptance": "waiting_acceptance",
    "worktodo-blocked": "blocked",
    "worktodo-completed": "completed"
  });
  const WORKSPACE_ORDER = Object.freeze([
    "worktodo-todo",
    "worktodo-inprogress",
    "worktodo-waiting-reply",
    "worktodo-waiting-acceptance",
    "worktodo-blocked"
  ]);
  const STATUS_ALIASES = Object.freeze({
    open: "not_started",
    todo: "not_started",
    ready: "not_started",
    backlog: "not_started",
    inprogress: "in_progress",
    progress: "in_progress",
    doing: "in_progress",
    waiting: "waiting_reply",
    review: "waiting_acceptance",
    qa: "waiting_acceptance",
    done: "completed",
    complete: "completed",
    completed: "completed"
  });

  function normalizeKey(value) {
    return String(value || "").trim().toLowerCase().replace(/[\s_]+/g, "-");
  }

  function normalizeStatus(value) {
    const raw = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
    const normalized = STATUS_LABELS[raw] ? raw : STATUS_ALIASES[raw] || "not_started";
    return Object.prototype.hasOwnProperty.call(STATUS_LABELS, normalized) ? normalized : "not_started";
  }

  function taskWorkspaceKey(task = {}) {
    return normalizeKey(task.workspaceKey || task.workspace_key || task.workspace || "");
  }

  function taskStatus(task = {}) {
    const workspaceStatus = WORKSPACE_STATUS[taskWorkspaceKey(task)];
    return workspaceStatus || normalizeStatus(task.rawStatus || task.status);
  }

  function isTerminal(task = {}) {
    const key = taskWorkspaceKey(task);
    const status = taskStatus(task);
    const workspaceName = String(task.workspaceName || task.workspace_name || "").trim();
    return Boolean(
      task.archivedAt || task.archived_at
      || key === "worktodo-completed"
      || key === "completed"
      || workspaceName === "完成"
      || workspaceName === "已完成"
      || ["completed", "merged", "cancelled", "canceled", "done"].includes(String(task.rawStatus || task.status || "").trim().toLowerCase())
      || status === "completed"
    );
  }

  function taskUpdatedAt(task = {}) {
    return Date.parse(task.latestProgressAt || task.updatedAt || task.createdAt || "") || 0;
  }

  function taskProjection(task = {}) {
    const status = taskStatus(task);
    return Object.freeze({
      id: String(task.id || ""),
      workCode: String(task.workCode || task.work_code || ""),
      title: String(task.title || "未命名工作"),
      status,
      statusLabel: STATUS_LABELS[status],
      workspaceKey: taskWorkspaceKey(task),
      workspaceName: String(task.workspaceName || task.workspace_name || STATUS_LABELS[status]),
      dueDate: task.dueDate || task.due_date || null,
      latestProgress: String(task.latestProgress || task.latest_progress || ""),
      latestProgressAt: task.latestProgressAt || task.latest_progress_at || null,
      updatedAt: task.updatedAt || task.updated_at || task.createdAt || task.created_at || null,
      priority: String(task.priority || "")
    });
  }

  function emptyState() {
    return Object.freeze({
      state: "empty",
      readOnly: true,
      source: SOURCE,
      fetchedAt: null,
      counts: Object.freeze({ active: 0, total: 0, not_started: 0, in_progress: 0, waiting_reply: 0, waiting_acceptance: 0, blocked: 0, completed: 0 }),
      workspaceCounts: Object.freeze([]),
      tasks: Object.freeze([])
    });
  }

  function loadingState() {
    return Object.freeze({ state: "loading", readOnly: true, source: SOURCE, fetchedAt: null, counts: null, workspaceCounts: [], tasks: [] });
  }

  function errorState(error) {
    return Object.freeze({
      state: "error",
      readOnly: true,
      source: SOURCE,
      fetchedAt: null,
      code: String(error?.code || "WORKTODO_SUMMARY_READ_FAILED"),
      message: "正式工作摘要暫時無法取得",
      counts: null,
      workspaceCounts: Object.freeze([]),
      tasks: Object.freeze([])
    });
  }

  function summarize(result = {}) {
    const sourceTasks = Array.isArray(result.tasks) ? result.tasks : [];
    if (!sourceTasks.length) return emptyState();

    const counts = {
      active: 0,
      total: sourceTasks.length,
      not_started: 0,
      in_progress: 0,
      waiting_reply: 0,
      waiting_acceptance: 0,
      blocked: 0,
      completed: 0
    };
    const workspaceCountMap = new Map();
    const activeTasks = [];

    sourceTasks.forEach(task => {
      const status = taskStatus(task);
      const terminal = isTerminal(task);
      if (terminal) {
        counts.completed += 1;
      } else {
        counts[status] = (counts[status] || 0) + 1;
        counts.active += 1;
        activeTasks.push(taskProjection(task));
        const key = taskWorkspaceKey(task) || status;
        const current = workspaceCountMap.get(key) || { key, name: String(task.workspaceName || task.workspace_name || STATUS_LABELS[status]), count: 0 };
        current.count += 1;
        workspaceCountMap.set(key, current);
      }
    });

    const tasks = activeTasks
      .sort((a, b) => taskUpdatedAt(b) - taskUpdatedAt(a) || a.title.localeCompare(b.title, "zh-Hant"))
      .slice(0, 5);
    const workspaceCounts = [...workspaceCountMap.values()]
      .sort((a, b) => {
        const aOrder = WORKSPACE_ORDER.indexOf(a.key);
        const bOrder = WORKSPACE_ORDER.indexOf(b.key);
        return (aOrder < 0 ? Number.MAX_SAFE_INTEGER : aOrder) - (bOrder < 0 ? Number.MAX_SAFE_INTEGER : bOrder)
          || b.count - a.count
          || a.name.localeCompare(b.name, "zh-Hant");
      })
      .map(item => Object.freeze(item));

    return Object.freeze({
      state: counts.active ? "ready" : "empty",
      readOnly: true,
      source: String(result.source || SOURCE),
      fetchedAt: new Date().toISOString(),
      counts: Object.freeze(counts),
      workspaceCounts: Object.freeze(workspaceCounts),
      tasks: Object.freeze(tasks)
    });
  }

  async function load(options = {}) {
    const service = options.service || root?.ZhugeBoardReadService;
    if (!service || typeof service.load !== "function") {
      const error = new Error("正式 WorkTodo 讀取服務尚未載入");
      error.code = "WORKTODO_BOARD_READ_SERVICE_UNAVAILABLE";
      return errorState(error);
    }
    try {
      const result = await service.load({ applicationScope: "worktodo", gateway: options.gateway });
      return summarize(result);
    } catch (error) {
      return errorState(error);
    }
  }

  return Object.freeze({
    source: SOURCE,
    statusLabels: STATUS_LABELS,
    loadingState,
    emptyState,
    errorState,
    normalizeStatus,
    taskStatus,
    isTerminal,
    summarize,
    load
  });
});
