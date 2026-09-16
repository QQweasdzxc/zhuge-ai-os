const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { resolveBrowserExecutable } = require("../browser-executable");

const FIXTURE = path.join(__dirname, "ivtk-parity-browser.html");

function runBrowser(browserExecutable, windowSize = "1440,1000") {
  return new Promise((resolve, reject) => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "zhuge-ivtk-parity-"));
    const args = [
      "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
      "--no-first-run", "--disable-background-networking", "--disable-component-update",
      "--disable-sync", `--window-size=${windowSize}`, `--user-data-dir=${profile}`,
      "--virtual-time-budget=1000", "--dump-dom", `file://${FIXTURE}`
    ];
    const child = spawn(browserExecutable, args, { encoding: "utf8" });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error, output) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) return reject(error);
      child.kill("SIGKILL");
      resolve(output);
    };
    const timer = setTimeout(() => finish(new Error(stderr || "Chrome timed out during IVTK parity regression")), 30000);
    child.stdout.on("data", chunk => {
      stdout += chunk;
      if (stdout.includes('id="ivtk-parity-audit"')) finish(null, stdout);
    });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", error => finish(error));
    child.on("close", code => {
      if (!stdout) finish(new Error(stderr || `Chrome exited with code ${code}`));
      else finish(null, stdout);
    });
  });
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
