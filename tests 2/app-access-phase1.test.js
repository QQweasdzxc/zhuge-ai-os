const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..");
const migration = fs.readFileSync(
  path.join(repoRoot, "supabase/migrations/20260916025649_global_floating_hub_app_access_phase1.sql"),
  "utf8"
);
const AppAccess = require(path.join(repoRoot, "shared/auth/app-access-service.js"));
const AppAccessGate = require(path.join(repoRoot, "shared/auth/app-access-gate.js"));

test("App Access service uses the canonical RPC contract", async () => {
  const calls = [];
  const service = AppAccess.createService({
    dataGateway: {
      rpc: async (name, args) => {
        calls.push({ name, args });
        if (name === "resolve_app_access") return { status: "approved", user_id: "user-1", email: "owner@example.com" };
        return { status: "pending", user_id: "user-1", email: "owner@example.com" };
      }
    }
  });

  const current = await service.getCurrent();
  assert.equal(current.status, "APPROVED");
  const submitted = await service.submit({ displayName: "New User", reason: "需要使用工作空間", idempotencyKey: "request-1" });
  assert.equal(submitted.status, "PENDING");
  assert.deepEqual(calls, [
    { name: "resolve_app_access", args: {} },
    {
      name: "submit_app_access_request",
      args: { p_display_name: "New User", p_reason: "需要使用工作空間", p_idempotency_key: "request-1" }
    }
  ]);
});

test("App Access gate keeps identity read-only and distinguishes status", () => {
  const fresh = AppAccessGate.render({ status: "NEW", email: "new@example.com" }, { email: "new@example.com" });
  assert.match(fresh, /Google Email/);
  assert.match(fresh, /readonly/);
  assert.match(fresh, /data-app-access-form/);
  assert.doesNotMatch(fresh, /name="email"/);

  const pending = AppAccessGate.render({ status: "PENDING", email: "new@example.com" });
  assert.match(pending, /等待 Creator／Owner 審核/);
  assert.doesNotMatch(pending, /data-app-access-form/);

  const rejected = AppAccessGate.render({ status: "REJECTED", email: "new@example.com", review_note: "請補充用途" });
  assert.match(rejected, /重新送出申請/);
  assert.match(rejected, /請補充用途/);
});

test("Phase 1 migration defines append-only history, canonical access, creator notes, and private presence", () => {
  assert.match(migration, /create table if not exists private\.app_access_application_events/);
  assert.match(migration, /before update or delete on private\.app_access_application_events/);
  assert.match(migration, /public\.resolve_app_access\(\)/);
  assert.match(migration, /public\.is_app_access_approved\(\)/);
  assert.match(migration, /public\.submit_app_access_request\(/);
  assert.match(migration, /public\.review_app_access_application\(/);
  assert.match(migration, /public\.get_creator_user_notes\(\)/);
  assert.match(migration, /public\.upsert_creator_user_note\(/);
  assert.match(migration, /pm_approved_bootstrap_evidence/);
  assert.match(migration, /create policy zhuge_app_presence_read/);
  assert.match(migration, /create policy zhuge_app_presence_track/);
  assert.match(migration, /realtime\.topic\(\) = 'zhuge-app-presence-v1'/);
  assert.match(migration, /as restrictive for all to authenticated using/);
  assert.match(migration, /public\.board_create_instance\(/);
});

test("all normal shell entries load the shared App Access boundary", () => {
  const required = [
    "app/Board/ai/index.html",
    "app/Board/worktodo/index.html",
    "app/Board/procurement/index.html",
    "app/Board/investment/index.html",
    "app/Board/template-preview/index.html",
    "modules/investment/index.html",
    "modules/worklog/chat/index.html",
    "modules/worklog/index.html"
  ];
  required.forEach(relativePath => {
    const source = fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
    assert.match(source, /app-access-service\.js/);
    assert.match(source, /app-access-gate\.js/);
    assert.match(source, /global-floating-hub\.js/);
  });
});

test("C board branches gate before runtime and direct Investment does the same", () => {
  const golden = fs.readFileSync(path.join(repoRoot, "shared/components/golden-master-runtime.js"), "utf8");
  const investment = fs.readFileSync(path.join(repoRoot, "modules/investment/services/investment-module.js"), "utf8");
  assert.equal((golden.match(/await requireApplicationAccess\(\)/g) || []).length, 5);
  assert.match(golden, /ZhugeGlobalFloatingHub\?\.mount/);
  assert.match(investment, /async function requireAppAccess\(/);
  assert.match(investment, /if \(gate\.isApproved\(access\)\) return true/);
});

test("Global Floating Hub is the normal WorkLog floating entry and preserves assistant access", () => {
  const worklog = fs.readFileSync(path.join(repoRoot, "modules/worklog/worklog-app.js"), "utf8");
  const hub = fs.readFileSync(path.join(repoRoot, "shared/components/global-floating-hub.js"), "utf8");
  const shell = worklog.match(/function osShell\(\) \{[\s\S]*?\n\}/);
  assert.ok(shell, "normal WorkLog shell should remain discoverable");
  assert.doesNotMatch(shell[0], /\$\{floatingAssistantWidget\(\)\}/);
  assert.match(worklog, /function floatingAssistantWidget\(\)/);
  assert.match(worklog, /function isStandaloneChatRoute\(\)/);
  assert.match(hub, /href\("modules\/worklog\/chat\/", \{ app: "1" \}\)/);
  assert.match(hub, /AI 小幫手/);
  assert.match(hub, /工時／時數/);
});

test("WorkLog cannot recreate the legacy floating assistant widget on normal routes", () => {
  const worklog = fs.readFileSync(path.join(repoRoot, "modules/worklog/worklog-app.js"), "utf8");
  const refresh = worklog.match(/function refreshConversationFromCloud\([\s\S]*?\n\}\n\nconst chineseNumberMap/);
  assert.ok(refresh, "conversation refresh function should remain discoverable");
  assert.doesNotMatch(refresh[0], /floatingAssistantWidget\(\)/);
  assert.match(worklog, /function removeLegacyFloatingAssistantWidget\(\)/);
  assert.match(worklog, /function bindGlobal\(\) \{\s*removeLegacyFloatingAssistantWidget\(\);/);
  assert.match(worklog, /function standaloneChatScreen\(\)/);
  assert.match(worklog, /function isStandaloneChatRoute\(\)/);
});

test("Presence resolves function-valued identity labels before rendering", () => {
  const hub = fs.readFileSync(path.join(repoRoot, "shared/components/global-floating-hub.js"), "utf8");
  assert.match(hub, /typeof options\.userLabel === "function"/);
  assert.match(hub, /String\(value\)\.trim\(\)/);
  assert.match(hub, /display_name: readUserLabel\(options, access\)/);
  assert.doesNotMatch(hub, /if \(options\.userLabel\) return String\(options\.userLabel\)\.trim\(\);/);
});
