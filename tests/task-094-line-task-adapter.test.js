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
  assert.throws(() => adapter.canonicalCommand({ event: verifiedEvent(), command: "accept_task" }), error => error.code === "LINE_IDENTITY_MAPPING_REQUIRED");
  const command = adapter.canonicalCommand({
    event: verifiedEvent(),
    command: "set_progress",
    resolvedUserId: "authenticated-user-uuid",
    boardInstanceId: "board-instance-uuid",
    taskId: "task-uuid",
    progress: 50,
    state: "in_progress"
  });
  assert.equal(command.authority, "canonical-board-rpc");
  assert.equal(command.persistence, "server-only");
  assert.equal(command.idempotencyKey, "line-task-v1:evt-094-001:set_progress");
  assert.equal(command.payload.progress, 50);
});

test("create_task and non-create commands have bounded allowlists", () => {
  const event = verifiedEvent({ webhookEventId: "evt-094-create" });
  const create = adapter.canonicalCommand({
    event,
    command: "create_task",
    resolvedUserId: "authenticated-user-uuid",
    boardInstanceId: "board-instance-uuid",
    title: "整理供應商報價",
    content: "從 LINE 建立後仍由 canonical Board RPC 寫入"
  });
  assert.equal(create.payload.task_id, null);
  assert.throws(() => adapter.canonicalCommand({
    event, command: "delete_task", resolvedUserId: "u", boardInstanceId: "b", taskId: "t"
  }), error => error.code === "LINE_COMMAND_NOT_ALLOWED");
  assert.throws(() => adapter.canonicalCommand({
    event, command: "complete_task", resolvedUserId: "u", boardInstanceId: "b"
  }), error => error.code === "LINE_TASK_ID_REQUIRED");
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

