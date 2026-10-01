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

  function parseDateOnly(value) {
    const match = String(value == null ? "" : value).slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return { year, month, day, iso: `${match[1]}-${match[2]}-${match[3]}` };
  }

  function normalizeAgreementSchedule(value) {
    const source = value?.agreementSchedule || value;
    const mode = String(source?.mode || source?.agreementMode || "").trim().toLowerCase();
    const start = parseDateOnly(source?.startDate || source?.agreementStartDate || source?.agreement_start_date);
    const end = parseDateOnly(source?.endDate || source?.agreementEndDate || source?.agreement_end_date);
    if (mode === "single" && start) return { mode, start, end: null };
    if (mode === "period" && start && end) return { mode, start, end };
    return null;
  }

  function compactAgreementDate(date) {
    return `${date.month}/${date.day}`;
  }

  function fullAgreementDate(date) {
    return date.iso.replace(/-/g, "/");
  }

  function renderAgreementSchedule(value) {
    const schedule = normalizeAgreementSchedule(value);
    if (!schedule) return "";
    const compact = schedule.mode === "period"
      ? `${compactAgreementDate(schedule.start)} → ${compactAgreementDate(schedule.end)}`
      : compactAgreementDate(schedule.start);
    const label = schedule.mode === "period"
      ? `約定期間：${fullAgreementDate(schedule.start)} 至 ${fullAgreementDate(schedule.end)}`
      : `約定日期：${fullAgreementDate(schedule.start)}`;
    return `<span class="shared-task-card-agreement" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}"><span class="shared-task-card-agreement-icon" aria-hidden="true">📅</span><span class="shared-task-card-agreement-value">${escapeHtml(compact)}</span></span>`;
  }

  function render(options = {}) {
    const className = ["shared-task-card", options.className || ""].filter(Boolean).join(" ");
    const code = options.code == null ? "" : `<div class="shared-task-card-code code">${escapeHtml(options.code)}</div>`;
    const agreementSchedule = renderAgreementSchedule(options.agreementSchedule);
    const title = options.titleHtml != null ? String(options.titleHtml) : escapeHtml(options.title || "未命名工作");
    const summary = options.summaryHtml != null
      ? String(options.summaryHtml)
      : options.summary
        ? `<p class="shared-task-card-summary">${escapeHtml(options.summary)}</p>`
        : "";
    const actions = options.actionsHtml ? `<div class="shared-task-card-actions">${String(options.actionsHtml)}</div>` : "";
    const headerSide = agreementSchedule || actions
      ? `<div class="shared-task-card-header-side">${agreementSchedule}${actions}</div>`
      : "";
    const body = options.bodyHtml ? String(options.bodyHtml) : "";
    const footer = options.footerHtml ? `<footer class="shared-task-card-footer">${String(options.footerHtml)}</footer>` : "";
    return `<article class="${escapeHtml(className)}"${renderAttributes(options.attributes)}>
      <div class="shared-task-card-header"><div class="shared-task-card-header-main">${code}</div>${headerSide}</div>
      <h3 class="shared-task-card-title">${title}</h3>
      ${summary}${body}${footer}
    </article>`;
  }

  return Object.freeze({ escapeHtml, render });
});
