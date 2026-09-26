/*
 * Server-side LINE webhook boundary.
 *
 * This module is intentionally transport-only. It verifies the LINE signature,
 * normalizes events, and delegates Board scope resolution plus canonical RPC
 * execution to injected server functions. It never owns Task state, auth, or
 * persistence and never accepts a client-supplied user/Board scope.
 */
(function (root, factory) {
  const api = factory(root?.ZhugeLineTaskAdapter || (typeof require === "function" ? require("./line-task-adapter.js") : null));
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeLineWebhookHandler = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (adapter) {
  "use strict";

  const CONTRACT = "zhuge-line-webhook-handler-v1";

  function text(value, max = 2000) {
    return String(value == null ? "" : value).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
  }

  function reject(code, status = 400) {
    const error = new Error(code);
    error.code = code;
    error.status = status;
    return error;
  }

  function parseBody(rawBody) {
    try {
      const parsed = typeof rawBody === "string" ? JSON.parse(rawBody) : rawBody;
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.events)) throw reject("LINE_PAYLOAD_INVALID");
      return parsed;
    } catch (error) {
      if (error?.code === "LINE_PAYLOAD_INVALID") throw error;
      throw reject("LINE_PAYLOAD_INVALID");
    }
  }

  async function verifyAndNormalize({ rawBody = "", signature = "", channelSecret = "", cryptoImpl } = {}) {
    if (!adapter?.verifySignature) throw reject("LINE_ADAPTER_UNAVAILABLE", 500);
    if (!(await adapter.verifySignature(rawBody, signature, channelSecret, cryptoImpl))) throw reject("LINE_SIGNATURE_INVALID", 401);
    const payload = parseBody(rawBody);
    const events = payload.events.map((event, index) => {
      const normalized = adapter.normalizeWebhookEvent(event, { signatureVerified: true, eventId: event?.webhookEventId || `event-${index}` });
      if (!normalized.accepted) throw reject(normalized.rejectCode || "LINE_EVENT_REJECTED", 400);
      return normalized;
    });
    return Object.freeze({ contract: CONTRACT, accepted: true, eventCount: events.length, events: Object.freeze(events) });
  }

  async function dispatchCanonical({ event, command, serverResolution, payload = {}, execute }) {
    if (!event?.accepted || event.identity?.verified !== true) throw reject("LINE_EVENT_UNVERIFIED", 401);
    if (typeof execute !== "function") throw reject("LINE_CANONICAL_EXECUTOR_UNAVAILABLE", 500);
    const canonical = adapter.canonicalCommand({ event, command, serverResolution, ...payload });
    const result = await execute(canonical);
    return Object.freeze({
      contract: CONTRACT,
      accepted: true,
      operation: canonical.operation,
      idempotencyKey: canonical.idempotencyKey,
      authority: canonical.authority,
      result: result && typeof result === "object" ? {
        accepted: result.accepted !== false,
        status: text(result.status || result.state || "accepted", 40),
        taskId: text(result.taskId || result.task_id, 120) || null
      } : { accepted: true, status: "accepted", taskId: null }
    });
  }

  return Object.freeze({ CONTRACT, verifyAndNormalize, dispatchCanonical });
});
