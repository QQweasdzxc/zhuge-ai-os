const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const sso = require("../labs/taskflow/cli-sso.js");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("CLI callback accepts only loopback HTTP callback endpoints", () => {
  for (const allowed of [
    "http://localhost:43127/callback",
    "http://127.0.0.1:43127/callback"
  ]) assert.equal(sso.validateCliCallback(allowed), true, allowed);
  for (const denied of [
    "https://127.0.0.1:43127/callback",
    "http://example.com:43127/callback",
    "http://10.8.0.5:43127/callback",
    "http://172.20.4.7:43127/callback",
    "http://192.168.1.9:43127/callback",
    "http://169.254.1.1:43127/callback",
    "http://127.0.0.1/callback",
    "http://127.0.0.1:43127/other",
    "http://user:pass@127.0.0.1:43127/callback",
    "http://127.0.0.1:43127/callback?x=1",
    "http://127.0.0.1:43127/callback#fragment"
  ]) assert.equal(sso.validateCliCallback(denied), false, denied);
});

test("CLI state has the native 128-bit lowercase hexadecimal form", () => {
  assert.equal(sso.validateCliState("0123456789abcdef0123456789abcdef"), true);
  for (const invalid of ["", "0123", "0123456789ABCDEF0123456789ABCDEF", "z".repeat(32), "a".repeat(33)]) {
    assert.equal(sso.validateCliState(invalid), false, invalid);
  }
  assert.deepEqual(sso.parseCliIntent(new URLSearchParams()), { status: "none" });
  assert.deepEqual(sso.parseCliIntent(new URLSearchParams("cli_callback=http%3A%2F%2F127.0.0.1%3A43127%2Fcallback")), { status: "invalid" });
  assert.deepEqual(
    sso.parseCliIntent(new URLSearchParams("cli_callback=http%3A%2F%2F127.0.0.1%3A43127%2Fcallback&cli_callback=http%3A%2F%2Flocalhost%3A43127%2Fcallback&cli_state=0123456789abcdef0123456789abcdef")),
    { status: "invalid" }
  );
  assert.deepEqual(
    sso.parseCliIntent(new URLSearchParams("cli_callback=http%3A%2F%2F127.0.0.1%3A43127%2Fcallback&cli_state=0123456789abcdef0123456789abcdef")),
    { status: "valid", callback: "http://127.0.0.1:43127/callback", state: "0123456789abcdef0123456789abcdef" }
  );
});

test("browser handoff stays on Zhuge origin and carries CLI intent only in the fragment", () => {
  const intent = { status: "valid", callback: "http://127.0.0.1:43127/callback", state: "0123456789abcdef0123456789abcdef" };
  const target = new URL(sso.buildAiosLauncherUrl(intent));
  assert.equal(target.origin, "https://qqweasdzxc.github.io");
  assert.equal(target.pathname, "/zhuge-ai-os/labs/taskflow/");
  assert.equal(target.hash.includes("cli_callback="), true);
  assert.equal(target.hash.includes("cli_state="), true);
  assert.equal(target.search, "");
  assert.equal(sso.buildTaskFlowLoginDestination(intent).startsWith("/login#"), true);
});

test("TaskFlow return paths are relative and same-origin only", () => {
  const origin = "https://taskflow.example";
  assert.equal(sso.safeTaskFlowDestination("/workspace/issues?view=board#top", origin), "/workspace/issues?view=board#top");
  for (const denied of ["https://evil.example/", "//evil.example/", "/\\\\evil.example/"]) {
    assert.equal(sso.safeTaskFlowDestination(denied, origin), null, denied);
  }
});

test("native callback carries an opaque one-time code, never an API access token", () => {
  const authorizationCode = "zgc_" + "a".repeat(43);
  const state = "0123456789abcdef0123456789abcdef";
  const target = new URL(sso.buildCliCallbackUrl("http://127.0.0.1:43127/callback", authorizationCode, state));
  assert.equal(target.origin, "http://127.0.0.1:43127");
  assert.equal(target.pathname, "/callback");
  assert.equal(target.searchParams.get("token"), authorizationCode);
  assert.doesNotMatch(target.searchParams.get("token"), /^[^.]+\.[^.]+\.[^.]+$/);
  assert.equal(target.searchParams.get("state"), state);
  assert.throws(() => sso.buildCliCallbackUrl("http://example.com/callback", authorizationCode, state));
  assert.throws(() => sso.buildCliCallbackUrl("http://127.0.0.1:43127/callback", "eyJhbGciOiJIUzI1NiJ9.payload.sig", state));
  const values = new Map();
  const storage = { getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, value) };
  assert.equal(sso.consumeCliState(state, storage), true);
  assert.equal(sso.consumeCliState(state, storage), false);
});

