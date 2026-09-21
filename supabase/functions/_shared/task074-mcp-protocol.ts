/**
 * TASK-074 Streamable HTTP MCP protocol surface.
 *
 * This module is transport-only.  It deliberately does not know how the
 * protected caller is authenticated or how a lifecycle operation is executed.
 * The Edge entrypoint supplies those two dependencies so the protocol cannot
 * accidentally become a second Board authority.
 */

export const MCP_PROTOCOL_VERSION = "2025-11-25";
export const MCP_MODERN_PROTOCOL_VERSION = "2026-07-28";
export const MCP_SERVER_NAME = "zhuge-task-074-mcp";
export const MCP_SERVER_VERSION = "1.0.0";
export const MCP_PATH = "/mcp";
export const MAX_MCP_REQUEST_BYTES = 32 * 1024;
export const MAX_TOOL_ARGUMENT_BYTES = 24 * 1024;

type JsonObject = Record<string, unknown>;
type JsonRpcId = string | number | null;

export type McpCall = {
  name: string;
  arguments: JsonObject;
};

export class McpHttpError extends Error {
  status: number;
  code: string;
  headers: Record<string, string>;

  constructor(message: string, status: number, code: string, headers: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

export class McpToolError extends Error {
  code: string;

  constructor(message: string, code = "MCP_TOOL_FAILED") {
    super(message);
    this.code = code;
  }
}

const TASK_CODE_PATTERN = /^TASK-[A-Z0-9][A-Z0-9-]{0,60}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_PATTERN = /^[A-Za-z0-9._:-]{8,200}$/;
const CLAIM_TOKEN_PATTERN = UUID_PATTERN;
const STAGES = new Set(["planning", "review"]);
const REVIEW_STATES = new Set(["pass", "rework"]);
const REVIEW_GATES = new Set(["pm_decision_required", "runtime_qa"]);
const PLAN_KEYS = new Set([
  "summary",
  "problem",
  "objective",
  "proposed_solution",
  "related_work",
  "acceptance_criteria",
  "developer_notes",
  "usage_scenario"
]);

const text = (value: unknown, maxLength: number) => String(value ?? "").trim().slice(0, maxLength);

const toolAnnotations = Object.freeze({
  openWorldHint: false,
  destructiveHint: false,
  idempotentHint: true
});

export const MCP_TOOLS = Object.freeze([
  {
    name: "task074_gpt_claim",
    description: "Claim one explicitly named TASK-xxx for the bounded GPT planning or review stage. Uses the canonical TASK-074 claim ledger and workflow binding.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        task: { type: "string", pattern: "^TASK-[A-Z0-9][A-Z0-9-]{0,60}$" },
        stage: { type: "string", enum: ["planning", "review"] },
        idempotency_key: { type: "string", minLength: 8, maxLength: 200 },
        lease_seconds: { type: "integer", minimum: 60, maximum: 86400 }
      },
      required: ["task", "stage", "idempotency_key"]
    },
    annotations: { ...toolAnnotations, readOnlyHint: false }
  },
  {
    name: "task074_plan_handoff_co",
    description: "Submit the bounded GPT plan and return the named TASK to the canonical Co queue. The existing GPT claim token is required.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        task: { type: "string", pattern: "^TASK-[A-Z0-9][A-Z0-9-]{0,60}$" },
        claim_token: { type: "string", format: "uuid" },
        idempotency_key: { type: "string", minLength: 8, maxLength: 200 },
        plan: {
          type: "object",
          additionalProperties: false,
          properties: {
            summary: { type: "string", maxLength: 12000 },
            problem: { type: "string", maxLength: 12000 },
            objective: { type: "string", maxLength: 12000 },
            proposed_solution: { type: "string", maxLength: 12000 },
            related_work: { type: "string", maxLength: 12000 },
            acceptance_criteria: { type: "string", maxLength: 12000 },
            developer_notes: { type: "string", maxLength: 12000 },
            usage_scenario: { type: "string", maxLength: 12000 }
          },
          required: ["objective", "proposed_solution", "acceptance_criteria"]
        }
      },
      required: ["task", "claim_token", "idempotency_key", "plan"]
    },
    annotations: { ...toolAnnotations, readOnlyHint: false }
  },
  {
    name: "task074_gpt_review",
    description: "Record the canonical GPT Review PASS or REWORK for one explicitly named TASK-xxx. PASS must name pm_decision_required or runtime_qa; REWORK returns the task to Co.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        task: { type: "string", pattern: "^TASK-[A-Z0-9][A-Z0-9-]{0,60}$" },
        review_state: { type: "string", enum: ["pass", "rework"] },
        next_gate: { type: "string", enum: ["pm_decision_required", "runtime_qa"] },
        claim_token: { type: "string", format: "uuid" },
        idempotency_key: { type: "string", minLength: 8, maxLength: 200 },
        review_note: { type: "string", maxLength: 12000 },
        evidence_ref: { type: "string", maxLength: 500 },
        regression_note: { type: "string", maxLength: 12000 },
        regression_ref: { type: "string", maxLength: 500 }
      },
      required: ["task", "review_state", "claim_token", "idempotency_key"]
    },
    annotations: { ...toolAnnotations, readOnlyHint: false }
  },
  {
    name: "task074_runtime_qa",
    description: "Expose the canonical QJC Runtime QA action contract for discovery. Execution remains a human QJC gate and fails closed on the GPT-only MCP actor surface.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        task: { type: "string", pattern: "^TASK-[A-Z0-9][A-Z0-9-]{0,60}$" },
        qa_state: { type: "string", enum: ["pass", "rework"] },
        evidence_note: { type: "string", maxLength: 12000 },
        evidence_ref: { type: "string", maxLength: 1000 },
        idempotency_key: { type: "string", minLength: 8, maxLength: 200 },
        transition_key: { type: "string", maxLength: 160 }
      },
      required: ["task", "qa_state", "idempotency_key"]
    },
    annotations: { ...toolAnnotations, readOnlyHint: false }
  },
  {
    name: "task074_inspect",
    description: "Read the canonical task state and recent activity for one explicitly named TASK-xxx. Does not create or change Board data.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { task: { type: "string", pattern: "^TASK-[A-Z0-9][A-Z0-9-]{0,60}$" } },
      required: ["task"]
    },
    annotations: { ...toolAnnotations, readOnlyHint: true, idempotentHint: true }
  },
  {
    name: "task074_renew_gpt_claim",
    description: "Renew an active GPT planning or review lease through the canonical claim ledger.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        claim_token: { type: "string", format: "uuid" },
        lease_seconds: { type: "integer", minimum: 60, maximum: 86400 }
      },
      required: ["claim_token"]
    },
    annotations: { ...toolAnnotations, readOnlyHint: false }
  },
  {
    name: "task074_release_gpt_claim",
    description: "Release the current GPT claim through the canonical claim ledger with an auditable reason.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        claim_token: { type: "string", format: "uuid" },
        reason: { type: "string", maxLength: 1000 }
      },
      required: ["claim_token", "reason"]
    },
    annotations: { ...toolAnnotations, readOnlyHint: false }
  }
]);

