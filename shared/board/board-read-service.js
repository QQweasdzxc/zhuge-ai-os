/* Zhuge AI OS AI Board — Shared Cloud adapter.
 *
 * The Board is a presentation module. It receives the current Shared
 * Identity and Shared Supabase Data Gateway; it never creates a second
 * Supabase client or reads a task from browser storage. Mutations are limited
 * to the approved controlled RPC boundary.
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

  /*
   * The server-side board_transition_task() remains the authority.  This
   * client-side map is deliberately only a UX contract: it tells QJC which
   * drop targets are meaningful before the controlled RPC is called and gives
   * a PM-readable reason when a drop is rejected.  It must stay in lockstep
   * with the approved RPC transitions, never replace them.
   */
  const QJC_TRANSITIONS = Object.freeze({
    ready: Object.freeze({
      progress: Object.freeze({ status: "inprogress", assignee: "Co", action: "開始推進（Co）" })
    }),
    inprogress: Object.freeze({
      qa: Object.freeze({ status: "qa", assignee: "GPT", action: "Co 完成 → 交 GPT" })
    }),
    qa: Object.freeze({
      progress: Object.freeze({ status: "inprogress", assignee: "Co", action: "退回 Co 修正" }),
      qa: Object.freeze({ status: "qa", assignee: "QJC", action: "GPT Review 通過 → 交 QJC", requiresAssignee: "GPT" }),
      done: Object.freeze({ status: "done", assignee: "QJC", action: "PM QA 通過 → 完成", requiresAssignee: "QJC" })
    }),
    done: Object.freeze({})
  });

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

  function planTransition(task, targetUiKey) {
    const currentStatus = normalizeStatus(task?.status);
    const currentWorkspace = workspaceForStatus(currentStatus).uiKey;
    const target = QJC_TRANSITIONS[currentStatus]?.[String(targetUiKey || "")];
    if (!target) {
      return Object.freeze({
        allowed: false,
        currentStatus,
        currentWorkspace,
        reason: currentWorkspace === targetUiKey
          ? "這張卡片已在目前工作區，不需要重複交接。"
          : `目前在「${workspaceForStatus(currentStatus).label}」，只能依序交給下一個工作階段；不能直接跳到「${STATUS_BY_UI_KEY[targetUiKey]?.label || "未知工作區"}」。`
      });
    }
    if (target.requiresAssignee && String(task?.assignee || "") !== target.requiresAssignee) {
      const owner = target.requiresAssignee === "GPT" ? "GPT Review" : "QJC PM QA";
      return Object.freeze({
        allowed: false,
        currentStatus,
        currentWorkspace,
        reason: `目前接球者不是${owner}，不能執行這個交接；請先由目前負責角色完成驗證。`
      });
    }
    return Object.freeze({
      allowed: true,
      currentStatus,
      currentWorkspace,
      targetWorkspace: String(targetUiKey),
      status: target.status,
      assignee: target.assignee,
      action: target.action
    });
  }

  function availableTransitions(task) {
    return Object.freeze(Object.keys(QJC_TRANSITIONS[normalizeStatus(task?.status)] || {})
      .map(target => planTransition(task, target))
      .filter(item => item.allowed));
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
      usageScenario: String(row.usage_scenario || row.usageScenario || ""),
      createdBy: String(row.created_by || ""),
      updatedAt: row.updated_at || row.updatedAt || null,
      createdAt: row.created_at || row.createdAt || null
    });
  }

  function normalizeChecklistItem(row = {}) {
    return Object.freeze({
      id: String(row.id || ""),
      taskId: String(row.task_id || ""),
      checklistType: String(row.checklist_type || "task_acceptance"),
      stage: String(row.stage || "co"),
      itemKey: String(row.item_key || ""),
      label: String(row.label || ""),
      required: row.required !== false,
      state: String(row.state || "not_verified"),
      checkedBy: String(row.checked_by || ""),
      checkedAt: row.checked_at || null,
      evidenceNote: String(row.evidence_note || ""),
      evidenceRef: String(row.evidence_ref || ""),
      sortOrder: Number(row.sort_order || 0),
      version: Number(row.version || 1),
      updatedAt: row.updated_at || null
    });
  }

  function isPrinciple(row = {}) {
    const code = String(row.knowledge_code || row.code || "").toUpperCase();
    const type = String(row.knowledge_type || row.type || "").toLowerCase();
    const title = String(row.title || "").toLowerCase();
    return type.includes("principle") || type.includes("policy") || code.startsWith("PRINCIPLE") || title.includes("原則");
  }

  function isSystemMap(row = {}) {
    const code = String(row.knowledge_code || row.code || "").toUpperCase();
    const title = String(row.title || "").toLowerCase();
    return code.includes("SYSTEM-MAP") || code.includes("SYSTEM_MAP") || title.includes("system map") || title.includes("系統藍圖") || title.includes("系統地圖");
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

  function normalizeSystemMap(row = {}) {
    return Object.freeze({
      code: String(row.knowledge_code || row.code || ""),
      title: String(row.title || "系統藍圖"),
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
      gateway.select("board_tasks", "?select=id,title,status,priority,assignee,source_workspace,summary,objective,usage_scenario,work_code,created_by,created_at,updated_at&order=created_at.asc"),
      gateway.select("engineering_knowledge", "?select=knowledge_code,knowledge_type,title,summary,content,version,status,updated_at&status=not.is.null&order=updated_at.desc")
    ]);
    const tasks = (Array.isArray(taskRows) ? taskRows : []).map(normalizeTask);
    const knowledge = Array.isArray(knowledgeRows) ? knowledgeRows : [];
    const principles = knowledge.filter(row => String(row.status || "").toLowerCase() === "approved").filter(isPrinciple).map(normalizePrinciple);
    const systemMaps = knowledge.filter(isSystemMap).map(normalizeSystemMap);
    return Object.freeze({ identity, tasks, principles, systemMaps, readOnly: false, source: "Supabase Shared Data Gateway" });
  }

  async function loadChecklist(taskId, options = {}) {
    const gateway = options.gateway || requireGateway();
    const encoded = encodeURIComponent(String(taskId || ""));
    const rows = await gateway.select(
      "engineering_checklist_items",
      `?select=*&task_id=eq.${encoded}&order=sort_order.asc,created_at.asc`
    );
    return (Array.isArray(rows) ? rows : []).map(normalizeChecklistItem);
  }

  async function transitionTask(taskId, targetStatus, targetAssignee, note = "", options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("board_transition_task", {
      p_task_id: taskId,
      p_target_status: targetStatus,
      p_target_assignee: targetAssignee,
      p_actor_type: "human",
      p_actor_label: "QJC",
      p_note: note || null
    });
  }

  async function createTask(input = {}, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("board_create_task", {
      p_title: input.title,
      p_summary: input.summary || null,
      p_usage_scenario: input.usageScenario || null,
      p_priority: input.priority || null,
      p_actor_type: "human",
      p_actor_label: "QJC"
    }).then(normalizeTask);
  }

  async function createChecklistItem(input = {}, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("board_create_checklist_item", {
      p_task_id: input.taskId,
      p_checklist_type: input.checklistType || "task_acceptance",
      p_stage: input.stage || "qjc",
      p_item_key: input.itemKey,
      p_label: input.label,
      p_required: input.required !== false,
      p_sort_order: Number(input.sortOrder || 0),
      p_actor_type: "human",
      p_actor_label: "QJC"
    }).then(normalizeChecklistItem);
  }

  async function updateChecklistItem(input = {}, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("board_update_checklist_item", {
      p_item_id: input.id,
      p_state: input.state || "not_verified",
      p_evidence_note: input.evidenceNote || null,
      p_evidence_ref: input.evidenceRef || null,
      p_actor_type: "human",
      p_actor_label: "QJC"
    }).then(normalizeChecklistItem);
  }

  async function subscribe(callback, options = {}) {
    const gateway = options.gateway || requireGateway();
    if (typeof gateway.subscribe !== "function") {
      const error = new Error("Shared Supabase Gateway 尚未支援 Realtime。");
      error.code = "BOARD_REALTIME_UNAVAILABLE";
      throw error;
    }
    const stopTask = await gateway.subscribe("board_tasks", callback);
    const stopChecklist = await gateway.subscribe("engineering_checklist_items", callback);
    return async () => {
      await Promise.allSettled([stopTask?.(), stopChecklist?.()]);
    };
  }

  return Object.freeze({
    STATUS_WORKSPACES,
    STATUS_BY_UI_KEY,
    planTransition,
    availableTransitions,
    normalizeStatus,
    workspaceForStatus,
    normalizeTask,
    normalizeChecklistItem,
    isPrinciple,
    isSystemMap,
    normalizePrinciple,
    normalizeSystemMap,
    load,
    loadChecklist,
    transitionTask,
    createTask,
    createChecklistItem,
    updateChecklistItem,
    subscribe
  });
});
