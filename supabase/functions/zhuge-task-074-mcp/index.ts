/*
 * TASK-074 Remote MCP server.
 *
 * The function is a protected protocol adapter, not a second Board authority:
 * ChatGPT -> mTLS-authenticated proxy -> this MCP surface -> existing Broker
 * -> short-lived GPT Actor Token -> engineering-transition v36 -> canonical RPC.
 *
 * The public MCP URL must be the HTTPS mTLS proxy URL.  The raw Supabase
 * function URL is backend-only and is protected by the shared proxy secret.
 */

import {
  handleMcpRequest,
  McpHttpError,
  McpToolError,
  validateToolCall,
  type McpCall
} from "../_shared/task074-mcp-protocol.ts";

type JsonObject = Record<string, unknown>;

const BROKER_KEY_ID_DEFAULT = "chatgpt-engineering-connector-1";
const BROKER_CLOCK_SKEW_SECONDS = 90;
const BROKER_TTL_SECONDS = 300;
const PROXY_AUTH_HEADER = "x-zhuge-mcp-proxy-auth";

function text(value: unknown, maxLength = 240) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function envRequired(name: string) {
  const value = String(Deno.env.get(name) || "").trim();
  if (!value) throw new McpHttpError("MCP server configuration is unavailable.", 503, "MCP_CONFIGURATION_UNAVAILABLE");
  return value;
}

function jsonObject(raw: string, code: string) {
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("object required");
    return parsed as JsonObject;
  } catch {
    throw new McpHttpError("MCP server configuration is unavailable.", 503, code);
  }
}

function base64url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function base64urlBytes(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const decoded = atob(normalized);
  return Uint8Array.from(decoded, character => character.charCodeAt(0));
}

function uuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function equalSecret(left: string, right: string) {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  let result = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) result |= (leftBytes[index] || 0) ^ (rightBytes[index] || 0);
  return result === 0;
}

function authorizeMcpRequest(request: Request) {
  const expected = envRequired("MCP_TRUSTED_PROXY_SECRET");
  const supplied = String(request.headers.get(PROXY_AUTH_HEADER) || "");
  if (!supplied || !equalSecret(supplied, expected)) {
    throw new McpHttpError("MCP client authentication is required.", 401, "MCP_AUTH_REQUIRED", {
      "www-authenticate": "Mutual TLS is required at the public MCP proxy."
    });
  }
}

function brokerConfig() {
  const supabaseUrl = envRequired("SUPABASE_URL").replace(/\/$/, "");
  const brokerUrl = String(Deno.env.get("ENGINEERING_ACTOR_BROKER_URL") || `${supabaseUrl}/functions/v1/engineering-actor-broker`).replace(/\/$/, "");
  const transitionUrl = String(Deno.env.get("ENGINEERING_TRANSITION_URL") || `${supabaseUrl}/functions/v1/engineering-transition`).replace(/\/$/, "");
  if (!/^https:\/\//i.test(brokerUrl) || !/^https:\/\//i.test(transitionUrl)) {
    throw new McpHttpError("MCP downstream endpoints must use HTTPS.", 503, "MCP_CONFIGURATION_UNAVAILABLE");
  }
  const keyId = text(Deno.env.get("ENGINEERING_BROKER_CALLER_KEY_ID") || BROKER_KEY_ID_DEFAULT, 80);
  if (!/^[A-Za-z0-9._-]{1,80}$/.test(keyId)) {
    throw new McpHttpError("MCP Broker caller key id is invalid.", 503, "MCP_CONFIGURATION_UNAVAILABLE");
  }
  return {
    brokerUrl,
    transitionUrl,
    privateJwk: jsonObject(envRequired("ENGINEERING_BROKER_CALLER_PRIVATE_JWK"), "MCP_BROKER_CALLER_KEY_UNAVAILABLE"),
    keyId
  };
}

async function sha256Base64url(value: string) {
  return base64url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value))));
}

async function signBrokerRequest(body: string, configValue: ReturnType<typeof brokerConfig>) {
  const now = Math.floor(Date.now() / 1000);
  const requestId = crypto.randomUUID();
  const bodyHash = await sha256Base64url(body);
  const signingInput = `${now}.${requestId}.${bodyHash}`;
  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "jwk",
      configValue.privateJwk,
      { name: "ECDSA", namedCurve: "P-256" },
      false,
      ["sign"]
    );
  } catch {
    throw new McpToolError("Protected Broker caller key is unavailable.", "MCP_BROKER_CALLER_KEY_UNAVAILABLE");
  }
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(signingInput)
  );
  return {
    requestId,
    headers: {
      "content-type": "application/json",
      "x-zhuge-broker-key-id": configValue.keyId,
      "x-zhuge-broker-timestamp": String(now),
      "x-zhuge-broker-request-id": requestId,
      "x-zhuge-broker-signature": base64url(new Uint8Array(signature))
    }
  };
}

