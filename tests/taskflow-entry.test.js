const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("TaskFlow entry uses explicit TaskFlow Dev endpoints and never falls back to Native Lab services", () => {
  const entry = read("labs/taskflow/index.html");
  const config = read("labs/taskflow/runtime-config.js");
  assert.match(entry, /ZhugeTaskFlowConfig/);
  assert.match(entry, /TaskFlow Dev URL 尚未設定|尚未設定 TaskFlow Dev URL/);
  assert.match(entry, /zhuge-multica-lab\.onrender\.com/);
  assert.match(entry, /不可回退到 Multica Native Lab 服務/);
  assert.match(config, /apiUrl: ""/);
  assert.match(config, /webUrl: ""/);
  assert.doesNotMatch(config, /apiKey|serviceRole|accessToken|token:/i);
});

test("TaskFlow entry retains the shared Zhuge identity handoff and required Multica attribution", () => {
  const entry = read("labs/taskflow/index.html");
  assert.match(entry, /zhuge_ai_os_google_auth_session_v1/);
  assert.match(entry, /zhuge_ai_os_session_v1/);
  assert.match(entry, /\/auth\/zhuge/);
  assert.match(entry, /\/zhuge-handoff#zhuge_token=/);
  assert.match(entry, /\/api\/workspaces/);
  assert.match(entry, /\/readyz/);
  assert.match(entry, /\/zhuge-ready/);
  assert.match(entry, /"Multica"/);
  assert.match(entry, /MulticaIcon|brand-mark/);
  assert.match(entry, /© <span id="copyrightYear"/);
  assert.match(entry, /github\.com\/multica-ai\/multica/);
  assert.match(read("labs/taskflow/DB_BOUNDARY.md"), /lab_multica, extensions/);
  assert.match(read("labs/taskflow/Dockerfile.backend"), /MULTICA_CLOUD_URL=/);
  assert.match(read("labs/taskflow/Dockerfile.backend"), /DO_NOT_TRACK=1/);
  assert.match(read("labs/taskflow/Dockerfile.web"), /NEXT_PUBLIC_ENABLE_CLOUD_RUNTIME=false/);
});

test("TaskFlow Dev configuration is non-secret and cannot select the Native Lab endpoints", () => {
  const source = read("labs/taskflow/index.html");
  const script = source.match(/function normalizedBase\(value, label\) \{([\s\S]*?)\n      \}/)?.[0];
  assert.ok(script, "TaskFlow endpoint validation must be present");
  const url = vm.runInNewContext(`(() => { ${script}; return normalizedBase; })()`, { URL });
  assert.equal(url("https://taskflow-web.example", "TaskFlow Web"), "https://taskflow-web.example");
  assert.throws(() => url("https://zhuge-multica-lab.onrender.com", "TaskFlow Web"), /不可回退到 Multica Native Lab/);
  assert.throws(() => url("http://taskflow-web.example", "TaskFlow Web"), /必須使用 HTTPS/);
  assert.equal(url("http://localhost:3000", "TaskFlow Web"), "http://localhost:3000");
  for (const invalid of [
    "https://user:pass@taskflow-web.example",
    "https://taskflow-web.example/app",
    "https://taskflow-web.example/?token=secret",
    "https://taskflow-web.example/#fragment"
  ]) {
    assert.throws(() => url(invalid, "TaskFlow Web"), /服務根網址/);
  }
});

test("TaskFlow entry resolves only the existing Zhuge session keys and hands tokens only to the configured TaskFlow API", () => {
  const entry = read("labs/taskflow/index.html");
  assert.match(entry, /const AUTH_KEY = "zhuge_ai_os_google_auth_session_v1"/);
  assert.match(entry, /const SESSION_KEY = "zhuge_ai_os_session_v1"/);
  assert.match(entry, /function currentAccessToken\(\)/);
  assert.match(entry, /fetch\(`\$\{api\}\/auth\/zhuge`/);
  assert.match(entry, /body: JSON\.stringify\(\{ access_token: accessToken \}\)/);
  assert.doesNotMatch(entry, /access_token=[^"'`]/);
  assert.match(entry, /if \(configured && currentAccessToken\(\)\) void enter\(\)/);
});

test("TaskFlow Dev launcher emits only validated non-secret service origins", () => {
  const script = path.join(ROOT, "labs/taskflow/build-dev-entry.mjs");
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "taskflow-entry-"));
  try {
    const outputDir = path.join(temp, "site");
    const run = env => spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: { ...process.env, TASKFLOW_ENTRY_OUTPUT: outputDir, ...env }
    });
    const ok = run({
      TASKFLOW_API_URL: "https://taskflow-api.example/",
      TASKFLOW_WEB_URL: "https://taskflow-web.example/"
    });
    assert.equal(ok.status, 0, ok.stderr || ok.stdout);
    const config = fs.readFileSync(path.join(outputDir, "runtime-config.js"), "utf8");
    assert.ok(config.includes('"apiUrl":"https://taskflow-api.example"'));
    assert.ok(config.includes('"webUrl":"https://taskflow-web.example"'));
    assert.doesNotMatch(config, /token|secret|service_role/i);
    assert.equal(fs.existsSync(path.join(outputDir, "index.html")), true);

    for (const invalid of [
      { TASKFLOW_API_URL: "https://taskflow-api.example", TASKFLOW_WEB_URL: "https://taskflow-api.example" },
      { TASKFLOW_API_URL: "https://zhuge-multica-lab-api.onrender.com", TASKFLOW_WEB_URL: "https://taskflow-web.example" },
      { TASKFLOW_API_URL: "https://taskflow-api.example/path", TASKFLOW_WEB_URL: "https://taskflow-web.example" },
      { TASKFLOW_API_URL: "", TASKFLOW_WEB_URL: "https://taskflow-web.example" }
    ]) {
      const result = run(invalid);
      assert.notEqual(result.status, 0, JSON.stringify(invalid));
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
