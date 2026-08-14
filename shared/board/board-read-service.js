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
  const TERMINAL_WORKSPACES = Object.freeze({
    merged: Object.freeze({ key: "merged", uiKey: "history", label: "已合併", code: "merged" }),
    cancelled: Object.freeze({ key: "cancelled", uiKey: "history", label: "已取消", code: "cancelled" })
  });

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
      todo: Object.freeze({ status: "ready", assignee: "Co", action: "退回待辦（Co）" }),
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
    if (raw === "merged" || raw === "merge") return "merged";
    if (raw === "cancelled" || raw === "canceled" || raw === "cancel") return "cancelled";
    if (raw === "inprogress" || raw === "doing" || raw === "progress") return "inprogress";
    if (raw === "qa" || raw === "review" || raw === "readyforqa") return "qa";
    if (raw === "done" || raw === "complete" || raw === "completed") return "done";
    if (raw === "ready" || raw === "todo" || raw === "backlog" || raw === "inbox") return "ready";
    return "ready";
  }

  function workspaceForStatus(value) {
    const status = normalizeStatus(value);
    return STATUS_BY_KEY[status] || TERMINAL_WORKSPACES[status] || STATUS_BY_KEY.ready;
  }

  function isGovernanceTerminal(taskOrStatus) {
    const value = typeof taskOrStatus === "object" ? taskOrStatus?.status : taskOrStatus;
    return ["merged", "cancelled"].includes(normalizeStatus(value));
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
      // Keep the PM-readable contract fields separate.  The Board can present
      // a clear narrative without asking a reviewer to infer it from internal
      // engineering columns.
      summary: String(row.summary || row.objective || row.problem || row.description || ""),
      problem: String(row.problem || ""),
      objective: String(row.objective || ""),
      proposedSolution: String(row.proposed_solution || row.proposedSolution || ""),
      acceptanceCriteria: String(row.acceptance_criteria || row.acceptanceCriteria || ""),
      relatedWork: String(row.related_work || row.relatedWork || ""),
      developerNotes: String(row.developer_notes || row.developerNotes || ""),
      pmNotes: String(row.pm_notes || row.pmNotes || ""),
      usageScenario: String(row.usage_scenario || row.usageScenario || ""),
      resolutionAction: String(row.resolution_action || ""),
      mergedInto: String(row.merged_into || ""),
      linkedTo: String(row.linked_to || ""),
      resolutionReason: String(row.resolution_reason || ""),
      resolvedAt: row.resolved_at || null,
      resolvedBy: String(row.resolved_by || ""),
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

  function completionGateStatus(items = []) {
    const rows = (Array.isArray(items) ? items : []).map(item => item && Object.prototype.hasOwnProperty.call(item, "evidenceNote") ? item : normalizeChecklistItem(item));
    const required = rows.filter(item => item.required && item.stage.toLowerCase() !== "gpt");
    const coItems = required.filter(item => item.stage.toLowerCase() === "co");
    const qjcItems = required.filter(item => item.stage.toLowerCase() === "qjc");
    const passed = required.filter(item => item.state === "pass" && Boolean(item.evidenceNote || item.evidenceRef));
    const failed = required.filter(item => item.state === "fail");
    const missingEvidence = required.filter(item => item.state === "pass" && !item.evidenceNote && !item.evidenceRef);
    const missing = required.filter(item => item.state !== "pass");
    const missingStages = [];
    if (!coItems.length) missingStages.push("Co 開發驗證");
    if (!qjcItems.length) missingStages.push("QJC PM 驗收");
    const allowed = required.length > 0
      && coItems.length > 0
      && qjcItems.length > 0
      && missing.length === 0
      && missingEvidence.length === 0;
    return Object.freeze({
      required,
      coItems,
      qjcItems,
      passed,
      failed,
      missing,
      missingEvidence,
      missingStages,
      hasRequired: required.length > 0,
      allowed
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

  function requireEngineeringMemoryResolver(options = {}) {
    const resolver = options.memoryResolver || root.ZhugeEngineeringMemory;
    if (!resolver || typeof resolver.resolveCurrentCanonical !== "function") {
      const error = new Error("Canonical Engineering Memory Resolver 尚未載入。");
      error.code = "ENGINEERING_MEMORY_RESOLVER_UNAVAILABLE";
      throw error;
    }
    return resolver;
  }

  async function load(options = {}) {
    const identity = currentIdentity();
    if (!identity?.isAuthenticated) {
      const error = new Error("請先登入 Zhuge AI OS，才能查看 AI Board。");
      error.code = "BOARD_SESSION_REQUIRED";
      throw error;
    }
    const gateway = options.gateway || requireGateway();
    const resolver = options.engineeringMemory ? null : requireEngineeringMemoryResolver(options);
    const [taskRows, engineeringMemory] = await Promise.all([
      gateway.select("board_tasks", "?select=id,title,status,priority,assignee,source_workspace,summary,problem,objective,proposed_solution,acceptance_criteria,related_work,developer_notes,pm_notes,usage_scenario,work_code,created_by,created_at,updated_at,resolution_action,merged_into,linked_to,resolution_reason,resolved_at,resolved_by&order=created_at.asc"),
      options.engineeringMemory || resolver.resolveCurrentCanonical({ gateway, codes: options.knowledgeCodes })
    ]);
    const tasks = (Array.isArray(taskRows) ? taskRows : []).map(normalizeTask);
    const knowledge = (engineeringMemory?.records || []).map(row => ({
      knowledge_code: row.knowledgeCode,
      knowledge_type: row.knowledgeType,
      title: row.title,
      summary: row.summary,
      content: row.content,
      version: row.version,
      status: "approved",
      updated_at: row.updatedAt
    }));
    const principles = knowledge.filter(row => String(row.status || "").toLowerCase() === "approved").filter(isPrinciple).map(normalizePrinciple);
    const systemMaps = knowledge.filter(isSystemMap).map(normalizeSystemMap);
    return Object.freeze({ identity, tasks, principles, systemMaps, engineeringMemory, engineeringMemoryFailures: engineeringMemory?.failures || [], governanceMetadataAvailable: true, readOnly: false, source: "Supabase Shared Data Gateway → Canonical Engineering Memory Resolver" });
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

  function healthFinding(type, severity, title, detail, records = []) {
    return Object.freeze({ type, severity, title, detail, records: records.map(String) });
  }

  function normalizedTitle(value = "") {
    return String(value).toLocaleLowerCase("zh-TW").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  }

  async function runHealthCheck(options = {}) {
    const result = await load(options);
    const findings = [];
    if (result.engineeringMemoryFailures?.length) {
      result.engineeringMemoryFailures.forEach(failure => findings.push(healthFinding(
        failure.reason === "Canonical Conflict / Need PM Decision" ? "canonical_conflict" : "canonical_retrieval_failed",
        "error",
        `${failure.knowledgeCode || "Engineering Principle"} | ${failure.reason}`,
        "Canonical Principle 無法由 public.engineering_knowledge 唯一解析；未使用 Repository 舊文件、歷史引用或舊 Context fallback。",
        [failure.knowledgeCode || "public.engineering_knowledge"]
      )));
    }
    const tasks = result.tasks;
    const byCode = new Map();
    tasks.forEach(task => {
      const code = String(task.workCode || "").trim();
      if (!code) findings.push(healthFinding("missing_work_code", "warning", "TASK 缺少編號", `${task.title} 尚未有正式 TASK Code。`, [task.id]));
      else byCode.set(code, [...(byCode.get(code) || []), task]);
      if (!task.title.trim()) findings.push(healthFinding("missing_required_field", "warning", "TASK 缺少標題", "沒有標題的 TASK 無法讓 PM 辨識。", [task.id]));
      if (!task.summary.trim()) findings.push(healthFinding("missing_required_field", "info", "TASK 缺少需求內容", "此 TASK 尚未補充需求內容，請由 GPT／PM 判斷是否需要補充。", [task.workCode || task.id]));
    });
    byCode.forEach((rows, code) => {
      if (rows.length > 1) findings.push(healthFinding("duplicate_code", "error", `TASK Code 重複：${code}`, "同一個正式編號對應多張 TASK；不要自動刪除，應由 PM 決定整理方式。", rows.map(row => row.id)));
    });
    const numbers = [...byCode.keys()].map(code => Number(String(code).match(/TASK[-_ ]?(\d+)/i)?.[1] || 0)).filter(Boolean).sort((a, b) => a - b);
    if (numbers.length > 1) {
      const present = new Set(numbers);
      const gaps = [];
      for (let n = numbers[0]; n <= numbers[numbers.length - 1]; n++) if (!present.has(n)) gaps.push(`TASK-${String(n).padStart(3, "0")}`);
      if (gaps.length) findings.push(healthFinding("number_gap", "info", "TASK 編號存在歷史缺口", `發現 ${gaps.join("、")}；這只是 Finding，不自動補建假 TASK。`, gaps));
    }
    const titleRows = tasks.map(task => ({ task, title: normalizedTitle(task.title) })).filter(item => item.title);
    for (let i = 0; i < titleRows.length; i++) for (let j = i + 1; j < titleRows.length; j++) {
      const a = new Set(titleRows[i].title.split(" "));
      const b = new Set(titleRows[j].title.split(" "));
      const overlap = [...a].filter(token => token && b.has(token)).length / Math.max(a.size, b.size);
      if (overlap >= 0.8) findings.push(healthFinding("high_similarity", "warning", "TASK 標題高度相似", `${titleRows[i].task.workCode || titleRows[i].task.id} 與 ${titleRows[j].task.workCode || titleRows[j].task.id} 可能描述同一範圍；保留原資料，交 PM／GPT 判斷。`, [titleRows[i].task.id, titleRows[j].task.id]));
    }
    const latestTaskAt = Math.max(...tasks.map(task => Date.parse(task.updatedAt || task.createdAt || "") || 0), 0);
    const latestMapAt = Math.max(...result.systemMaps.map(map => Date.parse(map.updatedAt || "") || 0), 0);
    if (latestTaskAt && (!latestMapAt || latestMapAt < latestTaskAt)) findings.push(healthFinding("stale_knowledge", "warning", "系統藍圖可能落後目前 TASK", "目前正式 TASK 最近更新時間晚於 System Map；先保留 Stale Finding，更新需走既有治理流程。", ["TASK-026-SYSTEM-MAP"]));
    const gateway = options.gateway || requireGateway();
    let checklistRows = [];
    try {
      checklistRows = await gateway.select("engineering_checklist_items", "?select=task_id,stage,state,required,evidence_note,evidence_ref");
    } catch (error) {
      findings.push(healthFinding("checklist_read_failed", "error", "Checklist 無法讀取", "無法完成 Checklist consistency 檢查；請確認 Shared Gateway 與權限。", [error.message || "gateway"]));
    }
    const checklistByTask = new Map();
    (Array.isArray(checklistRows) ? checklistRows : []).forEach(row => checklistByTask.set(String(row.task_id), [...(checklistByTask.get(String(row.task_id)) || []), row]));
    tasks.filter(task => task.status === "done").forEach(task => {
      const gate = completionGateStatus(checklistByTask.get(task.id) || []);
      if (gate.hasRequired && !gate.allowed) findings.push(healthFinding("done_checklist_conflict", "error", `${task.workCode || "TASK"} 完成狀態與 Checklist 不一致`, "完成 TASK 的 Co／QJC 必要驗收仍未完整通過或缺少 Evidence；GPT 工程審查紀錄不列入 QJC 完成 Gate。", [task.id]));
    });
    if (!result.governanceMetadataAvailable) {
      findings.push(healthFinding("schema_capability", "error", "治理欄位無法讀取", "目前無法確認 Merge／Cancel／Link／Ignore 的正式治理欄位；請先確認 TASK-033 Migration。", ["board_tasks"]));
    }
    return Object.freeze({ scannedAt: new Date().toISOString(), taskCount: tasks.length, findingCount: findings.length, findings, writable: false, source: "Supabase Shared Data Gateway (read-only)" });
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

  async function governanceAction(taskId, action, targetTaskId = null, reason = "", options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("board_governance_action", {
      p_task_id: taskId,
      p_action: action,
      p_target_task_id: targetTaskId || null,
      p_reason: reason
    }).then(normalizeTask);
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
    isGovernanceTerminal,
    normalizeChecklistItem,
    completionGateStatus,
    isPrinciple,
    isSystemMap,
    normalizePrinciple,
    normalizeSystemMap,
    load,
    loadChecklist,
    transitionTask,
    governanceAction,
    createTask,
    createChecklistItem,
    updateChecklistItem,
    runHealthCheck,
    subscribe
  });
});
