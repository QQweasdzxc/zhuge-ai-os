/*
 * WorkTodo -> Shared Task UX adapter.
 *
 * This adapter owns only WorkTodo-to-presentation mapping.  It never reads
 * Supabase, calls an RPC, or writes browser storage.  WorkLog keeps the
 * canonical DataService / Repository / RLS boundary and binds the data-
 * attributes emitted here to those existing domain operations.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(null);
  else root.ZhugeWorkTodoTaskAdapter = factory(root);
})(typeof window !== "undefined" ? window : globalThis, function (root) {
  "use strict";

  const CAPABILITIES = Object.freeze({
    title: true,
    note: true,
    status: true,
    progress: true,
    priority: true,
    pin: true,
    dueDate: true,
    completion: true,
    workJournal: true,
    checklist: false,
    generalAttachment: false,
    progressNoteAttachment: false,
    gptAnalysis: false,
    usageScenario: false,
    engineeringEvidence: false
  });

  const STATUS_LABELS = Object.freeze({
    not_started: "待開始",
    in_progress: "進行中",
    waiting_reply: "等待回覆",
    waiting_acceptance: "等待驗收",
    blocked: "阻塞",
    completed: "完成"
  });

  const PRIORITY_LABELS = Object.freeze({
    p0: "P0",
    p1: "P1",
    p2: "P2",
    p3: "P3"
  });

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

  function normalize(task = {}, journal = []) {
    const status = normalizeStatus(task.status);
    const progress = status === "completed" ? 100 : clampProgress(task.progress);
    const entries = (Array.isArray(journal) ? journal : [])
      .filter(entry => entry && String(entry.content || "").trim())
      .map(entry => ({
        id: String(entry.cloudId || entry.id || entry.clientId || ""),
        content: String(entry.content || "").trim(),
        entryType: String(entry.entryType || entry.entry_type || "progress"),
        status: normalizeStatus(entry.status || entry.entry_status || status),
        progress: clampProgress(entry.progress),
        createdBy: String(entry.createdBy || entry.created_by || ""),
        createdAt: entry.createdAt || entry.created_at || "",
        updatedAt: entry.updatedAt || entry.updated_at || entry.createdAt || entry.created_at || ""
      }))
      .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0));
    return {
      id: String(task.id || ""),
      cloudId: String(task.cloudId || ""),
      title: String(task.title || "").trim(),
      note: String(task.note || "").trim(),
      status,
      statusLabel: STATUS_LABELS[status],
      progress,
      priority: normalizePriority(task.priority),
      priorityLabel: PRIORITY_LABELS[normalizePriority(task.priority)],
      userPinned: task.userPinned === true,
      dueDate: String(task.dueDate || "").slice(0, 10),
      startedAt: task.startedAt || "",
      completedAt: task.completedAt || "",
      completedNote: String(task.completedNote || "").trim(),
      completedBy: String(task.completedBy || ""),
      journal: entries
    };
  }

  function formatDueDate(value) {
    if (!value) return "尚未設定";
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("zh-TW", { year: "numeric", month: "numeric", day: "numeric" }).format(date);
  }

  function formatTimestamp(value, formatter) {
    if (typeof formatter === "function") return formatter(value);
    const date = new Date(value || 0);
    return Number.isNaN(date.getTime()) ? "時間未知" : date.toLocaleString("zh-TW", { hour12: false });
  }

  function contentMarkup(value, renderContent) {
    if (typeof renderContent === "function") return renderContent(value);
    return escapeHtml(value).replace(/\n/g, "<br>");
  }

  function editableFieldMarkup(vm, field, label) {
    const value = vm[field] || "";
    return `<div class="worktodo-shared-inline-field" data-worktodo-inline-field="${field}">
      <div class="worktodo-shared-inline-field-toolbar"><span class="worktodo-shared-inline-field-value" data-worktodo-field-value="${field}">${value ? contentMarkup(value) : "<span class=\"muted\">尚未填寫</span>"}</span><button class="btn2" type="button" data-worktodo-edit-field="${field}" aria-label="編輯${escapeHtml(label)}">✏️ 編輯</button></div>
    </div>`;
  }

  function selectOptions(values, selected, labels = {}) {
    return values.map(value => `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(labels[value] || value)}</option>`).join("");
  }

  function controlsMarkup(vm, readOnly) {
    if (readOnly) {
      return `<div class="worktodo-shared-controls-readonly"><span>狀態：${escapeHtml(vm.statusLabel)}</span><span>進度：${vm.progress}%</span><span>優先度：${escapeHtml(vm.priorityLabel)}</span><span>置頂：${vm.userPinned ? "是" : "否"}</span><span>日期：${escapeHtml(formatDueDate(vm.dueDate))}</span></div>`;
    }
    return `<div class="worktodo-shared-controls" data-worktodo-controls>
      <label>目前狀態<select class="input" data-worktodo-status>${selectOptions(Object.keys(STATUS_LABELS), vm.status, STATUS_LABELS)}</select></label>
      <label>進度 <output data-worktodo-progress-output>${vm.progress}%</output><input class="task-progress-range" type="range" min="0" max="100" step="5" value="${vm.progress}" data-worktodo-progress></label>
      <label>優先度<select class="input" data-worktodo-priority>${selectOptions(Object.keys(PRIORITY_LABELS), vm.priority, PRIORITY_LABELS)}</select></label>
      <label>日期<input class="input task-date-input" type="date" value="${escapeHtml(vm.dueDate)}" data-worktodo-due-date></label>
      <label class="worktodo-shared-pin"><input type="checkbox" data-worktodo-pin${vm.userPinned ? " checked" : ""}> 📌 置頂</label>
      <div class="worktodo-shared-controls-actions"><button class="btn" type="button" data-worktodo-save-controls>儲存工作屬性</button></div>
    </div>`;
  }

  function journalRow(entry, options = {}) {
    const label = entry.entryType === "completion" ? "結案紀錄" : "工作進度";
    const actor = options.actorLabel || entry.createdBy || "目前使用者";
    const entryId = escapeHtml(entry.id);
    return `<article class="shared-task-drawer-activity-row worktodo-shared-journal-row" data-activity-kind="human" data-worktodo-journal-entry="${entryId}">
      <div class="task-activity-dot" aria-hidden="true"></div>
      <div class="worktodo-shared-journal-body"><header class="shared-task-progress-note-header"><strong class="shared-task-progress-note-title">${escapeHtml(label)}</strong><span class="shared-task-progress-note-actions"><button class="shared-task-icon-button" type="button" data-worktodo-journal-edit="${entryId}" aria-label="編輯工作進度" title="編輯工作進度">✎</button></span></header>
      <div class="shared-task-progress-content">${contentMarkup(entry.content, options.renderContent)}</div>
      <small class="shared-task-progress-note-meta">${escapeHtml(actor)} · ${escapeHtml(formatTimestamp(entry.createdAt, options.formatTimestamp))}</small></div>
    </article>`;
  }

  function journalComposer(options = {}) {
    if (options.readOnly) return `<div class="worktodo-shared-journal-readonly">此待辦的工作紀錄僅供查閱。</div>`;
    const editing = options.editingEntry;
    const draft = options.journalDraft || {};
    const status = normalizeStatus(draft.status || options.task?.status);
    const progress = clampProgress(draft.progress ?? options.task?.progress);
    const label = editing ? "編輯工作進度" : "新增工作進度";
    const saveLabel = editing ? "儲存更新" : "新增";
    return `<section class="shared-task-drawer-progress-composer worktodo-shared-journal-composer" data-worktodo-journal-composer>
      <div class="shared-task-progress-composer-heading"><label for="taskJournalContent">${label}</label>${editing ? `<button class="shared-task-progress-composer-close" type="button" data-journal-cancel aria-label="取消編輯工作進度">×</button>` : ""}</div>
      <textarea class="input" id="taskJournalContent" rows="3" placeholder="輸入這次工作進度…">${escapeHtml(draft.content || "")}</textarea>
      <div class="worktodo-shared-journal-options"><label><input type="checkbox" id="taskJournalUpdateProgress"${draft.updateProgress ? " checked" : ""}> 同時更新進度</label><label><input type="checkbox" id="taskJournalUpdateStatus"${draft.updateStatus ? " checked" : ""}> 同時更新狀態</label></div>
      <div class="worktodo-shared-journal-optional ${draft.updateProgress ? "" : "is-hidden"}" data-journal-progress-fields><label>目前進度 <output id="taskJournalProgressOutput">${progress}%</output><input class="task-progress-range" id="taskJournalProgress" type="range" min="0" max="100" step="5" value="${progress}"></label></div>
      <div class="worktodo-shared-journal-optional ${draft.updateStatus ? "" : "is-hidden"}" data-journal-status-fields><label>目前狀態<select class="input" id="taskJournalStatus">${selectOptions(Object.keys(STATUS_LABELS), status, STATUS_LABELS)}</select></label></div>
      <div class="shared-task-progress-composer-actions"><small>由既有 WorkTodo Cloud Journal path 保存。</small><button class="shared-task-progress-submit" type="button" data-journal-save>${saveLabel}</button></div>
    </section>`;
  }

  function renderJournal(entries, options = {}) {
    if (options.loading) return "<div class=\"shared-task-drawer-empty\">🌀 正在從 Cloud 載入工作進度…</div>";
    if (!entries.length) return "<div class=\"shared-task-drawer-empty\">尚無工作進度紀錄。</div>";
    return entries.map(entry => journalRow(entry, options)).join("");
  }

  function render(task, options = {}) {
    const drawer = options.drawer || root?.ZhugeSharedTaskDrawer;
    if (!drawer?.render) return "<div class=\"shared-task-drawer-empty\">Shared Task Drawer 尚未載入。</div>";
    const vm = normalize(task, options.journal || []);
    const readOnly = options.readOnly === true;
    const sections = [
      { id: "work-content", title: "工作內容", className: "worktodo-shared-content-section", html: editableFieldMarkup(vm, "note", "工作內容") },
      { id: "work-properties", title: "工作屬性", className: "worktodo-shared-properties-section", collapsible: true, open: false, html: controlsMarkup(vm, readOnly) },
      vm.status === "completed" && vm.completedNote ? { id: "completion", title: "完成摘要", className: "worktodo-shared-completion-section", html: `<p class=\"worktodo-shared-completion-note\">${contentMarkup(vm.completedNote, options.renderContent)}</p><small class=\"muted\">完成時間：${escapeHtml(formatTimestamp(vm.completedAt, options.formatTimestamp))}</small>` } : null
    ].filter(Boolean);
    const html = drawer.render({
      title: vm.title || "未命名待辦",
      titleCode: vm.id,
      titleEditable: !readOnly,
      subtitle: "WorkTodo · Shared Task Drawer",
      readOnly,
      properties: [
        { key: "status", icon: "◉", label: "目前狀態", value: vm.statusLabel },
        { key: "progress", icon: "◒", label: "進度", value: `${vm.progress}%` },
        { key: "priority", icon: "⚑", label: "優先度", value: vm.priorityLabel },
        { key: "pin", icon: "📌", label: "置頂", value: vm.userPinned ? "是" : "否" },
        { key: "due-date", icon: "📅", label: "日期", value: formatDueDate(vm.dueDate) }
      ],
      sections,
      activity: {
        title: "💬 工作進度",
        hint: "WorkTodo Work Journal · 最近更新在前",
        composerHtml: journalComposer({ ...options, task: vm }),
        html: renderJournal(vm.journal, { ...options, actorLabel: options.actorLabel, formatTimestamp: options.formatTimestamp })
      },
      footerHtml: `<div class=\"worktodo-shared-footer-actions\"><button class=\"btn2 ${vm.status === "completed" ? "" : "primary"}\" type=\"button\" data-task-toggle=\"${escapeHtml(vm.id)}\">${vm.status === "completed" ? "恢復待辦" : "標記完成"}</button></div>`
    });
    return html.replace('<div class="shared-task-drawer"', `<div class="shared-task-drawer worktodo-shared-task-drawer" data-worktodo-shared-drawer data-worktodo-task-id="${escapeHtml(vm.id)}"`);
  }

  function renderCard(task, options = {}) {
    const card = options.card || root?.ZhugeSharedTaskCard;
    if (!card?.render) return "<div class=\"empty\">Shared Task Card foundation 尚未載入。</div>";
    const vm = normalize(task, options.journal || []);
    const titleHtml = options.titleHtml != null
      ? String(options.titleHtml)
      : `<span class="worktodo-shared-card-title-status" aria-hidden="true">${vm.status === "completed" ? "✅" : "⬜"}</span> ${escapeHtml(vm.title)}`;
    const bodyHtml = options.bodyHtml != null
      ? String(options.bodyHtml)
      : `<div class="task-progress-track" aria-label="進度 ${vm.progress}%"><span style="width:${vm.progress}%"></span></div>`;
    return card.render({
      className: ["entry", "task-row", "worktodo-shared-task-card", vm.status === "completed" ? "task-completed" : ""].filter(Boolean).join(" "),
      code: vm.id,
      titleHtml,
      summaryHtml: options.summaryHtml,
      actionsHtml: options.actionsHtml,
      bodyHtml,
      attributes: {
        "data-task-card": vm.id,
        "data-worktodo-open-task": vm.id,
        tabindex: "0",
        role: "button"
      }
    });
  }

  return Object.freeze({ CAPABILITIES, normalize, render, renderCard, renderJournal, journalComposer });
});
