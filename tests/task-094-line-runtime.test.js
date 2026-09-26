const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const runtime = require("../shared/line/line-runtime-contract.js");

const root = path.resolve(__dirname, "..");
const edge = fs.readFileSync(path.join(root, "supabase/functions/zhuge-line-task-runtime/index.ts"), "utf8");
const migration = fs.readFileSync(path.join(root, "docs/supabase/20260926_task_094_line_runtime.sql"), "utf8");

test("TASK-094 runtime parser is bounded and fail-closed", () => {
  assert.deepEqual(runtime.parseCommandText("建立工作：整理供應商報價"), {
    ok: true, command: "create_task", title: "整理供應商報價", content: "", taskId: ""
  });
  assert.deepEqual(runtime.parseCommandText("進度: 50 task:550e8400-e29b-41d4-a716-446655440000"), {
    ok: true, command: "set_progress", progress: 50, taskId: "550e8400-e29b-41d4-a716-446655440000"
  });
  assert.equal(runtime.parseCommandText("進度: 60 task:550e8400-e29b-41d4-a716-446655440000").code, "LINE_COMMAND_NOT_RECOGNIZED");
  assert.equal(runtime.parseCommandText("完成").command, "complete_task");
  assert.equal(runtime.parseCommandText("完成").taskId, "");
  assert.equal(runtime.parseCommandText("完成 task:550e8400-e29b-41d4-a716-446655440000").command, "complete_task");
  assert.equal(runtime.parseCommandText("隨便說說").code, "LINE_COMMAND_NOT_RECOGNIZED");
});

test("TASK-094 provider readiness exposes names and state only", () => {
  const missing = runtime.providerState({});
  assert.equal(missing.configured, false);
  assert.equal(missing.errorCategory, "PROVIDER_NOT_CONFIGURED");
  assert.deepEqual(missing.secretNames, ["LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN"]);
  const configured = runtime.providerState({ LINE_CHANNEL_SECRET: "test-only", LINE_CHANNEL_ACCESS_TOKEN: "test-only" });
  assert.equal(configured.configured, true);
  assert.equal(JSON.stringify(configured).includes("test-only"), false);
});

test("TASK-094 Edge runtime has custom signature auth, sanitized RPC boundary, and no client secret path", () => {
  for (const name of ["LINE_CHANNEL_SECRET", "LINE_CHANNEL_ACCESS_TOKEN", "SUPABASE_SERVICE_ROLE_KEY", "line_resolve_subject", "board_line_task_command_v1", "PROVIDER_NOT_CONFIGURED"]) {
    assert.match(edge, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(edge, /signature_verified:\s*true/);
  assert.match(edge, /secrets_exposed:\s*false/);
  assert.doesNotMatch(edge, /console\.(log|error)\(/);
  assert.match(edge, /flexTaskMessage/);
  assert.match(edge, /LINE_LIFF_TASK_BASE_URL/);
  assert.match(edge, /taskDeepLink/);
});

test("TASK-094 Cloud bridge is private, service-role-only, durable, and workflow fail-closed", () => {
  assert.match(migration, /create table if not exists private\.line_subject_bindings/i);
  assert.match(migration, /create table if not exists private\.line_webhook_idempotency/i);
  assert.match(migration, /grant execute on function public\.line_resolve_subject\([^;]+\) to service_role/i);
  assert.match(migration, /grant execute on function public\.board_line_task_command_v1\([^;]+\) to service_role/i);
  assert.match(migration, /Workflow-bound Task must use the canonical Workflow transition path/);
  assert.doesNotMatch(migration, /grant execute on function public\.(line_resolve_subject|board_line_task_command_v1)[^;]+ to (public|anon|authenticated)/i);
  assert.match(migration, /line_webhook_idempotency[\s\S]*expires_at/);
});
