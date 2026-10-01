const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("Lab registry is the only AIOS Lab catalog and keeps Genspark source external", () => {
  const registry = JSON.parse(read("labs/registry.json"));
  assert.equal(registry.schemaVersion, 1);
  assert.equal(registry.labs.length, 1);
  assert.deepEqual(
    [registry.labs[0].category, registry.labs[0].status, registry.labs[0].enabled, registry.labs[0].currentGate],
    ["Investment", "EXPERIMENT", true, "PM_REVIEW"]
  );
  assert.match(registry.labs[0].localEntry, /^http:\/\/127\.0\.0\.1:/);
  assert.match(registry.labs[0].source, /^https:\/\/github\.com\//);
  assert.equal(registry.labs[0].licenseStatus, "UNCONFIRMED");
  assert.equal(fs.existsSync(path.join(root, "labs", "investment")), false);
  assert.match(read("labs/README.md"), /must never bundle/i);
});

test("Lab Center renders the registry safely and only links to loopback Lab entries", () => {
  const html = read("modules/labs/index.html");
  const script = read("modules/labs/labs-center.js");
  const nav = read("shared/components/zhuge-navigation.js");
  const router = read("app/router/index.js");
  assert.match(html, /data-external-root="\.\.\/\.\.\/" data-active-workspace="labs"/);
  assert.match(script, /\.\.\/\.\.\/labs\/registry\.json/);
  assert.match(script, /127\.0\.0\.1/);
  assert.match(script, /localhost/);
  assert.match(script, /textContent/);
  assert.doesNotMatch(script, /innerHTML/);
  assert.match(nav, /labs: \{ icon: "🧪", label: "Lab 實驗室"/);
  assert.match(nav, /labs: "modules\/labs\/"/);
  assert.match(nav, /\["library", "labs", "management", "settings"\]/);
  assert.match(nav, /GENERAL_USER_HIDDEN_ITEMS = Object\.freeze\(\[[^\]]*"labs"/);
  assert.match(router, /labs: "modules\/labs\/"/);
});

test("Lab Center reports source, gate, license and local-start instructions", () => {
  const script = read("modules/labs/labs-center.js");
  assert.match(script, /currentGate/);
  assert.match(script, /licenseStatus/);
  assert.match(script, /upstreamCommit/);
  assert.match(script, /http\.server 8765 --bind 127\.0\.0\.1/);
  assert.match(script, /Demo 會限制部分功能/);
});
