const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const Environment = require("../tools/governance-environment.js");
const Runner = require("../tools/pm-governance-approval.js");

const root = path.resolve(__dirname, "..");
const { privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const privateJwk = privateKey.export({ format: "jwk" });

function action(overrides = {}) {
  return Runner.normalizeActionManifest({
    operation: "create_task_contract",
    payload: { title: "Governance Approval Runner QA", summary: "Controlled path test", priority: "P1" },
    display: {
      title: "建立 Governance Approval Runner QA TASK",
      purpose: "確認 PM review 與受控 write path 可以連續執行。",
      scope: ["PM review", "Existing Governance Write"],
      impact: ["不改 Auth／Identity／RLS"]
    },
    ...overrides
  });
}

function baselineAction(overrides = {}) {
  return Runner.normalizeActionManifest({
    operation: "set_pm_accepted_baseline",
    payload: {
      product_version: "v0.9.0-alpha.9.13",
      runtime_build: "20260820-1434",
      git_commit: "7bc0364fbb95d09c3100b251d7f07bed137773f7",
      artifact_reference: "20260820-1502_Zhuge_AI_OS_v0.9.0-alpha.9.13_Pre-WorkTodo-Integration_PM-Accepted_Build20260820-1434.zip",
      pm_acceptance_status: "accepted",
      notes: "Milestone: Pre-WorkTodo Integration PM Accepted Baseline\nArchive SHA-256: c47312bce81a48abb266d5b152132ab50236e7f30d6bef100b902df10c0cf1bb"
    },
    display: {
      title: "登記 Pre-WorkTodo Integration PM Accepted Baseline",
      purpose: "將已由 PM 驗證的 Runtime 建立為目前正式 Accepted Baseline。",
      scope: ["Version / Build / Commit", "Immutable Archive reference"],
      impact: ["不修改 Product Source", "不開始 WorkTodo Integration"]
    },
    ...overrides
  });
}

test("environment loader resolves the existing public project configuration without requiring a secret", () => {
  const config = Environment.resolveExecutionEnvironment({});
  assert.match(config.supabaseUrl, /^https:\/\//);
  assert.ok(config.supabaseAnonKey);
  assert.equal(config.governanceWriteUrl, `${config.supabaseUrl}/functions/v1/engineering-transition`);
  assert.equal(config.urlSource, "canonical-public-project-config");
  const protectedConfig = Environment.resolveExecutionEnvironment({ SUPABASE_URL: "https://protected.example.supabase.co", SUPABASE_ANON_KEY: "public-key" });
  assert.equal(protectedConfig.urlSource, "protected-environment");
});

test("private broker key loader accepts the protected environment or the existing Keychain bridge", () => {
  assert.deepEqual(Environment.readProtectedPrivateJwk({ ENGINEERING_ACTOR_PRIVATE_JWK: JSON.stringify(privateJwk) }), privateJwk);
  const keychain = Environment.readProtectedPrivateJwk({}, {
    execFileSync: () => JSON.stringify(privateJwk)
  });
  assert.deepEqual(keychain, privateJwk);
  assert.throws(() => Environment.readProtectedPrivateJwk({}, { execFileSync: () => { throw new Error("missing"); } }), /unavailable/);
});

test("action manifest is immutable and mirrors the existing governance operation allowlist", () => {
  const parsed = action();
  assert.equal(Object.isFrozen(parsed), true);
  assert.equal(parsed.operation, "create_task_contract");
  const completeCreate = action({
    payload: {
      ...action().payload,
      acceptance_criteria: "C Mother Template 與 Consumer 1 對 1 比對後顯示 100% MATCH。"
    }
  });
  assert.equal(completeCreate.payload.acceptance_criteria, "C Mother Template 與 Consumer 1 對 1 比對後顯示 100% MATCH。");
  assert.throws(() => Runner.normalizeActionManifest({ operation: "set_pm_baseline", payload: {} }), /allowlisted/);
  assert.throws(() => Runner.normalizeActionManifest({ operation: "create_task_contract", payload: { title: "x", unknown: true } }), /not allowlisted/);
  assert.throws(() => Runner.normalizeActionManifest({ operation: "create_task_contract", payload: { title: "x", authorization_token: "bad" } }), /not an allowed action field/);
  assert.throws(() => Runner.normalizeActionManifest({ operation: "create_task_contract", payload: {} }), /title is required/);
  assert.throws(() => Runner.normalizeActionManifest({ operation: "register_artifact", payload: { artifact_type: "release" } }), /candidate/);
  assert.equal(baselineAction().operation, "set_pm_accepted_baseline");
  assert.throws(() => Runner.normalizeActionManifest({ operation: "set_pm_accepted_baseline", payload: { pm_acceptance_status: "pending" } }), /explicit PM accepted status/);
  assert.throws(() => Runner.normalizeActionManifest({ operation: "set_pm_accepted_baseline", payload: { pm_acceptance_status: "accepted", product_version: "v", runtime_build: "b", git_commit: "c" } }), /artifact_reference is required/);
  assert.throws(() => Runner.normalizeActionManifest({ operation: "set_pm_accepted_baseline", payload: { pm_acceptance_status: "accepted", product_version: "v", runtime_build: "b", git_commit: "c", artifact_reference: "a", archive_sha256: "secret" } }), /not allowlisted/);
});

test("Engineering Principle action is bounded to the PM-assigned EP-### payload and canonical read-back", () => {
  const principle = Runner.normalizeActionManifest({
    operation: "create_engineering_principle",
    payload: {
      knowledge_code: "EP-039",
      title: "ONE Golden Master — Single Presentation Source of Truth",
      summary: "Board-based Product 只有一個 Presentation / Interaction Source of Truth。",
      content: "ONE GOLDEN MASTER",
      module: "architecture",
      version: "1.0",
      source_path: "docs/principles/EP-039-one-golden-master-single-presentation-source-of-truth.md",
      source_reference: "PM / CTO Decision 2026-08-21"
    }
  });
  assert.equal(principle.operation, "create_engineering_principle");
  assert.throws(() => Runner.normalizeActionManifest({
    operation: "create_engineering_principle",
    payload: { ...principle.payload, knowledge_code: "EP-40" }
  }), /EP-###/);
  assert.throws(() => Runner.normalizeActionManifest({
    operation: "create_engineering_principle",
    payload: { ...principle.payload, status: "approved" }
  }), /not allowlisted/);
  const readBack = Runner.summarizeReadBack(principle, [{
    knowledge_code: "EP-039",
    title: principle.payload.title,
    summary: principle.payload.summary,
    content: principle.payload.content,
    source_path: principle.payload.source_path,
    source_reference: principle.payload.source_reference,
    status: "approved",
    version: "1.0"
  }]);
  assert.deepEqual(readBack, {
    table: "public.engineering_knowledge",
    identity: "EP-039",
    knowledgeCode: "EP-039",
    status: "approved",
    version: "1.0",
    title: principle.payload.title
  });
});

test("PM baseline approval uses the authenticated baseline RPC and Startup Gate read-back only", async () => {
  const approvedAction = baselineAction();
  const calls = [];
  let directGovernanceWriteCalls = 0;
  const runner = Runner.createRunner({
    action: approvedAction,
    environment: {
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "public-key",
      governanceWriteUrl: "https://example.supabase.co/functions/v1/engineering-transition"
    },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      const pathname = new URL(url).pathname;
      if (pathname === "/auth/v1/user") return new Response(JSON.stringify({ id: "owner-id", email: "qjc@example.com" }), { status: 200 });
      if (pathname === "/rest/v1/rpc/set_engineering_pm_accepted_baseline") {
        assert.equal(options.headers.Authorization, "Bearer access-only-in-process");
        const body = JSON.parse(options.body);
        assert.deepEqual(body.p_baseline, approvedAction.payload);
        return new Response(JSON.stringify({ baseline_key: "current", ...approvedAction.payload }), { status: 200 });
      }
      if (pathname === "/rest/v1/rpc/resolve_engineering_startup_gate") {
        return new Response(JSON.stringify({
          principles: { failures: [] },
          pm_accepted_baseline: { baseline_key: "current", ...approvedAction.payload }
        }), { status: 200 });
      }
      if (pathname === "/rest/v1/rpc/issue_engineering_governance_authorization") throw new Error("baseline must not issue a governance token");
      throw new Error(`Unexpected network call: ${pathname}`);
    },
    issueActorToken: () => { throw new Error("baseline must not issue an actor token"); },
    readPrivateJwk: () => { throw new Error("baseline must not load a private JWK"); },
    writeGovernance: async () => { directGovernanceWriteCalls += 1; }
  });
  runner.sessions.set("owner-session", {
    accessToken: "access-only-in-process",
    refreshToken: "refresh-only-in-process",
    expiresAt: Date.now() + 300000,
    createdAt: Date.now(),
    user: { id: "owner-id", email: "qjc@example.com", name: "QJC" },
    ownerStatus: "allowed"
  });
  const started = await runner.start({ port: 18765 });
  const headers = {
    Cookie: "pm_governance_sid=owner-session",
    Origin: "http://127.0.0.1:18765",
    "X-PM-Approval-Nonce": runner.approval.csrf
  };
  try {
    const response = await fetch(`${started.url}api/approve`, { method: "POST", headers });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.phase, "success");
    assert.equal(body.result.readBack.table, "engineering_pm_accepted_baselines");
    assert.equal(body.result.readBack.productVersion, "v0.9.0-alpha.9.13");
    assert.equal(body.result.readBack.runtimeBuild, "20260820-1434");
    assert.equal(body.result.readBack.gitCommit, "7bc0364fbb95d09c3100b251d7f07bed137773f7");
    assert.equal(body.result.readBack.startupGateStatus, "PASS");
    assert.doesNotMatch(JSON.stringify(body), /access-only-in-process|refresh-only-in-process/);
    assert.equal(directGovernanceWriteCalls, 0);
    assert.equal(calls.filter(call => new URL(call.url).pathname === "/rest/v1/rpc/set_engineering_pm_accepted_baseline").length, 1);
    assert.equal(calls.filter(call => new URL(call.url).pathname === "/rest/v1/rpc/resolve_engineering_startup_gate").length, 1);

    const replay = await fetch(`${started.url}api/approve`, { method: "POST", headers });
    assert.equal(replay.status, 403);
    assert.equal(calls.filter(call => new URL(call.url).pathname === "/rest/v1/rpc/set_engineering_pm_accepted_baseline").length, 1);
  } finally {
    await new Promise(resolve => started.server.close(resolve));
  }
});

test("PM baseline approval denies anonymous and non-owner sessions before the RPC", async () => {
  const makeRunner = async (ownerStatus, port) => {
    let writes = 0;
    const runner = Runner.createRunner({
      action: baselineAction(),
      environment: {
        supabaseUrl: "https://example.supabase.co",
        supabaseAnonKey: "public-key",
        governanceWriteUrl: "https://example.supabase.co/functions/v1/engineering-transition"
      },
      fetchImpl: async (url) => {
        const pathname = new URL(url).pathname;
        if (pathname === "/auth/v1/user") return new Response(JSON.stringify({ id: "user-id", email: "user@example.com" }), { status: 200 });
        if (pathname === "/rest/v1/rpc/set_engineering_pm_accepted_baseline") {
          writes += 1;
          return new Response(JSON.stringify({}), { status: 500 });
        }
        throw new Error(`Unexpected network call: ${pathname}`);
      }
    });
    if (ownerStatus) {
      runner.sessions.set(`session-${ownerStatus}`, {
        accessToken: "access-only-in-process",
        refreshToken: "refresh-only-in-process",
        expiresAt: Date.now() + 300000,
        createdAt: Date.now(),
        user: { id: "user-id", email: "user@example.com", name: "User" },
        ownerStatus
      });
    }
    const started = await runner.start({ port });
    return { runner, started, getWrites: () => writes, sessionId: ownerStatus ? `session-${ownerStatus}` : null };
  };

  const anonymous = await makeRunner(null, 18764);
  try {
    const response = await fetch(`${anonymous.started.url}api/approve`, { method: "POST", headers: { Origin: "http://127.0.0.1:18764", "X-PM-Approval-Nonce": anonymous.runner.approval.csrf } });
    assert.equal(response.status, 401);
    assert.equal(anonymous.getWrites(), 0);
  } finally {
    await new Promise(resolve => anonymous.started.server.close(resolve));
  }

  const nonOwner = await makeRunner("denied", 18763);
  try {
    const response = await fetch(`${nonOwner.started.url}api/approve`, {
      method: "POST",
      headers: { Cookie: "pm_governance_sid=session-denied", Origin: "http://127.0.0.1:18763", "X-PM-Approval-Nonce": nonOwner.runner.approval.csrf }
    });
    assert.equal(response.status, 403);
    assert.equal(nonOwner.getWrites(), 0);
  } finally {
    await new Promise(resolve => nonOwner.started.server.close(resolve));
  }
});

test("product inline-edit bridge queues only summary or usage_scenario and never exposes a capability", async () => {
  const pmCapability = "pm-capability-only-in-process";
  const actorCapability = "actor-capability-only-in-process";
  let writeCount = 0;
  const runner = Runner.createRunner({
    waitForProduct: true,
    productOrigins: ["https://app.example"],
    environment: {
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "public-key",
      governanceWriteUrl: "https://example.supabase.co/functions/v1/engineering-transition"
    },
    fetchImpl: async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname === "/auth/v1/user") return new Response(JSON.stringify({ id: "owner-id", email: "qjc@example.com" }), { status: 200 });
      if (pathname === "/rest/v1/rpc/issue_engineering_governance_authorization") return new Response(JSON.stringify({ authorization_id: "authorization-id", authorization_token: pmCapability }), { status: 200 });
      if (pathname === "/rest/v1/board_tasks") return new Response(JSON.stringify([{ id: "task-id", work_code: "TASK-039", title: "Drawer", status: "ready" }]), { status: 200 });
      throw new Error(`Unexpected network call: ${pathname}`);
    },
    readPrivateJwk: () => privateJwk,
    issueActorToken: () => actorCapability,
    writeGovernance: async (config, operation, payload) => {
      writeCount += 1;
      assert.equal(operation, "update_task_contract");
      assert.deepEqual(payload, { task_id: "task-id", summary: "新的工作內容" });
      assert.equal(config.pmAuthorizationToken, pmCapability);
      assert.equal(config.actorToken, actorCapability);
      return { result: { result: { result: { id: "task-id" } } } };
    }
  });
  const started = await runner.start({ port: 18770 });
  const productHeaders = { Origin: "https://app.example", "Content-Type": "application/json" };
  try {
    const waiting = await fetch(`${started.url}api/state`);
    assert.equal((await waiting.json()).phase, "waiting");

    const preflight = await fetch(`${started.url}api/request-task-update`, { method: "OPTIONS", headers: { Origin: "https://app.example", "Access-Control-Request-Method": "POST" } });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get("access-control-allow-origin"), "https://app.example");

    const denied = await fetch(`${started.url}api/request-task-update`, { method: "POST", headers: productHeaders, body: JSON.stringify({ operation: "register_artifact", task_id: "task-id" }) });
    assert.equal(denied.status, 422);

    const queued = await fetch(`${started.url}api/request-task-update`, { method: "POST", headers: productHeaders, body: JSON.stringify({ task_id: "task-id", summary: "新的工作內容" }) });
    assert.equal(queued.status, 202);
    const queuedBody = await queued.text();
    assert.match(queuedBody, /"phase":"pending"/);
    assert.match(queuedBody, /更新 task-id 的工作內容/);
    assert.doesNotMatch(queuedBody, /payload|pm-capability-only-in-process|actor-capability-only-in-process/);
    const requestId = JSON.parse(queuedBody).requestId;

    const beforeApproval = await fetch(`${started.url}api/task-update-status?request_id=${encodeURIComponent(requestId)}`, { headers: { Origin: "https://app.example" } });
    assert.equal((await beforeApproval.json()).phase, "pending");
    assert.equal(writeCount, 0);

    runner.sessions.set("owner-session", {
      accessToken: "access-only-in-process",
      refreshToken: "refresh-only-in-process",
      expiresAt: Date.now() + 300000,
      createdAt: Date.now(),
      user: { id: "owner-id", email: "qjc@example.com", name: "QJC" },
      ownerStatus: "allowed"
    });
    const approval = await fetch(`${started.url}api/approve`, {
      method: "POST",
      headers: { Cookie: "pm_governance_sid=owner-session", Origin: "http://127.0.0.1:18770", "X-PM-Approval-Nonce": runner.approval.csrf }
    });
    const approvalBody = await approval.text();
    assert.equal(approval.status, 200);
    assert.match(approvalBody, /"phase":"success"/);
    assert.match(approvalBody, /TASK-039/);
    assert.doesNotMatch(approvalBody, /pm-capability-only-in-process|actor-capability-only-in-process/);
    assert.equal(writeCount, 1);

    const afterApproval = await fetch(`${started.url}api/task-update-status?request_id=${encodeURIComponent(requestId)}`, { headers: { Origin: "https://app.example" } });
    assert.equal((await afterApproval.json()).phase, "success");
  } finally {
    await new Promise(resolve => started.server.close(resolve));
  }
});

