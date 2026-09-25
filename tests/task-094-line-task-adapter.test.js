const test = require("node:test");
const assert = require("node:assert/strict");
const adapter = require("../shared/line/line-task-adapter.js");

function verifiedEvent(overrides = {}) {
  return adapter.normalizeWebhookEvent({
    webhookEventId: "evt-094-001",
    type: "message",
    timestamp: 1727000000000,
    source: { type: "user", userId: "line-user-opaque" },
    message: { type: "text", text: "請接單" },
    ...overrides
  }, { signatureVerified: true });
}

function serverResolution(event, overrides = {}) {
  return {
    verified: true,
    authority: "canonical-board-scope",
    userId: "authenticated-user-uuid",
    boardInstanceId: "board-instance-uuid",
    subject: event.identity.subject,
    subjectType: event.identity.subjectType,
    ...overrides
  };
}

test("LINE adapter normalizes only verified events and fails closed otherwise", () => {
  const pending = adapter.normalizeWebhookEvent({ webhookEventId: "evt", source: { userId: "u" } });
  assert.equal(pending.accepted, false);
  assert.equal(pending.rejectCode, "LINE_SIGNATURE_UNVERIFIED");
  const ready = verifiedEvent();
  assert.equal(ready.accepted, true);
  assert.equal(ready.identity.verified, true);
  assert.equal(ready.identity.provider, "line");
});

test("LINE progress contract allows only explicit 25-point steps", () => {
  assert.deepEqual(adapter.normalizeProgress(75), { ok: true, value: 75 });
  assert.equal(adapter.normalizeProgress(60).code, "PROGRESS_STEP_INVALID");
  assert.deepEqual(adapter.normalizeProgress(60).allowed, [0, 25, 50, 75, 100]);
});

test("canonical command requires server-resolved identity and Board scope", () => {
  assert.throws(() => adapter.canonicalCommand({ event: verifiedEvent(), command: "accept_task" }), error => error.code === "LINE_SERVER_RESOLUTION_REQUIRED");
  const event = verifiedEvent({ webhookEventId: "evt-094-resolved" });
  const command = adapter.canonicalCommand({
    event,
    command: "set_progress",
    serverResolution: serverResolution(event, { taskId: "task-uuid" }),
    progress: 50,
    state: "in_progress"
  });
  assert.equal(command.authority, "canonical-board-rpc");
  assert.equal(command.persistence, "server-only");
  assert.equal(command.idempotencyKey, "line-task-v1:evt-094-resolved:set_progress");
  assert.equal(command.payload.progress, 50);
  assert.equal(command.payload.state, "in_progress");
});

test("LINE commands fail closed when caller scope is not bound to the verified subject", () => {
  const event = verifiedEvent({ webhookEventId: "evt-094-subject" });
  assert.throws(() => adapter.canonicalCommand({
    event,
    command: "accept_task",
    serverResolution: serverResolution(event, { subject: "different-line-user", taskId: "task-uuid" })
  }), error => error.code === "LINE_RESOLUTION_SUBJECT_MISMATCH");
  assert.throws(() => adapter.canonicalCommand({
    event,
    command: "accept_task",
    serverResolution: serverResolution(event, { taskId: "task-uuid" }),
    taskId: "different-task"
  }), error => error.code === "LINE_RESOLUTION_MISMATCH");
});

test("create_task and non-create commands have bounded allowlists", () => {
  const event = verifiedEvent({ webhookEventId: "evt-094-create" });
  const create = adapter.canonicalCommand({
    event,
    command: "create_task",
    serverResolution: serverResolution(event),
    title: "整理供應商報價",
    content: "從 LINE 建立後仍由 canonical Board RPC 寫入"
  });
  assert.equal(create.payload.task_id, null);
  assert.throws(() => adapter.canonicalCommand({
    event, command: "delete_task", serverResolution: serverResolution(event, { taskId: "t" })
  }), error => error.code === "LINE_COMMAND_NOT_ALLOWED");
  assert.throws(() => adapter.canonicalCommand({
    event, command: "complete_task", serverResolution: serverResolution(event), progress: 100
  }), error => error.code === "LINE_RESOLVED_TASK_REQUIRED");
});

test("Flex card is a sanitized presentation projection and carries no mutation", () => {
  const card = adapter.flexTaskCard({ id: "task-1", title: "\u0000整理文件", state: "blocked", progress: 25 }, { deepLink: "https://qqweasdzxc.github.io/modules/worklog/?app=1&task=task-1" });
  assert.equal(card.title, "整理文件");
  assert.equal(card.stateLabel, "卡關");
  assert.equal(card.progressLabel, "25%");
  assert.equal(card.mutation, "none");
});

test("LINE adapter uses deterministic event idempotency and does not accept arbitrary task writes", () => {
  assert.equal(adapter.idempotencyKey("evt-1", "accept_task"), "line-task-v1:evt-1:accept_task");
  assert.equal(adapter.idempotencyKey("evt-1", "delete_task"), "");
  assert.equal(adapter.idempotencyKey("", "accept_task"), "");
});

test("LINE commands derive state from the allowlisted command, not user input", () => {
  const event = verifiedEvent({ webhookEventId: "evt-094-state" });
  const command = adapter.canonicalCommand({
    event,
    command: "accept_task",
    state: "completed",
    serverResolution: serverResolution(event, { taskId: "task-uuid" })
  });
  assert.equal(command.payload.state, "assigned");
  assert.equal(command.payload.progress, null);
});

test("blocked and delayed commands require explicit human-readable evidence", () => {
  const blockedEvent = verifiedEvent({ webhookEventId: "evt-094-blocked" });
  assert.throws(() => adapter.canonicalCommand({
    event: blockedEvent,
    command: "mark_blocked",
    serverResolution: serverResolution(blockedEvent, { taskId: "t" })
  }), error => error.code === "LINE_BLOCK_REASON_REQUIRED");

  const delayedEvent = verifiedEvent({ webhookEventId: "evt-094-delayed" });
  assert.throws(() => adapter.canonicalCommand({
    event: delayedEvent,
    command: "mark_delayed",
    reason: "等待外部資料",
    serverResolution: serverResolution(delayedEvent, { taskId: "t" })
  }), error => error.code === "LINE_DELAY_EVIDENCE_REQUIRED");

  const command = adapter.canonicalCommand({
    event: delayedEvent,
    command: "mark_delayed",
    reason: "等待外部資料",
    dueAt: "2026-10-01T09:00:00+08:00",
    serverResolution: serverResolution(delayedEvent, { taskId: "t" })
  });
  assert.equal(command.payload.state, "delayed");
  assert.equal(command.payload.reason, "等待外部資料");
  assert.equal(command.payload.due_at, "2026-10-01T09:00:00+08:00");
});

test("completion requires explicit 100% evidence and progress updates require a value", () => {
  const event = verifiedEvent({ webhookEventId: "evt-094-complete" });
  assert.throws(() => adapter.canonicalCommand({
    event,
    command: "complete_task",
    serverResolution: serverResolution(event, { taskId: "t" }),
    progress: 75
  }), error => error.code === "LINE_COMPLETION_PROGRESS_REQUIRED");
  assert.throws(() => adapter.canonicalCommand({
    event,
    command: "set_progress",
    serverResolution: serverResolution(event, { taskId: "t" })
  }), error => error.code === "LINE_PROGRESS_REQUIRED");
  const completed = adapter.canonicalCommand({
    event,
    command: "complete_task",
    serverResolution: serverResolution(event, { taskId: "t" }),
    progress: 100
  });
  assert.equal(completed.payload.state, "completed");
  assert.equal(completed.payload.progress, 100);
});
