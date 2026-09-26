const test = require("node:test");
const assert = require("node:assert/strict");
const reminder = require("../shared/line/line-reminder-contract.js");

function base(overrides = {}) {
  return {
    taskId: "task-094-1",
    eventType: "assigned",
    eventId: "activity-094-1",
    recipientUserId: "user-1",
    lineSubject: "line-user-opaque",
    canonicalState: "assigned",
    title: "整理供應商報價",
    ...overrides
  };
}

test("LINE reminder intent is a server-bound, idempotent projection", () => {
  const intent = reminder.buildIntent(base());
  assert.equal(intent.contract, "zhuge-line-reminder-intent-v1");
  assert.equal(intent.idempotencyKey, "line-reminder-v1:task-094-1:assigned:activity-094-1");
  assert.equal(intent.delivery, "protected-server-messaging-boundary");
  assert.equal(intent.mutation, "none");
});

test("LINE reminder state and evidence mismatches fail closed", () => {
  assert.throws(() => reminder.buildIntent(base({ canonicalState: "completed" })), error => error.code === "LINE_REMINDER_STATE_MISMATCH");
  assert.throws(() => reminder.buildIntent(base({ eventType: "progress_updated", canonicalState: "in_progress", progress: 60 })), error => error.code === "LINE_REMINDER_PROGRESS_INVALID");
  assert.throws(() => reminder.buildIntent(base({ eventType: "blocked", canonicalState: "blocked" })), error => error.code === "LINE_REMINDER_REASON_REQUIRED");
  assert.throws(() => reminder.buildIntent(base({ eventType: "delayed", canonicalState: "delayed", reason: "等待資料" })), error => error.code === "LINE_REMINDER_DELAY_EVIDENCE_REQUIRED");
});

test("LINE reminder does not accept an unbounded event or missing recipient", () => {
  assert.throws(() => reminder.buildIntent(base({ eventType: "delete_task" })), error => error.code === "LINE_REMINDER_EVENT_NOT_ALLOWED");
  assert.throws(() => reminder.buildIntent(base({ lineSubject: "" })), error => error.code === "LINE_REMINDER_RECIPIENT_REQUIRED");
});