function safeCloudMessage(value: unknown) {
  const message = text(value, 300);
  if (!message || /token|private|service[_ -]?role|secret|password|certificate/i.test(message)) return "Protected lifecycle service rejected the request.";
  return message;
}

async function issueGptActorToken() {
  const configValue = brokerConfig();
  const body = JSON.stringify({
    actor: "GPT",
    profile: "transition",
    ttl_seconds: BROKER_TTL_SECONDS,
    purpose: "engineering-transition"
  });
  const signed = await signBrokerRequest(body, configValue);
  const response = await fetch(configValue.brokerUrl, { method: "POST", headers: signed.headers, body });
  let parsed: JsonObject | null = null;
  try {
    const raw = await response.text();
    parsed = raw ? JSON.parse(raw) as JsonObject : null;
  } catch {
    parsed = null;
  }
  const actorToken = text(parsed?.token, 4096);
  if (!response.ok || !actorToken) {
    throw new McpToolError(safeCloudMessage(parsed?.error), `MCP_BROKER_${text(parsed?.code || "UNAVAILABLE", 80)}`);
  }
  return { configValue, actorToken };
}

function sanitizedValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sanitizedValue);
  if (!value || typeof value !== "object") return value;
  const result: JsonObject = {};
  for (const [key, nested] of Object.entries(value as JsonObject)) {
    if (/^(token|access_token|actor_token|authorization|private_jwk|service_role_key|certificate|password)$/i.test(key)) continue;
    result[key] = sanitizedValue(nested);
  }
  return result;
}

async function callEngineeringTransition(payload: JsonObject) {
  const issued = await issueGptActorToken();
  const response = await fetch(issued.configValue.transitionUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${issued.actorToken}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ actor: "GPT", ...payload })
  });
  let parsed: JsonObject | null = null;
  try {
    const raw = await response.text();
    parsed = raw ? JSON.parse(raw) as JsonObject : null;
  } catch {
    parsed = null;
  }
  if (!response.ok) throw new McpToolError(safeCloudMessage(parsed?.error || parsed?.message), `MCP_TRANSITION_${text(parsed?.code || "FAILED", 80)}`);
  return sanitizedValue(parsed);
}

async function callTool(call: McpCall) {
  const args = validateToolCall(call) as Record<string, unknown>;
  switch (call.name) {
    case "task074_gpt_claim":
      return callEngineeringTransition({
        operation: "claim_specific_gpt",
        task: args.task,
        stage: args.stage,
        idempotencyKey: args.idempotencyKey,
        leaseSeconds: args.leaseSeconds
      });
    case "task074_plan_handoff_co":
      return callEngineeringTransition({
        operation: "plan_handoff_co",
        task: args.task,
        claimToken: args.claimToken,
        idempotencyKey: args.idempotencyKey,
        plan: args.plan
      });
    case "task074_gpt_review":
      return callEngineeringTransition({
        operation: "engineering_review",
        task: args.task,
        reviewState: args.reviewState,
        nextGate: args.nextGate,
        claimToken: args.claimToken,
        idempotencyKey: args.idempotencyKey,
        reviewNote: args.reviewNote,
        evidenceRef: args.evidenceRef,
        regressionNote: args.regressionNote,
        regressionRef: args.regressionRef
      });
    case "task074_inspect":
      return callEngineeringTransition({ operation: "inspect", task: args.task });
    case "task074_renew_gpt_claim":
      return callEngineeringTransition({
        operation: "renew_gpt_claim",
        claimToken: args.claimToken,
        leaseSeconds: args.leaseSeconds
      });
    case "task074_release_gpt_claim":
      return callEngineeringTransition({
        operation: "release_gpt_claim",
        claimToken: args.claimToken,
        reason: args.reason
      });
    default:
      throw new McpToolError("Tool is not part of the TASK-074 allowlist.", "MCP_TOOL_NOT_ALLOWLISTED");
  }
}

Deno.serve(async request => handleMcpRequest(request, { authorize: authorizeMcpRequest, callTool }));
