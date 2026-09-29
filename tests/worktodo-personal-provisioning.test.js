const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const BoardRead = require("../shared/board/board-read-service.js");
const migration = read("docs/supabase/20260916_c_consumer_provisioning_personal_worktodo.sql");
const runtime = read("shared/components/golden-master-runtime.js");

const USER_ID = "a1b2c3d4-e5f6-47a8-9b0c-d1e2f3a4b5c6";
const OWNER_BOARD_ID = "0b2b5c4e-6767-4792-a97a-d2ddf42e60da";
const PERSONAL_BOARD_ID = "e1b2c3d4-f5a6-4789-8b0c-d1e2f3a4b5c6";
const PERSONAL_SCOPE = `worktodo-user-${USER_ID.replace(/-/g, "")}`;
const PERSONAL_PREFIX = "W1234567890ABCDE";

function instance({ id, owner = USER_ID, scope, prefix, template = "c" }) {
  return {
    id,
    name: "工作待辦",
    task_code_prefix: prefix,
    template_key: template,
    authorization_mode: "owner",
    owner_uuid: owner,
    legacy_application_scope: scope,
    is_template_instance: false,
    active: true
  };
}

function provisioningResult(board = instance({
  id: PERSONAL_BOARD_ID,
  scope: PERSONAL_SCOPE,
  prefix: PERSONAL_PREFIX
})) {
  return {
    contract: "module-c-consumer-provisioning-v2",
    board_instance: board,
    board_instance_id: board.id,
    template_key: "c",
    application_scope: PERSONAL_SCOPE,
    module_adoption: { status: "adopted", template_key: "c" },
    workflow: null,
    workflow_version_id: null,
    workflow_status: "not_configured",
    shared_runtime: "module-c-golden-master-runtime",
    atomic: true,
    fail_closed: true
  };
}

test("WorkTodo resolves the existing Owner Board before any personal provisioning", async () => {
  const calls = [];
  const gateway = {
    select: async (_table, query) => {
      calls.push({ kind: "select", query });
      return query.includes("legacy_application_scope=eq.worktodo")
        ? [instance({ id: OWNER_BOARD_ID, scope: "worktodo", prefix: "WLTK" })]
        : [];
    },
    rpc: async (...args) => { calls.push({ kind: "rpc", args }); throw new Error("must not provision Owner WorkTodo"); }
  };

  const result = await BoardRead.resolveOrProvisionPersonalWorkTodo({ userId: USER_ID }, { gateway });

  assert.equal(result.boardInstanceId, OWNER_BOARD_ID);
  assert.equal(result.provisioned, false);
  assert.equal(result.identity, "existing-owner-worktodo");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kind, "select");
  assert.equal(calls.some(call => call.kind === "rpc"), false);
});

test("approved-user resolver self-provisions only through canonical C v2 with server-owned intent", async () => {
  const calls = [];
  const gateway = {
    select: async (_table, query) => { calls.push({ kind: "select", query }); return []; },
    rpc: async (name, args) => {
      calls.push({ kind: "rpc", name, args });
      return provisioningResult();
    }
  };

  const result = await BoardRead.resolveOrProvisionPersonalWorkTodo(
    { userId: USER_ID, idempotencyKey: "qa-self-provision-1" },
    { gateway }
  );

  assert.equal(result.boardInstanceId, PERSONAL_BOARD_ID);
  assert.equal(result.provisioned, true);
  assert.equal(result.boardInstance.legacy_application_scope, PERSONAL_SCOPE);
  assert.notEqual(result.boardInstance.task_code_prefix, "WLTK");
  const provisionCalls = calls.filter(call => call.kind === "rpc");
  assert.equal(provisionCalls.length, 1);
  assert.equal(provisionCalls[0].name, "board_provision_c_consumer_v2");
  assert.deepEqual(provisionCalls[0].args, {
    p_name: "工作待辦",
    p_task_code_prefix: "SELF",
    p_template_key: "c",
    p_application_scope: "worktodo-self",
    p_workspace_blueprint: null,
    p_workflow_blueprint: null,
    p_idempotency_key: "worktodo-self-qa-self-provision-1"
  });
  assert.equal(calls.filter(call => call.kind === "select").length, 2);
});

