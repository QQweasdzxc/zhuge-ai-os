/* Protected LINE Messaging API adapter.
 *
 * This is a server-side boundary only.  The caller must inject a sender that
 * owns the LINE channel access token and an idempotency store.  No browser
 * session, Flex payload, or user-supplied recipient can provide credentials or
 * bypass the reminder contract.
 */
(function (root, factory) {
  const api = factory(root?.ZhugeLineReminderContract || (typeof require === "function" ? require("./line-reminder-contract.js") : null));
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeLineMessagingAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (reminderContract) {
  "use strict";

  const CONTRACT = "zhuge-line-messaging-adapter-v1";
  const MAX_MESSAGE_CHARS = 800;

  function text(value, max = MAX_MESSAGE_CHARS) {
    return String(value == null ? "" : value)
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, max);
  }

  function fail(code, status = 500) {
    const error = new Error(code);
    error.code = code;
    error.status = status;
    throw error;
  }

  function ensureIntent(intent) {
    if (!intent || intent.contract !== "zhuge-line-reminder-intent-v1") fail("LINE_REMINDER_INTENT_INVALID", 400);
    if (intent.mutation !== "none" || intent.delivery !== "protected-server-messaging-boundary") fail("LINE_REMINDER_INTENT_BOUNDARY_INVALID", 400);
    if (!intent.idempotencyKey || !intent.recipient?.lineSubject || !intent.event?.id) fail("LINE_REMINDER_INTENT_INCOMPLETE", 400);
    return intent;
  }

  function renderText(intent, options = {}) {
    const label = text(options.label || "Zhuge AI OS 工作提醒", 80);
    const title = text(intent.title || "未命名工作", 180);
    const state = text(intent.state || "", 40);
    const progress = intent.progress == null ? "" : `｜進度 ${Number(intent.progress)}%`;
    const reason = text(intent.reason, 240);
    const due = text(intent.dueAt, 80);
    const evidence = reason ? `\n原因：${reason}` : due ? `\n期限：${due}` : "";
    return `${label}\n${title}\n狀態：${state}${progress}${evidence}`.slice(0, MAX_MESSAGE_CHARS);
  }

  function messagePayload(intent, options = {}) {
    const value = ensureIntent(intent);
    return Object.freeze({
      to: text(value.recipient.lineSubject, 200),
      messages: Object.freeze([{ type: "text", text: renderText(value, options) }]),
      idempotencyKey: text(value.idempotencyKey, 480)
    });
  }

  async function sendReminder(intent, options = {}) {
    const value = ensureIntent(intent);
    if (typeof options.send !== "function") fail("LINE_MESSAGING_SENDER_UNAVAILABLE", 503);
    if (!options.idempotencyStore || typeof options.idempotencyStore.get !== "function" || typeof options.idempotencyStore.put !== "function") {
      fail("LINE_MESSAGING_IDEMPOTENCY_STORE_UNAVAILABLE", 503);
    }
    const key = text(value.idempotencyKey, 480);
    const existing = await options.idempotencyStore.get(key);
    if (existing?.status === "sent" || existing?.status === "accepted") {
      return Object.freeze({ contract: CONTRACT, status: "already_sent", idempotencyKey: key, mutation: "none" });
    }
    const payload = messagePayload(value, options);
    let response;
    try {
      response = await options.send(payload, { provider: "line-messaging-api", idempotencyKey: key });
    } catch (error) {
      await options.idempotencyStore.put(key, { status: "failed", code: text(error?.code || "LINE_SEND_FAILED", 80) });
      return Object.freeze({ contract: CONTRACT, status: "failed", idempotencyKey: key, mutation: "none", errorCode: text(error?.code || "LINE_SEND_FAILED", 80) });
    }
    const accepted = response?.accepted !== false && response?.ok !== false;
    if (!accepted) {
      await options.idempotencyStore.put(key, { status: "failed", code: text(response?.code || "LINE_SEND_REJECTED", 80) });
      return Object.freeze({ contract: CONTRACT, status: "failed", idempotencyKey: key, mutation: "none", errorCode: text(response?.code || "LINE_SEND_REJECTED", 80) });
    }
    await options.idempotencyStore.put(key, { status: "sent" });
    return Object.freeze({ contract: CONTRACT, status: "sent", idempotencyKey: key, mutation: "external-notification-only" });
  }

  return Object.freeze({ CONTRACT, MAX_MESSAGE_CHARS, messagePayload, sendReminder });
});
