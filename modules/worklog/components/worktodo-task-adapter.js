/*
 * WorkTodo -> Shared Task UX adapter.
 *
 * The adapter owns only normalization and presentation mapping. It never
 * reads Supabase, calls an RPC, owns auth, or writes browser storage. WorkLog
 * remains the only domain consumer of its canonical DataService/Repository.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(null);
  else root.ZhugeWorkTodoTaskAdapter = factory(root);
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  "use strict";

  const sharedActivityTextRenderer = root?.ZhugeSharedActivityTextRenderer
    || (typeof require === "function" ? require("../../../shared/components/activity-text-renderer.js") : null);
  const sharedTaskCardSummary = root?.ZhugeSharedTaskCardSummary
    || (typeof require === "function" ? require("../../../shared/components/task-card-summary.js") : null);

  const CAPABILITIES = Object.freeze({
    title: true,
    note: true,
    status: true,
    progress: true,
    priority: true,
    pin: true,
    dueDate: true,
    workProperty: true,
    estimatedMinutes: true,
    completion: true,
    workJournal: true,
    wltkIdentity: true,
    usageScenario: true,
    checklist: true,
    generalAttachment: true,
    progressNoteAttachment: true,
    progressNoteRevisionTombstone: true,
    gptAnalysis: true,
    completionArchiveLifecycle: true,
    engineeringEvidence: false
  });
  const sharedDrawerContract = Object.freeze({
    viewModel: "toSharedViewModel",
    renderer: "ZhugeGoldenMaster.renderDrawer",
    ownsDrawer: false
  });

  const STATUS_LABELS = Object.freeze({
    not_started: "待開始",
    in_progress: "進行中",
    waiting_reply: "等待回覆",
    waiting_acceptance: "等待驗收",
    blocked: "阻塞",
    completed: "完成"
  });
  const PRIORITY_LABELS = Object.freeze({ p0: "P0", p1: "P1", p2: "P2", p3: "P3", p4: "P4" });

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
  function clampProgress(value) {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : 0;
  }
  function normalizeStatus(value) {
    const raw = String(value || "not_started").trim().toLowerCase();
    const aliases = { open: "not_started", todo: "not_started", "in progress": "in_progress", waiting: "waiting_reply", done: "completed", complete: "completed" };
    const normalized = aliases[raw] || raw;
    return Object.prototype.hasOwnProperty.call(STATUS_LABELS, normalized) ? normalized : "not_started";
  }
  function normalizePriority(value) {
    const normalized = String(value || "p2").trim().toLowerCase();
    return Object.prototype.hasOwnProperty.call(PRIORITY_LABELS, normalized) ? normalized : "p2";
  }
  function formatDueDate(value) {
    if (!value) return "尚未設定日期";
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    if (Number.isNaN(date.getTime())) return String(value);
    return new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "numeric", day: "numeric" }).format(date);
  }
  function formatEstimatedMinutes(value) {
    const minutes = Number(value || 0);
    if (!Number.isFinite(minutes) || minutes <= 0) return "尚未設定";
    const rounded = Math.round(minutes);
    const hours = Math.floor(rounded / 60);
    const remainder = rounded % 60;
    if (!hours) return `${rounded} 分鐘`;
    return remainder ? `${hours} 小時 ${remainder} 分鐘` : `${hours} 小時`;
  }
  function formatTimestamp(value, formatter) {
    if (typeof formatter === "function") return formatter(value);
    const date = new Date(value || 0);
    return Number.isNaN(date.getTime()) ? "時間未知" : date.toLocaleString("zh-TW", { hour12: false });
  }
  function contentMarkup(value, renderContent) {
    if (typeof renderContent === "function") return renderContent(value);
    return sharedActivityTextRenderer && typeof sharedActivityTextRenderer.render === "function"
      ? sharedActivityTextRenderer.render(value)
      : escapeHtml(value).replace(/\r?\n/g, "<br>");
  }
  function byteSize(value) {
    const number = Number(value || 0);
    if (!number) return "大小未提供";
    if (number < 1024) return `${number} B`;
    if (number < 1024 * 1024) return `${Math.round(number / 1024)} KB`;
    return `${(number / (1024 * 1024)).toFixed(1)} MB`;
  }
  function isImage(mime) { return String(mime || "").toLowerCase().startsWith("image/"); }

  function canonicalActivityValue(entry, camelCaseKey, snakeCaseKey) {
    const camelValue = entry?.[camelCaseKey];
    if (camelValue !== undefined && camelValue !== null) return camelValue;
    return entry?.[snakeCaseKey];
  }

  function isHumanProgressEntry(entry = {}) {
    const activityType = String(entry.activityType || entry.activity_type || "").trim();
    const action = String(entry.action || "").trim();
    return activityType === "human_progress_note"
      && ["progress_note_created", "progress_note_edited"].includes(action);
  }

  function visibleHumanProgressEntries(entries = []) {
    const rows = Array.isArray(entries) ? entries : [];
    const superseded = new Set(rows
      .filter(entry => entry?.revisionOf != null)
      .map(entry => String(entry.revisionOf)));
    const tombstoned = new Set(rows
      .filter(entry => entry?.tombstoneOf != null)
      .map(entry => String(entry.tombstoneOf)));
    return rows.filter(entry => isHumanProgressEntry(entry)
      && !superseded.has(String(entry.id))
      && !tombstoned.has(String(entry.id))
      && entry.action !== "progress_note_deleted"
      && !["superseded", "tombstoned", "tombstone"].includes(String(entry.lifecycleStatus || "")));
  }

  function normalizeAttachment(item = {}) {
    const id = String(item.id || item.attachmentId || "");
    const activityId = String(item.activityId || item.activity_id || item.journalEntryUuid || item.journal_entry_uuid || "");
    const storagePath = String(item.storagePath || item.storage_path || "");
    return {
      id,
      attachmentId: id,
      taskUuid: String(item.taskUuid || item.task_uuid || ""),
      journalEntryUuid: String(item.journalEntryUuid || item.journal_entry_uuid || ""),
      activityId,
      attachmentScope: String(item.attachmentScope || item.attachment_scope || "task"),
      filename: String(item.filename || "未命名附件"),
      mimeType: String(item.mimeType || item.mime_type || "application/octet-stream"),
      byteSize: Number(item.byteSize ?? item.byte_size ?? 0) || 0,
      storageBucket: String(item.storageBucket || item.storage_bucket || "worktodo-attachments"),
      storagePath,
      uploadStatus: String(item.uploadStatus || item.upload_status || "ready"),
      createdAt: item.createdAt || item.created_at || "",
      signedUrl: String(item.signedUrl || "")
    };
  }

  function normalize(task = {}, journal = [], capabilityData = {}) {
    const status = normalizeStatus(task.status);
    const entries = (Array.isArray(journal) ? journal : [])
      .filter(entry => entry && String(entry.content || entry.note || "").trim())
      .map(entry => {
        const content = String(entry.content || entry.note || "").trim();
        const id = String(entry.cloudId || entry.cloud_id || entry.id || entry.clientId || entry.client_id || "");
        const actionValue = String(entry.action || "").trim();
        const rawActivityType = String(canonicalActivityValue(entry, "activityType", "activity_type") || "").trim();
        const rawEntryType = String(canonicalActivityValue(entry, "entryType", "entry_type") || "").trim();
        const activityType = rawActivityType
          || (rawEntryType === "system_activity" ? "system_activity" : "human_progress_note");
        const action = actionValue
          || (activityType === "human_progress_note" ? "progress_note_created" : "system_activity");
        const createdAt = entry.createdAt || entry.created_at || entry.timestamp || "";
        const actorId = String(entry.actorId || entry.actor_id || entry.createdBy || entry.created_by || "");
        const actorLabel = String(entry.actorLabel || entry.actor_label || entry.createdByLabel || entry.created_by_label || "QJC");
        const revisionOf = canonicalActivityValue(entry, "revisionOf", "revision_of");
        const tombstoneOf = canonicalActivityValue(entry, "tombstoneOf", "tombstone_of");
        return {
          id,
          content,
          note: content,
          entryType: rawEntryType || activityType,
          action,
          activityType,
          entityType: String(canonicalActivityValue(entry, "entityType", "entity_type") || (activityType === "human_progress_note" ? "worktodo_progress_note" : "")),
          entityId: String(canonicalActivityValue(entry, "entityId", "entity_id") || entry.taskUuid || entry.task_uuid || task.id || ""),
          status: normalizeStatus(entry.status || entry.entry_status || status),
          progress: clampProgress(entry.progress),
          createdBy: actorId,
          actorId,
          actorLabel,
          createdAt,
          timestamp: createdAt,
          updatedAt: entry.updatedAt || entry.updated_at || createdAt,
          lifecycleStatus: String(canonicalActivityValue(entry, "lifecycleStatus", "lifecycle_status") || "active"),
          revisionOf: revisionOf == null ? null : String(revisionOf),
          tombstoneOf: tombstoneOf == null ? null : String(tombstoneOf)
        };
      })
      .sort((a, b) => (Date.parse(b.createdAt || 0) || 0) - (Date.parse(a.createdAt || 0) || 0));
    const checklist = (Array.isArray(capabilityData.checklist) ? capabilityData.checklist : []).map(item => ({
      id: String(item.id || ""), label: String(item.label || ""), completed: item.completed === true || item.completed === 1,
      sortOrder: Number(item.sort_order ?? item.sortOrder ?? 0) || 0
    })).filter(item => item.id && item.label);
    const attachments = (Array.isArray(capabilityData.attachments) ? capabilityData.attachments : []).map(normalizeAttachment).filter(item => item.id && item.storagePath);
    const dueDate = String(task.dueDate || task.due_date || "").slice(0, 10);
    const agreementModeRaw = String(task.agreementMode || task.agreement_mode || "").trim().toLowerCase();
    const agreementMode = agreementModeRaw === "single" || agreementModeRaw === "period" ? agreementModeRaw : "";
    const agreementStartDate = String(task.agreementStartDate || task.agreement_start_date || "").slice(0, 10);
    const agreementEndDate = agreementMode === "period" ? String(task.agreementEndDate || task.agreement_end_date || "").slice(0, 10) : "";
    const latestProgress = String(task.latestProgress || task.latest_progress || task.progressNote || task.progress_note || visibleHumanProgressEntries(entries)[0]?.content || "").trim();
    return {
      id: String(task.id || task.workCode || ""),
      workCode: String(task.workCode || task.work_code || task.id || ""),
      legacyId: String(task.legacyId || task.legacy_id || ""),
      cloudId: String(task.cloudId || task.cloud_id || ""),
      title: String(task.title || "未命名待辦").trim(),
      note: String(task.note || "").trim(),
      workContent: String(task.workContent || task.work_content || task.note || "").trim(),
      latestProgress,
      usageScenario: String(task.usageScenario || task.usage_scenario || "").trim(),
      status, statusLabel: STATUS_LABELS[status],
      progress: status === "completed" ? 100 : clampProgress(task.progress),
      priority: normalizePriority(task.priority), priorityLabel: PRIORITY_LABELS[normalizePriority(task.priority)],
      userPinned: task.userPinned === true,
      dueDate,
      agreementMode,
      agreementStartDate,
      agreementEndDate,
      agreedDateStart: agreementStartDate,
      agreedDateEnd: agreementEndDate,
      workProperty: String(task.workProperty || task.work_property || "").trim(),
      estimatedMinutes: Number(task.estimatedMinutes ?? task.estimated_minutes ?? 0) || 0,
      startedAt: task.startedAt || "", completedAt: task.completedAt || "", completedNote: String(task.completedNote || "").trim(),
      completedBy: String(task.completedBy || ""), archiveDueAt: task.archiveDueAt || "", archivedAt: task.archivedAt || "", archivedBy: task.archivedBy || "",
      gptUnderstanding: String(task.gptUnderstanding || task.gpt_understanding || "").trim(),
      gptAnalysis: String(task.gptAnalysis || task.gpt_analysis || "").trim(),
      gptRecommendation: String(task.gptRecommendation || task.gpt_recommendation || "").trim(),
      gptExecutionPrinciples: String(task.gptExecutionPrinciples || task.gpt_execution_principles || "").trim(),
      gptHandoffSummary: String(task.gptHandoffSummary || task.gpt_handoff_summary || "").trim(),
      journal: entries, checklist, attachments
    };
  }

  function toSharedViewModel(task = {}, journal = [], capabilityData = {}) {
    const vm = normalize(task, journal, capabilityData);
    return Object.freeze({
      task: Object.freeze({
        ...task,
        summary: task.summary || vm.workContent,
        usageScenario: task.usageScenario || vm.usageScenario,
        dueDate: vm.dueDate,
        agreementMode: vm.agreementMode,
        agreementStartDate: vm.agreementStartDate,
        agreementEndDate: vm.agreementEndDate,
        agreedDateStart: vm.agreementStartDate,
        agreedDateEnd: vm.agreementEndDate
      }),
      activity: vm.journal,
      checklist: vm.checklist,
      attachments: vm.attachments,
      latestProgress: vm.latestProgress,
      workContent: vm.workContent,
      agreementMode: vm.agreementMode,
      agreementStartDate: vm.agreementStartDate,
      agreementEndDate: vm.agreementEndDate,
      agreedDateStart: vm.agreementStartDate,
      agreedDateEnd: vm.agreementEndDate
    });
  }

  function editableFieldMarkup(vm, field, label, readOnly) {
    const value = vm[field] || "";
    const edit = readOnly ? "" : `<button class="btn2" type="button" data-worktodo-edit-field="${field}" aria-label="編輯${escapeHtml(label)}">✏️ 編輯</button>`;
    return `<div class="worktodo-shared-inline-field" data-worktodo-inline-field="${field}"><div class="worktodo-shared-inline-field-toolbar"><span class="worktodo-shared-inline-field-value" data-worktodo-field-value="${field}">${value ? contentMarkup(value) : `<span class="muted">尚未填寫</span>`}</span>${edit}</div></div>`;
  }
  function checklistMarkup(vm, readOnly) {
    const done = vm.checklist.filter(item => item.completed).length;
    const rows = vm.checklist.map(item => `<li class="worktodo-shared-checklist-row" data-worktodo-checklist-item="${escapeHtml(item.id)}"><label><input type="checkbox" data-worktodo-checklist-complete="${escapeHtml(item.id)}"${item.completed ? " checked" : ""}${readOnly ? " disabled" : ""}><span>${escapeHtml(item.label)}</span></label>${readOnly ? "" : `<button class="shared-task-icon-button" type="button" data-worktodo-checklist-delete="${escapeHtml(item.id)}" aria-label="刪除 Checklist 項目" title="刪除 Checklist 項目">🗑️</button>`}</li>`).join("");
    const empty = vm.checklist.length ? "" : `<div class="shared-task-drawer-empty">尚無 Checklist 項目。</div>`;
    const add = readOnly ? "" : `<form class="worktodo-shared-checklist-add" data-worktodo-checklist-add><input class="input" data-worktodo-checklist-label placeholder="新增 Checklist 項目…" aria-label="新增 Checklist 項目"><button class="btn2" type="submit">＋新增</button></form>`;
    return `<details class="shared-task-drawer-checklist-panel worktodo-shared-checklist-panel" data-worktodo-checklist-panel${vm.checklist.length ? " open" : ""}><summary><span>☑ 工作 Checklist</span><span data-worktodo-checklist-count>${done} / ${vm.checklist.length}</span></summary><div class="shared-task-drawer-checklist-body"><ul class="worktodo-shared-checklist-list">${rows}</ul>${empty}${add}</div></details>`;
  }
  function attachmentMarkup(vm, readOnly) {
    const rows = vm.attachments.map(item => `<article class="worktodo-shared-attachment-row" data-worktodo-attachment="${escapeHtml(item.id)}" data-worktodo-attachment-path="${escapeHtml(item.storagePath)}"><span class="worktodo-shared-attachment-preview" data-worktodo-attachment-preview="${escapeHtml(item.id)}">${isImage(item.mimeType) ? "🖼️" : "📄"}</span><span class="worktodo-shared-attachment-copy"><strong>${escapeHtml(item.filename)}</strong><small>${escapeHtml(item.mimeType)} · ${escapeHtml(byteSize(item.byteSize))}</small></span><span class="worktodo-shared-attachment-actions"><button class="btn2" type="button" data-worktodo-attachment-open="${escapeHtml(item.id)}">開啟／預覽</button>${readOnly ? "" : `<button class="shared-task-icon-button" type="button" data-worktodo-attachment-delete="${escapeHtml(item.id)}" aria-label="刪除附件" title="刪除附件">🗑️</button>`}</span></article>`).join("");
    return `<div class="worktodo-shared-attachments" data-worktodo-attachments-zone>${rows || `<div class="worktodo-shared-attachment-empty">目前沒有附件</div>`}${readOnly ? "" : `<label class="btn2 worktodo-shared-attachment-add" for="worktodoTaskAttachmentInput">＋新增附件<input id="worktodoTaskAttachmentInput" type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"></label>`}</div>`;
  }
  function journalRow(entry, vm, options = {}) {
    const attachments = vm.attachments.filter(item => item.attachmentScope === "progress_note" && item.journalEntryUuid === entry.id);
    const canManage = options.readOnly !== true;
    const attachmentMarkupForNote = attachments.length ? `<div class="worktodo-shared-journal-attachments">${attachments.map(item => `<div class="worktodo-shared-journal-attachment" data-worktodo-journal-attachment="${escapeHtml(item.id)}"><button class="btn2" type="button" data-worktodo-attachment-open="${escapeHtml(item.id)}">📎 ${escapeHtml(item.filename)}</button>${canManage ? `<button class="shared-task-icon-button" type="button" data-worktodo-attachment-delete="${escapeHtml(item.id)}" aria-label="刪除附件：${escapeHtml(item.filename)}" title="刪除附件">🗑️</button>` : ""}</div>`).join("")}</div>` : "";
    const actions = canManage ? `<span class="shared-task-progress-note-actions"><button class="shared-task-icon-button" type="button" data-worktodo-journal-edit="${escapeHtml(entry.id)}" aria-label="編輯工作進度" title="編輯工作進度">✎</button><button class="shared-task-icon-button" type="button" data-worktodo-journal-delete="${escapeHtml(entry.id)}" aria-label="撤回工作進度" title="撤回工作進度">🗑️</button></span>` : "";
    return `<article class="shared-task-drawer-activity-row worktodo-shared-journal-row" data-worktodo-journal-entry="${escapeHtml(entry.id)}"><div class="task-activity-dot" aria-hidden="true"></div><div class="worktodo-shared-journal-body"><header class="shared-task-progress-note-header"><strong class="shared-task-progress-note-title">工作進度</strong>${actions}</header><div class="shared-task-progress-content">${contentMarkup(entry.content, options.renderContent)}</div>${attachmentMarkupForNote}<small class="shared-task-progress-note-meta">${escapeHtml(options.actorLabel || entry.createdBy || "目前使用者")} · ${escapeHtml(formatTimestamp(entry.createdAt, options.formatTimestamp))}</small></div></article>`;
  }
  function renderJournal(entries, vm, options = {}) {
    if (options.loading) return `<div class="shared-task-drawer-empty">🌀 正在從 Cloud 載入工作進度…</div>`;
    const humanEntries = visibleHumanProgressEntries(entries);
    if (!humanEntries.length) return `<div class="shared-task-drawer-empty">尚無工作進度紀錄。</div>`;
    return humanEntries.map(entry => journalRow(entry, vm, options)).join("");
  }
  function journalComposer(options = {}) {
    if (options.readOnly) return `<div class="worktodo-shared-journal-readonly">此待辦已封存，工作進度僅供查閱。</div>`;
    const editing = options.editingEntry;
    const draft = options.journalDraft || {};
    return `<section class="shared-task-drawer-progress-composer worktodo-shared-journal-composer" data-worktodo-journal-composer data-worktodo-composer-panel${editing ? "" : " hidden"}><div class="shared-task-progress-composer-heading"><label for="taskJournalContent">${editing ? "編輯工作進度" : "新增工作進度"}</label><button class="shared-task-progress-composer-close" type="button" data-worktodo-composer-close aria-label="關閉工作進度編輯">×</button></div><textarea class="input" id="taskJournalContent" rows="3" placeholder="輸入本次工作進度…">${escapeHtml(draft.content || "")}</textarea><div class="worktodo-shared-journal-composer-actions"><label class="shared-task-progress-attachment" for="worktodoProgressAttachmentInput" title="新增工作進度附件" aria-label="新增工作進度附件"><span aria-hidden="true">＋</span><input id="worktodoProgressAttachmentInput" type="file" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.zip"></label><button class="shared-task-progress-submit" type="button" data-worktodo-journal-save>${editing ? "儲存" : "新增"}</button></div><small data-worktodo-progress-attachment-hint>可選擇圖片／文件附件；工作進度內容不可為空白。</small></section>`;
  }
  function analysisMarkup(vm) {
    const blocks = [
      ["understanding", "需求理解", vm.gptUnderstanding || vm.note],
      ["judgement", "分析與判斷", vm.gptAnalysis],
      ["proposal", "建議做法", vm.gptRecommendation],
      ["principles", "執行原則／Acceptance Criteria", vm.gptExecutionPrinciples],
      ["handoff", "交付 Co 的執行摘要", vm.gptHandoffSummary]
    ].map(([key, title, value]) => `<article class="shared-task-analysis-card" data-task-analysis-field="${key}"><h3>${title}</h3>${value ? `<p>${contentMarkup(value)}</p>` : `<div class="shared-task-analysis-empty">目前正式 Cloud 尚未提供這項分析內容。</div>`}</article>`).join("");
    return `<section class="shared-task-analysis-view worktodo-shared-analysis-view" data-task-analysis-view aria-label="GPT 分析與建議"><header class="shared-task-analysis-header"><div><span class="shared-task-analysis-kicker">AI Analysis Layer · Read-only</span><h2>🤖 GPT 分析與建議</h2><p>此檢視只讀取 WorkTodo 正式分析欄位。</p></div><button class="shared-task-analysis-close" type="button" data-worktodo-analysis-close aria-label="返回待辦詳情" title="返回待辦詳情">×</button></header><div class="shared-task-analysis-grid">${blocks}</div></section>`;
  }

  function render(task, options = {}) {
    const goldenMaster = options.goldenMaster || root?.ZhugeGoldenMaster;
    const drawer = options.drawer || root?.ZhugeSharedTaskDrawer;
    if (!drawer?.render) return `<div class="shared-task-drawer-empty">Shared Task Drawer 尚未載入。</div>`;
    const vm = normalize(task, options.journal || [], options.capabilityData || {});
    const readOnly = options.readOnly === true || Boolean(vm.archivedAt);
    const sections = [
      { id: "work-content", title: "工作內容", className: "worktodo-shared-content-section", html: editableFieldMarkup(vm, "note", "工作內容", readOnly) },
      { id: "usage-scenario", title: "使用情境", className: "worktodo-shared-content-section", html: editableFieldMarkup(vm, "usageScenario", "使用情境", readOnly) },
      { id: "attachments", title: "📎 附件", hint: "圖片、文件與工作交付物", className: "worktodo-shared-attachments-section", html: attachmentMarkup(vm, readOnly) },
      vm.status === "completed" && vm.completedNote ? { id: "completion", title: "完成摘要", className: "worktodo-shared-completion-section", html: `<p>${contentMarkup(vm.completedNote, options.renderContent)}</p><small class="muted">完成時間：${escapeHtml(formatTimestamp(vm.completedAt, options.formatTimestamp))}</small>` } : null
    ].filter(Boolean);
    const drawerOptions = {
      title: vm.title,
      titleCode: vm.workCode || vm.id,
      titleEditable: !readOnly,
      subtitle: readOnly ? "WorkTodo · 封存（唯讀）" : "WorkTodo · Shared Task UX",
      readOnly,
      properties: [
        { key: "status", icon: "◉", label: "目前狀態", value: vm.statusLabel },
        { key: "progress", icon: "◒", label: "進度", value: `${vm.progress}%` },
        { key: "priority", icon: "⚑", label: "優先度", value: vm.priorityLabel },
        { key: "pin", icon: "📌", label: "置頂", value: vm.userPinned ? "是" : "否" },
        { key: "estimated-minutes", action: "estimated-minutes", interactive: !readOnly, icon: "⏱️", label: "預估時間", value: formatEstimatedMinutes(vm.estimatedMinutes) },
        { key: "due-date", action: "due-date", interactive: !readOnly, icon: "📅", label: "日期", value: formatDueDate(vm.dueDate) },
        { key: "gpt-analysis", action: "gpt-analysis", interactive: true, icon: "🤖", label: "GPT 分析與建議", value: "開啟" }
      ],
      sections,
      activity: {
        title: "💬 工作進度",
        hint: "只顯示人工作業進度；System Activity 保留於 Cloud 紀錄",
        topHtml: checklistMarkup(vm, readOnly),
        composerHtml: journalComposer({ ...options, readOnly, task: vm }),
        floatingHtml: readOnly ? "" : `<button class="shared-task-progress-composer-trigger" type="button" data-worktodo-composer-open aria-label="新增工作進度" title="新增工作進度">＋</button>`,
        html: renderJournal(vm.journal, vm, { ...options, actorLabel: options.actorLabel, formatTimestamp: options.formatTimestamp })
      },
      footerHtml: readOnly ? "" : `<div class="worktodo-shared-footer-actions"><button class="btn2" type="button" data-task-toggle="${escapeHtml(vm.id)}">${vm.status === "completed" ? "恢復待辦" : "標記完成"}</button></div>`
    };
    const html = goldenMaster?.renderDrawer
      ? goldenMaster.renderDrawer({ ...drawerOptions, components: { drawer } })
      : drawer.render(drawerOptions);
    return html.replace('<div class="shared-task-drawer"', `<div class="shared-task-drawer worktodo-shared-task-drawer" data-worktodo-shared-drawer data-worktodo-task-id="${escapeHtml(vm.id)}" data-worktodo-task-cloud-id="${escapeHtml(vm.cloudId)}"`);
  }

  function renderCard(task, options = {}) {
    const goldenMaster = options.goldenMaster || root?.ZhugeGoldenMaster;
    const card = options.card || root?.ZhugeSharedTaskCard;
    if (!card?.render) return `<div class="empty">Shared Task Card foundation 尚未載入。</div>`;
    const vm = normalize(task, options.journal || [], options.capabilityData || {});
    const latestProgress = options.latestProgress || vm.latestProgress || vm.journal[0]?.content || "";
    const summary = options.summaryHtml != null
      ? options.summaryHtml
      : (sharedTaskCardSummary?.render
        ? sharedTaskCardSummary.render({ latestProgress, workContent: vm.workContent })
        : "");
    const cardOptions = {
      className: ["shared-task-board-card", "shared-task-card", vm.status === "completed" ? "task-completed" : ""].filter(Boolean).join(" "),
      code: vm.workCode || vm.id,
      titleHtml: options.titleHtml != null ? String(options.titleHtml) : escapeHtml(vm.title),
      summaryHtml: summary,
      agreementSchedule: options.agreementSchedule || (vm.agreementMode ? {
        mode: vm.agreementMode,
        startDate: vm.agreementStartDate,
        endDate: vm.agreementEndDate
      } : null),
      actionsHtml: options.actionsHtml,
      bodyHtml: "",
      attributes: Object.assign({
        "data-task-card": vm.id,
        "data-shared-task-board-card-id": vm.id,
        "data-worktodo-open-task": vm.id,
        tabindex: "0",
        role: "button",
        draggable: "true"
      }, options.attributes || {})
    };
    return goldenMaster?.renderCard
      ? goldenMaster.renderCard(cardOptions, { components: { card } })
      : card.render(cardOptions);
  }

  /*
   * Shared Attachment UI delegates the mutation to the active Consumer
   * adapter.  The raw row is intentionally preserved for DataService because
   * the controlled WorkTodo delete path requires storage_path, while the
   * renderer uses the normalized storagePath field.
   */
  function bindAttachmentActions(container, options = {}) {
    if (!container?.querySelectorAll) return false;
    const rows = Array.isArray(options.attachments) ? options.attachments : [];
    const domainService = options.dataService || root?.DataService;
    const confirmDelete = options.confirm || root?.confirm;
    const openAttachment = typeof options.onOpen === "function" ? options.onOpen : null;
    const onDeleted = typeof options.onDeleted === "function" ? options.onDeleted : null;
    // Keep the two selectors separate.  The formal Shared Drawer emits the
    // shared attribute, while older isolated WorkTodo fixtures still expose
    // the adapter attribute only; querying them independently keeps the
    // adapter contract compatible without creating another renderer.
    const openButtons = [
      ...container.querySelectorAll("[data-shared-attachment-open]"),
      ...container.querySelectorAll("[data-worktodo-attachment-open]")
    ];
    [...new Set(openButtons)].forEach(button => {
      button.onclick = () => {
        const attachmentId = button.dataset.sharedAttachmentOpen || button.dataset.worktodoAttachmentOpen;
        const item = rows.find(row => String(row.id || row.attachmentId) === String(attachmentId));
        return openAttachment?.(item);
      };
    });
    const deleteButtons = [
      ...container.querySelectorAll("[data-shared-attachment-delete]"),
      ...container.querySelectorAll("[data-worktodo-attachment-delete]")
    ];
    [...new Set(deleteButtons)].forEach(button => {
      button.onclick = async () => {
        const attachmentId = button.dataset.sharedAttachmentDelete || button.dataset.worktodoAttachmentDelete;
        const item = rows.find(row => String(row.id || row.attachmentId) === String(attachmentId));
        if (!item || (typeof confirmDelete === "function" && !confirmDelete(`確定刪除附件「${item.filename || "未命名附件"}」？`))) return;
        if (typeof domainService?.deleteWorkTodoAttachment !== "function") {
          options.onError?.(new Error("WorkTodo Adapter 尚未取得正式附件刪除服務。"), item, button);
          return;
        }
        button.disabled = true;
        try {
          await domainService.deleteWorkTodoAttachment(item);
          await onDeleted?.(item);
        } catch (error) {
          button.disabled = false;
          options.onError?.(error, item, button);
        }
      };
    });
    return true;
  }

  return Object.freeze({ sharedDrawerContract, CAPABILITIES, normalize, toSharedViewModel, render, renderCard, renderJournal, journalComposer, analysisMarkup, bindAttachmentActions });
});
