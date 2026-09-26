(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ZhugeWorkTodoOrdering = factory();
})(typeof globalThis === "object" ? globalThis : this, function () {
  "use strict";

  const WORKFLOW_ORDER = Object.freeze([
    "not_started",
    "in_progress",
    "waiting_reply",
    "waiting_acceptance",
    "blocked",
    "completed"
  ]);

  function text(value) {
    return String(value == null ? "" : value).trim();
  }

  // Date-only values are compared as UTC calendar days so the ordering does
  // not shift when the browser runs in a different timezone.
  function parseDateOnly(value) {
    const match = text(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const timestamp = Date.UTC(year, month - 1, day);
    const date = new Date(timestamp);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return Object.freeze({ key: `${match[1]}-${match[2]}-${match[3]}`, value: timestamp });
  }

  function parseTimestamp(value) {
    const timestamp = Date.parse(text(value));
    return Number.isFinite(timestamp) ? timestamp : 0;
  }

  function firstPresent(...values) {
    return values.find(value => value !== undefined && value !== null && text(value) !== "") || "";
  }

  function acceptanceDate(task = {}) {
    const agreement = task.agreement || task.schedule || {};
    const end = parseDateOnly(firstPresent(
      task.agreementEndDate,
      task.agreement_end_date,
      task.endDate,
      task.end_date,
      agreement.endDate,
      agreement.end_date
    ));
    if (end) return end;

    const due = parseDateOnly(firstPresent(task.dueDate, task.due_date, task.deadline));
    if (due) return due;

    // A start-only schedule still has a meaningful date.  It is only a
    // fallback; a valid range end always wins above.
    return parseDateOnly(firstPresent(
      task.agreementStartDate,
      task.agreement_start_date,
      task.startDate,
      task.start_date,
      agreement.startDate,
      agreement.start_date
    ));
  }

  function latestProgressTimestamp(task = {}, journalEntries = []) {
    const rows = Array.isArray(journalEntries) ? journalEntries : [];
    const taskSnapshot = Math.max(
      parseTimestamp(task.latestProgressAt),
      parseTimestamp(task.latest_progress_at)
    );
    return rows.reduce((latest, entry = {}) => Math.max(
      latest,
      parseTimestamp(firstPresent(
        entry.createdAt,
        entry.created_at,
        entry.progressAt,
        entry.progress_at,
        entry.updatedAt,
        entry.updated_at
      ))
    ), taskSnapshot);
  }

  function updatedTimestamp(task = {}) {
    return Math.max(
      parseTimestamp(task.updatedAt),
      parseTimestamp(task.updated_at),
      parseTimestamp(task.createdAt),
      parseTimestamp(task.created_at)
    );
  }

  function workCodeCompare(a = {}, b = {}) {
    const aCode = text(a.workCode || a.work_code || a.id);
    const bCode = text(b.workCode || b.work_code || b.id);
    return aCode.localeCompare(bCode, "en", { numeric: true, sensitivity: "base" });
  }

  function compareTasks(a = {}, b = {}, options = {}) {
    const workspaceKey = text(options.workspaceKey || options.workspace || a.status).toLowerCase();
    if (workspaceKey === "waiting_acceptance") {
      const aDate = acceptanceDate(a);
      const bDate = acceptanceDate(b);
      if (aDate && !bDate) return -1;
      if (!aDate && bDate) return 1;
      if (aDate && bDate && aDate.value !== bDate.value) return aDate.value - bDate.value;
    }

    const journalsForTask = typeof options.journalsForTask === "function" ? options.journalsForTask : () => [];
    const aProgress = latestProgressTimestamp(a, journalsForTask(a));
    const bProgress = latestProgressTimestamp(b, journalsForTask(b));
    const aRecent = aProgress || updatedTimestamp(a);
    const bRecent = bProgress || updatedTimestamp(b);
    if (aRecent !== bRecent) return bRecent - aRecent;
    return workCodeCompare(a, b);
  }

  function sortTasks(list = [], options = {}) {
    const rows = Array.isArray(list) ? [...list] : [];
    const workspaceForTask = typeof options.workspaceForTask === "function"
      ? options.workspaceForTask
      : task => task?.status;
    return rows.sort((a, b) => {
      const aWorkspace = text(workspaceForTask(a)).toLowerCase();
      const bWorkspace = text(workspaceForTask(b)).toLowerCase();
      if (aWorkspace !== bWorkspace) {
        const aIndex = WORKFLOW_ORDER.indexOf(aWorkspace);
        const bIndex = WORKFLOW_ORDER.indexOf(bWorkspace);
        if (aIndex !== bIndex) return (aIndex < 0 ? WORKFLOW_ORDER.length : aIndex) - (bIndex < 0 ? WORKFLOW_ORDER.length : bIndex);
      }
      return compareTasks(a, b, { ...options, workspaceKey: aWorkspace });
    });
  }

  return Object.freeze({
    acceptanceDate,
    compareTasks,
    latestProgressTimestamp,
    parseDateOnly,
    sortTasks
  });
});
