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

test("CLI token is constrained to validated callback and state is consumed once", () => {
  const token = "short-lived-jwt-value-123";
  const state = "0123456789abcdef0123456789abcdef";
  const target = new URL(sso.buildCliCallbackUrl("http://127.0.0.1:43127/callback", token, state));
  assert.equal(target.origin, "http://127.0.0.1:43127");
  assert.equal(target.pathname, "/callback");
  assert.equal(target.searchParams.get("token"), token);
  assert.equal(target.searchParams.get("state"), state);
  assert.throws(() => sso.buildCliCallbackUrl("http://example.com/callback", token, state));
  const values = new Map();
  const storage = { getItem: key => values.has(key) ? values.get(key) : null, setItem: (key, value) => values.set(key, value) };
  assert.equal(sso.consumeCliState(state, storage), true);
  assert.equal(sso.consumeCliState(state, storage), false);
});

test("CLI overlay uses Zhuge-authenticated identity and five-minute native grant", () => {
  const login = read("labs/taskflow/overrides/zhuge-login-page.tsx");
  const auth = read("labs/taskflow/overrides/zhuge_auth.go");
  const patch = read("labs/taskflow/patches/apply-zhuge-identity.py");
  const docker = read("labs/taskflow/Dockerfile.backend");
  const proxy = read("labs/taskflow/overrides/zhuge-cli-proxy.ts");
  const router = read("third_party/multica/server/cmd/server/router.go");
  const cliRoute = router.indexOf('r.Post("/api/cli-token", h.IssueCliToken)');
  const authGroupStart = router.lastIndexOf("r.Group(func(r chi.Router) {", cliRoute);
  const authGroupEnd = router.indexOf("\n\t})", cliRoute);
  assert.match(login, /api\.getMe\(\)/);
  assert.match(login, /api\.issueCliToken\(\)/);
  assert.match(login, /consumeCliState/);
  assert.match(login, /buildCliCallbackUrl/);
  assert.match(auth, /requireUserID\(w, r\)/);
  assert.match(auth, /zhugeCliTokenClaims/);
  assert.match(auth, /zhugeCliAuthorizationTTL\s*=\s*5\s*\*\s*time\.Minute/);
  assert.match(patch, /r\.Post\("\/api\/cli-token", h\.ZhugeIssueCliToken\)/);
  assert.match(patch, /Native CLI token route marker not found/);
  assert.match(docker, /go test \.\/internal\/handler -run/);
  assert.match(proxy, /request\.nextUrl\.searchParams\.getAll\("cli_callback"\)/);
  assert.match(proxy, /target\.hash = fragment\.toString\(\)/);
  assert.match(proxy, /NextResponse\.redirect\(target, 303\)/);
  assert.doesNotMatch(proxy, /access_token|token=/i);
  assert.doesNotMatch(login, /access_token\s*=|token=/i);
});

test("handoff validates same-origin destination before storing the TaskFlow token", () => {
  const handoff = read("labs/taskflow/overrides/zhuge-handoff-page.tsx");
  assert.match(handoff, /resolved\.origin === window\.location\.origin/);
  assert.ok(handoff.indexOf("if (!safeDestination)") < handoff.indexOf('localStorage.setItem("multica_token"'));
  assert.match(handoff, /window\.location\.replace\(safeDestination\)/);
});
