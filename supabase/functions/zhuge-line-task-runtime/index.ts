/*
 * TASK-094 protected LINE Task Runtime.
 *
 * Custom-authenticated webhook: LINE channel-secret HMAC is the only inbound
 * provider authentication.  Supabase service-role access is server-only and
 * is used only to call the service-role-only identity/canonical Board RPCs.
 * No provider credential, token, raw webhook, or raw RPC response is returned.
 */

await import("./shared/line/line-task-adapter.js");
await import("./shared/line/line-reminder-contract.js");
await import("./shared/line/line-webhook-handler.js");
await import("./shared/line/line-messaging-adapter.js");
await import("./shared/line/line-runtime-contract.js");

const CONTRACT = "zhuge-line-task-runtime-v1";
const MAX_BODY_CHARS = 256_000;
const DEFAULT_ORIGIN = "https://qqweasdzxc.github.io";
const RPC_REJECTED = "CANONICAL_RPC_REJECTED";

type JsonObject = Record<string, unknown>;

class RuntimeError extends Error {
  status: number;
  code: string;
  category: string;
  constructor(code: string, message: string, status = 500, category = "runtime") {
    super(message);
    this.code = code;
    this.status = status;
    this.category = category;
  }
}

function text(value: unknown, max = 500) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
}

function headers() {
  return new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
}

function json(body: JsonObject, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: headers() });
}

function environment() {
  const values = {
    LINE_CHANNEL_SECRET: text(Deno.env.get("LINE_CHANNEL_SECRET"), 4096),
    LINE_CHANNEL_ACCESS_TOKEN: text(Deno.env.get("LINE_CHANNEL_ACCESS_TOKEN"), 4096),
    SUPABASE_URL: text(Deno.env.get("SUPABASE_URL"), 400).replace(/\/$/, ""),
    SUPABASE_SERVICE_ROLE_KEY: text(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), 4096),
    LINE_LIFF_TASK_BASE_URL: text(Deno.env.get("LINE_LIFF_TASK_BASE_URL"), 1000)
  };
  return values;
}

function providerState(env = environment()) {
  return (globalThis as any).ZhugeLineRuntimeContract.providerState(env);
}

function runtimeState(env = environment()) {
  const provider = providerState(env);
  const databaseConfigured = Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
  return {
    contract: CONTRACT,
    status: provider.configured && databaseConfigured ? "ready" : "provider_not_configured",
    authentication: "LINE channel-secret HMAC-SHA256",
    provider: {
      configured: provider.configured,
      available: provider.available,
      error_category: provider.errorCategory
    },
    canonical_board: {
      configured: databaseConfigured,
      available: databaseConfigured ? "unknown" : "unavailable",
      error_category: databaseConfigured ? "NOT_PROBED" : "RUNTIME_CONFIGURATION_UNAVAILABLE"
    },
    webhook_idempotency: "durable-private-rpc-ledger",
    mutation_boundary: "service-role-only-canonical-board-rpc",
    browser_access: false,
    secrets_exposed: false,
    provider_calls: 0,
    product_data_mutation: false
  };
}

function requireRuntimeConfig(env = environment()) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new RuntimeError("RUNTIME_CONFIGURATION_UNAVAILABLE", "Protected server configuration is unavailable.", 503, "configuration");
  }
}

function requireProviderConfig(env = environment()) {
  if (!env.LINE_CHANNEL_SECRET || !env.LINE_CHANNEL_ACCESS_TOKEN) {
    throw new RuntimeError("PROVIDER_NOT_CONFIGURED", "LINE provider credentials are not configured.", 503, "provider");
  }
}

function safeRpcError(status: number) {
  if (status === 401 || status === 403) return "CANONICAL_AUTHORITY_REJECTED";
  if (status === 409) return "CANONICAL_IDEMPOTENCY_CONFLICT";
  if (status === 422) return "CANONICAL_ARGUMENT_REJECTED";
  return RPC_REJECTED;
}

async function rpc(name: string, args: JsonObject, env = environment()) {
  requireRuntimeConfig(env);
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      accept: "application/json"
    },
    body: JSON.stringify(args)
  });
  if (!response.ok) throw new RuntimeError(safeRpcError(response.status), "Canonical Board RPC rejected the request.", response.status >= 500 ? 503 : response.status, "canonical_authority");
  const payload = await response.json().catch(() => null);
  if (!payload || typeof payload !== "object") throw new RuntimeError("CANONICAL_RESPONSE_INVALID", "Canonical Board RPC returned an invalid response.", 502, "canonical_authority");
  return payload as JsonObject;
}

