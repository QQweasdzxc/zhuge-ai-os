const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const manifestPath = path.join(root, "tools/deployment/zhuge-deployment-readiness.json");
const scriptPath = path.join(root, "tools/deployment/zhuge-deployment-readiness.mjs");

test("deployment readiness is source-complete, secret-name-only, and non-mutating by default", () => {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  assert.equal(manifest.automatic_mutation, false);
  assert.equal(manifest.production_apply, "human_gate");
  assert.deepEqual(manifest.deploy_order, [
    "preflight", "task-101-migration", "zhuge-skyeye-read",
    "task-attachment-ai-read", "task-094-line-protected-runtime", "smoke-and-readback"
  ]);
  const serialized = JSON.stringify(manifest);
  assert.doesNotMatch(serialized, /(sk-[A-Za-z0-9]{20,}|eyJ[a-zA-Z0-9_-]{20,}|BEGIN [A-Z ]+ PRIVATE KEY)/);
  for (const item of Object.values(manifest.artifacts)) {
    assert.ok(Array.isArray(item.required_secret_names));
    assert.ok(item.rollback);
  }
});

test("deployment readiness preflight validates artifacts and never applies", () => {
  const result = spawnSync(process.execPath, [scriptPath], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.status, "PASS");
  assert.equal(output.automatic_mutation, false);
  assert.deepEqual(output.secret_names, [
    "CWA_API_KEY", "LINE_CHANNEL_ACCESS_TOKEN", "LINE_CHANNEL_SECRET",
    "MOENV_API_KEY", "OPENAI_API_KEY", "TDX_CLIENT_ID", "TDX_CLIENT_SECRET"
  ]);
  assert.match(output.artifacts["task-094"].status, /human_runtime_host_required/);
});

test("deployment readiness refuses an apply flag", () => {
  const result = spawnSync(process.execPath, [scriptPath, "--apply"], { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /DEPLOYMENT_AUTHORIZATION_REQUIRED/);
});
