const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

const root = path.resolve(__dirname, "..");
const protocolPath = path.join(root, "supabase/functions/_shared/task074-mcp-protocol.ts");
const edgePath = path.join(root, "supabase/functions/zhuge-task-074-mcp/index.ts");
const protocolSource = fs.readFileSync(protocolPath, "utf8");
const edgeSource = fs.readFileSync(edgePath, "utf8");

test("TASK-074 MCP source exposes only the bounded lifecycle tools", () => {
  for (const tool of [
    "task074_gpt_claim",
    "task074_plan_handoff_co",
    "task074_gpt_review",
    "task074_inspect",
    "task074_renew_gpt_claim",
    "task074_release_gpt_claim"
  ]) assert.match(protocolSource, new RegExp(`name: "${tool}"`));
  assert.doesNotMatch(protocolSource, /task074_co_claim|create_task|governance_write|service_role/i);
  assert.match(protocolSource, /MCP_PATH = ".*mcp"/);
  assert.match(protocolSource, /MCP request is too large/);
});

test("MCP edge keeps the Broker key and Actor Token inside the protected runtime", () => {
  assert.match(edgeSource, /ENGINEERING_BROKER_CALLER_PRIVATE_JWK/);
  assert.match(edgeSource, /ENGINEERING_ACTOR_BROKER_URL/);
  assert.match(edgeSource, /authorization: `Bearer \$\{issued\.actorToken\}`/);
  assert.match(edgeSource, /sanitizedValue\(parsed\)/);
  assert.match(edgeSource, /MCP_TRUSTED_PROXY_SECRET/);
  assert.doesNotMatch(edgeSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(edgeSource, /console\.(log|error|warn)/);
});

test("MCP edge reuses the existing Broker and engineering-transition surfaces", () => {
  assert.match(edgeSource, /engineering-actor-broker/);
  assert.match(edgeSource, /engineering-transition/);
  assert.match(edgeSource, /operation: "claim_specific_gpt"/);
  assert.match(edgeSource, /operation: "plan_handoff_co"/);
  assert.match(edgeSource, /operation: "engineering_review"/);
  assert.match(edgeSource, /operation: "inspect"/);
  assert.doesNotMatch(edgeSource, /board_tasks\s*\?/);
  assert.doesNotMatch(edgeSource, /fetch\([^)]*rest\/v1\/rpc/);
});

test("MCP protocol validation is strict and fail-closed", async () => {
  const protocol = await import(pathToFileURL(protocolPath).href);
  assert.throws(() => protocol.validateToolCall({ name: "task074_gpt_claim", arguments: { task: "TASK-079", stage: "planning", idempotency_key: "short" } }), /idempotency_key/);
  assert.deepEqual(protocol.validateToolCall({ name: "task074_gpt_claim", arguments: { task: "TASK-079", stage: "planning", idempotency_key: "gpt-plan-20260921" } }), {
    task: "TASK-079",
    stage: "planning",
    idempotencyKey: "gpt-plan-20260921",
    leaseSeconds: 900
  });
  assert.throws(() => protocol.validateToolCall({ name: "task074_plan_handoff_co", arguments: { task: "TASK-079", claim_token: "not-a-uuid", idempotency_key: "gpt-handoff-20260921", plan: {} } }), /claim_token/);
  assert.throws(() => protocol.validateToolCall({ name: "task074_gpt_review", arguments: { task: "TASK-079", review_state: "pass", next_gate: "runtime_qa", claim_token: "00000000-0000-4000-8000-000000000001", idempotency_key: "gpt-review-20260921", review_note: "review" } }), /regression/);
});

test("MCP modern discovery, legacy handshake, tool listing, and auth dependency are Inspector-ready", async () => {
  const protocol = await import(pathToFileURL(protocolPath).href);
  const authorize = () => undefined;
  const callTool = async () => ({ success: true, sanitized: true });
  const discover = await protocol.handleMcpRequest(new Request("http://127.0.0.1:8787/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "server/discover"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "server/discover", params: {} })
  }), { authorize, callTool });
  const discovered = await discover.json();
  assert.equal(discovered.result.supportedVersions[0], "2026-07-28");
  assert.equal(discovered.result.resultType, "complete");

  const init = await protocol.handleMcpRequest(new Request("http://127.0.0.1:8787/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26" } })
  }), { authorize, callTool });
  assert.equal(init.status, 200);
  assert.equal((await init.json()).result.serverInfo.name, "zhuge-task-074-mcp");

  const list = await protocol.handleMcpRequest(new Request("http://127.0.0.1:8787/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} })
  }), { authorize, callTool });
  const listed = await list.json();
  assert.equal(listed.result.tools.length, 6);
  assert.equal(listed.result.tools.some(tool => tool.name === "task074_gpt_claim"), true);

  const modernList = await protocol.handleMcpRequest(new Request("http://127.0.0.1:8787/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "mcp-protocol-version": "2026-07-28",
      "mcp-method": "tools/list"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "tools/list", params: {} })
  }), { authorize, callTool });
  const modernListed = await modernList.json();
  assert.equal(modernListed.result.resultType, "complete");
  assert.equal(modernListed.result.cacheScope, "private");
});
