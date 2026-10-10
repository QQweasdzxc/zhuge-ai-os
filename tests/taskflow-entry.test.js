const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ReleaseGovernance = require("../tools/release-governance.js");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("formal TaskFlow entry has a consistent new Product release identity", () => {
  const gate = ReleaseGovernance.assertSourceIdentity(ReleaseGovernance.readIdentitySnapshot(ROOT));
  const identity = JSON.parse(read("version.json"));
  assert.equal(gate.status, "PASS");
  assert.equal(gate.version, identity.version);
  assert.equal(gate.build, identity.build);
  assert.equal(gate.publishedCIdentity.build, "20260915-1707");
});

test("WORK navigation places TaskFlow before WorkLog on the canonical AIOS origin", () => {
  const navigation = read("shared/components/zhuge-navigation.js");
  assert.match(navigation, /GENERAL_USER_VISIBLE_ITEMS = Object\.freeze\(\["taskflow", "worklog"/);
  assert.match(navigation, /taskflow: \{ icon: "🧭", label: "TaskFlow", group: "camp"/);
  assert.match(navigation, /taskflow: "labs\/taskflow\/",/);
  assert.match(navigation, /campIds = \["taskflow", "worklog"/);
});

test("TaskFlow service configuration exposes only separate non-secret public endpoints", () => {
  const config = read("labs/taskflow/runtime-config.js");
  assert.match(config, /https:\/\/zhuge-taskflow-api\.onrender\.com/);
  assert.match(config, /https:\/\/zhuge-taskflow-web\.onrender\.com/);
  assert.doesNotMatch(config, /access[_-]?token|refresh[_-]?token|service[_-]?role|secret|password/i);
  assert.notEqual(config.match(/apiUrl:\s*"([^"]+)"/)?.[1], config.match(/webUrl:\s*"([^"]+)"/)?.[1]);
});

test("TaskFlow sends the existing Zhuge session only to API POST and returns to official login", () => {
  const entry = read("labs/taskflow/index.html");
  assert.match(entry, /href="https:\/\/qqweasdzxc\.github\.io\/zhuge-ai-os\/modules\/worklog\/\?app=1&amp;workspace=dashboard"/);
  assert.match(entry, /const AUTH_KEY = "zhuge_ai_os_google_auth_session_v1"/);
  assert.match(entry, /const SESSION_KEY = "zhuge_ai_os_session_v1"/);
  assert.match(entry, /boundedFetch\(api \+ "\/auth\/zhuge"/);
  assert.match(entry, /body: JSON\.stringify\(\{ access_token: accessToken \}\)/);
  assert.match(entry, /window\.location\.replace\(AIOS_LOGIN_URL\)/);
  assert.match(entry, /zhuge-handoff/);
  assert.match(entry, /zhuge_token/);
  assert.match(entry, /timeoutMs = 45000/);
  assert.doesNotMatch(entry, /access_token\s*=/);
  assert.doesNotMatch(entry, /access_token=[^"'\s&]/);
  assert.doesNotMatch(entry, /console\.(?:log|error|warn).*access_token/i);
});

test("TaskFlow CLI login return uses same-origin Zhuge login and the guarded one-use SSO bridge", () => {
  const entry = read("labs/taskflow/index.html");
  const worklog = read("modules/worklog/index.html");
  const helper = read("labs/taskflow/cli-sso.js");
  assert.match(entry, /new URL\(aiosBasePath \+ "\/modules\/worklog\/\?app=1&workspace=dashboard", window\.location\.origin\)/);
  assert.match(entry, /storePendingCliIntent\(cliIntent, window\.sessionStorage\)/);
  assert.match(entry, /history\.replaceState\(null, "", window\.location\.pathname \+ window\.location\.search\)/);
  assert.match(entry, /buildTaskFlowLoginDestination\(cliIntent\)/);
  assert.match(worklog, /labs\/taskflow\/cli-sso\.js\?v=/);
  assert.match(worklog, /startLoginReturnMonitor\(window\)/);
  assert.match(helper, /PENDING_INTENT_TTL_MS = 4 \* 60 \* 1000/);
  assert.match(helper, /consumePendingCliIntent/);
  assert.match(helper, /claims\.exp/);
  assert.doesNotMatch(worklog, /cli_callback=.*(?:access_token|refresh_token)/i);
});
