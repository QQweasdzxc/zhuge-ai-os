const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(root, file), "utf8");

test("Lab portfolio reads use the canonical Investment projection through Shared ModuleContext", () => {
  const adapter = read("labs/investment/src/portfolio/readonly-adapter.mjs");
  const app = read("labs/investment/app.js");
  const html = read("labs/investment/index.html");
  assert.match(adapter, /investment_current_positions_view/);
  assert.match(adapter, /current_broker_positions_view/);
  assert.match(adapter, /context\.data\.select/);
  assert.match(adapter, /context\.security\?\.evaluate\?\.\("view"\)/);
  assert.match(adapter, /appAccess\.getCurrent\(\)/);
  assert.match(adapter, /appAccessGate\.isApproved\(access\)/);
  assert.match(html, /shared\/auth\/runtime-session-provider\.js/);
  assert.match(html, /shared\/security\/mfa-service\.js/);
  assert.match(app, /createReadOnlyPortfolioAdapter/);
});

test("Lab portfolio projection is allowlisted and does not request account or raw broker payload", () => {
  const adapter = read("labs/investment/src/portfolio/readonly-adapter.mjs");
  const primaryProjection = adapter.match(/const POSITION_COLUMNS = \[([\s\S]*?)\]\.join/);
  assert.ok(primaryProjection);
  assert.doesNotMatch(primaryProjection[1], /account|raw_broker_values|user_id|portfolio_id|source_id/);
  assert.doesNotMatch(adapter, /\.rpc\s*\(|\.insert\s*\(|\.update\s*\(|\.delete\s*\(|\.upsert\s*\(/i);
  assert.match(adapter, /writes: Object\.freeze\(\[\]\)/);
  assert.match(adapter, /SNAPSHOT_INCOMPLETE/);
});

test("Lab context contains no portfolio values in its route and US providers remain explicitly unconnected", () => {
  const app = read("labs/investment/app.js");
  const placeholder = read("labs/investment/src/portfolio/research-placeholder.mjs");
  assert.match(app, /research\/\$\{encodeURIComponent\(safeSymbol\)\}/);
  assert.doesNotMatch(app, /location\.hash[^\n]*(quantity|averageCost|investedCost|unrealized)/i);
  assert.doesNotMatch(app, /localStorage\.(?:getItem|setItem)\([^\n]*(?:portfolio|holding)/i);
  assert.match(app, /createUnconnectedResearch/);
  assert.match(placeholder, /status: "NOT_CONNECTED"/);
  assert.match(placeholder, /data: null/);
});

test("formal Investment source remains untouched by Lab-only work", () => {
  const { execFileSync } = require("node:child_process");
  const changed = execFileSync("git", ["diff", "HEAD", "--name-only", "--", "modules/investment"], { cwd: root, encoding: "utf8" })
    .trim().split("\n").filter(Boolean).sort();
  assert.deepEqual(changed, []);
});