test("browser approval page receives only review metadata and never embeds capability labels", () => {
  const page = Runner.renderApprovalPage({
    operation: "建立 Canonical TASK Contract",
    operationLabel: "建立 Canonical TASK Contract",
    title: "Current TASK review",
    purpose: "PM decides whether this controlled action may run.",
    scope: ["Canonical TASK"],
    impact: ["History remains append-only"]
  }, { phase: "pending", authenticated: true, csrf: "nonce", user: { email: "qjc@example.com" } });
  assert.match(page, /Current TASK review/);
  assert.doesNotMatch(page, /PM_AUTHORIZATION_TOKEN|ENGINEERING_ACTOR_TOKEN|ENGINEERING_ACTOR_PRIVATE_JWK|SUPABASE_SERVICE_ROLE_KEY|JWK|Copy Token|Paste Token|Secret Input/);
  assert.doesNotMatch(page, /"payload"\s*:/);
  assert.match(page, /核准 Governance 變更/);
  const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(match => match[1]);
  assert.equal(scripts.length, 2);
  assert.doesNotThrow(() => new vm.Script(scripts[1]));
});

test("OAuth initiation delegates state creation to Supabase and binds callback to a local HttpOnly attempt", async () => {
  const calls = [];
  const runner = Runner.createRunner({
    action: action(),
    environment: {
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "public-key",
      governanceWriteUrl: "https://example.supabase.co/functions/v1/engineering-transition"
    },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      const requestUrl = new URL(url);
      if (requestUrl.pathname === "/auth/v1/token") {
        const body = JSON.parse(options.body);
        assert.equal(requestUrl.searchParams.get("grant_type"), "pkce");
        assert.equal(body.auth_code, "auth-code");
        assert.ok(body.code_verifier);
        return new Response(JSON.stringify({
          access_token: "access-token",
          refresh_token: "refresh-token",
          expires_in: 3600,
          token_type: "bearer"
        }), { status: 200 });
      }
      if (requestUrl.pathname === "/auth/v1/user") {
        return new Response(JSON.stringify({ id: "owner-id", email: "qjc@example.com", user_metadata: { name: "QJC" } }), { status: 200 });
      }
      throw new Error(`Unexpected network call: ${requestUrl.pathname}`);
    }
  });
  const started = await runner.start({ port: 18769 });
  const responseCookies = response => response.headers.getSetCookie?.() || [response.headers.get("set-cookie") || ""];
  try {
    const startResponse = await fetch(`${started.url}auth/start`, { redirect: "manual" });
    assert.equal(startResponse.status, 302);
    const authorizationUrl = new URL(startResponse.headers.get("location"));
    assert.equal(authorizationUrl.searchParams.get("provider"), "google");
    assert.equal(authorizationUrl.searchParams.get("redirect_to"), "http://127.0.0.1:18769/auth/callback");
    assert.equal(authorizationUrl.searchParams.get("code_challenge_method"), "S256");
    assert.ok(authorizationUrl.searchParams.get("code_challenge"));
    assert.equal(authorizationUrl.searchParams.has("state"), false);
    const attemptCookie = responseCookies(startResponse)
      .find(cookie => cookie.startsWith(`${Runner.OAUTH_ATTEMPT_COOKIE}=`))
      .split(";", 1)[0];
    assert.match(attemptCookie, new RegExp(`^${Runner.OAUTH_ATTEMPT_COOKIE}=`));

    const callbackResponse = await fetch(`${started.url}auth/callback?code=auth-code`, {
      redirect: "manual",
      headers: { Cookie: attemptCookie }
    });
    assert.equal(callbackResponse.status, 302);
    assert.equal(new URL(callbackResponse.headers.get("location"), started.url).pathname, "/");
    const callbackCookies = responseCookies(callbackResponse).join(";");
    assert.match(callbackCookies, new RegExp(`${Runner.OAUTH_ATTEMPT_COOKIE}=;`));
    assert.match(callbackCookies, /pm_governance_sid=/);
    assert.equal(runner.oauthAttempts.size, 0);
    assert.equal(runner.sessions.size, 1);
    assert.equal(calls.filter(call => new URL(call.url).pathname === "/auth/v1/token").length, 1);

    const replay = await fetch(`${started.url}auth/callback?code=auth-code`, {
      redirect: "manual",
      headers: { Cookie: attemptCookie }
    });
    assert.equal(replay.status, 400);
    assert.equal(calls.filter(call => new URL(call.url).pathname === "/auth/v1/token").length, 1);
  } finally {
    await new Promise(resolve => started.server.close(resolve));
  }
});

