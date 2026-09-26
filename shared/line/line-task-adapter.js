/*
 * Shared LINE Task Adapter contract.
 *
 * LINE is an interaction transport only.  This module never owns Board data,
 * Workflow, auth, or persistence.  A protected server adapter must resolve a
 * verified LINE subject to an authenticated Zhuge user and then call the
 * existing canonical Board RPC through its normal authority boundary.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeLineTaskAdapter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CONTRACT = "zhuge-line-task-adapter-v1";
  const PROGRESS_STEPS = Object.freeze([0, 25, 50, 75, 100]);
  const TASK_STATES = Object.freeze([
    "unassigned",
    "assigned",
    "in_progress",
    "blocked",
    "delayed",
    "completed"
  ]);
  const COMMANDS = Object.freeze([
    "create_task",
    "accept_task",
    "set_progress",
    "mark_blocked",
    "mark_delayed",
    "complete_task"
  ]);
  const MAX_TEXT = 500;
  const MAX_EVENT_ID = 200;

  function text(value, max = MAX_TEXT) {
    return String(value == null ? "" : value)
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .trim()
      .slice(0, max);
  }

  function object(value) {
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  }

  function first(value, fallback = "") {
    return text(value || fallback);
  }

  function normalizeProgress(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return Object.freeze({ ok: false, code: "PROGRESS_REQUIRED" });
    const rounded = Math.round(number);
    if (!PROGRESS_STEPS.includes(rounded)) {
      return Object.freeze({ ok: false, code: "PROGRESS_STEP_INVALID", allowed: [...PROGRESS_STEPS] });
    }
    return Object.freeze({ ok: true, value: rounded });
  }

  function normalizeState(value, fallback = "unassigned") {
    const raw = text(value, 40).toLowerCase().replace(/[ -]+/g, "_");
    const aliases = Object.freeze({
      todo: "unassigned",
      open: "unassigned",
      accepted: "assigned",
      working: "in_progress",
      blocked: "blocked",
      delayed: "delayed",
      done: "completed",
      complete: "completed"
    });
    const normalized = aliases[raw] || raw;
    return TASK_STATES.includes(normalized) ? normalized : fallback;
  }

  function sourceIdentity(source = {}) {
    const value = object(source);
    const type = first(value.type, "").toLowerCase();
    const id = first(value.userId || value.groupId || value.roomId, "");
    const subjectType = value.userId ? "user" : value.groupId ? "group" : value.roomId ? "room" : "unknown";
    return Object.freeze({
      provider: "line",
      subjectType,
      subject: id,
      sourceType: type || "unknown",
      verified: false
    });
  }

  function normalizeWebhookEvent(event = {}, options = {}) {
    const value = object(event);
    const message = object(value.message);
    const identity = sourceIdentity(value.source);
    const eventId = first(value.webhookEventId || value.eventId || options.eventId, "");
    const messageText = message.type === "text" ? text(message.text, 2000) : "";
    const verified = options.signatureVerified === true;
    const hasIdentity = Boolean(identity.subject && identity.subjectType !== "unknown");
    return Object.freeze({
      contract: CONTRACT,
      eventId: eventId.slice(0, MAX_EVENT_ID),
      eventType: first(value.type, "unknown"),
      timestamp: Number.isFinite(Number(value.timestamp)) ? Number(value.timestamp) : null,
      identity: Object.freeze({ ...identity, verified }),
      message: Object.freeze({
        type: first(message.type, "unknown"),
        text: messageText,
        hasText: Boolean(messageText)
      }),
      accepted: Boolean(eventId && hasIdentity && verified),
      rejectCode: !eventId ? "LINE_EVENT_ID_REQUIRED"
        : !hasIdentity ? "LINE_SOURCE_ID_REQUIRED"
          : !verified ? "LINE_SIGNATURE_UNVERIFIED" : ""
    });
  }

  function idempotencyKey(eventId, command) {
    const event = text(eventId, MAX_EVENT_ID);
    const action = text(command, 80).toLowerCase();
    if (!event || !COMMANDS.includes(action)) return "";
    return `line-task-v1:${event}:${action}`.slice(0, 240);
  }

  function commandState(command) {
    return Object.freeze({
      create_task: "unassigned",
      accept_task: "assigned",
      set_progress: "in_progress",
      mark_blocked: "blocked",
      mark_delayed: "delayed",
      complete_task: "completed"
    })[command] || "unassigned";
  }

  function commandEvidence(value, command, progress) {
    const reason = text(value.reason || value.blockReason || value.delayReason, 500);
    const dueAt = text(value.dueAt || value.due_at, 80);
    if (command === "set_progress" && !progress) {
      const error = new Error("LINE progress update requires an explicit progress value.");
      error.code = "LINE_PROGRESS_REQUIRED";
      throw error;
    }
    if (command === "mark_blocked" && !reason) {
      const error = new Error("A blocked Task requires an explicit reason.");
      error.code = "LINE_BLOCK_REASON_REQUIRED";
      throw error;
    }
    if (command === "mark_delayed" && (!reason || !dueAt)) {
      const error = new Error("A delayed Task requires an explicit reason and due date.");
      error.code = "LINE_DELAY_EVIDENCE_REQUIRED";
      throw error;
    }
    if (command === "mark_delayed" && !Number.isFinite(Date.parse(dueAt))) {
      const error = new Error("A delayed Task requires a valid due date.");
      error.code = "LINE_DELAY_DATE_INVALID";
      throw error;
    }
    if (command === "complete_task" && progress?.value !== 100) {
      const error = new Error("A completed Task requires explicit 100% progress.");
      error.code = "LINE_COMPLETION_PROGRESS_REQUIRED";
      throw error;
    }
    return Object.freeze({ reason, dueAt });
  }

  function requireVerifiedEvent(event) {
    if (!event?.accepted || event.identity?.verified !== true) {
      const error = new Error("Verified LINE event is required before a canonical Task command can be created.");
      error.code = event?.rejectCode || "LINE_EVENT_UNVERIFIED";
      throw error;
    }
    if (!event.eventId) {
      const error = new Error("LINE webhook event id is required for idempotency.");
      error.code = "LINE_EVENT_ID_REQUIRED";
      throw error;
    }
  }

  function requireServerResolution(value, event, command) {
    const resolution = object(value.serverResolution || value.authorityResolution);
    const userId = first(resolution.userId || resolution.user_id, "");
    const boardInstanceId = first(resolution.boardInstanceId || resolution.board_instance_id, "");
    const taskId = first(resolution.taskId || resolution.task_id, "");
    const subject = first(resolution.subject || resolution.lineSubject || resolution.line_subject, "");
    const subjectType = first(resolution.subjectType || resolution.subject_type, "").toLowerCase();
    if (resolution.verified !== true || resolution.authority !== "canonical-board-scope") {
      const error = new Error("A verified server-side Board scope resolution is required before a LINE command can be created.");
      error.code = "LINE_SERVER_RESOLUTION_REQUIRED";
      throw error;
    }
    if (!userId || !boardInstanceId || !subject || !subjectType) {
      const error = new Error("The server-side LINE identity and Board scope resolution is incomplete.");
      error.code = "LINE_SERVER_RESOLUTION_INCOMPLETE";
      throw error;
    }
    if (subject !== event.identity.subject || subjectType !== event.identity.subjectType) {
      const error = new Error("The server-side resolution is not bound to the verified LINE subject.");
      error.code = "LINE_RESOLUTION_SUBJECT_MISMATCH";
      throw error;
    }
    if (command === "create_task" && taskId) {
      const error = new Error("A create command cannot carry an existing server-resolved Task id.");
      error.code = "LINE_CREATE_TASK_RESOLUTION_INVALID";
      throw error;
    }
    if (command !== "create_task" && !taskId) {
      const error = new Error("Existing canonical Task resolution is required for this LINE command.");
      error.code = "LINE_RESOLVED_TASK_REQUIRED";
      throw error;
    }
    return Object.freeze({ userId, boardInstanceId, taskId, subject, subjectType });
  }

  function canonicalCommand(input = {}) {
    const value = object(input);
    const event = value.event;
    requireVerifiedEvent(event);
    const command = text(value.command, 80).toLowerCase();
    if (!COMMANDS.includes(command)) {
      const error = new Error("LINE command is not allowlisted.");
      error.code = "LINE_COMMAND_NOT_ALLOWED";
      throw error;
    }
    const resolution = requireServerResolution(value, event, command);
    const suppliedUserId = first(value.resolvedUserId, "");
    const suppliedBoardInstanceId = first(value.boardInstanceId, "");
    const suppliedTaskId = first(value.taskId, "");
    if ((suppliedUserId && suppliedUserId !== resolution.userId)
      || (suppliedBoardInstanceId && suppliedBoardInstanceId !== resolution.boardInstanceId)
      || (suppliedTaskId && suppliedTaskId !== resolution.taskId)) {
      const error = new Error("Caller-provided identity or Task scope does not match the verified server resolution.");
      error.code = "LINE_RESOLUTION_MISMATCH";
      throw error;
    }
    const progress = value.progress == null ? null : normalizeProgress(value.progress);
    if (progress && !progress.ok) {
      const error = new Error("Progress must be one of 0, 25, 50, 75, or 100 percent.");
      error.code = progress.code;
      error.allowed = progress.allowed;
      throw error;
    }
    const evidence = commandEvidence(value, command, progress);
    const taskId = resolution.taskId;
    const payload = {
      board_instance_id: resolution.boardInstanceId,
      task_id: taskId || null,
      title: command === "create_task" ? text(value.title, 240) : null,
      content: command === "create_task" ? text(value.content, 4000) : null,
      // LINE may request a command, but it never chooses the resulting state.
      // The canonical command itself is the only state transition selector.
      state: commandState(command),
      progress: progress ? progress.value : null,
      reason: evidence.reason || null,
      due_at: evidence.dueAt || null,
      source: "line",
      line_subject_type: event.identity.subjectType
    };
    if (command === "create_task" && !payload.title) {
      const error = new Error("A title is required to create a canonical Task.");
      error.code = "LINE_TASK_TITLE_REQUIRED";
      throw error;
    }
    return Object.freeze({
      contract: CONTRACT,
      operation: command,
      actor: Object.freeze({ userId: resolution.userId, provider: "line", subjectType: event.identity.subjectType }),
      idempotencyKey: idempotencyKey(event.eventId, command),
      payload: Object.freeze(payload),
      authority: "canonical-board-rpc",
      persistence: "server-only",
      audit: Object.freeze({ eventId: event.eventId, provider: "line" })
    });
  }

  function flexTaskCard(task = {}, options = {}) {
    const value = object(task);
    const taskId = first(value.id || value.taskId, "");
    const title = text(value.title || "未命名工作", 120);
    const progress = normalizeProgress(value.progress == null ? 0 : value.progress);
    const progressLabel = progress.ok ? `${progress.value}%` : "資料不足";
    const state = normalizeState(value.state || value.status);
    const label = Object.freeze({
      unassigned: "待接單",
      assigned: "已接單",
      in_progress: "進行中",
      blocked: "卡關",
      delayed: "延期",
      completed: "完成"
    })[state] || "狀態未知";
    const deepLink = text(options.deepLink, 1000);
    return Object.freeze({
      type: "flex_task_card",
      altText: `${title}｜${label}｜${progressLabel}`,
      taskId,
      title,
      state,
      stateLabel: label,
      progress: progress.ok ? progress.value : null,
      progressLabel,
      deepLink: deepLink || null,
      mutation: "none"
    });
  }

  function flexTaskMessage(task = {}, options = {}) {
    const card = flexTaskCard(task, options);
    const bodyContents = [
      Object.freeze({ type: "text", text: card.title, weight: "bold", size: "md", wrap: true }),
      Object.freeze({ type: "text", text: `狀態：${card.stateLabel}`, size: "sm", color: "#5f6368", margin: "md" }),
      Object.freeze({ type: "text", text: `進度：${card.progressLabel}`, size: "sm", color: "#5f6368", margin: "sm" })
    ];
    const bubble = {
      type: "bubble",
      size: "kilo",
      body: Object.freeze({ type: "box", layout: "vertical", spacing: "sm", contents: Object.freeze(bodyContents) })
    };
    if (card.deepLink) {
      bubble.footer = Object.freeze({
        type: "box",
        layout: "vertical",
        contents: Object.freeze([Object.freeze({
          type: "button",
          style: "primary",
          action: Object.freeze({ type: "uri", label: "開啟 Zhuge", uri: card.deepLink })
        })])
      });
    }
    return Object.freeze({
      type: "flex",
      altText: card.altText,
      contents: Object.freeze(bubble),
      mutation: "none"
    });
  }

  async function verifySignature(body, signature, channelSecret, cryptoImpl) {
    const secret = text(channelSecret, 200);
    const supplied = text(signature, 200);
    const cryptoValue = cryptoImpl || (typeof globalThis !== "undefined" ? globalThis.crypto : null);
    if (!secret || !supplied || !cryptoValue?.subtle) return false;
    const key = await cryptoValue.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const digest = await cryptoValue.subtle.sign("HMAC", key, new TextEncoder().encode(String(body || "")));
    let binary = "";
    for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
    const expected = typeof btoa === "function" ? btoa(binary) : Buffer.from(binary, "binary").toString("base64");
    if (expected.length !== supplied.length) return false;
    let diff = 0;
    for (let index = 0; index < expected.length; index += 1) diff |= expected.charCodeAt(index) ^ supplied.charCodeAt(index);
    return diff === 0;
  }

  return Object.freeze({
    CONTRACT,
    PROGRESS_STEPS,
    TASK_STATES,
    COMMANDS,
    normalizeProgress,
    normalizeState,
    normalizeWebhookEvent,
    idempotencyKey,
    canonicalCommand,
    flexTaskCard,
    flexTaskMessage,
    verifySignature
  });
});
