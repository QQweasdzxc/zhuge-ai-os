const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ReleaseGovernance = require("../tools/release-governance");

const ROOT = path.resolve(__dirname, "..");
const read = relativePath => fs.readFileSync(path.join(ROOT, relativePath), "utf8");
const BUILD = JSON.parse(read("version.json")).build;

test("TASK-088 successor owns one shared responsive/accessibility layer", () => {
  const css = read("shared/theme/responsive-modernization.css");
  assert.match(css, /--zhuge-responsive-gutter/);
  assert.match(css, /text-size-adjust: 100%/);
  assert.match(css, /min-height: var\(--zhuge-touch-target-min\)/);
  assert.match(css, /safe-area-bottom/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /forced-colors/);
  assert.match(css, /prefers-contrast/);
  assert.match(css, /overflow-wrap: anywhere/);
  assert.match(css, /zhuge-responsive-table/);
  assert.doesNotMatch(css, /(?:investment|worktodo|ai-board|worklog|procurement)/i);
});

test("runtime surfaces use the Candidate Build while public surfaces use the shared asset revision", () => {
  const runtimeSurfaces = [
    "index.html",
    "app/dashboard/index.html",
    "app/Board/worktodo/index.html",
    "app/Board/ai/index.html",
    "app/Board/procurement/index.html",
    "app/Board/template-preview/index.html",
    "app/Board/investment/index.html",
    "modules/investment/index.html",
    "modules/worklog/index.html",
    "modules/worklog/chat/index.html"
  ];
  for (const file of runtimeSurfaces) {
    const source = read(file);
    assert.match(source, new RegExp(`responsive-modernization\\.css\\?v=${BUILD}`), `${file} must load Candidate CSS`);
    assert.match(source, /viewport-fit=cover/, `${file} must preserve safe-area viewport metadata`);
    assert.doesNotMatch(source, /user-scalable\s*=\s*no|max(?:imum)?-scale\s*=\s*1/i, `${file} must not disable zoom`);
  }

  // Public/legal pages are source artifacts but not Runtime Build-identity
  // surfaces in release-governance.js (RUNTIME_SCAN_ROOTS). Their CSS cache
  // token identifies the shared asset revision and must not be coupled to each
  // Candidate's version.json build.
  const publicSurfaces = [
    "product/index.html",
    "privacy/index.html",
    "terms/index.html",
    "scopes/index.html",
    "google-data/index.html",
    "support/index.html",
    "contact/index.html"
  ];
  const publicAssetRevisions = new Set();
  const releaseIdentity = ReleaseGovernance.readIdentitySnapshot(ROOT);
  for (const file of publicSurfaces) {
    const source = read(file);
    const cacheRevision = source.match(/responsive-modernization\.css\?v=(202\d{5}-\d{4})/);
    assert.ok(cacheRevision, `${file} must load the shared responsive asset with a revision token`);
    publicAssetRevisions.add(cacheRevision[1]);
    assert.equal(
      releaseIdentity.cacheBusters.some(item => item.file === file),
      false,
      `${file} is not part of the Candidate Runtime Build cache-buster contract`
    );
    assert.match(source, /viewport-fit=cover/, `${file} must preserve safe-area viewport metadata`);
    assert.doesNotMatch(source, /user-scalable\s*=\s*no|max(?:imum)?-scale\s*=\s*1/i, `${file} must not disable zoom`);
  }
  assert.equal(publicAssetRevisions.size, 1, "public/legal consumers of the shared CSS must use one shared asset revision");
});

test("responsive source preview covers shared board, drawer, states and long content", () => {
  const fixture = read("tests/task-088-responsive-preview.html");
  for (const marker of [
    "responsive-board", "responsive-table", "shared-task-drawer-panel",
    "zhuge-state", "insufficient-evidence", "zhuge-floating-hub",
    "viewport-fit"
  ]) assert.match(fixture, new RegExp(marker), `${marker} preview marker missing`);
});

test("mobile drawer keeps safe-area and dynamic viewport rules authoritative", () => {
  const css = read("shared/theme/responsive-modernization.css");
  assert.match(css, /shared-task-drawer\)\s*\{[\s\S]*padding-block-start: var\(--zhuge-safe-area-top/);
  assert.match(css, /shared-task-drawer-panel\)\s*\{[\s\S]*max-height: 100dvh/);
  assert.match(css, /orientation:\s*landscape/);
  assert.match(css, /max-height:\s*520px/);
  assert.match(css, /shared-task-drawer-grid\)\s*\{[\s\S]*overflow-y:\s*auto/);
});
