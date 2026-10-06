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

function normalizedProductLoaders(source, productBuild) {
  return source.replace(/((?:src|href)=")([^"]+)(")/g, (all, start, url, end) => {
    if (url.includes("shared/config/template-release.js")) return all;
    return start + url.replace(/\?v=(202\d{5}-\d{4})\b/g, (cache, build) => {
      assert.equal(build, productBuild, "Product-governed loader must use the Product Build");
      return "?v=PRODUCT_BUILD";
    }) + end;
  });
}

function assertInvestmentReleaseBoundary({ changed, beforeManifest, manifest, product, beforeProduct, beforeHtml, html }) {
  const allowed = new Set(["modules/investment/index.html", "modules/investment/version.json"]);
  for (const file of changed) assert.ok(allowed.has(file), `Investment functional source changed: ${file}`);
  assert.deepEqual(Object.keys(manifest).sort(), Object.keys(beforeManifest).sort(), "manifest keys retained");
  for (const key of Object.keys(beforeManifest)) {
    if (!["version", "build"].includes(key)) assert.deepEqual(manifest[key], beforeManifest[key], `${key} retained`);
  }
  assert.equal(manifest.version, product.version);
  assert.equal(manifest.build, product.build);
  assert.equal(normalizedProductLoaders(html, product.build), normalizedProductLoaders(beforeHtml, beforeProduct.build), "only governed Product v= values may change");
}

test("formal Investment functional source remains untouched while governed Product release metadata may synchronize", () => {
  const { execFileSync } = require("node:child_process");
  const head = file => execFileSync("git", ["show", `HEAD:${file}`], { cwd: root, encoding: "utf8" });
  const changed = execFileSync("git", ["diff", "HEAD", "--name-only", "--", "modules/investment"], { cwd: root, encoding: "utf8" })
    .trim().split("\n").filter(Boolean);
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "--", "modules/investment"], { cwd: root, encoding: "utf8" })
    .trim().split("\n").filter(Boolean);
  assertInvestmentReleaseBoundary({ changed: [...changed, ...untracked],
    beforeManifest: JSON.parse(head("modules/investment/version.json")), manifest: JSON.parse(read("modules/investment/version.json")),
    product: JSON.parse(read("version.json")), beforeProduct: JSON.parse(head("version.json")),
    beforeHtml: head("modules/investment/index.html"), html: read("modules/investment/index.html") });
});

test("Investment release boundary rejects functional, manifest and Published C identity changes", () => {
  const beforeHtml = '<script src="./services/runtime.js?v=20261006-0629&feature=keep&security-contract=safe&pm-contract=stable"></script><script src="../../shared/config/template-release.js?v=20260915-1707"></script>';
  const html = beforeHtml.replace('runtime.js?v=20261006-0629', 'runtime.js?v=20261006-0845');
  const fixture = { changed: ["modules/investment/index.html", "modules/investment/version.json"], beforeManifest: { version: "old", build: "20261006-0629", module: "Investment", dataMode: "cloud" },
    manifest: { version: "new", build: "20261006-0845", module: "Investment", dataMode: "cloud" },
    beforeProduct: { build: "20261006-0629" }, product: { version: "new", build: "20261006-0845" }, beforeHtml, html };
  assertInvestmentReleaseBoundary(fixture);
  for (const file of ["services/a.js", "pages/a.js", "components/a.css", "models/a.js", "config/a.js"]) {
    assert.throws(() => assertInvestmentReleaseBoundary({ ...fixture, changed: [...fixture.changed, `modules/investment/${file}`] }), /functional source changed/);
  }
  for (const manifest of [{ ...fixture.manifest, dataMode: "local" }, { ...fixture.manifest, extra: true }, { version: "new", build: "20261006-0845", module: "Investment" }]) {
    assert.throws(() => assertInvestmentReleaseBoundary({ ...fixture, manifest }));
  }
  for (const altered of [html.replace('runtime.js', 'other.js'), html.replace('feature=keep', 'feature=changed'), html.replace('security-contract=safe', 'security-contract=changed'), html.replace('pm-contract=stable', 'pm-contract=changed'), html.replace('<script', '<script data-new="yes"'), html.replace('?v=20260915-1707', '?v=20261006-0845'), html.replace('runtime.js?v=20261006-0845', 'runtime.js?v=20261006-0629')]) {
    assert.throws(() => assertInvestmentReleaseBoundary({ ...fixture, html: altered }));
  }
});
