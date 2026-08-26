/* Zhuge AI OS AI Board — Shared Cloud adapter.
 *
 * The Board is a presentation module. It receives the current Shared
 * Identity and Shared Supabase Data Gateway; it never creates a second
 * Supabase client or reads a task from browser storage. Mutations are limited
 * to approved controlled RPCs or the existing PM Governance Runner boundary.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeBoardReadService = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const ENGINEERING_STATUS_DESCRIPTORS = Object.freeze([
    { key: "ready", label: "Ready", code: "ready" },
    { key: "inprogress", label: "推進中", code: "inprogress" },
    { key: "qa", label: "驗證中", code: "qa" },
    { key: "done", label: "已完成", code: "done" }
  ]);
  const STATUS_BY_KEY = Object.freeze(Object.fromEntries(ENGINEERING_STATUS_DESCRIPTORS.map(item => [item.key, item])));
  const TERMINAL_STATUS_DESCRIPTORS = Object.freeze({
    merged: Object.freeze({ key: "merged", label: "已合併", code: "merged" }),
    cancelled: Object.freeze({ key: "cancelled", label: "已取消", code: "cancelled" })
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
      qa: Object.freeze({ status: "qa", assignee: "QJC", action: "GPT Review 通過 → 交 QJC", requiresAssignee: "GPT" })
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

  function statusDescriptorFor(value) {
    const status = normalizeStatus(value);
    return STATUS_BY_KEY[status] || TERMINAL_STATUS_DESCRIPTORS[status] || STATUS_BY_KEY.ready;
  }

  function isGovernanceTerminal(taskOrStatus) {
    const value = typeof taskOrStatus === "object" ? taskOrStatus?.status : taskOrStatus;
    return ["merged", "cancelled"].includes(normalizeStatus(value));
  }

  // Archive presentation is derived from canonical Engineering/Governance
  // state plus the server-owned completion lifecycle timestamps. It is not a
  // second status or a browser-side timer.
  function isArchiveTask(taskOrStatus) {
    const task = typeof taskOrStatus === "object" && taskOrStatus !== null ? taskOrStatus : null;
    const value = task ? task.status : taskOrStatus;
    const status = normalizeStatus(value);
    if (isGovernanceTerminal(value)) return true;
    if (!task) return status === "done";
    if (task.archivedAt) return true;
    // A task is visible in 已完成 while its Cloud-owned 48-hour window is
    // active.  The same row remains active after a PM drags it out: the old
    // completion timestamp is retained as evidence, while archive_due_at is
    // cleared to cancel the current timer. Re-entering 已完成 starts a new
    // window through the controlled RPC.
    if (task.completionAt && task.archiveDueAt) {
      const due = Date.parse(task.archiveDueAt);
      // A timestamped completion row is archive-eligible by its Cloud due
      // time. The workspace normally identifies the active lifecycle window;
      // keeping the timestamp branch also makes the adapter safe for older
      // read fixtures that omit workspace columns.
      return Number.isFinite(due) && due <= Date.now();
    }
    if (task.completionAt && !task.archiveDueAt) return false;
    if (status !== "done") return false;

    // Legacy done rows without the new lifecycle timestamps remain in the
    // existing read-only Archive. New completion rows are governed by the
    // workspace/timestamp branch above.
    return true;
  }

  function planTransition(task, targetUiKey) {
    const currentStatus = normalizeStatus(task?.status);
    const currentStatusDescriptor = statusDescriptorFor(currentStatus);
    const target = QJC_TRANSITIONS[currentStatus]?.[String(targetUiKey || "")];
    if (!target) {
      return Object.freeze({
        allowed: false,
        currentStatus,
        currentStatusDescriptor,
        reason: currentStatusDescriptor.key === targetUiKey
          ? "這張卡片已在目前工作區，不需要重複交接。"
          : `目前工程狀態為「${currentStatusDescriptor.label}」，只能依序交給下一個工作階段；不能直接執行這個工程交接。`
      });
    }
    if (target.requiresAssignee && String(task?.assignee || "") !== target.requiresAssignee) {
      const owner = target.requiresAssignee === "GPT" ? "GPT Review" : "QJC PM QA";
      return Object.freeze({
        allowed: false,
        currentStatus,
        currentStatusDescriptor,
        reason: `目前接球者不是${owner}，不能執行這個交接；請先由目前負責角色完成驗證。`
      });
    }
    return Object.freeze({
      allowed: true,
      currentStatus,
      currentStatusDescriptor,
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

  function normalizeWorkspace(row = {}) {
    return Object.freeze({
      id: String(row.id || ""),
      key: String(row.workspace_key || row.key || ""),
      name: String(row.name || "未命名工作區"),
      applicationScope: String(row.application_scope || row.applicationScope || "ai_board"),
      ownerUuid: String(row.owner_uuid || row.ownerUuid || ""),
      sortOrder: Number(row.sort_order || 0),
      active: row.active !== false,
      archivedAt: row.archived_at || null,
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null
    });
  }

  function normalizeMovement(row = {}) {
    const before = row.before_data || {};
    const after = row.after_data || {};
    return Object.freeze({
      id: String(row.id || ""),
      taskId: String(row.entity_id || row.task_id || ""),
      fromWorkspaceId: String(before.workspace_id || ""),
      fromWorkspace: String(before.workspace_name || ""),
      toWorkspaceId: String(after.workspace_id || ""),
      toWorkspace: String(after.workspace_name || ""),
      actor: String(row.actor_label || ""),
      actorId: String(row.actor_id || ""),
      timestamp: row.created_at || null,
      note: String(row.note || "")
    });
  }

  function normalizeActivity(row = {}) {
    const action = String(row.action || "");
    const activityType = String(row.activity_type || row.activityType || (action === "progress_note_created" ? "human_progress_note" : "system_activity"));
    return Object.freeze({
      id: String(row.id || ""),
      entityType: String(row.entity_type || ""),
      entityId: String(row.entity_id || ""),
      action,
      activityType,
      beforeData: row.before_data && typeof row.before_data === "object" ? row.before_data : {},
      afterData: row.after_data && typeof row.after_data === "object" ? row.after_data : {},
      note: String(row.note || ""),
      actorId: String(row.actor_id || ""),
      actorType: String(row.actor_type || "legacy"),
      actorLabel: String(row.actor_label || "Legacy"),
      revisionOf: row.revision_of == null ? null : String(row.revision_of),
      tombstoneOf: row.tombstone_of == null ? null : String(row.tombstone_of),
      timestamp: row.created_at || null
    });
  }

  function normalizeArtifact(row = {}) {
    return Object.freeze({
      artifactId: String(row.artifact_id || ""),
      filename: String(row.filename || ""),
      productVersion: String(row.product_version || ""),
      runtimeBuild: String(row.runtime_build || ""),
      artifactTimestamp: row.artifact_timestamp || null,
      gitCommit: String(row.git_commit || ""),
      sha256: String(row.sha256 || ""),
      artifactType: String(row.artifact_type || ""),
      qaStatus: String(row.qa_status || ""),
      pmAcceptanceStatus: String(row.pm_acceptance_status || ""),
      storageLocation: String(row.storage_location || ""),
      relatedTask: String(row.related_task || ""),
      lineage: row.lineage && typeof row.lineage === "object" ? row.lineage : {}
    });
  }

  function normalizeTask(row = {}) {
    const rawStatus = String(row.status || "").trim().toLowerCase();
    const status = normalizeStatus(rawStatus);
    return Object.freeze({
      id: String(row.id || ""),
      workCode: String(row.work_code || row.workCode || ""),
      title: String(row.title || "未命名工作"),
      status,
      rawStatus,
      applicationScope: String(row.application_scope || row.applicationScope || "ai_board"),
      ownerUuid: String(row.owner_uuid || row.ownerUuid || ""),
      workspaceId: String(row.workspace_id || row.workspaceId || ""),
      workspaceKey: String(row.workspace_key || row.workspaceKey || ""),
      workspaceName: String(row.workspace_name || row.workspaceName || ""),
      workspace: String(row.workspace_key || row.workspaceKey || ""),
      priority: String(row.priority || ""),
      assignee: String(row.assignee || ""),
      dueDate: row.due_date || row.dueDate || null,
      agreementMode: row.agreement_mode || row.agreementMode || null,
      agreementStartDate: row.agreement_start_date || row.agreementStartDate || null,
      agreementEndDate: row.agreement_end_date || row.agreementEndDate || null,
      source: String(row.source_workspace || row.source || ""),
      // Keep the PM-readable contract fields separate.  The Board can present
      // a clear narrative without asking a reviewer to infer it from internal
      // engineering columns.
      summary: String(row.summary || row.objective || row.problem || row.description || ""),
      latestProgress: String(row.latest_progress || row.latestProgress || ""),
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
      acceptedAt: row.accepted_at || null,
      acceptedBy: String(row.accepted_by || ""),
      completionAt: row.completion_at || null,
      completionBy: String(row.completion_by || ""),
      archiveDueAt: row.archive_due_at || null,
      archivedAt: row.archived_at || null,
      archivedBy: String(row.archived_by || ""),
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

  function normalizeTaskChecklistItem(row = {}) {
    return Object.freeze({
      id: String(row.id || ""),
      taskId: String(row.task_id || ""),
      checklistType: "general_task",
      label: String(row.label || ""),
      completed: row.completed === true,
      sortOrder: Number(row.sort_order || 0),
      createdBy: String(row.created_by || ""),
      updatedBy: String(row.updated_by || ""),
      createdAt: row.created_at || null,
      updatedAt: row.updated_at || null
    });
  }

  function normalizeTaskAttachment(row = {}) {
    return Object.freeze({
      attachmentId: String(row.id || row.attachment_id || ""),
      taskId: String(row.task_id || ""),
      activityId: String(row.activity_id || ""),
      attachmentScope: String(row.attachment_scope || "task"),
      filename: String(row.filename || ""),
      mimeType: String(row.mime_type || "application/octet-stream"),
      byteSize: Number(row.byte_size || 0),
      storageBucket: String(row.storage_bucket || "board-task-attachments"),
      storagePath: String(row.storage_path || ""),
      uploadStatus: String(row.upload_status || ""),
      deletionStatus: String(row.deletion_status || "active"),
      deletedAt: row.deleted_at || null,
      deletedBy: String(row.deleted_by || ""),
      createdBy: String(row.created_by || ""),
      createdAt: row.created_at || null,
      completedAt: row.completed_at || null
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
    const applicationScope = options.applicationScope === "worktodo" ? "worktodo" : "ai_board";
    const isWorkTodo = applicationScope === "worktodo";
    const resolver = options.engineeringMemory || isWorkTodo ? null : requireEngineeringMemoryResolver(options);
    // Reconciliation is a server-side, authenticated RPC. It uses canonical
    // timestamps and makes refresh/realtime reads converge without a browser
    // timer or local state pretending that 48 hours have elapsed.
    if (!isWorkTodo && typeof gateway.rpc === "function") {
      await gateway.rpc("board_reconcile_completion_lifecycle", {});
    }
    const [workspaceRows, taskRows, engineeringMemory] = await Promise.all([
      gateway.select("board_workspaces", `?select=id,workspace_key,name,sort_order,active,archived_at,created_at,updated_at,application_scope,owner_uuid&application_scope=eq.${applicationScope}&active=eq.true&order=sort_order.asc`),
      gateway.select("board_tasks", `?select=id,title,status,priority,assignee,due_date,agreement_mode,agreement_start_date,agreement_end_date,workspace_id,source_workspace,summary,problem,objective,proposed_solution,acceptance_criteria,related_work,developer_notes,pm_notes,usage_scenario,work_code,created_by,created_at,updated_at,resolution_action,merged_into,linked_to,resolution_reason,resolved_at,resolved_by,accepted_at,accepted_by,completion_at,completion_by,archive_due_at,archived_at,archived_by,application_scope,owner_uuid&application_scope=eq.${applicationScope}&order=created_at.asc`),
      options.engineeringMemory || (isWorkTodo ? { status: "not_applicable", records: [], failures: [] } : resolver.resolveCurrentCanonical({ gateway, codes: options.knowledgeCodes }))
    ]);
    const workspaces = (Array.isArray(workspaceRows) ? workspaceRows : []).map(normalizeWorkspace);
    const workspaceById = new Map(workspaces.map(workspace => [workspace.id, workspace]));
    let latestProgressByTask = new Map();
    if (isWorkTodo && typeof gateway.select === "function") {
      try {
        const workTodoTaskIds = (Array.isArray(taskRows) ? taskRows : [])
          .map(row => String(row?.id || "").trim())
          .filter(Boolean);
        const activityRows = workTodoTaskIds.length
          ? await gateway.select(
            "engineering_activity_log",
            `?select=id,entity_id,action,activity_type,note,revision_of,tombstone_of,created_at&entity_type=eq.board_task&activity_type=eq.human_progress_note&entity_id=in.(${workTodoTaskIds.map(encodeURIComponent).join(",")})&order=created_at.desc`
          )
          : [];
        const superseded = new Set((Array.isArray(activityRows) ? activityRows : []).filter(row => row.revision_of != null).map(row => String(row.revision_of)));
        const tombstoned = new Set((Array.isArray(activityRows) ? activityRows : []).filter(row => row.tombstone_of != null).map(row => String(row.tombstone_of)));
        (Array.isArray(activityRows) ? activityRows : []).forEach(row => {
          const id = String(row.id || "");
          const taskId = String(row.entity_id || "");
          if (!taskId || !id || row.action === "progress_note_deleted" || superseded.has(id) || tombstoned.has(id) || latestProgressByTask.has(taskId)) return;
          latestProgressByTask.set(taskId, String(row.note || "").trim());
        });
      } catch {
        latestProgressByTask = new Map();
      }
    }
    const tasks = (Array.isArray(taskRows) ? taskRows : []).map(row => {
      const workspace = workspaceById.get(String(row.workspace_id || ""));
      return normalizeTask({
        ...row,
        workspace_key: workspace?.key || "",
        workspace_name: workspace?.name || "",
        latest_progress: latestProgressByTask.get(String(row.id || "")) || ""
      });
    });
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
    return Object.freeze({ identity, workspaces, tasks, principles, systemMaps, engineeringMemory, engineeringMemoryFailures: engineeringMemory?.failures || [], governanceMetadataAvailable: true, readOnly: false, source: isWorkTodo ? "Supabase Shared Data Gateway → WorkTodo Application Scope" : "Supabase Shared Data Gateway → Canonical Engineering Memory Resolver" });
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

  async function loadTaskChecklist(taskId, options = {}) {
    const gateway = options.gateway || requireGateway();
    const encoded = encodeURIComponent(String(taskId || ""));
    const rows = await gateway.select(
      "board_task_checklist_items",
      `?select=id,task_id,label,completed,sort_order,created_by,updated_by,created_at,updated_at&task_id=eq.${encoded}&order=sort_order.asc,created_at.asc`
    );
    return (Array.isArray(rows) ? rows : []).map(normalizeTaskChecklistItem);
  }

  async function loadMovementHistory(taskId, options = {}) {
    const gateway = options.gateway || requireGateway();
    const encoded = encodeURIComponent(String(taskId || ""));
    const rows = await gateway.select(
      "engineering_activity_log",
      `?select=id,entity_id,action,before_data,after_data,note,actor_id,actor_label,created_at&entity_type=eq.board_task&entity_id=eq.${encoded}&action=eq.workspace_moved&order=created_at.desc`
    );
    return (Array.isArray(rows) ? rows : []).map(normalizeMovement);
  }

  async function loadActivity(taskId, options = {}) {
    const gateway = options.gateway || requireGateway();
    const encodedTaskId = encodeURIComponent(String(taskId || ""));
    const fields = "id,entity_type,entity_id,action,activity_type,before_data,after_data,note,actor_id,actor_type,actor_label,revision_of,tombstone_of,created_at";
    const taskRowsPromise = gateway.select(
      "engineering_activity_log",
      `?select=${fields}&entity_type=eq.board_task&entity_id=eq.${encodedTaskId}&order=created_at.desc`
    );
    const checklistItems = Array.isArray(options.checklistItems)
      ? options.checklistItems
      : await loadChecklist(taskId, { gateway });
    const checklistIds = checklistItems.map(item => String(item?.id || "")).filter(Boolean);
    const checklistRowsPromise = checklistIds.length
      ? gateway.select(
        "engineering_activity_log",
        `?select=${fields}&entity_type=eq.engineering_checklist_item&entity_id=in.(${checklistIds.join(",")})&order=created_at.desc`
      )
      : Promise.resolve([]);
    const [taskRows, checklistRows] = await Promise.all([taskRowsPromise, checklistRowsPromise]);
    return [...(Array.isArray(taskRows) ? taskRows : []), ...(Array.isArray(checklistRows) ? checklistRows : [])]
      .map(normalizeActivity)
      .sort((left, right) => (Date.parse(right.timestamp || "") || 0) - (Date.parse(left.timestamp || "") || 0));
  }

  async function loadArtifacts(task, options = {}) {
    const gateway = options.gateway || requireGateway();
    const references = [...new Set([task?.id, task?.workCode].map(value => String(value || "").trim()).filter(Boolean))];
    if (!references.length) return [];
    const fields = "artifact_id,filename,product_version,runtime_build,artifact_timestamp,git_commit,sha256,artifact_type,qa_status,pm_acceptance_status,storage_location,related_task,lineage";
    const rows = await Promise.all(references.map(reference => gateway.select(
      "engineering_artifacts",
      `?select=${fields}&related_task=eq.${encodeURIComponent(reference)}&order=artifact_timestamp.desc`
    )));
    const seen = new Set();
    return rows.flatMap(items => Array.isArray(items) ? items : [])
      .map(normalizeArtifact)
      .filter(item => item.artifactId && !seen.has(item.artifactId) && seen.add(item.artifactId));
  }

  async function loadTaskAttachments(taskId, options = {}) {
    const gateway = options.gateway || requireGateway();
    const encoded = encodeURIComponent(String(taskId || ""));
    const rows = await gateway.select(
      "board_task_attachments",
      `?select=id,task_id,activity_id,attachment_scope,filename,mime_type,byte_size,storage_bucket,storage_path,upload_status,deletion_status,deleted_at,deleted_by,created_by,created_at,completed_at&task_id=eq.${encoded}&upload_status=eq.ready&deletion_status=eq.active&order=created_at.desc`
    );
    return (Array.isArray(rows) ? rows : []).map(normalizeTaskAttachment);
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

  async function reconcileCompletionLifecycle(options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("board_reconcile_completion_lifecycle", {});
  }

  async function createWorkspace(name, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("board_create_workspace", { p_name: name }).then(normalizeWorkspace);
  }

  async function renameWorkspace(workspaceId, name, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("board_rename_workspace", { p_workspace_id: workspaceId, p_name: name }).then(normalizeWorkspace);
  }

  async function deleteWorkspaceWithContract(workspaceId, requestRpc, finalizeRpc, options = {}) {
    const gateway = options.gateway || requireGateway();
    const manifest = await gateway.rpc(requestRpc, { p_workspace_id: workspaceId });
    const attachments = Array.isArray(manifest?.attachments) ? manifest.attachments : [];
    if (attachments.length && typeof gateway.removeStorageObject !== "function") {
      const error = new Error("Shared Supabase Gateway 尚未支援受控 Workspace Storage 刪除。");
      error.code = "WORKSPACE_STORAGE_DELETE_UNAVAILABLE";
      throw error;
    }
    for (const attachment of attachments) {
      await gateway.removeStorageObject(attachment.storage_bucket || attachment.storageBucket, attachment.storage_path || attachment.storagePath);
    }
    return gateway.rpc(finalizeRpc, {
      p_workspace_id: workspaceId,
      p_task_ids: Array.isArray(manifest?.task_ids) ? manifest.task_ids : [],
      p_attachment_ids: attachments.map(attachment => attachment.id || attachment.attachment_id).filter(Boolean)
    });
  }

  async function deleteWorkspace(workspaceId, options = {}) {
    return deleteWorkspaceWithContract(workspaceId, "board_request_delete_workspace", "board_finalize_delete_workspace", options);
  }

  async function reorderWorkspaces(workspaceIds, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("board_reorder_workspaces", { p_workspace_ids: workspaceIds });
  }

  async function worktodoRenameWorkspace(workspaceId, name, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("worktodo_rename_workspace", { p_workspace_id: workspaceId, p_name: name }).then(normalizeWorkspace);
  }

  async function worktodoDeleteWorkspace(workspaceId, options = {}) {
    return deleteWorkspaceWithContract(workspaceId, "worktodo_request_delete_workspace", "worktodo_finalize_delete_workspace", options);
  }

  async function worktodoReorderWorkspaces(workspaceIds, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("worktodo_reorder_workspaces", { p_workspace_ids: workspaceIds });
  }

  async function worktodoCreateWorkspace(name, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("worktodo_create_workspace", { p_name: name }).then(normalizeWorkspace);
  }

  async function moveTaskWorkspace(taskId, targetWorkspaceId, note = "", options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("board_move_task_workspace", {
      p_task_id: taskId,
      p_target_workspace_id: targetWorkspaceId,
      p_note: note || null
    }).then(normalizeTask);
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
      p_actor_label: "QJC",
      p_workspace_id: input.workspaceId || null
    }).then(normalizeTask);
  }

  async function worktodoCreateTask(input = {}, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("worktodo_create_task", {
      p_title: input.title,
      p_summary: input.summary || null,
      p_status: input.status || "not_started",
      p_usage_scenario: input.usageScenario || null,
      p_workspace_id: input.workspaceId || null
    }).then(normalizeTask);
  }

  async function worktodoUpdateTask(input = {}, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("worktodo_update_task", {
      p_task_id: input.taskId,
      p_patch: input.patch && typeof input.patch === "object" ? input.patch : {}
    }).then(normalizeTask);
  }

  async function worktodoDeleteTask(taskId, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("worktodo_delete_task", { p_task_id: taskId });
  }

  async function worktodoAddTaskProgressNote(input = {}, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("worktodo_add_task_progress_note", {
      p_task_id: input.taskId,
      p_note: input.note
    }).then(normalizeActivity);
  }

  async function worktodoEditTaskProgressNote(input = {}, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("worktodo_edit_task_progress_note", {
      p_activity_id: Number(input.activityId),
      p_note: String(input.note || "")
    }).then(normalizeActivity);
  }

  async function worktodoDeleteTaskProgressNote(activityId, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("worktodo_delete_task_progress_note", {
      p_activity_id: Number(activityId)
    }).then(normalizeActivity);
  }

  async function worktodoSetAgreementSchedule(input = {}, options = {}) {
    const gateway = options.gateway || requireGateway();
    const mode = input.mode == null || input.mode === "" ? null : String(input.mode);
    return gateway.rpc("worktodo_set_agreement_schedule", {
      p_task_id: input.taskId,
      p_agreement_mode: mode,
      p_agreement_start_date: input.startDate || null,
      p_agreement_end_date: input.endDate || null
    }).then(normalizeTask);
  }

  async function worktodoMigrateTask(workCode, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("worktodo_migrate_task", { p_work_code: String(workCode || "") }).then(normalizeTask);
  }

  async function updateTaskContent(input = {}, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("board_update_task_content", {
      p_task_id: input.taskId,
      p_summary: input.summary == null ? null : String(input.summary),
      p_usage_scenario: input.usageScenario == null ? null : String(input.usageScenario)
    }).then(normalizeTask);
  }

  async function updateTaskTitle(input = {}, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("board_update_task_title", {
      p_task_id: input.taskId,
      p_title: String(input.title || "")
    }).then(normalizeTask);
  }

  async function updateTaskDueDate(input = {}, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("board_update_task_due_date", {
      p_task_id: input.taskId,
      p_due_date: input.dueDate || null
    }).then(normalizeTask);
  }

  async function addTaskChecklistItem(input = {}, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("board_add_task_checklist_item", {
      p_task_id: input.taskId,
      p_label: input.label,
      p_sort_order: Number(input.sortOrder || 0)
    }).then(normalizeTaskChecklistItem);
  }

  async function updateTaskChecklistItem(input = {}, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("board_update_task_checklist_item", {
      p_item_id: input.id,
      p_label: Object.prototype.hasOwnProperty.call(input, "label") ? input.label : null,
      p_completed: Object.prototype.hasOwnProperty.call(input, "completed") ? Boolean(input.completed) : null,
      p_sort_order: Object.prototype.hasOwnProperty.call(input, "sortOrder") ? Number(input.sortOrder) : null
    }).then(normalizeTaskChecklistItem);
  }

  async function deleteTaskChecklistItem(itemId, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("board_delete_task_checklist_item", { p_item_id: itemId });
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

  async function addTaskProgressNote(taskId, note, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("board_add_task_progress_note", {
      p_task_id: taskId,
      p_note: note
    }).then(normalizeActivity);
  }

  async function editTaskProgressNote(activityId, note, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("board_edit_task_progress_note", {
      p_activity_id: Number(activityId),
      p_note: String(note || "")
    }).then(normalizeActivity);
  }

  async function deleteTaskProgressNote(activityId, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("board_delete_task_progress_note", {
      p_activity_id: Number(activityId)
    }).then(normalizeActivity);
  }

  async function prepareTaskAttachment(input = {}, options = {}) {
    const gateway = options.gateway || requireGateway();
    const file = input.file;
    if (!file || !file.name || !Number.isFinite(Number(file.size))) {
      throw new Error("請先選擇有效附件。");
    }
    return gateway.rpc("board_prepare_task_attachment", {
      p_task_id: input.taskId,
      p_filename: file.name,
      p_mime_type: file.type || "application/octet-stream",
      p_byte_size: Number(file.size),
      p_activity_id: input.activityId || null
    }).then(normalizeTaskAttachment);
  }

  async function prepareProgressNoteAttachment(input = {}, options = {}) {
    const gateway = options.gateway || requireGateway();
    const file = input.file;
    if (!file || !file.name || !Number.isFinite(Number(file.size))) {
      throw new Error("請先選擇有效進度附件。");
    }
    return gateway.rpc("board_prepare_progress_note_attachment", {
      p_activity_id: input.activityId,
      p_filename: file.name,
      p_mime_type: file.type || "application/octet-stream",
      p_byte_size: Number(file.size)
    }).then(normalizeTaskAttachment);
  }

  async function uploadTaskAttachment(attachment, file, options = {}) {
    const gateway = options.gateway || requireGateway();
    if (typeof gateway.uploadStorageObject !== "function") {
      throw new Error("Shared Supabase Gateway 尚未支援受控附件上傳。");
    }
    await gateway.uploadStorageObject(attachment.storageBucket, attachment.storagePath, file, {
      contentType: attachment.mimeType
    });
    return attachment;
  }

  async function completeTaskAttachment(attachmentId, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("board_complete_task_attachment", { p_attachment_id: attachmentId }).then(normalizeTaskAttachment);
  }

  async function deleteTaskAttachment(attachmentId, options = {}) {
    const gateway = options.gateway || requireGateway();
    const requested = await gateway.rpc("board_request_delete_task_attachment", { p_attachment_id: attachmentId }).then(normalizeTaskAttachment);
    try {
      if (typeof gateway.removeStorageObject !== "function") {
        throw new Error("Shared Supabase Gateway 尚未支援受控附件刪除。");
      }
      await gateway.removeStorageObject(requested.storageBucket, requested.storagePath);
      return gateway.rpc("board_finalize_delete_task_attachment", { p_attachment_id: attachmentId }).then(normalizeTaskAttachment);
    } catch (error) {
      await gateway.rpc("board_cancel_delete_task_attachment", { p_attachment_id: attachmentId }).catch(() => {});
      throw error;
    }
  }

  async function deleteProgressNoteAttachment(input = {}, options = {}) {
    const gateway = options.gateway || requireGateway();
    const attachmentId = input.attachmentId || input.id;
    const requested = await gateway.rpc("board_request_delete_progress_attachment", {
      p_attachment_id: attachmentId
    }).then(normalizeTaskAttachment);
    try {
      if (typeof gateway.removeStorageObject !== "function") {
        throw new Error("Shared Supabase Gateway 尚未支援受控附件刪除。");
      }
      await gateway.removeStorageObject(requested.storageBucket, requested.storagePath);
      return gateway.rpc("board_finalize_delete_progress_attachment", {
        p_attachment_id: attachmentId
      }).then(normalizeTaskAttachment);
    } catch (error) {
      await gateway.rpc("board_cancel_delete_progress_attachment", { p_attachment_id: attachmentId }).catch(() => {});
      throw error;
    }
  }

  async function taskAttachmentUrl(attachment, options = {}) {
    const gateway = options.gateway || requireGateway();
    if (!attachment?.storageBucket || !attachment?.storagePath || typeof gateway.createStorageSignedUrl !== "function") return "";
    return gateway.createStorageSignedUrl(attachment.storageBucket, attachment.storagePath, 3600);
  }

  function governanceRunnerUrl(options = {}) {
    return String(options.runnerUrl || root.ZhugeGovernanceApprovalRunnerUrl || "http://127.0.0.1:8765").replace(/\/$/, "");
  }

  async function governanceRunnerJson(pathname, options = {}) {
    const response = await (root.fetch || fetch)(`${governanceRunnerUrl(options)}${pathname}`, {
      method: options.method || "GET",
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      cache: "no-store"
    });
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    if (!response.ok) {
      const error = new Error(body?.message || "PM Governance Approval Runner 未接受這次受控請求。");
      error.code = body?.code || "GOVERNANCE_RUNNER_UNAVAILABLE";
      error.status = response.status;
      throw error;
    }
    return body;
  }

  async function requestTaskContractUpdate(input = {}, options = {}) {
    const payload = { task_id: input.taskId };
    if (Object.prototype.hasOwnProperty.call(input, "summary")) payload.summary = String(input.summary ?? "");
    if (Object.prototype.hasOwnProperty.call(input, "usageScenario")) payload.usage_scenario = String(input.usageScenario ?? "");
    return governanceRunnerJson("/api/request-task-update", { ...options, method: "POST", body: payload });
  }

  async function taskContractUpdateStatus(requestId, options = {}) {
    const query = `?request_id=${encodeURIComponent(String(requestId || ""))}`;
    return governanceRunnerJson(`/api/task-update-status${query}`, options);
  }

  async function subscribe(callback, options = {}) {
    const gateway = options.gateway || requireGateway();
    if (typeof gateway.subscribe !== "function") {
      const error = new Error("Shared Supabase Gateway 尚未支援 Realtime。");
      error.code = "BOARD_REALTIME_UNAVAILABLE";
      throw error;
    }
    const stopTask = await gateway.subscribe("board_tasks", callback);
    const stopTaskChecklist = await gateway.subscribe("board_task_checklist_items", callback);
    const stopTaskAttachments = await gateway.subscribe("board_task_attachments", callback);
    const stopChecklist = await gateway.subscribe("engineering_checklist_items", callback);
    const stopWorkspaces = await gateway.subscribe("board_workspaces", callback);
    const stopActivity = await gateway.subscribe("engineering_activity_log", callback);
    return async () => {
      await Promise.allSettled([stopTask?.(), stopTaskChecklist?.(), stopTaskAttachments?.(), stopChecklist?.(), stopWorkspaces?.(), stopActivity?.()]);
    };
  }

  return Object.freeze({
    ENGINEERING_STATUS_DESCRIPTORS,
    planTransition,
    availableTransitions,
    normalizeStatus,
    statusDescriptorFor,
    normalizeWorkspace,
    normalizeMovement,
    normalizeActivity,
    normalizeArtifact,
    normalizeTask,
    normalizeTaskChecklistItem,
    normalizeTaskAttachment,
    isGovernanceTerminal,
    isArchiveTask,
    normalizeChecklistItem,
    completionGateStatus,
    isPrinciple,
    isSystemMap,
    normalizePrinciple,
    normalizeSystemMap,
    load,
    reconcileCompletionLifecycle,
    loadChecklist,
    loadTaskChecklist,
    loadMovementHistory,
    loadActivity,
    loadArtifacts,
    loadTaskAttachments,
    transitionTask,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    reorderWorkspaces,
    worktodoRenameWorkspace,
    worktodoDeleteWorkspace,
    worktodoReorderWorkspaces,
    worktodoCreateWorkspace,
    moveTaskWorkspace,
    governanceAction,
    createTask,
    worktodoCreateTask,
    worktodoUpdateTask,
    worktodoDeleteTask,
    worktodoAddTaskProgressNote,
    worktodoEditTaskProgressNote,
    worktodoDeleteTaskProgressNote,
    worktodoSetAgreementSchedule,
    worktodoMigrateTask,
    updateTaskContent,
    updateTaskTitle,
    updateTaskDueDate,
    addTaskChecklistItem,
    updateTaskChecklistItem,
    deleteTaskChecklistItem,
    createChecklistItem,
    updateChecklistItem,
    addTaskProgressNote,
    editTaskProgressNote,
    deleteTaskProgressNote,
    prepareTaskAttachment,
    prepareProgressNoteAttachment,
    uploadTaskAttachment,
    completeTaskAttachment,
    deleteTaskAttachment,
    deleteProgressNoteAttachment,
    taskAttachmentUrl,
    requestTaskContractUpdate,
    taskContractUpdateStatus,
    runHealthCheck,
    subscribe
  });
});
