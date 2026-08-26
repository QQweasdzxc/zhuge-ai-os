const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const { resolveBrowserExecutable } = require("./browser-executable");

const FIXTURE = path.join(__dirname, "worktodo-shared-drawer-browser.html");

function runBrowser(browserExecutable) {
  const args = [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
    "--no-first-run", "--disable-background-networking", "--disable-component-update",
    "--disable-sync", "--window-size=1600,1000",
    `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), "zhuge-worktodo-drawer-"))}`,
    "--virtual-time-budget=2200", "--dump-dom",
    `${pathToFileURL(FIXTURE).href}?consumer=worktodo-new`
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(browserExecutable, args, { encoding: "utf8" });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.kill("SIGKILL"); } catch { /* already exited */ }
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error(stderr || "Chrome timed out while rendering the WorkTodo Shared Drawer fixture")), 30000);
    const parse = () => {
      const match = stdout.match(/data-audit="([^\"]+)"/);
      if (!match) return null;
      return JSON.parse(match[1].replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
    };
    child.stdout.on("data", chunk => {
      stdout += chunk;
      const audit = parse();
      if (audit) finish(null, audit);
    });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", error => finish(error));
    child.on("close", code => {
      if (settled) return;
      const audit = parse();
      if (audit) return finish(null, audit);
      finish(new Error(stderr || `Chrome exited with code ${code} without WorkTodo Drawer audit output`));
    });
  });
}

test("WorkTodo uses the Shared Task Drawer presentation contract at runtime", async t => {
  const browserExecutable = resolveBrowserExecutable();
  if (!browserExecutable) return t.skip("Set CHROME_PATH, CHROMIUM_PATH, or BROWSER_EXECUTABLE to run the WorkTodo Shared Drawer browser regression");

  const audit = await runBrowser(browserExecutable);
  assert.equal(audit.framework, "v1");
  assert.equal(audit.gap, "8px");
  assert.equal(audit.rowGap, "8px");
  assert.match(audit.cardPadding, /16px/);
  assert.equal(audit.activityRows, 2);
  assert.equal(audit.systemActivityRendered, false);
  assert.equal(audit.systemActivityControls, false);
  assert.equal(audit.revisionOriginalRendered, false);
  assert.equal(audit.revisionLatestRendered, true);
  assert.equal(audit.tombstonedOriginalRendered, false);
  assert.equal(audit.activityReadPath, "engineering_activity_log");
  assert.equal(audit.legacyFallbackCalled, false);
  assert.equal(audit.legacyChecklistPathCalled, false);
  assert.ok(audit.canonicalChecklistReads >= 1);
  assert.equal(audit.hasSharedDrawer, true);
  assert.equal(audit.hasWorkTodoOwnedDrawer, false);
  assert.equal(audit.hasLegacyProperties, false);
  assert.equal(audit.hasAgreedDateProperty, true);
  assert.equal(audit.hasAgreedDateEditor, true);
  assert.equal(audit.agreementMode, "single");
  assert.equal(audit.agreementValue, "尚未設定");
  assert.equal(audit.agreementEditorAfterMetadataRow, true);
  assert.ok(audit.agreementEditorWidth > 0 && audit.agreementEditorWidth <= 360);
  assert.equal(audit.agreementEditorAlignmentDelta, 0);
  assert.equal(audit.metadataGridChildren, 4);
  assert.equal(audit.gptRemainsInMetadataRow, true);
  assert.equal(audit.agreedDateInputs, 1);
  assert.equal(audit.agreementPeriodHidden, true);
  assert.equal(audit.periodMode, "period");
  assert.equal(audit.periodDateInputs, 2);
  assert.equal(audit.clearMode, "single");
  assert.equal(audit.clearDateInputs, 1);
  assert.equal(audit.checklistDisabled, false);
  assert.equal(audit.urlLink, true);
});
