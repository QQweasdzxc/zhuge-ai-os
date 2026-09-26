const test = require("node:test");
const assert = require("node:assert/strict");
const adapter = require("../shared/line/line-messaging-adapter.js");

function intent(overrides = {}) {
  return {
    contract: "zhuge-line-reminder-intent-v1",
    taskId: "task-094-message",
    recipient: { userId: "user-094", lineSubject: "line-user-opaque" },
    event: { id: "activity-094-message", type: "assigned" },
    state: "assigned",
    title: "確認報價",
    progress: null,
    reason: null,
    dueAt: null,
    idempotencyKey: "line-reminder-v1:task-094-message:assigned:activity-094-message",
    mutation: "none",
    delivery: "protected-server-messaging-boundary",
    ...overrides
  };
}

function store() {
  const values = new Map();
  return { values, get: async key => values.get(key) || null, put: async (key, value) => values.set(key, value) };
}

test("TASK-094 Messaging adapter builds a bounded server-only LINE text payload", () => {
  const payload = adapter.messagePayload(intent({ reason: "等待對方回覆" }));
  assert.equal(payload.to, "line-user-opaque");
  assert.equal(payload.messages[0].type, "text");
  assert.match(payload.messages[0].text, /等待對方回覆/);
  assert.equal(payload.messages[0].text.length <= adapter.MAX_MESSAGE_CHARS, true);
  assert.equal(JSON.stringify(payload).includes("channel"), false);
  assert.equal(JSON.stringify(payload).includes("token"), false);
});

test("TASK-094 Messaging adapter sends once and returns an idempotent acknowledgement", async () => {
  const idempotencyStore = store();
  let calls = 0;
  const send = async () => { calls += 1; return { accepted: true, raw_provider_response: "redacted" }; };
  const first = await adapter.sendReminder(intent(), { idempotencyStore, send });
  const second = await adapter.sendReminder(intent(), { idempotencyStore, send });
  assert.equal(first.status, "sent");
  assert.equal(second.status, "already_sent");
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(first).includes("redacted"), false);
});

test("TASK-094 Messaging adapter fails closed without protected sender or idempotency store", async () => {
  await assert.rejects(() => adapter.sendReminder(intent(), { idempotencyStore: store() }), error => error.code === "LINE_MESSAGING_SENDER_UNAVAILABLE");
  await assert.rejects(() => adapter.sendReminder(intent(), { send: async () => ({ accepted: true }) }), error => error.code === "LINE_MESSAGING_IDEMPOTENCY_STORE_UNAVAILABLE");
});

test("TASK-094 Messaging adapter rejects an unverified reminder intent", () => {
  assert.throws(() => adapter.messagePayload(intent({ mutation: "board-write" })), error => error.code === "LINE_REMINDER_INTENT_BOUNDARY_INVALID");
});