function commandPayload(parsed: JsonObject, event: JsonObject) {
  const identity = event.identity as JsonObject;
  return {
    p_line_subject: text(identity.subject, 200),
    p_subject_type: text(identity.subjectType, 40),
    p_event_id: text(event.eventId, 200),
    p_idempotency_key: text((globalThis as any).ZhugeLineTaskAdapter.idempotencyKey(event.eventId, parsed.command), 240),
    p_command: text(parsed.command, 80),
    p_title: text(parsed.title, 240) || null,
    p_content: text(parsed.content, 4000) || null,
    p_task_id: text(parsed.taskId, 80) || null,
    p_progress: Number.isInteger(parsed.progress) ? parsed.progress : null,
    p_reason: text(parsed.reason, 500) || null,
    p_due_at: text(parsed.dueAt, 80) || null
  };
}

async function resolveAndExecute(event: JsonObject, parsed: JsonObject, env: JsonObject) {
  const taskId = text(parsed.taskId, 80);
  const resolved = await rpc("line_resolve_subject", {
    p_line_subject: text((event.identity as JsonObject).subject, 200),
    p_subject_type: text((event.identity as JsonObject).subjectType, 40),
    p_task_id: taskId || null
  }, env);
  const resolution = {
    ...(resolved as JsonObject),
    verified: resolved.verified === true,
    authority: text(resolved.authority, 80),
    userId: text(resolved.userId, 120),
    boardInstanceId: text(resolved.boardInstanceId, 120),
    taskId: text(resolved.taskId, 120),
    subject: text(resolved.subject, 200),
    subjectType: text(resolved.subjectType, 40)
  };
  const handler = (globalThis as any).ZhugeLineWebhookHandler;
  return handler.dispatchCanonical({
    event,
    command: parsed.command,
    serverResolution: resolution,
    payload: {
      resolvedUserId: resolution.userId,
      boardInstanceId: resolution.boardInstanceId,
      taskId: resolution.taskId,
      title: parsed.title,
      content: parsed.content,
      progress: parsed.progress,
      reason: parsed.reason,
      dueAt: parsed.dueAt
    },
    execute: async () => {
      const result = await rpc("board_line_task_command_v1", commandPayload(parsed, event), env);
      return (globalThis as any).ZhugeLineRuntimeContract.sanitizeRpcResult(result);
    }
  });
}

function replyText(result: JsonObject) {
  const operation = text(result.operation, 80);
  const state = text(result.transportState || result.status, 80);
  const taskId = text(result.taskId, 120);
  const progress = Number.isInteger(result.progress) ? `｜進度 ${result.progress}%` : "";
  return `Zhuge AI OS\n${operation || "工作更新"}\n狀態：${state || "已受理"}${progress}${taskId ? `\nTask：${taskId}` : ""}`.slice(0, 800);
}

function taskDeepLink(taskId: string, baseUrl: string) {
  if (!taskId || !baseUrl) return "";
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== "https:") return "";
    url.searchParams.set("task", taskId);
    return url.toString().slice(0, 1000);
  } catch {
    return "";
  }
}

function replyMessages(result: JsonObject, env: JsonObject) {
  const taskId = text(result.taskId, 120);
  const messages: JsonObject[] = [{ type: "text", text: replyText(result) }];
  const deepLink = taskDeepLink(taskId, text(env.LINE_LIFF_TASK_BASE_URL, 1000));
  if (!deepLink) return messages;
  const adapter = (globalThis as any).ZhugeLineTaskAdapter;
  const card = adapter.flexTaskMessage({
    id: taskId,
    title: text(result.title, 120) || "工作更新",
    state: text(result.transportState || result.status, 80),
    progress: Number.isInteger(result.progress) ? result.progress : null
  }, { deepLink });
  messages.push(card);
  return messages;
}

