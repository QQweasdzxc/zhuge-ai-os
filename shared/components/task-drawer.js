/*
 * Shared Task Drawer Foundation
 *
 * This file owns presentation only. Consumers provide already-normalized,
 * escaped section markup and keep their domain, Cloud, authorization, and
 * audit behavior outside this component.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ZhugeSharedTaskDrawer = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function asMarkup(value, emptyText) {
    return value == null || value === "" ? `<div class="shared-task-drawer-empty">${escapeHtml(emptyText || "尚未提供內容")}</div>` : String(value);
  }

  function renderProperties(properties) {
    const rows = Array.isArray(properties) ? properties.filter(item => item && (item.label || item.value)) : [];
    if (!rows.length) return "";
    return `<div class="shared-task-drawer-properties" data-shared-task-properties role="list">${rows.map(item => {
      const icon = item.icon ? `<span class="shared-task-drawer-property-icon" aria-hidden="true">${escapeHtml(item.icon)}</span>` : "";
      const label = escapeHtml(item.label || "");
      const value = escapeHtml(item.value || "—");
      const key = escapeHtml(item.key || item.label || "property");
      const interactive = item.interactive === true;
      const action = interactive ? escapeHtml(item.action || item.key || "property") : "";
      const tag = interactive ? "button" : "div";
      const type = interactive ? ' type="button"' : "";
      const actionAttribute = interactive ? ` data-task-property-action="${action}" aria-label="${label}：${value}"` : "";
      return `<${tag} class="shared-task-drawer-property${interactive ? " is-interactive" : ""}" data-task-property="${key}"${actionAttribute}${type} role="listitem">${icon}<span class="shared-task-drawer-property-copy"><span class="shared-task-drawer-property-label">${label}</span><strong class="shared-task-drawer-property-value" data-task-property-value>${value}</strong></span></${tag}>`;
    }).join("")}</div>`;
  }

  function renderSection(section) {
    const item = section || {};
    const title = escapeHtml(item.title || "");
    const content = asMarkup(item.html, item.emptyText);
    const className = item.className ? ` ${escapeHtml(item.className)}` : "";
    const hidden = item.hidden === true ? " hidden" : "";
    if (item.collapsible) {
      return `<details class="shared-task-drawer-section shared-task-drawer-collapsible${className}"${item.open ? " open" : ""}><summary>${title}</summary><div class="shared-task-drawer-section-body">${content}</div></details>`;
    }
    return `<section class="shared-task-drawer-section${className}"${hidden} data-shared-task-drawer-section="${escapeHtml(item.id || "")}"><div class="shared-task-drawer-section-heading"><h3>${title}</h3>${item.hint ? `<span>${escapeHtml(item.hint)}</span>` : ""}</div><div class="shared-task-drawer-section-body">${content}</div></section>`;
  }

  function render(options) {
    const config = options || {};
    const itemLabel = escapeHtml(config.itemLabel || "TASK");
    const title = escapeHtml(config.title || itemLabel);
    const titleCode = escapeHtml(config.titleCode || itemLabel);
    const subtitle = escapeHtml(config.subtitle || "Task Detail");
    const sections = Array.isArray(config.sections) ? config.sections : [];
    const activity = config.activity || {};
    const activityTitle = escapeHtml(activity.title || "💬 工作進度紀錄");
    const activityHint = escapeHtml(activity.hint || "人工備註＋System Activity");
    const activityTop = activity.topHtml ? String(activity.topHtml) : "";
    const activityComposer = activity.bottomHtml ? "" : (activity.composerHtml ? String(activity.composerHtml) : "");
    const activityFloating = activity.floatingHtml ? `<div class="shared-task-drawer-floating-action" data-shared-task-floating-action>${String(activity.floatingHtml)}</div>` : "";
    const activityNotes = activity.notesHtml ? String(activity.notesHtml) : "";
    const activityRows = asMarkup(activity.html, "目前沒有可讀取的 System Activity。");
    const activityNotesMarkup = activityComposer || activityNotes
      ? `<div class="shared-task-drawer-activity-notes">${activityComposer}${activityNotes}</div>`
      : "";
    const activityBottom = activity.bottomHtml ? `<div class="shared-task-drawer-activity-bottom">${String(activity.bottomHtml)}</div>` : "";
    const footer = config.footerHtml ? `<footer class="shared-task-drawer-footer">${config.footerHtml}</footer>` : "";
    const readOnly = config.readOnly === true ? " data-read-only=\"true\"" : "";
    const titleEditor = config.titleEditable === true && config.readOnly !== true
      ? `<button class="shared-task-drawer-title-edit" type="button" data-task-title-edit aria-label="編輯 ${itemLabel} 主旨" title="編輯 ${itemLabel} 主旨">✏️</button>`
      : "";
    const heading = titleCode
      ? `<span class="shared-task-drawer-title-code" data-shared-task-title-code>${titleCode}</span><span class="shared-task-drawer-title-separator" aria-hidden="true">｜</span><span id="taskDetailTitle" data-shared-task-title>${title}</span>`
      : `<span id="taskDetailTitle" data-shared-task-title>${title}</span>`;
    const properties = Array.isArray(config.properties) ? config.properties : config.meta;
    return `<div class="shared-task-drawer" data-shared-task-drawer data-shared-task-framework="v1"${readOnly}>
      <div class="shared-task-drawer-backdrop" data-shared-task-drawer-close aria-hidden="true"></div>
      <aside class="shared-task-drawer-panel" role="dialog" aria-modal="true" aria-label="${title}">
        <header class="shared-task-drawer-header" data-shared-task-region="header"><div><span class="shared-task-drawer-kicker">${subtitle}</span><div class="shared-task-drawer-title-row"><h2 data-shared-task-title-heading>${heading}</h2>${titleEditor}</div></div><button class="shared-task-drawer-close" type="button" data-shared-task-drawer-close aria-label="關閉">×</button></header>
        <div class="shared-task-drawer-properties-wrap">${renderProperties(properties)}</div>
        <div class="shared-task-drawer-grid">
          <main class="shared-task-drawer-content" data-shared-task-region="work-body">${sections.map(renderSection).join("")}</main>
          <aside class="shared-task-drawer-activity" data-shared-task-region="activity" aria-label="${activityTitle}"><div class="shared-task-drawer-section-heading"><h3>${activityTitle}</h3><span>${activityHint}</span></div>${activityTop ? `<div class="shared-task-drawer-activity-top">${activityTop}</div>` : ""}${activityNotesMarkup}<div class="shared-task-drawer-activity-list" data-shared-task-timeline>${activityRows}</div>${activityBottom}</aside>
        </div>
        ${activityFloating}
        ${footer}
      </aside>
    </div>`;
  }

  function mount(target, options) {
    if (!target) return null;
    target.innerHTML = render(options);
    const root = target.querySelector("[data-shared-task-drawer]");
    if (!root) return null;
    const onClose = options && typeof options.onClose === "function" ? options.onClose : null;
    if (onClose) root.querySelectorAll("[data-shared-task-drawer-close]").forEach(node => node.addEventListener("click", onClose));
    return root;
  }

  return Object.freeze({ escapeHtml, renderProperties, render, mount });
});
