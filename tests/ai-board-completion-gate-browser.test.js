const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const os = require("node:os");
const { resolveBrowserExecutable } = require("./browser-executable");

test("Drawer PM acceptance and QJC card drag share the formal completion lifecycle", async t => {
  const browserExecutable = resolveBrowserExecutable();
  if (!browserExecutable) return t.skip("Set CHROME_PATH, CHROMIUM_PATH, or BROWSER_EXECUTABLE to run the browser regression");
  const fixture = path.join(__dirname, "ai-board-completion-gate-browser.html");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "zhuge-ai-board-gate-"));
  const args = ["--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--no-first-run", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--window-size=1600,1000", `--user-data-dir=${profile}`, "--virtual-time-budget=6000", "--dump-dom", `file://${fixture}`];
  const output = await new Promise((resolve, reject) => {
    const child = spawn(browserExecutable, args, { encoding: "utf8" });
    let stdout = ""; let stderr = ""; let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); try { child.kill("SIGKILL"); } catch {} error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => finish(new Error(stderr || "Chrome timed out before producing DOM output")), 60000);
    child.stdout.on("data", chunk => { stdout += chunk; if (stdout.includes("completion-gate-audit")) finish(null, stdout); });
    child.stderr.on("data", chunk => { stderr += chunk; }); child.on("error", error => finish(error)); child.on("close", code => stdout ? finish(null, stdout) : finish(new Error(stderr || `Chrome exited with code ${code}`)));
  });
  const audit = output.match(/id="completion-gate-audit"[^>]*>([^<]*)/)?.[1] || "";
  assert.match(audit, /calls=pm-acceptance:button-task:pass,pm-acceptance:drag-task:pass/);
  assert.match(audit, /result=button-task:done:completed:QJC\|drag-task:done:completed:QJC/);
  assert.match(audit, /sameFormalResult=true/);
  assert.match(audit, /audit=button-task:task_completed_after_pm_acceptance:pm_acceptance_pass:completed\|drag-task:task_completed_after_pm_acceptance:pm_acceptance_pass:completed/);
  assert.match(audit, /moveCalls=0/);
  assert.match(audit, /gptCheckboxes=0/);
  assert.match(audit, /gptLabel=true/);
  assert.match(audit, /errors=$/);
});