async function sendReply(replyToken: string, result: JsonObject, env: JsonObject, eventId: string) {
  const messaging = (globalThis as any).ZhugeLineMessagingAdapter;
  if (!replyToken || !env.LINE_CHANNEL_ACCESS_TOKEN) return { status: "not_sent", reason: "PROVIDER_NOT_CONFIGURED" };
  const outcome = await messaging.sendReply(replyToken, replyMessages(result, env), {
    idempotencyKey: `line-reply-v1:${eventId}`,
    send: async (payload: JsonObject, options: JsonObject) => {
      const response = await fetch("https://api.line.me/v2/bot/message/reply", {
        method: "POST",
        headers: { authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`, "content-type": "application/json" },
        body: JSON.stringify(payload),
        signal: options.signal as AbortSignal
      });
      return { accepted: response.ok, status: response.status, retryable: response.status === 429 || response.status >= 500 };
    }
  });
  return { status: text(outcome.status, 40), error_category: text(outcome.errorCode, 80) || null };
}

Deno.serve(async request => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers() });
  const env = environment();
  if (request.method === "GET" && new URL(request.url).pathname.endsWith("/health")) return json(runtimeState(env));
  if (request.method !== "POST") return json({ code: "METHOD_NOT_ALLOWED", message: "POST is required." }, 405);

  try {
    requireProviderConfig(env);
    const rawBody = await request.text();
    if (rawBody.length > MAX_BODY_CHARS) throw new RuntimeError("LINE_PAYLOAD_TOO_LARGE", "LINE payload exceeds the read limit.", 413, "input");
    const signature = text(request.headers.get("x-line-signature"), 240);
    const handler = (globalThis as any).ZhugeLineWebhookHandler;
    const envelope = await handler.verifyAndNormalize({ rawBody, signature, channelSecret: env.LINE_CHANNEL_SECRET });
    const raw = JSON.parse(rawBody) as JsonObject;
    const rawEvents = Array.isArray(raw.events) ? raw.events : [];
    const results = [];
    let repliesSent = 0;
    for (let index = 0; index < envelope.events.length; index += 1) {
      const event = envelope.events[index] as JsonObject;
      const parsed = (globalThis as any).ZhugeLineRuntimeContract.parseCommandText((event.message as JsonObject)?.text);
      if (!parsed.ok) {
        results.push({ event_id: text(event.eventId, 200), accepted: false, code: parsed.code, mutation: "none" });
        continue;
      }
      if (parsed.command !== "create_task" && !parsed.taskId) {
        results.push({ event_id: text(event.eventId, 200), accepted: false, code: "LINE_TASK_CONTEXT_REQUIRED", mutation: "none" });
        continue;
      }
      try {
        const result = await resolveAndExecute(event, parsed, env);
        const sanitized = {
          event_id: text(event.eventId, 200),
          accepted: true,
          operation: text(result.operation, 80),
          idempotency_key: text(result.idempotencyKey, 240),
          status: text((result.result as JsonObject)?.status, 40),
          task_id: text((result.result as JsonObject)?.taskId, 120) || null,
          mutation: text((result.result as JsonObject)?.mutation, 80) || "none"
        };
        results.push(sanitized);
        const replyToken = text((rawEvents[index] as JsonObject)?.replyToken, 240);
        const reply = await sendReply(replyToken, sanitized, env, event.eventId);
        if (reply.status === "sent") repliesSent += 1;
      } catch (error) {
        const runtimeError = error instanceof RuntimeError ? error : null;
        results.push({ event_id: text(event.eventId, 200), accepted: false, code: runtimeError?.code || "LINE_COMMAND_REJECTED", error_category: runtimeError?.category || "canonical_authority", mutation: "none" });
      }
    }
    return json({
      contract: CONTRACT,
      signature_verified: true,
      event_count: results.length,
      accepted_count: results.filter(item => item.accepted === true).length,
      replies_sent: repliesSent,
      results,
      provider_calls: repliesSent,
      product_data_mutation: false,
      secrets_exposed: false
    });
  } catch (error) {
    if (error instanceof RuntimeError) return json({ code: error.code, message: error.message, error_category: error.category, mutation: "none", provider_calls: 0 }, error.status);
    return json({ code: "LINE_RUNTIME_FAILED", message: "LINE runtime rejected the request.", error_category: "runtime", mutation: "none", provider_calls: 0 }, 500);
  }
});