test("authenticated owner approval issues, executes, and reads back exactly once without returning capabilities", async () => {
  const pmCapability = "pm-capability-only-in-process";
  const actorCapability = "actor-capability-only-in-process";
  const calls = [];
  let writeCount = 0;
  const approvedAction = action();
  const runner = Runner.createRunner({
    action: approvedAction,
    environment: {
      supabaseUrl: "https://example.supabase.co",
      supabaseAnonKey: "public-key",
      governanceWriteUrl: "https://example.supabase.co/functions/v1/engineering-transition"
    },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      const pathname = new URL(url).pathname;
      if (pathname === "/auth/v1/user") {
        return new Response(JSON.stringify({ id: "owner-id", email: "qjc@example.com", user_metadata: { name: "QJC" } }), { status: 200 });
      }
      if (pathname === "/rest/v1/rpc/issue_engineering_governance_authorization") {
        return new Response(JSON.stringify({ authorization_id: "authorization-id", authorization_token: pmCapability }), { status: 200 });
      }
      if (pathname === "/rest/v1/board_tasks") {
        return new Response(JSON.stringify([{ id: "task-id", work_code: "TASK-999", title: "Governance Approval Runner QA", status: "ready" }]), { status: 200 });
      }
      throw new Error(`Unexpected network call: ${pathname}`);
    },
    readPrivateJwk: () => privateJwk,
    issueActorToken: (actor, options) => {
      assert.equal(actor, "GPT");
      assert.equal(options.profile, "governance-write");
      return actorCapability;
    },
    writeGovernance: async (config, operation, payload) => {
      writeCount += 1;
      assert.equal(operation, "create_task_contract");
      assert.equal(payload.title, "Governance Approval Runner QA");
      assert.equal(config.pmAuthorizationToken, pmCapability);
      assert.equal(config.actorToken, actorCapability);
      return { result: { result: { result: { id: "task-id" } } } };
    }
  });
  const sessionId = "authenticated-session";
  runner.sessions.set(sessionId, {
    accessToken: "access-only-in-process",
    refreshToken: "refresh-only-in-process",
    expiresAt: Date.now() + 300000,
    createdAt: Date.now(),
    user: { id: "owner-id", email: "qjc@example.com", name: "QJC" },
    ownerStatus: "allowed"
  });
  const started = await runner.start({ port: 18766 });
  const headers = {
    Cookie: `pm_governance_sid=${sessionId}`,
    Origin: "http://127.0.0.1:18766",
    "X-PM-Approval-Nonce": runner.approval.csrf
  };
  try {
    const response = await fetch(`${started.url}api/approve`, { method: "POST", headers });
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(body, /"phase":"success"/);
    assert.match(body, /TASK-999/);
    assert.doesNotMatch(body, /pm-capability-only-in-process|actor-capability-only-in-process/);
    assert.equal(writeCount, 1);
    assert.equal(calls.filter(call => call.url.endsWith("/issue_engineering_governance_authorization")).length, 1);

    const replay = await fetch(`${started.url}api/approve`, { method: "POST", headers });
    assert.equal(replay.status, 403);
    assert.equal(writeCount, 1);
    assert.equal(runner.currentState(runner.sessions.get(sessionId)).result.readBack.workCode, "TASK-999");
  } finally {
    await new Promise(resolve => started.server.close(resolve));
  }
});