function jsonHeaders(extra: Record<string, string> = {}) {
  return {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...extra
  };
}

function jsonResponse(body: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders(extraHeaders) });
}

function jsonRpc(id: JsonRpcId, result: unknown) {
  return jsonResponse({ jsonrpc: "2.0", id, result });
}

function modernResult(id: JsonRpcId, result: JsonObject) {
  return jsonRpc(id, {
    ...result,
    resultType: "complete",
    _meta: {
      "io.modelcontextprotocol/serverInfo": {
        name: MCP_SERVER_NAME,
        version: MCP_SERVER_VERSION
      }
    }
  });
}

function jsonRpcError(id: JsonRpcId, code: number, message: string, data?: unknown) {
  const error: JsonObject = { code, message };
  if (data !== undefined) error.data = data;
  return jsonResponse({ jsonrpc: "2.0", id, error });
}

function invalidRequest(id: JsonRpcId = null) {
  return jsonRpcError(id, -32600, "Invalid Request.");
}

function isObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function byteLength(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function boundedString(value: unknown, name: string, maxLength: number) {
  const result = text(value, maxLength);
  if (!result) throw new McpToolError(`${name} is required.`, "MCP_ARGUMENT_INVALID");
  return result;
}

function taskCode(value: unknown) {
  const task = boundedString(value, "task", 80);
  if (!TASK_CODE_PATTERN.test(task)) throw new McpToolError("task must be an explicit TASK-xxx code.", "MCP_ARGUMENT_INVALID");
  return task;
}

function idempotencyKey(value: unknown) {
  const key = boundedString(value, "idempotency_key", 200);
  if (!IDEMPOTENCY_PATTERN.test(key)) throw new McpToolError("idempotency_key contains unsupported characters or is out of bounds.", "MCP_ARGUMENT_INVALID");
  return key;
}

function claimToken(value: unknown) {
  const token = boundedString(value, "claim_token", 80);
  if (!CLAIM_TOKEN_PATTERN.test(token)) throw new McpToolError("claim_token must be a UUID.", "MCP_ARGUMENT_INVALID");
  return token;
}

function leaseSeconds(value: unknown, fallback = 900) {
  if (value === undefined || value === null || value === "") return fallback;
  const lease = Number(value);
  if (!Number.isInteger(lease) || lease < 60 || lease > 86400) {
    throw new McpToolError("lease_seconds must be an integer between 60 and 86400.", "MCP_ARGUMENT_INVALID");
  }
  return lease;
}

function plan(value: unknown) {
  if (!isObject(value)) throw new McpToolError("plan must be a JSON object.", "MCP_ARGUMENT_INVALID");
  if (Object.keys(value).some(key => !PLAN_KEYS.has(key))) {
    throw new McpToolError("plan contains a field outside the canonical allowlist.", "MCP_ARGUMENT_INVALID");
  }
  const result: JsonObject = {};
  for (const key of PLAN_KEYS) {
    if (value[key] !== undefined) result[key] = boundedString(value[key], `plan.${key}`, 12000);
  }
  if (!result.objective || !result.proposed_solution || !result.acceptance_criteria) {
    throw new McpToolError("plan requires objective, proposed_solution and acceptance_criteria.", "MCP_ARGUMENT_INVALID");
  }
  if (byteLength(JSON.stringify(result)) > 24 * 1024) {
    throw new McpToolError("plan exceeds the bounded payload size.", "MCP_ARGUMENT_INVALID");
  }
  return result;
}

export function validateToolCall(call: McpCall) {
  if (!isObject(call) || typeof call.name !== "string" || !isObject(call.arguments)) {
    throw new McpToolError("tools/call requires a tool name and object arguments.", "MCP_ARGUMENT_INVALID");
  }
  const args = call.arguments;
  switch (call.name) {
    case "task074_gpt_claim":
      return {
        task: taskCode(args.task),
        stage: (() => {
          const stage = boundedString(args.stage, "stage", 20).toLowerCase();
          if (!STAGES.has(stage)) throw new McpToolError("stage must be planning or review.", "MCP_ARGUMENT_INVALID");
          return stage;
        })(),
        idempotencyKey: idempotencyKey(args.idempotency_key),
        leaseSeconds: leaseSeconds(args.lease_seconds)
      };
    case "task074_plan_handoff_co":
      return {
        task: taskCode(args.task),
        claimToken: claimToken(args.claim_token),
        idempotencyKey: idempotencyKey(args.idempotency_key),
        plan: plan(args.plan)
      };
    case "task074_gpt_review": {
      const reviewState = boundedString(args.review_state, "review_state", 20).toLowerCase();
      if (!REVIEW_STATES.has(reviewState)) throw new McpToolError("review_state must be pass or rework.", "MCP_ARGUMENT_INVALID");
      const nextGate = args.next_gate === undefined || args.next_gate === null || args.next_gate === ""
        ? null
        : boundedString(args.next_gate, "next_gate", 40).toLowerCase();
      if (reviewState === "pass" && !nextGate) throw new McpToolError("PASS requires next_gate.", "MCP_ARGUMENT_INVALID");
      if (nextGate && !REVIEW_GATES.has(nextGate)) throw new McpToolError("next_gate is not allowlisted.", "MCP_ARGUMENT_INVALID");
      if (reviewState === "rework" && nextGate) throw new McpToolError("REWORK cannot specify next_gate.", "MCP_ARGUMENT_INVALID");
      const result = {
        task: taskCode(args.task),
        reviewState,
        nextGate,
        claimToken: claimToken(args.claim_token),
        idempotencyKey: idempotencyKey(args.idempotency_key),
        reviewNote: args.review_note ? boundedString(args.review_note, "review_note", 12000) : null,
        evidenceRef: args.evidence_ref ? boundedString(args.evidence_ref, "evidence_ref", 500) : null,
        regressionNote: args.regression_note ? boundedString(args.regression_note, "regression_note", 12000) : null,
        regressionRef: args.regression_ref ? boundedString(args.regression_ref, "regression_ref", 500) : null
      };
      if (!result.reviewNote && !result.evidenceRef) throw new McpToolError("Review evidence is required.", "MCP_ARGUMENT_INVALID");
      if (reviewState === "pass" && !result.regressionNote && !result.regressionRef) {
        throw new McpToolError("PASS requires regression evidence.", "MCP_ARGUMENT_INVALID");
      }
      return result;
    }
    case "task074_runtime_qa": {
      const qaState = boundedString(args.qa_state, "qa_state", 20).toLowerCase();
      if (!REVIEW_STATES.has(qaState)) throw new McpToolError("qa_state must be pass or rework.", "MCP_ARGUMENT_INVALID");
      const evidenceNote = args.evidence_note ? boundedString(args.evidence_note, "evidence_note", 12000) : null;
      const evidenceRef = args.evidence_ref ? boundedString(args.evidence_ref, "evidence_ref", 1000) : null;
      if (!evidenceNote && !evidenceRef) throw new McpToolError("Runtime QA evidence note or reference is required.", "MCP_ARGUMENT_INVALID");
      return {
        task: taskCode(args.task),
        qaState,
        evidenceNote,
        evidenceRef,
        idempotencyKey: idempotencyKey(args.idempotency_key),
        transitionKey: args.transition_key ? boundedString(args.transition_key, "transition_key", 160) : null
      };
    }
    case "task074_inspect":
      return { task: taskCode(args.task) };
    case "task074_renew_gpt_claim":
      return { claimToken: claimToken(args.claim_token), leaseSeconds: leaseSeconds(args.lease_seconds) };
    case "task074_release_gpt_claim":
      return {
        claimToken: claimToken(args.claim_token),
        reason: boundedString(args.reason, "reason", 1000)
      };
    default:
      throw new McpToolError("Tool is not part of the TASK-074 allowlist.", "MCP_TOOL_NOT_ALLOWLISTED");
  }
}

function initializedNotification(value: JsonObject) {
  return value.method === "notifications/initialized" && value.id === undefined;
}

function protocolVersion(params: unknown) {
  const requested = isObject(params) ? text(params.protocolVersion, 40) : "";
  return requested || MCP_PROTOCOL_VERSION;
}

export type McpDependencies = {
  authorize: (request: Request) => Promise<void> | void;
  callTool: (call: McpCall) => Promise<unknown>;
};

export async function handleMcpRequest(request: Request, dependencies: McpDependencies) {
  const pathname = new URL(request.url).pathname;
  if (!pathname.endsWith(MCP_PATH)) return jsonResponse({ error: "MCP endpoint not found.", code: "MCP_NOT_FOUND" }, 404);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: jsonHeaders({ allow: "POST, OPTIONS" }) });
  if (request.method !== "POST") return jsonResponse({ error: "MCP Streamable HTTP requires POST.", code: "MCP_METHOD_NOT_ALLOWED" }, 405, { allow: "POST, OPTIONS" });

  try {
    await dependencies.authorize(request);
  } catch (error) {
    if (error instanceof McpHttpError) {
      return jsonResponse({ error: error.message, code: error.code }, error.status, error.headers);
    }
    return jsonResponse({ error: "MCP authorization failed.", code: "MCP_AUTH_FAILED" }, 401);
  }

  const rawBody = await request.text();
  if (byteLength(rawBody) > MAX_MCP_REQUEST_BYTES) return jsonRpcError(null, -32600, "MCP request is too large.");

  let value: JsonObject;
  try {
    const parsed = JSON.parse(rawBody);
    if (!isObject(parsed) || parsed.jsonrpc !== "2.0" || typeof parsed.method !== "string") throw new Error("invalid JSON-RPC");
    value = parsed;
  } catch {
    return invalidRequest();
  }

  const requestedProtocol = text(request.headers.get("MCP-Protocol-Version"), 40);
  const modern = requestedProtocol === MCP_MODERN_PROTOCOL_VERSION;
  if (requestedProtocol && ![MCP_PROTOCOL_VERSION, MCP_MODERN_PROTOCOL_VERSION].includes(requestedProtocol)) {
    return jsonRpcError(value.id === undefined ? null : value.id as JsonRpcId, -32022, "Unsupported MCP protocol version.", {
      supported: [MCP_MODERN_PROTOCOL_VERSION, MCP_PROTOCOL_VERSION]
    });
  }
  if (modern) {
    const headerMethod = text(request.headers.get("Mcp-Method"), 100);
    if (!headerMethod || headerMethod !== value.method) {
      return jsonRpcError(value.id === undefined ? null : value.id as JsonRpcId, -32020, "Mcp-Method header does not match the JSON-RPC method.");
    }
    if (value.method === "tools/call") {
      const params = isObject(value.params) ? value.params : {};
      const headerName = text(request.headers.get("Mcp-Name"), 100);
      if (!headerName || headerName !== text(params.name, 100)) {
        return jsonRpcError(value.id === undefined ? null : value.id as JsonRpcId, -32020, "Mcp-Name header does not match the tool name.");
      }
    }
  }

  if (initializedNotification(value)) return new Response(null, { status: 202, headers: jsonHeaders() });
  const id = value.id === undefined ? null : value.id as JsonRpcId;
  const method = value.method;
  const params = isObject(value.params) ? value.params : {};

  try {
    if (modern && method === "server/discover") {
      return modernResult(id, {
        supportedVersions: [MCP_MODERN_PROTOCOL_VERSION],
        capabilities: { tools: { listChanged: false } },
        instructions: "TASK-074 bounded GPT lifecycle tools only. The server keeps Broker private keys and GPT Actor Tokens inside the protected runtime. Co remains the canonical Co actor; this surface never impersonates Co.",
        ttlMs: 60000,
        cacheScope: "private"
      });
    }
    if (method === "initialize") {
      return jsonRpc(id, {
        protocolVersion: protocolVersion(params),
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
        instructions: "TASK-074 bounded GPT lifecycle tools only. The server keeps Broker private keys and GPT Actor Tokens inside the protected runtime. Co remains the canonical Co actor; this surface never impersonates Co."
      });
    }
    if (method === "ping") return modern ? modernResult(id, {}) : jsonRpc(id, {});
    if (method === "tools/list") {
      return modern
        ? modernResult(id, { tools: MCP_TOOLS, ttlMs: 60000, cacheScope: "private" })
        : jsonRpc(id, { tools: MCP_TOOLS });
    }
    if (method === "tools/call") {
      const name = text(params.name, 100);
      const args = isObject(params.arguments) ? params.arguments : {};
      const call = { name, arguments: args };
      validateToolCall(call);
      const toolResult = await dependencies.callTool(call);
      const callResult = {
        content: [{ type: "text", text: JSON.stringify(toolResult) }],
        structuredContent: toolResult,
        isError: false
      };
      return modern ? modernResult(id, callResult) : jsonRpc(id, callResult);
    }
    if (method.startsWith("notifications/")) return new Response(null, { status: 202, headers: jsonHeaders() });
    return jsonRpcError(id, -32601, "MCP method not found.");
  } catch (error) {
    const message = error instanceof McpToolError ? error.message : "TASK-074 MCP tool execution failed.";
    const code = error instanceof McpToolError ? error.code : "MCP_TOOL_FAILED";
    if (method === "tools/call") {
      const errorResult = {
        content: [{ type: "text", text: JSON.stringify({ code, error: message }) }],
        isError: true
      };
      return modern ? modernResult(id, errorResult) : jsonRpc(id, errorResult);
    }
    return jsonRpcError(id, -32603, "MCP request failed.", { code });
  }
}
