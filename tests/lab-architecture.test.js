const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Lab registry exposes one Zhuge-owned investment Lab on a relative same-origin path", () => {
  const registry = JSON.parse(read("labs/registry.json"));
  assert.equal(registry.schemaVersion, 1);
  assert.equal(registry.labs.length, 1);
  assert.deepEqual(
    [registry.labs[0].category, registry.labs[0].status, registry.labs[0].enabled, registry.labs[0].currentGate],
    ["Investment", "EXPERIMENT", true, "PM_REVIEW"],
  );
  assert.equal(registry.labs[0].id, "zhuge-investment-sandbox");
  assert.equal(registry.labs[0].localEntry, "./investment/");
  assert.doesNotMatch(registry.labs[0].localEntry, /127\.0\.0\.1|localhost|https?:/i);
  assert.equal(fs.existsSync(path.join(root, "labs", "investment", "index.html")), true);
  assert.equal(fs.existsSync(path.join(root, "labs", "investment", "Zhuge Investment Sandbox.app")), false);
  assert.match(read("labs/README.md"), /same-origin/i);
});

test("Module A and root router keep exactly one Lab Center destination", () => {
  const center = read("labs/index.html");
  const legacyEntry = read("modules/labs/index.html");
  const script = read("modules/labs/labs-center.js");
  const nav = read("shared/components/zhuge-navigation.js");
  const router = read("app/router/index.js");
  assert.match(center, /data-active-workspace="labs"/);
  assert.match(center, /shared\/config\/version\.js/);
  assert.match(center, /\.\.\/modules\/labs\/labs-center\.js/);
  assert.match(legacyEntry, /location\.replace/);
  assert.match(script, /registry\.json/);
  assert.match(script, /url\.origin !== location\.origin/);
  assert.match(script, /進入 Lab/);
  assert.doesNotMatch(script, /127\.0\.0\.1|localhost|http\.server|Terminal|Demo|VIP|License Key/);
  assert.equal((nav.match(/labs: \{ icon: "🧪", label: "Lab 實驗室"/g) ?? []).length, 1);
  assert.match(nav, /labs: "labs\/"/);
  assert.match(router, /labs: "labs\/"/);
});

test("Lab investment is a static same-origin runtime with no local API server dependency", () => {
  const html = read("labs/investment/index.html");
  const app = read("labs/investment/app.js");
  const runtime = read("labs/investment/src/browser-runtime.mjs");
  assert.match(html, /\.\/styles\.css/);
  assert.match(html, /\.\/app\.js/);
  assert.match(html, /type="importmap"/);
  assert.match(html, /fast-xml-parser/);
  assert.match(app, /from "\.\/src\/browser-runtime\.mjs(?:\?v=[^"]*)?"/);
  assert.doesNotMatch(app, /fetch\("\/api\//);
  assert.doesNotMatch(html, /\/sandbox\//);
  assert.match(runtime, /SERVER_PROXY_REQUIRED/);
  assert.match(runtime, /openapi\.twse\.com\.tw/);
  assert.equal(fs.existsSync(path.join(root, "labs", "investment", "server.mjs")), false);
  assert.match(read("labs/investment/.gitignore"), /^node_modules\/$/m);
});

test("formal Investment source is not a Lab runtime dependency", () => {
  const runtime = read("labs/investment/src/browser-runtime.mjs");
  const html = read("labs/investment/index.html");
  assert.doesNotMatch(runtime, /modules\/investment/);
  assert.doesNotMatch(html, /modules\/investment/);
});
