const test = require("node:test");
const assert = require("node:assert/strict");
const { webcrypto } = require("node:crypto");
const handler = require("../shared/line/line-webhook-handler.js");

const secret = "test-only-line-channel-secret";
const payload = JSON.stringify({
  events: [{
    webhookEventId: "evt-094-handler",
    type: "message",
    timestamp: 1727000000000,
    source: { type: "user", userId: "line-user-opaque" },
    message: { type: "text", text: "請接單" }
  }]
});

async function signatureFor(body) {
  const key = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await webcrypto.subtle.sign("HMAC", key, new TextEncoder().encode(body));
  return Buffer.from(digest).toString("base64");
}

test("TASK-094 webhook boundary verifies and normalizes without persistence", async () => {
  const signature = await signatureFor(payload);
  const envelope = await handler.verifyAndNormalize({ rawBody: payload, signature, channelSecret: secret, cryptoImpl: webcrypto });
  assert.equal(envelope.contract, "zhuge-line-webhook-handler-v1");
  assert.equal(envelope.accepted, true);
  assert.equal(envelope.eventCount, 1);
  assert.equal(envelope.events[0].identity.verified, true);
  assert.equal(JSON.stringify(envelope).includes(secret), false);
});

test("TASK-094 webhook boundary fails closed before canonical execution", async () => {
  await assert.rejects(
    () => handler.verifyAndNormalize({ rawBody: payload, signature: "wrong", channelSecret: secret, cryptoImpl: webcrypto }),
    error => error.code === "LINE_SIGNATURE_INVALID" && error.status === 401
  );
  const signature = await signatureFor(payload);
  const envelope = await handler.verifyAndNormalize({ rawBody: payload, signature, channelSecret: secret, cryptoImpl: webcrypto });
  await assert.rejects(
    () => handler.dispatchCanonical({ event: envelope.events[0], command: "accept_task", execute: async () => ({}) }),
    error => error.code === "LINE_SERVER_RESOLUTION_REQUIRED"
  );
});

test("TASK-094 canonical dispatch delegates to injected executor and returns sanitized ack", async () => {
  const signature = await signatureFor(payload);
  const envelope = await handler.verifyAndNormalize({ rawBody: payload, signature, channelSecret: secret, cryptoImpl: webcrypto });
  let received;
  const result = await handler.dispatchCanonical({
    event: envelope.events[0],
    command: "accept_task",
    serverResolution: {
      verified: true,
      authority: "canonical-board-scope",
      userId: "user-094",
      boardInstanceId: "board-094",
      taskId: "task-094",
      subject: "line-user-opaque",
      subjectType: "user"
    },
    execute: async command => {
      received = command;
      return { accepted: true, status: "assigned", task_id: "task-094", internal: secret };
    }
  });
  assert.equal(received.authority, "canonical-board-rpc");
  assert.equal(result.operation, "accept_task");
  assert.equal(result.result.status, "assigned");
  assert.equal(result.result.taskId, "task-094");
  assert.equal(JSON.stringify(result).includes(secret), false);
});
