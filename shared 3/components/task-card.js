/*
 * Shared Task Card presentation shell.
 *
 * Consumers provide normalized display values and escaped/domain-owned
 * markup.  This component owns no state, Cloud access, authorization, or
 * task business rules.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ZhugeSharedTaskCard = factory();
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

  function renderAttributes(attributes = {}) {
    return Object.entries(attributes)
      .filter(([, value]) => value !== undefined && value !== null && value !== false)
      .map(([name, value]) => ` ${escapeHtml(name)}="${escapeHtml(value === true ? name : value)}"`)
      .join("");
  }

  function render(options = {}) {
    const className = ["shared-task-card", options.className || ""].filter(Boolean).join(" ");
    const code = options.code == null ? "" : `<div class="shared-task-card-code code">${escapeHtml(options.code)}</div>`;
    const title = options.titleHtml != null ? String(options.titleHtml) : escapeHtml(options.title || "未命名工作");
    const summary = options.summaryHtml != null
      ? String(options.summaryHtml)
      : options.summary
        ? `<p class="shared-task-card-summary">${escapeHtml(options.summary)}</p>`
        : "";
    const actions = options.actionsHtml ? `<div class="shared-task-card-actions">${String(options.actionsHtml)}</div>` : "";
    const body = options.bodyHtml ? String(options.bodyHtml) : "";
    const footer = options.footerHtml ? `<footer class="shared-task-card-footer">${String(options.footerHtml)}</footer>` : "";
    return `<article class="${escapeHtml(className)}"${renderAttributes(options.attributes)}>
      <div class="shared-task-card-header">${code}${actions}</div>
      <h3 class="shared-task-card-title">${title}</h3>
      ${summary}${body}${footer}
    </article>`;
  }

  return Object.freeze({ escapeHtml, render });
});
