/* Zhuge AI OS AI Board — read-only cloud adapter.
 *
 * The Board is a presentation module. It receives the current Shared
 * Identity and the Shared Supabase Data Gateway; it never creates a second
 * Supabase client, reads a task from browser storage, or performs writes.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeBoardReadService = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const STATUS_WORKSPACES = Object.freeze([
    { key: "ready", uiKey: "todo", label: "待辦", code: "ready" },
    { key: "inprogress", uiKey: "progress", label: "推進", code: "inprogress" },
    { key: "qa", uiKey: "qa", label: "驗證", code: "qa" },
    { key: "done", uiKey: "done", label: "完成", code: "done" }
  ]);
  const STATUS_BY_KEY = Object.freeze(Object.fromEntries(STATUS_WORKSPACES.map(item => [item.key, item])));
  const STATUS_BY_UI_KEY = Object.freeze(Object.fromEntries(STATUS_WORKSPACES.map(item => [item.uiKey, item])));

  function normalizeStatus(value) {
    const raw = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
    if (raw === "inprogress" || raw === "doing" || raw === "progress") return "inprogress";
    if (raw === "qa" || raw === "review" || raw === "readyforqa") return "qa";
    if (raw === "done" || raw === "complete" || raw === "completed") return "done";
    if (raw === "ready" || raw === "todo" || raw === "backlog" || raw === "inbox") return "ready";
    return "ready";
  }

  function workspaceForStatus(value) {
    return STATUS_BY_KEY[normalizeStatus(value)] || STATUS_BY_KEY.ready;
  }

  function normalizeTask(row = {}) {
    const status = normalizeStatus(row.status);
    return Object.freeze({
      id: String(row.id || ""),
      workCode: String(row.work_code || row.workCode || ""),
      title: String(row.title || "未命名工作"),
      status,
      workspace: workspaceForStatus(status).uiKey,
      priority: String(row.priority || ""),
      assignee: String(row.assignee || ""),
      source: String(row.source_workspace || row.source || ""),
      summary: String(row.summary || row.objective || row.description || ""),
      updatedAt: row.updated_at || row.updatedAt || null,
      createdAt: row.created_at || row.createdAt || null
    });
  }

  function isPrinciple(row = {}) {
    const code = String(row.knowledge_code || row.code || "").toUpperCase();
    const type = String(row.knowledge_type || row.type || "").toLowerCase();
    const title = String(row.title || "").toLowerCase();
    return type.includes("principle") || type.includes("policy") || code.startsWith("PRINCIPLE") || title.includes("原則");
  }

  function normalizePrinciple(row = {}) {
    return Object.freeze({
      code: String(row.knowledge_code || row.code || ""),
      title: String(row.title || "未命名原則"),
      summary: String(row.summary || row.content || ""),
      version: String(row.version || ""),
      updatedAt: row.updated_at || null
    });
  }

  function currentIdentity() {
    const source = typeof root.getSharedSessionSnapshot === "function"
      ? root.getSharedSessionSnapshot()
      : (typeof session !== "undefined" && session ? session : {});
    return root.ZhugeIdentity?.normalize ? root.ZhugeIdentity.normalize(source) : source;
  }

  function requireGateway() {
    const gateway = root.ZhugeSupabaseGateway?.createDataGateway?.();
    if (!gateway || typeof gateway.select !== "function") {
      const error = new Error("Shared Supabase Gateway 尚未就緒。");
      error.code = "BOARD_GATEWAY_UNAVAILABLE";
      throw error;
    }
    return gateway;
  }

  async function load(options = {}) {
    const identity = currentIdentity();
    if (!identity?.isAuthenticated) {
      const error = new Error("請先登入 Zhuge AI OS，才能查看 AI Board。");
      error.code = "BOARD_SESSION_REQUIRED";
      throw error;
    }
    const gateway = options.gateway || requireGateway();
    const [taskRows, knowledgeRows] = await Promise.all([
      gateway.select("board_tasks", "?select=id,title,status,priority,assignee,source_workspace,summary,objective,work_code,created_at,updated_at&order=created_at.asc"),
      gateway.select("engineering_knowledge", "?select=knowledge_code,knowledge_type,title,summary,content,version,status,updated_at&status=eq.approved&order=updated_at.desc")
    ]);
    const tasks = (Array.isArray(taskRows) ? taskRows : []).map(normalizeTask);
    const principles = (Array.isArray(knowledgeRows) ? knowledgeRows : [])
      .filter(isPrinciple)
      .map(normalizePrinciple);
    return Object.freeze({ identity, tasks, principles, readOnly: true, source: "Supabase Shared Data Gateway" });
  }

  return Object.freeze({ STATUS_WORKSPACES, STATUS_BY_UI_KEY, normalizeStatus, workspaceForStatus, normalizeTask, isPrinciple, normalizePrinciple, load });
});
