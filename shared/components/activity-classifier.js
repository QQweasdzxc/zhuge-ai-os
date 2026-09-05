/*
 * Canonical Activity Classification.
 *
 * One fail-closed predicate is shared by Template C presentation and its
 * consumer data mapping. Only an explicit Human Progress activity may gain
 * Human Progress presentation or edit/delete capability.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeSharedActivityClassifier = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const HUMAN_PROGRESS_ACTIONS = Object.freeze([
    "progress_note_created",
    "progress_note_edited"
  ]);

  function valueOf(item = {}, camelCaseKey, snakeCaseKey) {
    const camelCaseValue = item?.[camelCaseKey];
    if (camelCaseValue !== undefined && camelCaseValue !== null) return camelCaseValue;
    return item?.[snakeCaseKey];
  }

  function classify(item = {}) {
    const activityType = String(valueOf(item, "activityType", "activity_type") || "").trim();
    const action = String(item?.action || "").trim();
    const isHumanProgress = activityType === "human_progress_note"
      && HUMAN_PROGRESS_ACTIONS.includes(action);
    const classification = isHumanProgress
      ? "human_progress_note"
      : activityType === "system_activity"
        ? "system_activity"
        : "unknown";
    return Object.freeze({ activityType, action, classification, isHumanProgress });
  }

  function isHumanProgressActivity(item = {}) {
    return classify(item).isHumanProgress;
  }

  return Object.freeze({ HUMAN_PROGRESS_ACTIONS, classify, isHumanProgressActivity });
});
