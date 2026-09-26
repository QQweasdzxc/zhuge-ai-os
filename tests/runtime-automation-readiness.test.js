const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const readiness = fs.readFileSync("tools/runtime/provider-readiness.mjs", "utf8");
const harness = fs.readFileSync("tools/runtime/authenticated-runtime-qa.mjs", "utf8");
const workflow = fs.readFileSync(".github/workflows/authenticated-runtime-qa.yml", "utf8");

test("provider readiness exposes only sanitized state", () => {
  assert.match(readiness, /configured/);
  assert.match(readiness, /PROVIDER_NOT_CONFIGURED/);
  assert.match(readiness, /secretValuesExposed: false/);
  assert.doesNotMatch(readiness, /console\.log\(process\.env/);
  assert.doesNotMatch(readiness, /JSON\.stringify\(process\.env/);
});

test("authenticated harness skips without secure storage state", () => {
  assert.match(harness, /AUTH_CREDENTIAL_UNAVAILABLE/);
  assert.match(harness, /Zhuge_AUTH_STORAGE_STATE_B64/);
  assert.match(harness, /storageState/);
  assert.match(harness, /secretValuesExposed: false/);
  assert.doesNotMatch(harness, /localStorage\.setItem\([^)]*token/i);
  assert.doesNotMatch(harness, /eyJ[A-Za-z0-9_-]+\./);
});

test("authenticated runtime workflow is manual/scheduled, read-only, and secret-backed", () => {
  assert.match(workflow, /workflow_dispatch/);
  assert.match(workflow, /permissions:\s*\n\s*contents: read/);
  assert.match(workflow, /Zhuge_AUTH_STORAGE_STATE_B64/);
  assert.match(workflow, /TDX_CLIENT_SECRET/);
  const authSecretLine = workflow.split("\n").find((line) => line.includes("Zhuge_AUTH_STORAGE_STATE_B64:"));
  assert.equal(authSecretLine.trim(), "Zhuge_AUTH_STORAGE_STATE_B64: ${{ secrets.Zhuge_AUTH_STORAGE_STATE_B64 }}");
});