test("anonymous, non-owner, and rejected approval attempts do not execute a Governance Write", async () => {
  const makeRunner = async (ownerStatus) => {
    let writes = 0;
    const runner = Runner.createRunner({
      action: action(),
      environment: {
        supabaseUrl: "https://example.supabase.co",
        supabaseAnonKey: "public-key",
        governanceWriteUrl: "https://example.supabase.co/functions/v1/engineering-transition"
      },
      fetchImpl: async (url) => {
        const pathname = new URL(url).pathname;
        if (pathname === "/auth/v1/user") return new Response(JSON.stringify({ id: "user-id", email: "user@example.com" }), { status: 200 });
        throw new Error(`Unexpected network call: ${pathname}`);
      },
      writeGovernance: async () => { writes += 1; }
    });
    if (ownerStatus) {
      runner.sessions.set(`session-${ownerStatus}`, {
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: Date.now() + 300000,
        createdAt: Date.now(),
        user: { id: "user-id", email: "user@example.com", name: "User" },
        ownerStatus
      });
    }
    const port = ownerStatus === "denied" ? 18767 : 18768;
    const started = await runner.start({ port });
    return { runner, started, writes, sessionId: ownerStatus ? `session-${ownerStatus}` : null };
  };

  const anonymous = await makeRunner(null);
  try {
    const response = await fetch(`${anonymous.started.url}api/approve`, { method: "POST", headers: { Origin: "http://127.0.0.1:18768", "X-PM-Approval-Nonce": anonymous.runner.approval.csrf } });
    assert.equal(response.status, 401);
  } finally {
    await new Promise(resolve => anonymous.started.server.close(resolve));
  }

  const nonOwner = await makeRunner("denied");
  try {
    const response = await fetch(`${nonOwner.started.url}api/approve`, {
      method: "POST",
      headers: { Cookie: "pm_governance_sid=session-denied", Origin: "http://127.0.0.1:18767", "X-PM-Approval-Nonce": nonOwner.runner.approval.csrf }
    });
    assert.equal(response.status, 403);
    assert.equal(nonOwner.runner.approval.phase, "pending");
  } finally {
    await new Promise(resolve => nonOwner.started.server.close(resolve));
  }

  const rejected = await makeRunner("allowed");
  try {
    const response = await fetch(`${rejected.started.url}api/reject`, {
      method: "POST",
      headers: { Cookie: "pm_governance_sid=session-allowed", Origin: "http://127.0.0.1:18768", "X-PM-Approval-Nonce": rejected.runner.approval.csrf }
    });
    assert.equal(response.status, 200);
    assert.match(await response.text(), /"phase":"rejected"/);
    assert.equal(rejected.runner.approval.phase, "rejected");
  } finally {
    await new Promise(resolve => rejected.started.server.close(resolve));
  }
});

