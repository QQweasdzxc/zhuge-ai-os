/*
 * Canonical C Template Preview.
 *
 * This renderer owns a neutral, read-only View Model only. It deliberately
 * does not read a Consumer, Cloud, local storage, or a domain RPC. The same
 * Golden Master Board/Card/Drawer components used by AI Board and WorkTodo
 * render this preview, so the preview describes the capability contract rather
 * than taking a snapshot of either Consumer.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeCanonicalCTemplatePreview = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const textRenderer = root?.ZhugeSharedActivityTextRenderer
    || (typeof require === "function" ? require("./activity-text-renderer.js") : null);

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function neutralViewModel() {
    return {
      header: {
        title: "C Template｜看板區",
        description: "Canonical Shared Board / Card / Drawer Capability Preview",
        identityHint: "Neutral View Model · Read-only"
      },
      toolbar: {
        searchId: "canonicalTemplatePreviewSearch",
        searchLabel: "模板預覽搜尋",
        searchPlaceholder: "模板能力預覽（唯讀）",
        disabled: true,
        filters: [{ label: "全部來源", disabled: true }, { label: "所有優先度", disabled: true }],
        statusHtml: '<span class="golden-master-toolbar-status">不含 Consumer Domain Data</span>',
        legend: "Preview 只驗證共用 Presentation 與 Interaction Contract"
      },
      columns: [
        {
          id: "c-preview-todo",
          key: "c-preview-todo",
          name: "待開始",
          reorderable: false,
          cards: [{
            id: "c-preview-card",
            workCode: "C-PREVIEW-01",
            title: "Canonical C Template Card",
            workContent: "中立的 Shared Card 內容",
            latestProgress: "中立的最新工作進度",
            status: "not_started"
          }]
        },
        { id: "c-preview-progress", key: "c-preview-progress", name: "進行中", reorderable: false, cards: [] },
        { id: "c-preview-done", key: "c-preview-done", name: "完成", reorderable: false, cards: [], completion: true }
      ],
      drawer: {
        title: "Canonical C Template Card",
        titleCode: "C-PREVIEW-01",
        subtitle: "C Template · Neutral Preview",
        titleEditable: false,
        readOnly: true,
        properties: [
          { key: "workspace", icon: "📍", label: "工作區", value: "待開始" },
          { key: "status", icon: "◉", label: "目前狀態", value: "待開始" }
        ],
        sections: [
          { id: "preview-content", title: "工作內容", html: "<p>中立的 Shared Drawer 工作內容。</p>" },
          { id: "preview-usage", title: "使用情境", html: "<p>AI Board 與 WorkTodo 可由各自 Adapter 提供資料。</p>" },
          { id: "preview-attachments", title: "📎 附件", hint: "Shared Attachment Presentation", html: '<div class="shared-task-attachment-list"><article class="shared-task-attachment"><span class="shared-task-attachment-icon" aria-hidden="true">📄</span><span class="shared-task-attachment-copy"><strong>Canonical preview attachment</strong><small>僅展示共用附件介面，不連接實際檔案</small></span></article></div>' }
        ],
        activity: {
          title: "💬 工作進度",
          hint: "Shared Activity Presentation · Read-only",
          html: '<article class="shared-task-drawer-activity-row" data-activity-kind="human"><div class="task-activity-dot" aria-hidden="true"></div><div class="shared-task-progress-note-body"><header class="shared-task-progress-note-header"><strong class="shared-task-progress-note-title">工作進度</strong></header><div class="shared-task-progress-content">' + (textRenderer?.render ? textRenderer.render("中立的 Activity Renderer") : "中立的 Activity Renderer") + '</div><small class="shared-task-progress-note-meta">Canonical Preview · Read-only</small></div></article>'
        }
      }
    };
  }

  function cardOptions(card) {
    const summary = root?.ZhugeSharedTaskCardSummary?.render
      || (typeof require === "function" ? require("./task-card-summary.js").render : null);
    return {
      className: "shared-task-board-card canonical-c-template-preview-card",
      code: card.workCode,
      title: card.title,
      summaryHtml: summary ? summary({ latestProgress: card.latestProgress, workContent: card.workContent }) : escapeHtml(card.workContent),
      attributes: {
        "data-c-template-preview-card": card.id,
        tabindex: "0",
        role: "button",
        draggable: "false"
      }
    };
  }

  function render(options = {}) {
    const goldenMaster = options.goldenMaster || root?.ZhugeGoldenMaster;
    if (!goldenMaster?.render) return '<div class="board-empty">Canonical C Template Preview foundation 尚未載入。</div>';
    const model = neutralViewModel();
    const components = options.components || {};
    const columns = model.columns.map(column => ({
      ...column,
      renderCard: card => goldenMaster.renderCard(cardOptions(card), { components })
    }));
    return `<section class="canonical-c-template-preview" data-c-template-preview data-c-template-domain-data="none"><div class="canonical-c-template-preview-banner"><span class="template-management-kicker">Canonical C Template Preview</span><strong>Neutral View Model · No Cloud Write</strong></div>${goldenMaster.render({ ...model, columns, drawer: model.drawer, components })}</section>`;
  }

  function mount(target, options = {}) {
    if (!target) return null;
    target.innerHTML = render(options);
    return target.querySelector("[data-c-template-preview]");
  }

  return Object.freeze({ neutralViewModel, render, mount });
});