test("pending CLI intent resumes after Zhuge login only with a fresh existing session", () => {
  const intent = { status: "valid", callback: "http://127.0.0.1:43127/callback", state: "0123456789abcdef0123456789abcdef" };
  const sessionValues = new Map();
  const localValues = new Map();
  const storage = map => ({
    getItem: key => map.has(key) ? map.get(key) : null,
    setItem: (key, value) => map.set(key, value),
    removeItem: key => map.delete(key)
  });
  const sessionStorage = storage(sessionValues);
  const localStorage = storage(localValues);
  const now = Date.now();
  assert.equal(sso.storePendingCliIntent(intent, sessionStorage, now), true);
  const redirects = [];
  let poll;
  const root = {
    sessionStorage,
    localStorage,
    location: { replace: value => redirects.push(value) },
    setInterval: callback => { poll = callback; return 1; },
    clearInterval: () => {}
  };
  sso.startLoginReturnMonitor(root);
  assert.equal(redirects.length, 0, "an unauthenticated user is not assumed to be logged in");

  const payload = Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 300 })).toString("base64url");
  localStorage.setItem("zhuge_ai_os_google_auth_session_v1", JSON.stringify({ access_token: `header.${payload}.signature` }));
  poll();
  assert.equal(redirects.length, 1);
  const returned = new URL(redirects[0]);
  assert.equal(returned.origin, "https://qqweasdzxc.github.io");
  assert.equal(returned.pathname, "/zhuge-ai-os/labs/taskflow/");
  assert.match(returned.hash, /cli_callback=/);
  assert.match(returned.hash, /cli_state=0123456789abcdef0123456789abcdef/);
  assert.equal(returned.search, "", "CLI intent is not sent in an HTTP query");
  assert.equal(sso.consumePendingCliIntent(intent.state, sessionStorage), true);
  assert.equal(sso.consumePendingCliIntent(intent.state, sessionStorage), false);
});

test("pending CLI intent expires and rejects tampered callback/state data", () => {
  const values = new Map();
  const storage = {
    getItem: key => values.has(key) ? values.get(key) : null,
    setItem: (key, value) => values.set(key, value),
    removeItem: key => values.delete(key)
  };
  const intent = { status: "valid", callback: "http://localhost:43127/callback", state: "0123456789abcdef0123456789abcdef" };
  const start = Date.now();
  assert.equal(sso.storePendingCliIntent(intent, storage, start), true);
  assert.deepEqual(sso.readPendingCliIntent(storage, start + 4 * 60 * 1000 + 1), { status: "invalid" });
  assert.equal(values.size, 0);
  values.set("zhuge_taskflow_cli_intent_v1", JSON.stringify({ callback: "http://example.com/callback", state: intent.state, createdAt: start }));
  assert.deepEqual(sso.readPendingCliIntent(storage, start + 1), { status: "invalid" });
});

test("CLI overlay uses Zhuge-authenticated identity and five-minute native grant", () => {
  const login = read("labs/taskflow/overrides/zhuge-login-page.tsx");
  const auth = read("labs/taskflow/overrides/zhuge_auth.go");
  const patch = read("labs/taskflow/patches/apply-zhuge-identity.py");
  const docker = read("labs/taskflow/Dockerfile.backend");
  const proxy = read("labs/taskflow/overrides/zhuge-cli-proxy.ts");
  const router = read("third_party/multica/server/cmd/server/router.go");
  const requestLogger = read("third_party/multica/server/internal/middleware/request_logger.go");
  const cliRoute = router.indexOf('r.Post("/api/cli-token", h.IssueCliToken)');
  const authGroupStart = router.lastIndexOf("r.Group(func(r chi.Router) {", cliRoute);
  const authGroupEnd = router.indexOf("\n\t})", cliRoute);
  assert.match(login, /api\.getMe\(\)/);
  assert.match(login, /api\.issueCliToken\(\)/);
  assert.match(login, /consumeCliState/);
  assert.match(login, /buildCliCallbackUrl/);
  assert.match(auth, /requireUserID\(w, r\)/);
  assert.match(auth, /NewCLIAuthorizationCode\(uuidToString\(user\.ID\)\)/);
  assert.doesNotMatch(auth, /zhugeCliTokenClaims|SignedString\(auth\.JWTSecret\(\)\)/);
  assert.match(read("labs/taskflow/overrides/zhuge_cli_grant.go"), /ConsumeCLIAuthorizationCode/);
  assert.match(read("labs/taskflow/patches/patch-cli-auth-middleware.py"), /r\.URL\.Path, "\/"\) != "\/api\/tokens"/);
  assert.match(docker, /TestZhugeCLIAuthorizationCode/);
  assert.match(patch, /r\.Post\("\/api\/cli-token", h\.ZhugeIssueCliToken\)/);
  assert.match(patch, /Native CLI token route marker not found/);
  assert.match(docker, /go test \.\/internal\/handler -run/);
  assert.match(proxy, /request\.nextUrl\.searchParams\.getAll\("cli_callback"\)/);
  assert.match(proxy, /target\.hash = fragment\.toString\(\)/);
  assert.match(proxy, /NextResponse\.redirect\(target, 303\)/);
  assert.match(proxy, /Cache-Control", "no-store, private/);
  assert.match(proxy, /Referrer-Policy", "no-referrer/);
  assert.doesNotMatch(proxy, /access_token|token=/i);
  assert.doesNotMatch(login, /access_token\s*=|token=/i);
  assert.match(requestLogger, /"path", redactWebhookPath\(r\.URL\.Path\)/);
  assert.doesNotMatch(requestLogger, /RequestURI|URL\.String\(\)/);
});

test("handoff validates same-origin destination before storing the TaskFlow token", () => {
  const handoff = read("labs/taskflow/overrides/zhuge-handoff-page.tsx");
  assert.match(handoff, /resolved\.origin === window\.location\.origin/);
  assert.ok(handoff.indexOf("if (!safeDestination)") < handoff.indexOf('localStorage.setItem("multica_token"'));
  assert.match(handoff, /window\.location\.replace\(safeDestination\)/);
});
