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
  assert.doesNotMatch(adapter, /current_broker_positions_view/);
  assert.match(adapter, /loadCurrentPositions/);
  assert.match(adapter, /loadClosedPositions/);
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
  assert.match(adapter, /position_status=eq\.current&quantity=gt\.0/);
  assert.match(adapter, /user_id=eq\./);
  assert.match(adapter, /portfolio_id=eq\./);
});

test("Lab route contains no portfolio values and TW/US research keeps explicit market identity", () => {
  const app = read("labs/investment/app.js");
  const provider = read("labs/investment/src/providers/lab-market-provider.mjs");
  const edge = read("supabase/functions/investment-intelligence-read/index.ts");
  assert.match(app, /research\/\$\{normalizedMarket\}\/\$\{encodeURIComponent\(safeSymbol\)\}/);
  assert.doesNotMatch(app, /location\.hash[^\n]*(quantity|averageCost|investedCost|unrealized)/i);
  assert.doesNotMatch(app, /localStorage\.(?:getItem|setItem)\([^\n]*(?:portfolio|holding)/i);
  assert.match(app, /marketCode\(market\)/);
  assert.match(provider, /MARKETS\.has\(requestedMarket\)/);
  assert.match(provider, /MARKETS\.has\(market\)/);
  assert.match(provider, /SYMBOL_REQUEST_INVALID/);
  assert.match(provider, /getTaiwanMarketScan/);
  assert.match(edge, /function marketOf\(value: unknown\): Market \| ""/);
  assert.match(edge, /const market = marketOf\(input\.market\)/);
  assert.match(edge, /if \(!market \|\| \(suffixVenue && market !== "TW"\)\) return null/);
  assert.doesNotMatch(edge, /\^\\d\{4,6\}\$[^\n]{0,80}\? "TW" : "US"/, "Edge must not infer market from ticker width or alpha/numeric shape");
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
  const allowed = new Set(["modules/investment/index.html", "modules/investment/version.json", "modules/investment/assets/investment.css", "modules/investment/components/module-shell.js", "modules/investment/components/holding-card-presentation.js", "modules/investment/services/investment-intelligence-providers.js"]);
  for (const file of changed) assert.ok(allowed.has(file), `Investment functional source changed: ${file}`);
  assert.deepEqual(Object.keys(manifest).sort(), Object.keys(beforeManifest).sort(), "manifest keys retained");
  for (const key of Object.keys(beforeManifest)) {
    if (!["version", "build"].includes(key)) assert.deepEqual(manifest[key], beforeManifest[key], `${key} retained`);
  }
  assert.equal(manifest.version, product.version);
  assert.equal(manifest.build, product.build);
  const normalized = (source, build) => normalizedProductLoaders(source, build)
    .replace(/\n?\s*<script src="..\/..\/shared\/components\/zhuge-functional-tabs.js\?v=PRODUCT_BUILD"><\/script>/g, "")
    .replace(/\n?\s*<link rel="stylesheet" href="..\/..\/shared\/theme\/zhuge-functional-tabs.css\?v=PRODUCT_BUILD">/g, "");
  assert.equal(normalized(html, product.build), normalized(beforeHtml, beforeProduct.build), "only Product v= and the shared Functional Tabs adapter loader may change");
}

test("Official Investment presentation stays untouched while the shared market provider authority may add explicit TW/US identity", () => {
  const { execFileSync } = require("node:child_process");
  const head = file => execFileSync("git", ["show", `HEAD:${file}`], { cwd: root, encoding: "utf8" });
  const changed = execFileSync("git", ["diff", "HEAD", "--name-only", "--", "modules/investment"], { cwd: root, encoding: "utf8" })
    .trim().split("\n").filter(Boolean);
  const untracked = execFileSync("git", ["ls-files", "--others", "--exclude-standard", "--", "modules/investment"], { cwd: root, encoding: "utf8" })
    .trim().split("\n").filter(Boolean);
  // The PM-authorized Holding presentation file and governed metadata may only
  // change the approved display boundary. Compare every
  // existing route/focus rendering to HEAD, not merely an allowlist of paths.
  const vm = require("node:vm");
  const shell = source => { const context = { module: { exports: {} } }; vm.runInNewContext(source, context); return context.module.exports; };
  const oldShell = shell(head("modules/investment/components/module-shell.js"));
  const newShell = shell(read("modules/investment/components/module-shell.js"));
  assert.deepEqual(JSON.parse(JSON.stringify(newShell.primaryNavigation)), JSON.parse(JSON.stringify(oldShell.primaryNavigation)));
  assert.deepEqual(JSON.parse(JSON.stringify(newShell.labels)), JSON.parse(JSON.stringify(oldShell.labels)));
  assert.equal(newShell.navigationIsCurrent.toString(), oldShell.navigationIsCurrent.toString());
  const destinations = html => [...html.matchAll(/<(?:a|button)\b([^>]*)>([\s\S]*?)<\/(?:a|button)>/g)].map(([, attrs, body]) => {
    const route = attrs.match(/data-investment-route="([^"]+)"/)?.[1] || attrs.match(/href="[^"]*\/qa\/([^/?#]+)(?:\?[^\"]*)?"/)?.[1] || "";
    const className = attrs.match(/class="([^"]+)"/)?.[1] || "";
    const label = body.replace(/<[^>]*>/g, "").replace(/\s+/g, "").trim();
    return route && label ? { route, label, active: /(?:^|\s)(?:active|is-current)(?:\s|$)/.test(className) || /aria-current="page"|aria-selected="true"/.test(attrs) } : null;
  }).filter(Boolean);
  for (const activePage of Object.keys(oldShell.labels)) for (const activeFocus of ["", "watchlist", "research", "advisor", "realtime", "today-focus"]) for (const asLinks of [true,false]) {
    const state = { activePage, activeFocus }, options = { asLinks, hrefFor: item => "/qa/" + item.route + "?focus=" + (item.focus || "") };
    assert.deepEqual(destinations(newShell.renderPrimaryNavigation(state, options)), destinations(oldShell.renderPrimaryNavigation(state, options)), "primary tab destinations/labels/active state retained");
    assert.deepEqual(destinations(newShell.renderToolNavigation(state, options)), destinations(oldShell.renderToolNavigation(state, options)), "disclosed tool destinations/labels/active state retained");
  }
  const nonTabCss = css => css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/([^{}]+)\{([^{}]*)\}/g, (all, selector) => /\.investment-(?:primary-nav|content-tabs|tab|nav-item|tool-nav|tool-menu(?:-item)?)(?![\w-])/.test(selector) ? "" : all).replace(/\s+/g, "");
  assert.equal(nonTabCss(read("modules/investment/assets/investment.css")), nonTabCss(head("modules/investment/assets/investment.css")), "all Investment content CSS stays identical");
  const providerSource = read("modules/investment/services/investment-intelligence-providers.js");
  assert.match(providerSource, /const suppliedMarket = text\(request\.market\)\.toUpperCase\(\)/);
  assert.match(providerSource, /if \(market !== "TW" && market !== "US"\) return null/);
  assert.match(providerSource, /input\.symbols \|\| input\.positions \|\| \[\]/);
  assert.doesNotMatch(providerSource, /\["2330",\s*"0050",\s*"AAPL"\]/);
  assert.doesNotMatch(providerSource, /(?:supabase|client)\.from\s*\(/i, "shared provider does not query or mutate Product tables");
  assert.doesNotMatch(providerSource, /SUPABASE_SERVICE_ROLE|service_role/i);
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