test("reload/new-session resolution reuses the same personal Board without another provision call", async () => {
  const calls = [];
  const personal = instance({ id: PERSONAL_BOARD_ID, scope: PERSONAL_SCOPE, prefix: PERSONAL_PREFIX });
  const gateway = {
    select: async (_table, query) => {
      calls.push(query);
      return query.includes(`legacy_application_scope=eq.${PERSONAL_SCOPE}`) ? [personal] : [];
    },
    rpc: async () => { throw new Error("existing personal Board must not be reprovisioned"); }
  };

  const first = await BoardRead.resolveOrProvisionPersonalWorkTodo({ userId: USER_ID }, { gateway });
  const second = await BoardRead.resolveOrProvisionPersonalWorkTodo({ userId: USER_ID }, { gateway });

  assert.equal(first.boardInstanceId, PERSONAL_BOARD_ID);
  assert.equal(second.boardInstanceId, PERSONAL_BOARD_ID);
  assert.equal(first.provisioned, false);
  assert.equal(second.provisioned, false);
  assert.equal(calls.length, 4);
});

test("resolver fails closed for invalid or mismatched identities and invalid provision responses", async () => {
  let calls = 0;
  const emptyGateway = {
    select: async () => { calls += 1; return []; },
    rpc: async () => { calls += 1; return provisioningResult(instance({
      id: PERSONAL_BOARD_ID,
      owner: "11111111-2222-4333-8444-555555555555",
      scope: PERSONAL_SCOPE,
      prefix: PERSONAL_PREFIX
    })); }
  };

  await assert.rejects(
    () => BoardRead.resolveOrProvisionPersonalWorkTodo({ userId: "not-a-uuid" }, { gateway: emptyGateway }),
    error => error.code === "WORKTODO_PERSONAL_IDENTITY_INVALID"
  );
  assert.equal(calls, 0);

  await assert.rejects(
    () => BoardRead.resolveOrProvisionPersonalWorkTodo({ userId: USER_ID, idempotencyKey: "qa-invalid-owner" }, { gateway: emptyGateway }),
    error => error.code === "WORKTODO_PERSONAL_BOARD_IDENTITY_INVALID"
  );
});

test("canonical provisioning enforces approval, self-only scope, unique identity, three workspaces, and optional Workflow", () => {
  assert.match(migration, /create or replace function public\.board_provision_c_consumer_v2\(/i);
  assert.doesNotMatch(migration, /create\s+(?:or replace\s+)?function\s+public\.board_provision_[a-z0-9_]*(?:personal|worktodo)/i);
  assert.match(migration, /v_is_personal_worktodo boolean[\s\S]*'worktodo-self'/i);
  assert.match(migration, /public\.is_app_access_approved\(\)/i);
  assert.match(migration, /v_scope := 'worktodo-user-' \|\| replace\(v_user::text, '-', ''\)/i);
  assert.match(migration, /v_prefix := 'W' \|\| upper\(substr\(md5\(v_user::text\), 1, 15\)\)/i);
  assert.match(migration, /'workspace_key', 'worktodo-todo', 'name', '待辦事項', 'sort_order', 10/i);
  assert.match(migration, /'workspace_key', 'worktodo-inprogress', 'name', '進行中', 'sort_order', 20/i);
  assert.match(migration, /'workspace_key', 'worktodo-completed', 'name', '已完成', 'sort_order', 30/i);
  assert.match(migration, /hashtextextended\('module-c-personal-worktodo:' \|\| v_user::text, 0\)/i);
  assert.match(migration, /legacy_application_scope = 'worktodo'[\s\S]*Canonical WorkTodo already exists/i);
  assert.match(migration, /v_workflow_version_id[\s\S]*'workflow_status', case when v_workflow_version_id is null then 'not_configured'/i);
  assert.match(migration, /if not v_is_personal_worktodo then[\s\S]*board_c_workflow_save_draft\([\s\S]*board_c_workflow_publish\(/i);
  assert.match(migration, /if not v_is_creator then[\s\S]*Only an approved user may self-provision their own WorkTodo/i);
  assert.match(migration, /board_create_instance\(v_name, v_prefix, v_template\)/i);
  assert.match(migration, /consumer_adoptions[\s\S]*'atomic', true[\s\S]*'fail_closed', true/i);
  assert.match(migration, /revoke all on function public\.board_provision_c_consumer_v2/i);
  assert.match(migration, /grant execute on function public\.board_provision_c_consumer_v2[\s\S]*to authenticated/i);
});

test("WorkTodo runtime requires a resolved Board UUID and never trusts URL boardInstanceId", () => {
  assert.match(runtime, /resolveOrProvisionPersonalWorkTodo\(/);
  assert.match(runtime, /startBoardRuntime\(\{ applicationScope: "worktodo", boardInstanceId \}\)/);
  assert.match(runtime, /const requestedBoardInstanceId = workTodoRuntime[\s\S]*String\(options\.boardInstanceId \|\| ""\)/);
  assert.match(runtime, /legacyApplicationScope: state\.applicationScope === "procurement"[\s\S]*state\.applicationScope === "ai_board" \? "ai_board" : ""/);
});
