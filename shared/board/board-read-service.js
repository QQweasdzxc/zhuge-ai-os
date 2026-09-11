/* Zhuge AI OS AI Board — Shared Cloud adapter.
 *
 * The Board is a presentation module. It receives the current Shared
 * Identity and Shared Supabase Data Gateway; it never creates a second
 * Supabase client or reads a task from browser storage. Mutations are limited
 * to approved controlled RPCs or the existing PM Governance Runner boundary.
 */
(function (root, factory) {
  const activityClassifier = root?.ZhugeSharedActivityClassifier
    || (typeof module === "object" && module.exports && typeof require === "function"
      ? require("../components/activity-classifier.js")
      : null);
  const api = factory(root, activityClassifier);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeBoardReadService = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root, activityClassifier) {
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

  // C owns the standard acceptance contract.  Consumers opt into the
  // capability according to their product role; the contract itself is never
  // reimplemented by a consumer runtime.
  const C_LIFECYCLE_ACCEPTANCE_CONTRACT = Object.freeze({
    id: "module-c-lifecycle-acceptance-v1",
    source: "module-c-mother",
    acceptanceAction: "qjc-drop-to-completed",
    workspaceDecisionAction: "pm-workspace-decision",
    completionDecisionAction: "pm-workspace-decision-to-completed",
    reopenAction: "pm-workspace-decision-reopen",
    evidenceMode: "controlled-action-context",
    historicalEngineeringEvidence: "preserved-not-required-for-pm-decision",
    audit: "engineering_activity_log",
    atomicity: "single-transaction",
    genericDoneTransition: "forbidden"
  });

  // C owns one Workflow capability.  A Board Instance owns the data for its
  // own workflow; the capability is shared by every C consumer and does not
  // infer a workflow from a consumer name, TASK id, status, assignee, or UI
  // workspace label.
  const C_WORKFLOW_CANONICAL_CONTRACT = Object.freeze({
    id: "module-c-lifecycle-acceptance-v2",
    family: "module-c-lifecycle-acceptance",
    source: "module-c-mother",
    owner: "board-instance",
    versioning: "draft-published-retired-immutable",
    currentStepBinding: "board_tasks.workflow_version_id+current_workflow_step_id",
    workspaceBinding: "one-operable-step-per-workspace",
    roles: Object.freeze(["Co", "GPT", "QJC", "PM"]),
    acceptanceAction: "pm-workspace-decision-to-completion",
    reopenAction: "pm-workspace-decision-reopen",
    evidenceMode: "controlled-action-context-with-declared-evidence",
    atomicity: "single-transaction",
    idempotency: "private.board_workflow_action_idempotency",
    cloudSourceOfTruth: true
  });

  function createLifecycleCapability(acceptFromQjcDrop, enabled = true, reconcileWorkspaceDecision = null) {
    const capability = {
      contract: C_LIFECYCLE_ACCEPTANCE_CONTRACT,
      capabilities: Object.freeze({
        pmAcceptanceFromQjcDrop: Boolean(enabled),
        pmWorkspaceAuthority: typeof reconcileWorkspaceDecision === "function",
        pmCompletionDecision: typeof reconcileWorkspaceDecision === "function",
        pmReopenDecision: typeof reconcileWorkspaceDecision === "function"
      })
    };
    if (enabled && typeof acceptFromQjcDrop === "function") capability.acceptFromQjcDrop = acceptFromQjcDrop;
    if (typeof reconcileWorkspaceDecision === "function") capability.reconcileWorkspaceDecision = reconcileWorkspaceDecision;
    return Object.freeze(capability);
  }

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

  function normalizeWorkspace(row = {}) {
    return Object.freeze({
      id: String(row.id || ""),
      key: String(row.workspace_key || row.key || ""),
      name: String(row.name || "未命名工作區"),
      boardInstanceId: String(row.board_instance_id || row.boardInstanceId || ""),
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

  function classifyActivity(row = {}) {
    if (typeof activityClassifier?.classify === "function") return activityClassifier.classify(row);
    const activityType = String(row.activity_type || row.activityType || "").trim();
    const action = String(row.action || "").trim();
    return Object.freeze({
      activityType,
      action,
      classification: activityType === "system_activity" ? "system_activity" : "unknown",
      isHumanProgress: false
    });
  }

  function normalizeActivity(row = {}) {
    const classification = classifyActivity(row);
    const action = classification.action;
    const activityType = classification.activityType;
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
      boardInstanceId: String(row.board_instance_id || row.boardInstanceId || ""),
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
      latestProgressAt: row.latest_progress_at || row.latestProgressAt || null,
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
      workflowVersionId: String(row.workflow_version_id || row.workflowVersionId || ""),
      currentWorkflowStepId: String(row.current_workflow_step_id || row.currentWorkflowStepId || ""),
      createdBy: String(row.created_by || ""),
      updatedAt: row.updated_at || row.updatedAt || null,
      createdAt: row.created_at || row.createdAt || null
    });
  }

  function normalizeWorkflowStep(row = {}) {
    return Object.freeze({
      id: String(row.id || ""),
      workflowVersionId: String(row.workflow_version_id || row.workflowVersionId || ""),
      stepKey: String(row.step_key || row.stepKey || ""),
      name: String(row.name || ""),
      sortOrder: Number(row.sort_order ?? row.sortOrder ?? 0),
      roleKey: String(row.role_key || row.roleKey || "pm").toLowerCase(),
      workspaceId: String(row.workspace_id || row.workspaceId || ""),
      statusKey: String(row.status_key || row.statusKey || "inprogress").toLowerCase(),
      isInitial: row.is_initial === true || row.isInitial === true,
      isCompletion: row.is_completion === true || row.isCompletion === true
    });
  }

  function normalizeWorkflowDefinition(row = {}) {
    const source = row.workflow || row.definition || row;
    return Object.freeze({
      id: String(source.id || source.workflow_version_id || ""),
      boardInstanceId: String(source.board_instance_id || source.boardInstanceId || ""),
      versionNo: Number(source.version_no ?? source.versionNo ?? 0),
      name: String(source.name || ""),
      description: String(source.description || ""),
      status: String(source.status || "draft").toLowerCase(),
      basedOnWorkflowVersionId: String(source.based_on_workflow_version_id || source.basedOnWorkflowVersionId || ""),
      steps: (Array.isArray(source.steps) ? source.steps : []).map(normalizeWorkflowStep),
      transitions: (Array.isArray(source.transitions) ? source.transitions : []).map(item => Object.freeze({
        id: String(item.id || ""),
        workflowVersionId: String(item.workflow_version_id || item.workflowVersionId || source.id || ""),
        transitionKey: String(item.transition_key || item.transitionKey || ""),
        fromStepId: String(item.from_step_id || item.fromStepId || ""),
        toStepId: String(item.to_step_id || item.toStepId || ""),
        allowedRoles: Array.isArray(item.allowed_roles || item.allowedRoles) ? (item.allowed_roles || item.allowedRoles).map(String) : [],
        requiresGate: item.requires_gate === true || item.requiresGate === true
      })),
      gates: (Array.isArray(source.gates) ? source.gates : []).map(item => Object.freeze({
        id: String(item.id || ""),
        workflowVersionId: String(item.workflow_version_id || item.workflowVersionId || source.id || ""),
        stepId: String(item.step_id || item.stepId || ""),
        stepKey: String(item.step_key || item.stepKey || ""),
        gateKey: String(item.gate_key || item.gateKey || ""),
        name: String(item.name || ""),
        required: item.required !== false,
        humanActionRequired: item.human_action_required === true || item.humanActionRequired === true,
        completionRole: String(item.completion_role || item.completionRole || "pm").toLowerCase(),
        failurePolicy: String(item.failure_policy || item.failurePolicy || "stay").toLowerCase()
      })),
      evidenceRequirements: (Array.isArray(source.evidence_requirements || source.evidenceRequirements) ? (source.evidence_requirements || source.evidenceRequirements) : []).map(item => Object.freeze({
        id: String(item.id || ""),
        gateId: String(item.gate_id || item.gateId || ""),
        gateKey: String(item.gate_key || item.gateKey || ""),
        evidenceKey: String(item.evidence_key || item.evidenceKey || ""),
        label: String(item.label || ""),
        required: item.required !== false,
        sourceKind: String(item.source_kind || item.sourceKind || "pm_action_context").toLowerCase()
      }))
    });
  }

  function normalizeWorkflowResult(row = {}) {
    const value = row && typeof row === "object" ? row : {};
    const published = value.published ? normalizeWorkflowDefinition(value.published) : null;
    const draft = value.draft ? normalizeWorkflowDefinition(value.draft) : null;
    const workflow = value.workflow ? normalizeWorkflowDefinition(value.workflow) : null;
    return Object.freeze({
      contract: String(value.contract || C_WORKFLOW_CANONICAL_CONTRACT.id),
      boardInstanceId: String(value.board_instance_id || value.boardInstanceId || workflow?.boardInstanceId || published?.boardInstanceId || draft?.boardInstanceId || ""),
      boardName: String(value.board_name || value.boardName || ""),
      state: value.state && typeof value.state === "object" ? Object.freeze({
        draftWorkflowVersionId: String(value.state.draft_workflow_version_id || value.state.draftWorkflowVersionId || ""),
        publishedWorkflowVersionId: String(value.state.published_workflow_version_id || value.state.publishedWorkflowVersionId || ""),
        updatedAt: value.state.updated_at || value.state.updatedAt || null
      }) : null,
      published,
      draft,
      workflow,
      validation: value.validation && typeof value.validation === "object" ? value.validation : null,
      raw: value
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
      filename: String(row.display_name || row.filename || ""),
      originalFilename: String(row.filename || ""),
      note: String(row.note || ""),
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

  function normalizeBoardInstance(row = {}) {
    return Object.freeze({
      id: String(row.id || ""),
      name: String(row.name || ""),
      taskCodePrefix: String(row.task_code_prefix || row.taskCodePrefix || ""),
      templateKey: String(row.template_key || row.templateKey || ""),
      authorizationMode: String(row.authorization_mode || row.authorizationMode || ""),
      ownerUuid: String(row.owner_uuid || row.ownerUuid || ""),
      legacyApplicationScope: String(row.legacy_application_scope || row.legacyApplicationScope || ""),
      isTemplateInstance: row.is_template_instance === true || row.isTemplateInstance === true,
      active: row.active !== false,
      createdAt: row.created_at || row.createdAt || null,
      updatedAt: row.updated_at || row.updatedAt || null
    });
  }

  async function listBoardInstances(options = {}) {
    const gateway = options.gateway || requireGateway();
    const rows = await gateway.select(
      "board_instances",
      "?select=id,name,task_code_prefix,template_key,authorization_mode,owner_uuid,legacy_application_scope,is_template_instance,active,created_at,updated_at&active=eq.true&is_template_instance=eq.false&legacy_application_scope=is.null&template_key=eq.c&order=created_at.asc"
    );
    return (Array.isArray(rows) ? rows : [])
      .map(normalizeBoardInstance)
      .filter(instance => (
        instance.id &&
        instance.active !== false &&
        instance.isTemplateInstance !== true &&
        !instance.legacyApplicationScope &&
        instance.templateKey === "c"
      ));
  }

  async function listModuleConsumers(options = {}) {
    const gateway = options.gateway || requireGateway();
    const requestedTemplateKey = String(options.templateKey || "c").trim() || "c";
    const templateKey = encodeURIComponent(requestedTemplateKey);
    const rows = await gateway.select(
      "board_instances",
      `?select=id,name,task_code_prefix,template_key,authorization_mode,owner_uuid,legacy_application_scope,is_template_instance,active,created_at,updated_at&active=eq.true&template_key=eq.${templateKey}&order=created_at.asc`
    );
    return (Array.isArray(rows) ? rows : [])
      .map(row => {
        const instance = normalizeBoardInstance(row);
        const legacyScope = instance.legacyApplicationScope.replace(/_/g, "-");
        const consumerId = instance.isTemplateInstance ? "c" : legacyScope || instance.id;
        return Object.freeze({
          ...instance,
          consumerId,
          consumerLabel: instance.isTemplateInstance
            ? "C 母版"
            : instance.name || instance.taskCodePrefix || consumerId,
        });
      })
      .filter(instance => (
        instance.id &&
        instance.active !== false &&
        instance.templateKey === requestedTemplateKey &&
        instance.consumerId
      ));
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
    const requestedInstanceId = String(options.boardInstanceId || "").trim() || null;
    const applicationScope = requestedInstanceId ? null : options.applicationScope === "worktodo" ? "worktodo" : "ai_board";
    const isWorkTodo = applicationScope === "worktodo";
    const isBoardInstance = Boolean(requestedInstanceId);
    const resolver = options.engineeringMemory || isWorkTodo || isBoardInstance ? null : requireEngineeringMemoryResolver(options);
    // Reconciliation is a server-side, authenticated RPC. It uses canonical
    // timestamps and makes refresh/realtime reads converge without a browser
    // timer or local state pretending that 48 hours have elapsed.
    if (!isWorkTodo && !isBoardInstance && typeof gateway.rpc === "function") {
      await gateway.rpc("board_reconcile_completion_lifecycle", {});
    }
    const scopeQuery = isBoardInstance
      ? `board_instance_id=eq.${encodeURIComponent(requestedInstanceId)}`
      : `application_scope=eq.${applicationScope}`;
    const [workspaceRows, taskRows, engineeringMemory] = await Promise.all([
      gateway.select("board_workspaces", `?select=id,board_instance_id,workspace_key,name,sort_order,active,archived_at,created_at,updated_at,application_scope,owner_uuid&${scopeQuery}&active=eq.true&order=sort_order.asc`),
      gateway.select("board_tasks", `?select=id,board_instance_id,title,status,priority,assignee,due_date,agreement_mode,agreement_start_date,agreement_end_date,workspace_id,workflow_version_id,current_workflow_step_id,source_workspace,summary,problem,objective,proposed_solution,acceptance_criteria,related_work,developer_notes,pm_notes,usage_scenario,work_code,created_by,created_at,updated_at,resolution_action,merged_into,linked_to,resolution_reason,resolved_at,resolved_by,accepted_at,accepted_by,completion_at,completion_by,archive_due_at,archived_at,archived_by,application_scope,owner_uuid&${scopeQuery}&order=created_at.asc`),
      options.engineeringMemory || (isWorkTodo || isBoardInstance ? { status: "not_applicable", records: [], failures: [] } : resolver.resolveCurrentCanonical({ gateway, codes: options.knowledgeCodes }))
    ]);
    const workspaces = (Array.isArray(workspaceRows) ? workspaceRows : []).map(row => normalizeWorkspace(
      isBoardInstance && !row.application_scope && !row.applicationScope
        ? { ...row, application_scope: "c" }
        : row
    ));
    const workspaceById = new Map(workspaces.map(workspace => [workspace.id, workspace]));
    let latestProgressByTask = new Map();
    if ((isWorkTodo || isBoardInstance) && typeof gateway.select === "function") {
      try {
        const workTodoTaskIds = (Array.isArray(taskRows) ? taskRows : [])
          .map(row => String(row?.id || "").trim())
          .filter(Boolean);
        const activityRows = workTodoTaskIds.length
          ? await gateway.select(
            "engineering_activity_log",
            `?select=id,entity_id,action,activity_type,note,revision_of,tombstone_of,created_at&entity_type=eq.board_task&entity_id=in.(${workTodoTaskIds.map(encodeURIComponent).join(",")})&order=created_at.desc`
          )
          : [];
        const allActivityRows = Array.isArray(activityRows) ? activityRows : [];
        const superseded = new Set(allActivityRows.filter(row => row.revision_of != null).map(row => String(row.revision_of)));
        const tombstoned = new Set(allActivityRows.filter(row => row.tombstone_of != null).map(row => String(row.tombstone_of)));
        allActivityRows.forEach(row => {
          const id = String(row.id || "");
          const taskId = String(row.entity_id || "");
          if (!classifyActivity(row).isHumanProgress || !taskId || !id || superseded.has(id) || tombstoned.has(id) || latestProgressByTask.has(taskId)) return;
          latestProgressByTask.set(taskId, {
            content: String(row.note || "").trim(),
            createdAt: row.created_at || row.createdAt || null
          });
        });
      } catch {
        latestProgressByTask = new Map();
      }
    }
    const tasks = (Array.isArray(taskRows) ? taskRows : []).map(row => {
      const workspace = workspaceById.get(String(row.workspace_id || ""));
      return normalizeTask({
        ...row,
        ...(isBoardInstance && !row.application_scope && !row.applicationScope ? { application_scope: "c" } : {}),
        workspace_key: workspace?.key || "",
        workspace_name: workspace?.name || "",
        latest_progress: latestProgressByTask.get(String(row.id || ""))?.content || "",
        latest_progress_at: latestProgressByTask.get(String(row.id || ""))?.createdAt || null
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
    const resolvedBoardInstanceId = requestedInstanceId
      || String((taskRows || [])[0]?.board_instance_id || (workspaceRows || [])[0]?.board_instance_id || "");
    return Object.freeze({ identity, boardInstanceId: resolvedBoardInstanceId, workspaces, tasks, principles, systemMaps, engineeringMemory, engineeringMemoryFailures: engineeringMemory?.failures || [], governanceMetadataAvailable: true, readOnly: false, source: isBoardInstance ? "Supabase Shared Data Gateway → Board Instance" : isWorkTodo ? "Supabase Shared Data Gateway → WorkTodo Application Scope" : "Supabase Shared Data Gateway → Canonical Engineering Memory Resolver" });
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

  async function getWorkspaceNotificationSettings(workspaceId, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("board_get_workspace_notification_settings", { p_workspace_id: workspaceId });
  }

  async function saveWorkspaceNotificationSettings(workspaceId, settings = {}, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("board_save_workspace_notification_settings", {
      p_workspace_id: workspaceId,
      p_enabled: Boolean(settings.enabled),
      p_notify_assignee: Boolean(settings.notifyAssignee),
      p_notify_reporter: Boolean(settings.notifyReporter),
      p_custom_emails: Array.isArray(settings.customEmails) ? settings.customEmails : [],
      p_cc_emails: Array.isArray(settings.ccEmails) ? settings.ccEmails : [],
      p_bcc_emails: Array.isArray(settings.bccEmails) ? settings.bccEmails : [],
      p_progress_notification_enabled: Boolean(settings.progressNotificationEnabled),
      p_progress_to_emails: Array.isArray(settings.progressToEmails) ? settings.progressToEmails : [],
      p_progress_cc_emails: Array.isArray(settings.progressCcEmails) ? settings.progressCcEmails : [],
      p_progress_bcc_emails: Array.isArray(settings.progressBccEmails) ? settings.progressBccEmails : [],
      p_subject_template: String(settings.subjectTemplate || ""),
      p_body_template: String(settings.bodyTemplate || "")
    });
  }

  async function deleteWorkspaceWithContract(workspaceId, targetWorkspaceId, requestRpc, finalizeRpc, moveTask, options = {}) {
    const gateway = options.gateway || requireGateway();
    const manifest = await gateway.rpc(requestRpc, { p_workspace_id: workspaceId });
    const taskIds = Array.isArray(manifest?.task_ids) ? manifest.task_ids.filter(Boolean) : [];
    if (taskIds.length && options.rejectPopulated === true) {
      const error = new Error("此工作區仍有工作卡片，需先完成卡片處理後才能刪除；系統不會自動搬移工作卡片。");
      error.code = "WORKSPACE_DELETE_REQUIRES_RECONCILIATION";
      error.details = { workspaceId, taskCount: taskIds.length, tasksPreserved: true };
      throw error;
    }
    if (taskIds.length && !targetWorkspaceId) {
      const error = new Error("Workspace Delete Contract 缺少既有待開始 Workspace。");
      error.code = "WORKSPACE_DELETE_TARGET_UNAVAILABLE";
      throw error;
    }
    for (const taskId of taskIds) {
      await moveTask(taskId, targetWorkspaceId, gateway);
    }
    return gateway.rpc(finalizeRpc, {
      p_workspace_id: workspaceId,
      p_target_workspace_id: targetWorkspaceId || null,
      p_task_ids: taskIds
    });
  }

  async function deleteWorkspace(workspaceId, targetWorkspaceId, options = {}) {
    return deleteWorkspaceWithContract(
      workspaceId,
      targetWorkspaceId,
      "board_request_delete_workspace",
      "board_finalize_delete_workspace",
      (taskId, targetId, gateway) => gateway.rpc("board_move_task_workspace", {
        p_task_id: taskId,
        p_target_workspace_id: targetId,
        p_note: "Custom Workspace deleted; task preserved in canonical 待開始 workspace"
      }),
      { ...options, rejectPopulated: true }
    );
  }

  async function reorderWorkspaces(workspaceIds, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("board_reorder_workspaces", { p_workspace_ids: workspaceIds });
  }

  async function worktodoRenameWorkspace(workspaceId, name, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("worktodo_rename_workspace", { p_workspace_id: workspaceId, p_name: name }).then(normalizeWorkspace);
  }

  async function worktodoDeleteWorkspace(workspaceId, targetWorkspaceId, options = {}) {
    return deleteWorkspaceWithContract(
      workspaceId,
      targetWorkspaceId,
      "worktodo_request_delete_workspace",
      "worktodo_finalize_delete_workspace",
      (taskId, targetId, gateway) => gateway.rpc("worktodo_update_task", {
        p_task_id: taskId,
        p_patch: { workspace_id: targetId }
      }),
      options
    );
  }

  async function worktodoReorderWorkspaces(workspaceIds, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("worktodo_reorder_workspaces", { p_workspace_ids: workspaceIds });
  }

  async function worktodoCreateWorkspace(name, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("worktodo_create_workspace", { p_name: name }).then(normalizeWorkspace);
  }

  function currentCardUrl(taskId) {
    try {
      const url = new URL(root.location.href);
      url.searchParams.set("task", String(taskId || ""));
      return url.toString();
    } catch (_error) { return ""; }
  }

  async function moveTaskWorkspace(taskId, targetWorkspaceId, note = "", options = {}) {
    const gateway = options.gateway || requireGateway();
    const moved = await gateway.rpc("board_move_task_workspace", {
      p_task_id: taskId,
      p_target_workspace_id: targetWorkspaceId,
      p_note: note || null
    });
    // Movement is authoritative first. Notification is a Cloud side-effect and
    // must never roll back or duplicate the card movement if mail delivery fails.
    try {
      await gateway.invokeFunction("workspace-email-notification", {
        task_id: taskId,
        workspace_id: targetWorkspaceId,
        card_url: currentCardUrl(taskId)
      });
    } catch (error) {
      console.warn("Workspace Email notification failed after Cloud move", error);
    }
    return normalizeTask(moved);
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

  // The shared C drawer uses this operation for AI Board cards as well as
  // registered C consumers. The Cloud contract resolves the task's existing
  // board_instance_id server-side and applies the owner-scoped write check;
  // the client must not invent or copy a second board identity.
  async function deleteTask(taskId, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("board_instance_delete_task", { p_task_id: taskId });
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

  async function acceptTaskFromQjcDrop(input = {}, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("board_pm_acceptance_from_qjc_drop", {
      p_task_id: input.taskId,
      p_item_id: input.itemId,
      // A QJC Drop is itself the PM Acceptance intent.  The Cloud contract
      // creates the auditable action context; a UI prompt must not be used as
      // a substitute for that controlled record.
      p_evidence_note: input.evidenceNote || null,
      p_evidence_ref: input.evidenceRef || null
    });
  }

  // C owns PM workspace decisions.  This operation is deliberately separate
  // from the legacy sequential transition RPC: the PM-selected workspace is
  // the intent, while Cloud reconciles the formal lifecycle atomically.
  async function reconcileWorkspaceDecision(input = {}, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("board_c_reconcile_workspace_decision", {
      p_task_id: input.taskId,
      p_target_workspace_id: input.targetWorkspaceId,
      p_decision_note: input.decisionNote || null
    });
  }

  // Canonical Module C Workflow capability.  This is deliberately a thin
  // adapter over the v2 Cloud contract: Consumers provide only Board Instance
  // identity and capability flags; they do not own a second workflow engine.
  function createWorkflowCapability(options = {}) {
    const gateway = options.gateway || requireGateway();
    const requestedBoardInstanceId = String(options.boardInstanceId || "").trim();
    const legacyApplicationScope = String(options.legacyApplicationScope || "").trim();
    const templateKey = String(options.templateKey || "c").trim().toLowerCase() || "c";
    const readOnly = options.readOnly === true;
    const allowExistingCardAdoption = options.allowExistingCardAdoption === true;
    // Workflow definition/settings can remain read-only while a product still
    // permits PM workspace decisions.  This keeps Investment's financial
    // surface read-only without disabling the shared C movement contract.
    const allowWorkspaceMovement = options.allowWorkspaceMovement === true;
    let instancePromise;
    const resolveBoardInstance = async () => {
      if (!instancePromise) {
        instancePromise = (requestedBoardInstanceId
          ? gateway.select("board_instances", `?select=id,name,template_key,active&active=eq.true&id=eq.${encodeURIComponent(requestedBoardInstanceId)}`)
          : legacyApplicationScope
            ? gateway.select("board_instances", `?select=id,name,template_key,active,legacy_application_scope&active=eq.true&legacy_application_scope=eq.${encodeURIComponent(legacyApplicationScope)}`)
            : gateway.rpc("board_resolve_template_instance", { p_template_key: templateKey })
        ).then(value => {
          const instance = Array.isArray(value) ? value[0] : value;
          if (!instance?.id) {
            const error = new Error("C Workflow 尚未找到對應的 Board Instance。");
            error.code = "C_WORKFLOW_BOARD_INSTANCE_NOT_FOUND";
            throw error;
          }
          return instance;
        });
      }
      return instancePromise;
    };
    const boardInstanceId = async () => String((await resolveBoardInstance()).id);
    const assertWritable = () => {
      if (!readOnly) return;
      const error = new Error("目前子板為唯讀，不能修改流程設定。");
      error.code = "C_WORKFLOW_READ_ONLY";
      throw error;
    };
    const assertDecisionWritable = () => {
      if (!readOnly || allowWorkspaceMovement) return;
      const error = new Error("目前子板為唯讀，不能修改工作區決定。");
      error.code = "C_WORKFLOW_READ_ONLY";
      throw error;
    };
    const capabilityFlags = Object.freeze({
      settings: true,
      resolve: true,
      workspaceDecision: !readOnly || allowWorkspaceMovement,
      completion: !readOnly || allowWorkspaceMovement,
      reopen: !readOnly || allowWorkspaceMovement,
      adoption: !readOnly,
      existingCardAdoption: allowExistingCardAdoption && (!readOnly || allowWorkspaceMovement),
      legacyReconciliation: !readOnly,
      legacyWorkspaceRetirement: !readOnly,
      workspaceMovement: !readOnly || allowWorkspaceMovement
    });
    const rpc = async (name, args = {}) => gateway.rpc(name, { ...(args || {}), p_board_instance_id: await boardInstanceId() });
    const get = async (options = {}) => normalizeWorkflowResult(await rpc("board_c_workflow_get", { p_include_draft: options.includeDraft === true && !readOnly }));
    const saveDraft = async (input = {}) => {
      assertWritable();
      // The canonical RPC accepts its persisted snake_case contract.  Keep
      // the browser-facing editor model readable in camelCase, but normalize
      // the boundary here so every C consumer sends the same payload shape.
      const steps = (Array.isArray(input.steps) ? input.steps : []).map(step => ({
        step_key: step.step_key || step.stepKey,
        name: step.name,
        sort_order: step.sort_order ?? step.sortOrder,
        role_key: step.role_key || step.roleKey,
        workspace_id: step.workspace_id || step.workspaceId,
        status_key: step.status_key || step.statusKey,
        is_initial: step.is_initial ?? step.isInitial,
        is_completion: step.is_completion ?? step.isCompletion
      }));
      const transitions = (Array.isArray(input.transitions) ? input.transitions : []).map(transition => ({
        transition_key: transition.transition_key || transition.transitionKey,
        from_step_key: transition.from_step_key || transition.fromStepKey,
        to_step_key: transition.to_step_key || transition.toStepKey,
        allowed_roles: transition.allowed_roles || transition.allowedRoles,
        requires_gate: transition.requires_gate ?? transition.requiresGate
      }));
      const gates = (Array.isArray(input.gates) ? input.gates : []).map(gate => ({
        step_key: gate.step_key || gate.stepKey,
        gate_key: gate.gate_key || gate.gateKey,
        name: gate.name,
        required: gate.required,
        human_action_required: gate.human_action_required ?? gate.humanActionRequired,
        completion_role: gate.completion_role || gate.completionRole,
        failure_policy: gate.failure_policy || gate.failurePolicy,
        sort_order: gate.sort_order ?? gate.sortOrder
      }));
      const evidenceRequirements = (Array.isArray(input.evidenceRequirements)
        ? input.evidenceRequirements
        : (Array.isArray(input.evidence_requirements) ? input.evidence_requirements : [])).map(evidence => ({
        gate_key: evidence.gate_key || evidence.gateKey,
        evidence_key: evidence.evidence_key || evidence.evidenceKey,
        label: evidence.label,
        required: evidence.required,
        source_kind: evidence.source_kind || evidence.sourceKind,
        sort_order: evidence.sort_order ?? evidence.sortOrder
      }));
      return normalizeWorkflowResult(await rpc("board_c_workflow_save_draft", {
        p_name: String(input.name || ""),
        p_description: input.description == null ? null : String(input.description),
        p_steps: steps,
        p_transitions: transitions,
        p_gates: gates,
        p_evidence_requirements: evidenceRequirements,
        p_expected_draft_version_id: input.expectedDraftVersionId || null,
        p_idempotency_key: input.idempotencyKey || null
      }));
    };
    const validateDraft = async workflowVersionId => normalizeWorkflowResult(await gateway.rpc("board_c_workflow_validate_draft", { p_workflow_version_id: workflowVersionId }));
    const publish = async (input = {}) => {
      assertWritable();
      return normalizeWorkflowResult(await gateway.rpc("board_c_workflow_publish", {
        p_workflow_version_id: input.workflowVersionId,
        p_expected_published_version_id: input.expectedPublishedVersionId || null,
        p_idempotency_key: input.idempotencyKey || null
      }));
    };
    const requestAdoption = async (input = {}) => {
      assertWritable();
      return normalizeWorkflowResult(await rpc("board_c_workflow_request_adoption", {
        p_to_workflow_version_id: input.toWorkflowVersionId,
        p_note: input.note || null,
        p_idempotency_key: input.idempotencyKey || null
      }));
    };
    const approveAdoption = async (input = {}) => {
      assertWritable();
      return normalizeWorkflowResult(await gateway.rpc("board_c_workflow_approve_adoption", {
        p_adoption_id: input.adoptionId,
        p_note: input.note || null,
        p_idempotency_key: input.idempotencyKey || null
      }));
    };
    const setStepMapping = async (input = {}) => {
      assertWritable();
      return normalizeWorkflowResult(await gateway.rpc("board_c_workflow_set_step_mapping", {
        p_adoption_id: input.adoptionId,
        p_from_step_id: input.fromStepId,
        p_to_step_id: input.toStepId,
        p_mapping_status: input.mappingStatus || "mapped",
        p_note: input.note || null
      }));
    };
    const applyCardMapping = async (input = {}) => {
      assertWritable();
      return normalizeWorkflowResult(await gateway.rpc("board_c_workflow_apply_card_mapping", {
        p_adoption_id: input.adoptionId,
        p_task_id: input.taskId,
        p_idempotency_key: input.idempotencyKey || null
      }));
    };
    const adoptUnboundCard = async (input = {}) => {
      assertDecisionWritable();
      return normalizeWorkflowResult(await gateway.rpc("board_c_workflow_adopt_unbound_card_v2", {
        p_task_id: input.taskId,
        p_idempotency_key: input.idempotencyKey || null
      }));
    };
    const resolveTaskWorkflow = async taskId => gateway.rpc("board_c_workflow_resolve_task", { p_task_id: taskId });
    const reconcileBoundWorkspaceDecision = async (input = {}) => {
      assertDecisionWritable();
      return gateway.rpc("board_c_reconcile_workspace_decision_v2", {
        p_task_id: input.taskId,
        p_target_workspace_id: input.targetWorkspaceId,
        p_decision_note: input.decisionNote || null,
        p_idempotency_key: input.idempotencyKey || null
      });
    };
    const moveWorkspaceDecision = async (input = {}) => {
      assertDecisionWritable();
      const taskId = String(input.taskId || "").trim();
      if (!taskId) {
        const error = new Error("工作區決定缺少卡片識別資訊；卡片未變更。");
        error.code = "C_WORKFLOW_TASK_REQUIRED";
        throw error;
      }

      // These are authoritative Cloud reads. The client deliberately does not
      // infer a workflow from a consumer, status, assignee, workspace name, or
      // order.
      const workflowState = await get({ includeDraft: false });
      const publishedWorkflowId = String(
        workflowState?.state?.publishedWorkflowVersionId || workflowState?.published?.id || ""
      ).trim();
      const taskResolution = await resolveTaskWorkflow(taskId);
      const resolutionState = String(taskResolution?.state || "").trim().toLowerCase();

      if (resolutionState === "workflow_binding_invalid") {
        const error = new Error(taskResolution?.message || "卡片的正式流程綁定無法驗證；卡片未移動。");
        error.code = "C_WORKFLOW_TASK_BINDING_INVALID";
        throw error;
      }

      if (publishedWorkflowId && resolutionState === "workflow_not_configured") {
        if (!capabilityFlags.existingCardAdoption || typeof adoptUnboundCard !== "function") {
          const error = new Error("這張卡片尚未完成正式流程採用；目前沒有可安全執行的共用採用能力，卡片未移動。");
          error.code = "C_WORKFLOW_EXISTING_CARD_ADOPTION_UNAVAILABLE";
          throw error;
        }
        // Cloud validates that the current Workspace UUID maps to exactly one
        // step in the Published Workflow. Adoption only binds the existing
        // card; it never moves the card or changes its business data.
        await adoptUnboundCard({
          taskId,
          idempotencyKey: input.adoptionIdempotencyKey || `workflow-adopt-${taskId}`
        });
        return reconcileBoundWorkspaceDecision(input);
      }

      if (resolutionState === "resolved") return reconcileBoundWorkspaceDecision(input);

      if (resolutionState !== "workflow_not_configured") {
        const error = new Error(taskResolution?.message || "卡片流程狀態無法安全判定；卡片未移動。");
        error.code = "C_WORKFLOW_TASK_RESOLUTION_UNAVAILABLE";
        throw error;
      }

      if (publishedWorkflowId) {
        const error = new Error("這張卡片尚未完成 Published Workflow 採用；卡片未移動。");
        error.code = "C_WORKFLOW_TASK_NOT_ADOPTED";
        throw error;
      }

      // A Board Instance without a Published Workflow has no step/status
      // contract to reconcile. Use the existing owner-scoped Board Instance
      // movement RPC as the canonical C core operation. It validates that the
      // target belongs to the same Board Instance, preserves card data and
      // identity, and records the movement audit; it does not guess status or
      // assignee and is never a consumer-specific fallback.
      const moved = await gateway.rpc("board_instance_move_task_workspace", {
        p_task_id: taskId,
        p_workspace_id: input.targetWorkspaceId,
        p_reason: input.decisionNote || null
      });
      return Object.freeze({
        contract: C_WORKFLOW_CANONICAL_CONTRACT.id,
        action: "workspace-decision",
        state: "workspace_moved",
        decision: "workspace",
        task_id: moved?.id || taskId,
        board_instance_id: moved?.board_instance_id || await boardInstanceId(),
        target_workspace_id: moved?.workspace_id || input.targetWorkspaceId,
        status: moved?.status,
        assignee: moved?.assignee,
        workflow: "not_configured",
        workflow_bound: false,
        card_identity_preserved: true,
        card_data_moved: false,
        audit_recorded: true,
        raw: moved
      });
    };
    const reconcileLegacyCard = async (input = {}) => {
      assertWritable();
      return normalizeWorkflowResult(await gateway.rpc("board_c_workflow_reconcile_legacy_card_v2", {
        p_task_id: input.taskId,
        p_classification: input.classification,
        p_workflow_version_id: input.workflowVersionId || null,
        p_completion_step_id: input.completionStepId || null,
        p_reverification_evidence: input.reverificationEvidence || null,
        p_note: input.note || null,
        p_idempotency_key: input.idempotencyKey || null
      }));
    };
    const retireLegacyWorkspace = async (input = {}) => {
      assertWritable();
      return normalizeWorkflowResult(await gateway.rpc("board_c_workflow_retire_legacy_workspace_v2", {
        p_workspace_id: input.workspaceId,
        p_idempotency_key: input.idempotencyKey || null
      }));
    };
    return Object.freeze({
      contract: C_WORKFLOW_CANONICAL_CONTRACT,
      readOnly,
      capabilities: capabilityFlags,
      resolveBoardInstance,
      boardInstanceId,
      get,
      saveDraft,
      validateDraft,
      publish,
      requestAdoption,
      approveAdoption,
      setStepMapping,
      applyCardMapping,
      adoptUnboundCard,
      resolveTask: resolveTaskWorkflow,
      // One public C movement authority. It resolves the Board Instance
      // workflow state, adopts an unbound card only through the formal Cloud
      // contract when uniquely safe, and otherwise uses the existing generic
      // Board Instance move contract when no workflow is published.
      moveWorkspaceDecision,
      reconcileWorkspaceDecision: moveWorkspaceDecision,
      reconcileLegacyCard,
      retireLegacyWorkspace
    });
  }

  // Compatibility alias for older callers.  New shared Runtime code uses the
  // canonical C lifecycle capability above.
  async function pmAcceptTaskFromQjcDrop(input = {}, options = {}) {
    return acceptTaskFromQjcDrop(input, options);
  }

  async function pmQaFailChecklist(input = {}, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("board_pm_qa_fail_requeue", {
      p_item_id: input.id,
      p_evidence_note: input.evidenceNote || null,
      p_evidence_ref: input.evidenceRef || null
    }).then(normalizeChecklistItem);
  }

  async function reconcilePmAcceptanceLifecycle(taskId, note = "", options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("board_reconcile_pm_acceptance_lifecycle", {
      p_task_id: taskId,
      p_note: note || null
    });
  }

  async function addTaskProgressNote(taskId, note, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("board_add_task_progress_note", {
      p_task_id: taskId,
      p_note: note
    }).then(normalizeActivity);
  }

  async function notifyTaskProgress(taskId, activityId, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.invokeFunction("card-progress-email-notification", {
      task_id: taskId,
      activity_id: activityId,
      card_url: String(options.cardUrl || "")
    });
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

  async function updateTaskAttachmentMetadata(input = {}, options = {}) {
    const gateway = options.gateway || requireGateway();
    return gateway.rpc("board_update_task_attachment_metadata", {
      p_attachment_id: input.attachmentId || input.id,
      p_display_name: input.displayName == null ? null : String(input.displayName).trim(),
      p_note: input.note == null ? null : String(input.note).trim()
    }).then(normalizeTaskAttachment);
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

  // Template C is a registered board instance.  Keep its data wiring in this
  // service so the shared drawer can reuse the same action/read surface while
  // the consumer supplies only an immutable board-instance context.
  function createInstanceService(instanceOptions = {}) {
    const gateway = instanceOptions.gateway || requireGateway();
    const templateKey = String(instanceOptions.templateKey || "c").trim().toLowerCase();
    const requestedBoardInstanceId = String(instanceOptions.boardInstanceId || "").trim();
    const legacyApplicationScope = String(instanceOptions.legacyApplicationScope || "").trim();
    const requestedConsumerId = String(instanceOptions.consumerId || requestedBoardInstanceId || "c").trim();
    let instancePromise;
    const resolveInstance = async () => {
      if (!instancePromise) {
        instancePromise = (requestedBoardInstanceId
          ? gateway.select("board_instances", `?select=*&id=eq.${encodeURIComponent(requestedBoardInstanceId)}&active=eq.true`)
          : legacyApplicationScope
            ? gateway.select("board_instances", `?select=*&legacy_application_scope=eq.${encodeURIComponent(legacyApplicationScope)}&active=eq.true`)
            : gateway.rpc("board_resolve_template_instance", { p_template_key: templateKey })
        ).then(value => {
          const instance = requestedBoardInstanceId
            ? (Array.isArray(value) ? value[0] : value)
            : (Array.isArray(value) ? value[0] : value);
          if (!instance?.id) {
            const error = new Error("Canonical board instance 尚未建立。");
            error.code = "BOARD_INSTANCE_NOT_FOUND";
            throw error;
          }
          return instance;
        });
      }
      return instancePromise;
    };
    const withGateway = options => ({ ...(options || {}), gateway });
    const normalizeInstanceWorkspace = row => normalizeWorkspace({ ...row, application_scope: "c", applicationScope: "c" });
    const normalizeInstanceTask = row => normalizeTask({ ...row, application_scope: "c", applicationScope: "c" });
    const normalizeInstanceActivity = row => normalizeActivity(row);
    const normalizeInstanceAttachment = row => normalizeTaskAttachment(row);
    const workflow = createWorkflowCapability({
      gateway,
      templateKey,
      boardInstanceId: requestedBoardInstanceId,
      legacyApplicationScope,
      readOnly: instanceOptions.workflowReadOnly === true,
      allowExistingCardAdoption: instanceOptions.allowExistingCardAdoption === true,
      allowWorkspaceMovement: instanceOptions.allowWorkspaceMovement === true
    });

    async function instanceLoad(options = {}) {
      const instance = await resolveInstance();
      const result = await load({ ...options, ...withGateway(options), boardInstanceId: instance.id });
      return Object.freeze({
        ...result,
        boardName: String(instance.name || ""),
        taskCodePrefix: String(instance.task_code_prefix || ""),
        templateKey: String(instance.template_key || templateKey),
        authorizationMode: String(instance.authorization_mode || ""),
        isTemplateInstance: instance.is_template_instance === true,
        consumerId: requestedConsumerId
      });
    }
    async function instanceCreateWorkspace(name) {
      const instance = await resolveInstance();
      const token = typeof root.crypto?.randomUUID === "function"
        ? root.crypto.randomUUID().replace(/-/g, "")
        : `${Date.now()}${Math.random().toString(16).slice(2)}`;
      const prefix = String(instance.task_code_prefix || "board").trim().toLowerCase();
      return gateway.rpc("board_instance_create_workspace", {
        p_board_instance_id: instance.id,
        p_name: name,
        p_workspace_key: `${prefix}-custom-${token}`
      }).then(normalizeInstanceWorkspace);
    }
    async function instanceRenameWorkspace(workspaceId, name) {
      await resolveInstance();
      return gateway.rpc("board_instance_rename_workspace", { p_workspace_id: workspaceId, p_name: name }).then(normalizeInstanceWorkspace);
    }
    async function instanceGetWorkspaceNotificationSettings(workspaceId) {
      await resolveInstance();
      return gateway.rpc("board_get_workspace_notification_settings", { p_workspace_id: workspaceId });
    }
    async function instanceSaveWorkspaceNotificationSettings(workspaceId, settings = {}) {
      await resolveInstance();
      return gateway.rpc("board_save_workspace_notification_settings", {
        p_workspace_id: workspaceId,
        p_enabled: Boolean(settings.enabled),
        p_notify_assignee: Boolean(settings.notifyAssignee),
        p_notify_reporter: Boolean(settings.notifyReporter),
        p_custom_emails: Array.isArray(settings.customEmails) ? settings.customEmails : [],
        p_subject_template: String(settings.subjectTemplate || ""),
        p_body_template: String(settings.bodyTemplate || "")
      });
    }
    async function instanceDeleteWorkspace(workspaceId) {
      await resolveInstance();
      return gateway.rpc("board_instance_delete_workspace", { p_workspace_id: workspaceId });
    }
    async function instanceReorderWorkspaces(workspaceIds) {
      await resolveInstance();
      return gateway.rpc("board_instance_reorder_workspaces", { p_workspace_ids: workspaceIds });
    }
    async function instanceMoveTaskWorkspace(taskId, workspaceId, reason = "") {
      await resolveInstance();
      const moved = await gateway.rpc("board_instance_move_task_workspace", { p_task_id: taskId, p_workspace_id: workspaceId, p_reason: reason || null });
      try {
        await gateway.invokeFunction("workspace-email-notification", { task_id: taskId, workspace_id: workspaceId, card_url: currentCardUrl(taskId) });
      } catch (error) {
        console.warn("Workspace Email notification failed after Cloud move", error);
      }
      return normalizeInstanceTask(moved);
    }
    async function instanceCreateTask(input = {}) {
      const instance = await resolveInstance();
      return gateway.rpc("board_instance_create_task", {
        p_board_instance_id: instance.id,
        p_title: input.title,
        p_summary: input.summary || null,
        p_status: input.status || "not_started",
        p_usage_scenario: input.usageScenario || null,
        p_workspace_id: input.workspaceId || null
      }).then(normalizeInstanceTask);
    }
    async function instanceUpdateTitle(input = {}) {
      await resolveInstance();
      return gateway.rpc("board_instance_update_task_title", { p_task_id: input.taskId, p_title: String(input.title || "") }).then(normalizeInstanceTask);
    }
    async function instanceUpdateContent(input = {}) {
      await resolveInstance();
      return gateway.rpc("board_instance_update_task_content", {
        p_task_id: input.taskId,
        p_summary: input.summary == null ? null : String(input.summary),
        p_usage_scenario: input.usageScenario == null ? null : String(input.usageScenario)
      }).then(normalizeInstanceTask);
    }
    async function instanceUpdateDueDate(input = {}) {
      await resolveInstance();
      return gateway.rpc("board_instance_update_task_due_date", { p_task_id: input.taskId, p_due_date: input.dueDate || null }).then(normalizeInstanceTask);
    }
    async function instanceDeleteTask(taskId) {
      await resolveInstance();
      return gateway.rpc("board_instance_delete_task", { p_task_id: taskId });
    }
    async function instanceAddChecklist(input = {}) {
      await resolveInstance();
      return gateway.rpc("board_instance_add_task_checklist_item", {
        p_task_id: input.taskId,
        p_label: input.label,
        p_sort_order: Number(input.sortOrder || 0)
      }).then(normalizeTaskChecklistItem);
    }
    async function instanceUpdateChecklist(input = {}) {
      await resolveInstance();
      return gateway.rpc("board_instance_update_task_checklist_item", {
        p_item_id: input.id,
        p_label: input.label == null ? "" : String(input.label),
        p_completed: Boolean(input.completed),
        p_sort_order: Number(input.sortOrder || 0)
      }).then(normalizeTaskChecklistItem);
    }
    async function instanceDeleteChecklist(itemId) {
      await resolveInstance();
      return gateway.rpc("board_instance_delete_task_checklist_item", { p_item_id: itemId });
    }
    async function instanceCreateGovernanceChecklist(input = {}) {
      await resolveInstance();
      return gateway.rpc("board_instance_create_governance_checklist_item", {
        p_task_id: input.taskId,
        p_checklist_type: input.checklistType || "task_acceptance",
        p_stage: input.stage || "qjc",
        p_item_key: input.itemKey,
        p_label: input.label,
        p_required: input.required !== false,
        p_sort_order: Number(input.sortOrder || 0)
      }).then(normalizeChecklistItem);
    }
    async function instanceUpdateGovernanceChecklist(input = {}) {
      await resolveInstance();
      return gateway.rpc("board_instance_update_governance_checklist_item", {
        p_item_id: input.id,
        p_state: input.state || "not_verified",
        p_evidence_note: input.evidenceNote || null,
        p_evidence_ref: input.evidenceRef || null
      }).then(normalizeChecklistItem);
    }
    async function instanceAcceptTaskFromQjcDrop(input = {}) {
      await resolveInstance();
      return acceptTaskFromQjcDrop(input, withGateway());
    }
    async function instanceReconcileWorkspaceDecision(input = {}) {
      await resolveInstance();
      // Keep the instance service on the same C Workflow v2 authority as the
      // direct workflow capability.  The legacy v1 helper remains exported
      // only for compatibility with older non-instance callers.
      return (workflow.moveWorkspaceDecision || workflow.reconcileWorkspaceDecision)(input);
    }
    async function instanceAddProgress(taskId, note) {
      await resolveInstance();
      return gateway.rpc("board_instance_add_progress_note", { p_task_id: taskId, p_note: note }).then(normalizeInstanceActivity);
    }
    async function instanceNotifyProgress(taskId, activityId, options = {}) {
      await resolveInstance();
      return gateway.invokeFunction("card-progress-email-notification", {
        task_id: taskId,
        activity_id: activityId,
        card_url: String(options.cardUrl || "")
      });
    }
    async function instanceEditProgress(activityId, note) {
      await resolveInstance();
      return gateway.rpc("board_instance_edit_progress_note", { p_activity_id: Number(activityId), p_note: String(note || "") }).then(normalizeInstanceActivity);
    }
    async function instanceDeleteProgress(activityId) {
      await resolveInstance();
      return gateway.rpc("board_instance_delete_progress_note", { p_activity_id: Number(activityId) }).then(normalizeInstanceActivity);
    }
    async function instanceSetAgreement(input = {}) {
      await resolveInstance();
      return gateway.rpc("board_instance_set_agreement_schedule", {
        p_task_id: input.taskId,
        p_mode: input.mode == null || input.mode === "" ? null : String(input.mode),
        p_start_date: input.startDate || null,
        p_end_date: input.endDate || null
      }).then(normalizeInstanceTask);
    }
    async function instanceGetTaskVendorLink(taskId) {
      await resolveInstance();
      return gateway.rpc("board_instance_get_task_vendor_link", {
        p_task_id: taskId
      });
    }
    async function instanceSetTaskVendorLink(taskId, vendorId = null) {
      await resolveInstance();
      return gateway.rpc("board_instance_set_task_vendor_link", {
        p_task_id: taskId,
        p_vendor_id: vendorId == null ? null : String(vendorId).trim()
      });
    }
    async function instancePrepareTaskAttachment(input = {}) {
      await resolveInstance();
      const file = input.file;
      if (!file || !file.name || !Number.isFinite(Number(file.size))) throw new Error("請先選擇有效附件。");
      return gateway.rpc("board_instance_prepare_task_attachment", {
        p_task_id: input.taskId,
        p_filename: file.name,
        p_mime_type: file.type || "application/octet-stream",
        p_byte_size: Number(file.size),
        p_activity_id: input.activityId || null
      }).then(normalizeInstanceAttachment);
    }
    async function instancePrepareProgressAttachment(input = {}) {
      await resolveInstance();
      const file = input.file;
      if (!file || !file.name || !Number.isFinite(Number(file.size))) throw new Error("請先選擇有效進度附件。");
      return gateway.rpc("board_instance_prepare_progress_attachment", {
        p_activity_id: input.activityId,
        p_filename: file.name,
        p_mime_type: file.type || "application/octet-stream",
        p_byte_size: Number(file.size)
      }).then(normalizeInstanceAttachment);
    }
    async function instanceCompleteAttachment(attachmentId) {
      await resolveInstance();
      return gateway.rpc("board_instance_complete_attachment", { p_attachment_id: attachmentId }).then(normalizeInstanceAttachment);
    }
    async function instanceUpdateAttachmentMetadata(input = {}) {
      await resolveInstance();
      return gateway.rpc("board_update_task_attachment_metadata", {
        p_attachment_id: input.attachmentId || input.id,
        p_display_name: input.displayName == null ? null : String(input.displayName).trim(),
        p_note: input.note == null ? null : String(input.note).trim()
      }).then(normalizeInstanceAttachment);
    }
    async function instanceDeleteAttachment(attachmentId) {
      await resolveInstance();
      const requested = await gateway.rpc("board_instance_request_attachment_delete", { p_attachment_id: attachmentId }).then(normalizeInstanceAttachment);
      try {
        if (typeof gateway.removeStorageObject !== "function") throw new Error("Shared Supabase Gateway 尚未支援受控附件刪除。");
        await gateway.removeStorageObject(requested.storageBucket, requested.storagePath);
        return gateway.rpc("board_instance_finalize_attachment_delete", { p_attachment_id: attachmentId }).then(normalizeInstanceAttachment);
      } catch (error) {
        await gateway.rpc("board_instance_cancel_attachment_delete", { p_attachment_id: attachmentId }).catch(() => {});
        throw error;
      }
    }
    async function instanceUploadAttachment(attachment, file) {
      return uploadTaskAttachment(attachment, file, withGateway());
    }
    async function instanceTaskAttachmentUrl(attachment) {
      return taskAttachmentUrl(attachment, withGateway());
    }
    async function instanceGovernanceAction() {
      const error = new Error("C 母版不支援未定義的跨網域治理動作。");
      error.code = "BOARD_INSTANCE_GOVERNANCE_ACTION_UNAVAILABLE";
      throw error;
    }
    const lifecycle = createLifecycleCapability(
      instanceAcceptTaskFromQjcDrop,
      instanceOptions.lifecycleCapabilities?.pmAcceptanceFromQjcDrop === true,
      instanceOptions.lifecycleCapabilities?.pmWorkspaceAuthority === true
        ? instanceReconcileWorkspaceDecision
        : null
    );
    return Object.freeze({
      applicationScope: "c",
      templateKey,
      consumerId: requestedConsumerId,
      boardInstanceId: requestedBoardInstanceId,
      lifecycleContract: C_LIFECYCLE_ACCEPTANCE_CONTRACT,
      lifecycle,
      workflowContract: C_WORKFLOW_CANONICAL_CONTRACT,
      workflow,
      resolveInstance,
      load: instanceLoad,
      loadChecklist: (taskId, options) => loadChecklist(taskId, withGateway(options)),
      loadTaskChecklist: (taskId, options) => loadTaskChecklist(taskId, withGateway(options)),
      loadMovementHistory: (taskId, options) => loadMovementHistory(taskId, withGateway(options)),
      loadActivity: (taskId, options) => loadActivity(taskId, withGateway(options)),
      loadArtifacts: (task, options) => loadArtifacts(task, withGateway(options)),
      loadTaskAttachments: (taskId, options) => loadTaskAttachments(taskId, withGateway(options)),
      runHealthCheck: options => runHealthCheck(withGateway(options)),
      subscribe: (callback, options) => resolveInstance().then(instance => subscribe(callback, { ...(options || {}), gateway, boardInstanceId: instance.id })),
      normalizeStatus,
      statusDescriptorFor,
      completionGateStatus,
      isArchiveTask,
      isGovernanceTerminal,
      createWorkspace: instanceCreateWorkspace,
      renameWorkspace: instanceRenameWorkspace,
      getWorkspaceNotificationSettings: instanceGetWorkspaceNotificationSettings,
      saveWorkspaceNotificationSettings: instanceSaveWorkspaceNotificationSettings,
      deleteWorkspace: instanceDeleteWorkspace,
      reorderWorkspaces: instanceReorderWorkspaces,
      moveTaskWorkspace: instanceMoveTaskWorkspace,
      createTask: instanceCreateTask,
      updateTaskTitle: instanceUpdateTitle,
      updateTaskContent: instanceUpdateContent,
      updateTaskDueDate: instanceUpdateDueDate,
      deleteTask: instanceDeleteTask,
      addTaskChecklistItem: instanceAddChecklist,
      updateTaskChecklistItem: instanceUpdateChecklist,
      deleteTaskChecklistItem: instanceDeleteChecklist,
      createChecklistItem: instanceCreateGovernanceChecklist,
      updateChecklistItem: instanceUpdateGovernanceChecklist,
      reconcileWorkspaceDecision: instanceReconcileWorkspaceDecision,
      addTaskProgressNote: instanceAddProgress,
      notifyTaskProgress: instanceNotifyProgress,
      editTaskProgressNote: instanceEditProgress,
      deleteTaskProgressNote: instanceDeleteProgress,
      setAgreementSchedule: instanceSetAgreement,
      prepareTaskAttachment: instancePrepareTaskAttachment,
      prepareProgressNoteAttachment: instancePrepareProgressAttachment,
      uploadTaskAttachment: instanceUploadAttachment,
      completeTaskAttachment: instanceCompleteAttachment,
      updateTaskAttachmentMetadata: instanceUpdateAttachmentMetadata,
      deleteTaskAttachment: instanceDeleteAttachment,
      deleteProgressNoteAttachment: input => instanceDeleteAttachment(input?.attachmentId || input?.id),
      taskAttachmentUrl: instanceTaskAttachmentUrl,
      getTaskVendorLink: instanceGetTaskVendorLink,
      setTaskVendorLink: instanceSetTaskVendorLink,
      governanceAction: instanceGovernanceAction
    });
  }

  async function provisionConsumer(input = {}, options = {}) {
    const gateway = options.gateway || requireGateway();
    const args = {
      p_name: String(input.name || "").trim(),
      p_task_code_prefix: String(input.taskCodePrefix || input.prefix || "").trim(),
      p_template_key: String(input.templateKey || "c").trim().toLowerCase()
    };
    const applicationScope = String(input.applicationScope || "").trim().toLowerCase();
    if (applicationScope) args.p_application_scope = applicationScope;
    return gateway.rpc("board_provision_consumer", args);
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

  async function requestTaskContractCreation(input = {}, options = {}) {
    const title = String(input.title ?? "").trim();
    if (!title) {
      const error = new Error("建立 TASK 需要標題。");
      error.code = "TASK_TITLE_REQUIRED";
      throw error;
    }
    const payload = { title };
    const fields = Object.freeze([
      ["summary", "summary"],
      ["usageScenario", "usage_scenario"],
      ["priority", "priority"],
      ["acceptanceCriteria", "acceptance_criteria"],
      ["workspaceId", "workspace_id"]
    ]);
    for (const [inputField, payloadField] of fields) {
      if (!Object.prototype.hasOwnProperty.call(input, inputField)) continue;
      const value = String(input[inputField] ?? "").trim();
      if (value) payload[payloadField] = value;
    }
    return governanceRunnerJson("/api/request-task-create", { ...options, method: "POST", body: payload });
  }

  async function taskContractCreateStatus(requestId, options = {}) {
    const query = `?request_id=${encodeURIComponent(String(requestId || ""))}`;
    return governanceRunnerJson(`/api/task-create-status${query}`, options);
  }

  async function subscribe(callback, options = {}) {
    const gateway = options.gateway || requireGateway();
    if (typeof gateway.subscribe !== "function") {
      const error = new Error("Shared Supabase Gateway 尚未支援 Realtime。");
      error.code = "BOARD_REALTIME_UNAVAILABLE";
      throw error;
    }
    const boardFilter = options.boardInstanceId
      ? `board_instance_id=eq.${encodeURIComponent(String(options.boardInstanceId))}`
      : null;
    const stopTask = await gateway.subscribe("board_tasks", callback, boardFilter);
    const stopTaskChecklist = await gateway.subscribe("board_task_checklist_items", callback);
    const stopTaskAttachments = await gateway.subscribe("board_task_attachments", callback);
    const stopChecklist = await gateway.subscribe("engineering_checklist_items", callback);
    const stopWorkspaces = await gateway.subscribe("board_workspaces", callback, boardFilter);
    const stopActivity = await gateway.subscribe("engineering_activity_log", callback);
    return async () => {
      await Promise.allSettled([stopTask?.(), stopTaskChecklist?.(), stopTaskAttachments?.(), stopChecklist?.(), stopWorkspaces?.(), stopActivity?.()]);
    };
  }

  return Object.freeze({
    ENGINEERING_STATUS_DESCRIPTORS,
    lifecycleContract: C_LIFECYCLE_ACCEPTANCE_CONTRACT,
    lifecycle: createLifecycleCapability(acceptTaskFromQjcDrop, true, reconcileWorkspaceDecision),
    normalizeStatus,
    statusDescriptorFor,
    normalizeWorkspace,
    normalizeMovement,
    classifyActivity,
    normalizeActivity,
    normalizeArtifact,
    normalizeTask,
    normalizeTaskChecklistItem,
    normalizeTaskAttachment,
    C_LIFECYCLE_ACCEPTANCE_CONTRACT,
    C_WORKFLOW_CANONICAL_CONTRACT,
    createLifecycleCapability,
    createWorkflowCapability,
    isGovernanceTerminal,
    isArchiveTask,
    normalizeChecklistItem,
    completionGateStatus,
    isPrinciple,
    isSystemMap,
    normalizePrinciple,
    normalizeSystemMap,
    normalizeBoardInstance,
    load,
    listBoardInstances,
    listModuleConsumers,
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
    getWorkspaceNotificationSettings,
    saveWorkspaceNotificationSettings,
    deleteWorkspace,
    reorderWorkspaces,
    worktodoRenameWorkspace,
    worktodoDeleteWorkspace,
    worktodoReorderWorkspaces,
    worktodoCreateWorkspace,
    moveTaskWorkspace,
    governanceAction,
    createTask,
    deleteTask,
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
    acceptTaskFromQjcDrop,
    reconcileWorkspaceDecision,
    pmAcceptTaskFromQjcDrop,
    pmQaFailChecklist,
    reconcilePmAcceptanceLifecycle,
    addTaskProgressNote,
    notifyTaskProgress,
    editTaskProgressNote,
    deleteTaskProgressNote,
    prepareTaskAttachment,
    prepareProgressNoteAttachment,
    uploadTaskAttachment,
    completeTaskAttachment,
    updateTaskAttachmentMetadata,
    deleteTaskAttachment,
    deleteProgressNoteAttachment,
    taskAttachmentUrl,
    createInstanceService,
    provisionConsumer,
    requestTaskContractUpdate,
    taskContractUpdateStatus,
    requestTaskContractCreation,
    taskContractCreateStatus,
    runHealthCheck,
    subscribe
  });
});
