/* Pure, bounded helpers for the protected TASK-094 runtime. */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeLineRuntimeContract = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CONTRACT = "zhuge-line-task-runtime-v1";
  const COMMANDS = Object.freeze([
    "create_task",
    "accept_task",
    "set_progress",
    "mark_blocked",
    "mark_delayed",
    "complete_task"
  ]);
  const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";

  function text(value, max = 500) {
    return String(value == null ? "" : value)
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .trim()
      .slice(0, max);
  }

  function taskIdFromText(value) {
    const match = text(value, 2000).match(new RegExp(`(?:task(?:_id)?|任務)\\s*[:=：]\\s*(${UUID})`, "i"));
    return match ? match[1] : "";
  }

  function parseCommandText(value) {
    const input = text(value, 2000);
    if (!input) return Object.freeze({ ok: false, code: "LINE_COMMAND_REQUIRED" });
    const taskId = taskIdFromText(input);
    const withoutContext = input.replace(new RegExp(`(?:task(?:_id)?|任務)\\s*[:=：]\\s*${UUID}`, "i"), "").trim();
    let match = withoutContext.match(/^(?:建立|新增)(?:工作|任務)?\s*[:：]\s*(.+)$/i);
    if (match) return Object.freeze({ ok: true, command: "create_task", title: text(match[1], 240), content: "", taskId: "" });
    if (/^(?:接單|接单)$/i.test(withoutContext)) return Object.freeze({ ok: true, command: "accept_task", taskId });
    match = withoutContext.match(/^(?:進度|进度)\s*[:：]?\s*(0|25|50|75|100)\s*%?$/i);
    if (match) return Object.freeze({ ok: true, command: "set_progress", progress: Number(match[1]), taskId });
    match = withoutContext.match(/^(?:卡關|卡关)\s*[:：]\s*(.+)$/i);
    if (match) return Object.freeze({ ok: true, command: "mark_blocked", reason: text(match[1], 500), taskId });
    match = withoutContext.match(/^(?:延期)\s*[:：]\s*(\d{4}-\d{2}-\d{2})\s*[|｜,，]\s*(.+)$/i);
    if (match) return Object.freeze({ ok: true, command: "mark_delayed", dueAt: `${match[1]}T09:00:00+08:00`, reason: text(match[2], 500), taskId });
    if (/^(?:完成|完成了)$/i.test(withoutContext)) return Object.freeze({ ok: true, command: "complete_task", progress: 100, taskId });
    return Object.freeze({ ok: false, code: "LINE_COMMAND_NOT_RECOGNIZED" });
  }

  function providerState(env = {}) {
    const required = Object.freeze(["LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN"]);
    const configured = required.every(name => Boolean(text(env[name], 4096)));
    return Object.freeze({
      configured,
      available: configured ? "unknown" : "unavailable",
      errorCategory: configured ? "NOT_PROBED" : "PROVIDER_NOT_CONFIGURED",
      secretNames: required
    });
  }

  function sanitizeRpcResult(value) {
    const input = value && typeof value === "object" ? value : {};
    return Object.freeze({
      status: text(input.status || "accepted", 40),
      operation: text(input.operation, 80),
      taskId: text(input.task_id || input.taskId, 120) || null,
      canonicalStatus: text(input.canonical_status, 60) || null,
      transportState: text(input.transport_state, 60) || null,
      progress: Number.isInteger(input.progress) ? input.progress : null,
      idempotencyKey: text(input.idempotency_key || input.idempotencyKey, 240) || null,
      mutation: text(input.mutation, 80) || "none"
    });
  }

  return Object.freeze({ CONTRACT, COMMANDS, parseCommandText, providerState, sanitizeRpcResult, taskIdFromText });
});
