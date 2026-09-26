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
  const DEFAULT_TIMEOUT_MS = 8000;
  const MAX_TIMEOUT_MS = 10000;
  const DEFAULT_MAX_RETRIES = 1;
  const MAX_MAX_RETRIES = 1;
  const DEFAULT_PENDING_TTL_MS = 30000;

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

  function boundedNumber(value, fallback, maximum) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) return fallback;
    return Math.min(Math.floor(parsed), maximum);
  }

  function errorCode(value, fallback) {
    return text(value?.code || value?.errorCode || fallback, 80) || fallback;
  }

  function statusOf(value) {
    const status = Number(value?.status || value?.statusCode);
    return Number.isInteger(status) ? status : 0;
  }

  function retryable(value) {
    const status = statusOf(value);
    return value?.retryable === true || status === 408 || status === 425 || status === 429 || status >= 500;
  }

  function deliveryUncertain(value) {
    return value?.delivery === "uncertain" || errorCode(value, "") === "LINE_SEND_TIMEOUT";
  }

  function nowOf(options) {
    const value = typeof options.now === "function" ? options.now() : Date.now();
    return Number.isFinite(Number(value)) ? Number(value) : Date.now();
  }

  async function sendAttempt(send, payload, key, attempt, timeoutMs) {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller?.abort();
        const error = new Error("LINE_SEND_TIMEOUT");
        error.code = "LINE_SEND_TIMEOUT";
        error.status = 504;
        error.delivery = "uncertain";
        reject(error);
      }, timeoutMs);
    });
    try {
      return await Promise.race([
        Promise.resolve().then(() => send(payload, {
          provider: "line-messaging-api",
          idempotencyKey: key,
          attempt,
          signal: controller?.signal
        })),
        timeout
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  function isFreshPending(record, now, ttl) {
    if (record?.status !== "pending") return false;
    const startedAt = Number(record.startedAt);
    return Number.isFinite(startedAt) && now - startedAt < ttl;
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
    const now = nowOf(options);
    const existing = await options.idempotencyStore.get(key);
    if (existing?.status === "sent" || existing?.status === "accepted") {
      return Object.freeze({ contract: CONTRACT, status: "already_sent", idempotencyKey: key, mutation: "none" });
    }
    const pendingTtlMs = boundedNumber(options.pendingTtlMs, DEFAULT_PENDING_TTL_MS, MAX_TIMEOUT_MS * 10);
    if (isFreshPending(existing, now, pendingTtlMs)) {
      return Object.freeze({ contract: CONTRACT, status: "in_flight", idempotencyKey: key, mutation: "none" });
    }
    const payload = messagePayload(value, options);
    const pending = { status: "pending", startedAt: now };
    if (typeof options.idempotencyStore.claim === "function") {
      const claim = await options.idempotencyStore.claim(key, pending, {
        replaceIfStale: Boolean(existing?.status === "pending" && !isFreshPending(existing, now, pendingTtlMs))
      });
      if (claim?.status === "sent" || claim?.status === "accepted") {
        return Object.freeze({ contract: CONTRACT, status: "already_sent", idempotencyKey: key, mutation: "none" });
      }
      if (claim?.status === "pending" && claim.startedAt !== now) {
        return Object.freeze({ contract: CONTRACT, status: "in_flight", idempotencyKey: key, mutation: "none" });
      }
    } else {
      await options.idempotencyStore.put(key, pending);
    }

    const timeoutMs = boundedNumber(options.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    const maxRetries = boundedNumber(options.maxRetries, DEFAULT_MAX_RETRIES, MAX_MAX_RETRIES);
    let lastCode = "LINE_SEND_FAILED";
    let lastUncertain = false;
    for (let attempt = 1; attempt <= maxRetries + 1; attempt += 1) {
      try {
        const response = await sendAttempt(options.send, payload, key, attempt, timeoutMs);
        const accepted = response?.accepted !== false && response?.ok !== false;
        if (accepted) {
          await options.idempotencyStore.put(key, { status: "sent", sentAt: nowOf(options) });
          return Object.freeze({ contract: CONTRACT, status: "sent", idempotencyKey: key, mutation: "external-notification-only", attempts: attempt });
        }
        lastCode = errorCode(response, "LINE_SEND_REJECTED");
        lastUncertain = false;
        if (!retryable(response) || attempt > maxRetries) break;
      } catch (error) {
        lastCode = errorCode(error, "LINE_SEND_FAILED");
        lastUncertain = deliveryUncertain(error);
        if (!retryable(error) || lastUncertain || attempt > maxRetries) break;
      }
    }
    await options.idempotencyStore.put(key, { status: "failed", code: lastCode, delivery: lastUncertain ? "uncertain" : "rejected" });
    return Object.freeze({
      contract: CONTRACT,
      status: "failed",
      idempotencyKey: key,
      mutation: "none",
      errorCode: lastCode,
      delivery: lastUncertain ? "uncertain" : "rejected"
    });
  }

  return Object.freeze({
    CONTRACT,
    MAX_MESSAGE_CHARS,
    DEFAULT_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
    DEFAULT_MAX_RETRIES,
    MAX_MAX_RETRIES,
    messagePayload,
    sendReminder
  });
});