test("runner is localhost-only and uses the existing controlled write modules", () => {
  const source = fs.readFileSync(path.join(root, "tools/pm-governance-approval.js"), "utf8");
  assert.equal(Runner.HOST, "127.0.0.1");
  assert.match(source, /issue_engineering_governance_authorization/);
  assert.match(source, /engineering-actor-broker/);
  assert.match(source, /engineering-governance-write/);
  assert.match(fs.readFileSync(path.join(root, "tools/governance-environment.js"), "utf8"), /engineering-transition/);
  assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(source, /supabase_execute_sql|insert into|update .* set|delete from/i);
});

test("read-back targets stay within canonical sources and do not create a second data path", () => {
  const createTarget = Runner.readBackTarget(action(), { result: { result: { result: { id: "task-id" } } } });
  assert.equal(createTarget.table, "board_tasks");
  const checkpoint = Runner.readBackTarget(Runner.normalizeActionManifest({ operation: "update_checkpoint", payload: { checkpoint_key: "current", current_task: "TASK" } }), { result: { result: { result: {} } } });
  assert.equal(checkpoint.table, "engineering_project_checkpoints");
  assert.equal(checkpoint.identity, "current");
  const artifact = Runner.normalizeActionManifest({ operation: "register_artifact", payload: { artifact_type: "candidate", filename: "x.zip" } });
  assert.equal(Runner.readBackTarget(artifact, { result: { result: { result: { artifact_id: "artifact-id" } } } }).table, "engineering_artifacts");
  const principle = Runner.normalizeActionManifest({ operation: "create_engineering_principle", payload: {
    knowledge_code: "EP-039", title: "Title", summary: "Summary", content: "Content",
    source_path: "docs/principles/EP-039.md", source_reference: "PM / CTO Decision 2026-08-21"
  }});
  const principleTarget = Runner.readBackTarget(principle, { result: { result: { result: { knowledge_code: "EP-039" } } } });
  assert.equal(principleTarget.rpc, "resolve_engineering_startup_gate");
  assert.deepEqual(principleTarget.knowledgeCodes, ["EP-039"]);
  assert.equal(Runner.summarizeReadBack(action(), [{ id: "task-id", work_code: "TASK-999", title: "QA", status: "ready" }]).workCode, "TASK-999");
});

test("existing broker can issue the governance-write actor capability without privileged claims", () => {
  const Broker = require("../tools/engineering-actor-broker.js");
  const token = Broker.issueActorToken("GPT", { profile: "governance-write", privateJwk });
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  assert.equal(payload.aud, "engineering-governance-write");
  assert.equal(payload.scope, "engineering-governance:write");
  assert.equal(payload.service_role, undefined);
  assert.equal(payload.role, undefined);
});
