const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { resolveBrowserExecutable, browserDOM } = require("../browser-executable");

const FIXTURE = path.join(__dirname, "ivtk-parity-browser.html");

async function runBrowser(browserExecutable, windowSize = "1440,1000") {
  const output = await browserDOM(browserExecutable, FIXTURE, { ready: '#ivtk-parity-audit', width: Math.max(500, Number(windowSize.split(",")[0])), height: Number(windowSize.split(",")[1]) });
  return output;
}

async function readAudit(t, windowSize) {
  const browserExecutable = resolveBrowserExecutable();
  if (!browserExecutable) {
    t.skip("Set CHROME_PATH, CHROMIUM_PATH, or BROWSER_EXECUTABLE to run the IVTK parity browser regression");
    return null;
  }
  const output = await runBrowser(browserExecutable, windowSize);
  const match = output.match(/<pre id="ivtk-parity-audit">([^<]*)<\/pre>/);
  assert.ok(match, "Chrome did not emit the IVTK parity audit");
  return JSON.parse(match[1]);
}

function assertParityAudit(audit) {
  assert.equal(audit.status, "match");
  assert.equal(audit.gapCount, 0);
  assert.equal(audit.fingerprint, "MATCH");
  assert.deepEqual(audit.markers, [true, true, true, true]);
  assert.equal(audit.workspaceCount, 2);
  assert.equal(audit.cardCount, 1);
  assert.equal(audit.canonicalCard, true);
  assert.equal(audit.customBoardFrameworkAbsent, true);
  assert.equal(audit.drawer, true);
  assert.equal(audit.drawerContract, true);
  assert.equal(audit.boardScrollContained, true);
  assert.equal(audit.runtimeMethods, true);
}

test("Investment IVTK desktop surface matches the C Mother Template contract", async t => {
  const audit = await readAudit(t, "1440,1000");
  if (!audit) return;
  assertParityAudit(audit);
  assert.equal(audit.viewport.width, 1440);
  assert.equal(audit.documentOverflowFree, true);
});

test("Investment IVTK mobile surface preserves the C responsive contract", async t => {
  const audit = await readAudit(t, "390,844");
  if (!audit) return;
  assertParityAudit(audit);
  // Chrome headless enforces a 500 CSS-pixel minimum viewport. The test still
  // exercises the responsive layout at that minimum and verifies the requested
  // mobile window does not create document overflow.
  assert.ok(audit.viewport.width >= 390 && audit.viewport.width <= 500);
  assert.ok(audit.viewport.height > 0);
  assert.equal(audit.documentOverflowFree, true, JSON.stringify(audit));
});
