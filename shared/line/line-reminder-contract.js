/*
 * Shared LINE reminder intent contract.
 *
 * This module is deliberately not a Messaging API client.  It converts a
 * canonical Task event into one bounded, idempotent notification intent for a
 * protected server sender.  It never changes board state, chooses a Task
 * state, or accepts provider credentials from a browser/Flex payload.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeLineReminderContract = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CONTRACT = "zhuge-line-reminder-intent-v1";
  const EVENT_TYPES = Object.freeze([
    "assigned",
    "progress_updated",
    "blocked",
    "delayed",
    "completed"
  ]);
  const TASK_STATES = Object.freeze({
    assigned: "assigned",
    progress_updated: "in_progress",
    blocked: "blocked",
    delayed: "delayed",
    completed: "completed"
  });
  const MAX_TEXT = 500;

  function text(value, max = MAX_TEXT) {
    return String(value == null ? "" : value)
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, max);
  }

  function fail(code, message) {
    const error = new Error(message || code);
    error.code = code;
    throw error;
  }

  function idempotencyKey(taskId, eventType, eventId) {
    const task = text(taskId, 160);
    const event = text(eventType, 80);
    const source = text(eventId, 200);
    if (!task || !EVENT_TYPES.includes(event) || !source) return "";
    return `line-reminder-v1:${task}:${event}:${source}`.slice(0, 480);
  }

  function buildIntent(input = {}) {
    const taskId = text(input.taskId || input.task_id, 160);
    const eventType = text(input.eventType || input.event_type, 80).toLowerCase();
    const eventId = text(input.eventId || input.event_id, 200);
    const userId = text(input.recipientUserId || input.recipient_user_id, 160);
    const subject = text(input.lineSubject || input.line_subject, 160);
    const state = text(input.canonicalState || input.canonical_state, 60).toLowerCase();
    const title = text(input.title || "未命名工作", 160);
    const progress = input.progress == null ? null : Number(input.progress);

    if (!taskId) fail("LINE_REMINDER_TASK_REQUIRED", "Reminder intent needs a canonical Task id.");
    if (!EVENT_TYPES.includes(eventType)) fail("LINE_REMINDER_EVENT_NOT_ALLOWED", "Reminder event is not allowlisted.");
    if (!eventId) fail("LINE_REMINDER_EVENT_ID_REQUIRED", "Reminder intent needs a canonical source event id.");
    if (!userId || !subject) fail("LINE_REMINDER_RECIPIENT_REQUIRED", "Reminder intent needs a server-resolved recipient.");
    if (state !== TASK_STATES[eventType]) fail("LINE_REMINDER_STATE_MISMATCH", "Reminder state does not match its canonical event.");
    if (eventType === "progress_updated" && (![0, 25, 50, 75, 100].includes(progress))) {
      fail("LINE_REMINDER_PROGRESS_INVALID", "Progress reminder requires an explicit 0/25/50/75/100 value.");
    }
    if (eventType === "blocked" && !text(input.reason, MAX_TEXT)) fail("LINE_REMINDER_REASON_REQUIRED", "Blocked reminder needs a canonical reason.");
    if (eventType === "delayed" && (!text(input.reason, MAX_TEXT) || !Number.isFinite(Date.parse(text(input.dueAt || input.due_at, 80))))) {
      fail("LINE_REMINDER_DELAY_EVIDENCE_REQUIRED", "Delayed reminder needs a reason and valid due date.");
    }

    const key = idempotencyKey(taskId, eventType, eventId);
    if (!key) fail("LINE_REMINDER_IDEMPOTENCY_REQUIRED", "Reminder intent could not establish idempotency.");
    return Object.freeze({
      contract: CONTRACT,
      channel: "line",
      taskId,
      recipient: Object.freeze({ userId, lineSubject: subject }),
      event: Object.freeze({ id: eventId, type: eventType }),
      state,
      progress: Number.isFinite(progress) ? progress : null,
      title,
      reason: text(input.reason, MAX_TEXT) || null,
      dueAt: text(input.dueAt || input.due_at, 80) || null,
      idempotencyKey: key,
      mutation: "none",
      delivery: "protected-server-messaging-boundary"
    });
  }

  return Object.freeze({
    CONTRACT,
    EVENT_TYPES,
    idempotencyKey,
    buildIntent
  });
});
