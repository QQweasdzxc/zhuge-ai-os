/*
 * Canonical shared Task Card summary rule.
 *
 * The data adapters may expose different field names, but the presentation
 * order is shared: latest progress, then work content, then no summary.
 * This module owns presentation only; it does not fetch or mutate domain data.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeSharedTaskCardSummary = api;
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

  function firstText(values) {
    for (const value of values) {
      const text = String(value == null ? "" : value).trim();
      if (text) return text;
    }
    return "";
  }

  function resolve(input = {}) {
    return firstText([
      input.latestProgress,
      input.latest_progress,
      input.progressNote,
      input.progress_note,
      input.latestActivity,
      input.latest_activity,
      input.workContent,
      input.work_content,
      input.note,
      input.summary
    ]);
  }

  function render(input = {}) {
    const value = resolve(input);
    if (!value) return "";
    const content = textRenderer?.render
      ? textRenderer.render(value)
      : escapeHtml(value).replace(/\r?\n/g, "<br>");
    return `<p class="shared-task-card-summary">${content}</p>`;
  }

  return Object.freeze({ escapeHtml, resolve, render });
});
