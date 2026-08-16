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

  function renderMeta(meta) {
    const rows = Array.isArray(meta) ? meta : [];
    if (!rows.length) return "";
    return `<div class="shared-task-drawer-meta">${rows.map(item => {
      const label = escapeHtml(item?.label || "");
      const value = escapeHtml(item?.value || "");
      return `<span class="shared-task-drawer-meta-item"><b>${label}</b><span>${value}</span></span>`;
    }).join("")}</div>`;
  }

  function renderSection(section) {
    const item = section || {};
    const title = escapeHtml(item.title || "");
    const content = asMarkup(item.html, item.emptyText);
    const className = item.className ? ` ${escapeHtml(item.className)}` : "";
    if (item.collapsible) {
      return `<details class="shared-task-drawer-section shared-task-drawer-collapsible${className}"${item.open ? " open" : ""}><summary>${title}</summary><div class="shared-task-drawer-section-body">${content}</div></details>`;
    }
    return `<section class="shared-task-drawer-section${className}" data-shared-task-drawer-section="${escapeHtml(item.id || "")}"><div class="shared-task-drawer-section-heading"><h3>${title}</h3>${item.hint ? `<span>${escapeHtml(item.hint)}</span>` : ""}</div><div class="shared-task-drawer-section-body">${content}</div></section>`;
  }

  function render(options) {
    const config = options || {};
    const title = escapeHtml(config.title || "TASK");
    const subtitle = escapeHtml(config.subtitle || "Task Detail");
    const sections = Array.isArray(config.sections) ? config.sections : [];
    const activity = config.activity || {};
    const activityTitle = escapeHtml(activity.title || "💬 工作進度紀錄");
    const activityHint = escapeHtml(activity.hint || "人工備註＋System Activity");
    const activityNotes = asMarkup(activity.notesHtml, "目前沒有人工工作進度紀錄。");
    const activityRows = asMarkup(activity.html, "目前沒有可讀取的 System Activity。");
    const footer = config.footerHtml ? `<footer class="shared-task-drawer-footer">${config.footerHtml}</footer>` : "";
    const readOnly = config.readOnly === true ? " data-read-only=\"true\"" : "";
    return `<div class="shared-task-drawer" data-shared-task-drawer${readOnly}>
      <div class="shared-task-drawer-backdrop" data-shared-task-drawer-close aria-hidden="true"></div>
      <aside class="shared-task-drawer-panel" role="dialog" aria-modal="true" aria-label="${title}">
        <header class="shared-task-drawer-header"><div><span class="shared-task-drawer-kicker">${subtitle}</span><h2 id="taskDetailTitle">${title}</h2></div><button class="shared-task-drawer-close" type="button" data-shared-task-drawer-close aria-label="關閉">×</button></header>
        <div class="shared-task-drawer-meta-wrap">${renderMeta(config.meta)}</div>
        <div class="shared-task-drawer-grid">
          <main class="shared-task-drawer-content">${sections.map(renderSection).join("")}</main>
          <aside class="shared-task-drawer-activity" aria-label="${activityTitle}"><div class="shared-task-drawer-section-heading"><h3>${activityTitle}</h3><span>${activityHint}</span></div><div class="shared-task-drawer-activity-notes">${activityNotes}</div><div class="shared-task-drawer-activity-list">${activityRows}</div></aside>
        </div>
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

  return Object.freeze({ escapeHtml, render, mount });
});
