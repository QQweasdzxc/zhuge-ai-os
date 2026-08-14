const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const os = require("node:os");
const { resolveBrowserExecutable } = require("./browser-executable");

test("QJC workspace movement preserves engineering status, assignee, and Co + QJC evidence", async t => {
  const browserExecutable = resolveBrowserExecutable();
  if (!browserExecutable) return t.skip("Set CHROME_PATH, CHROMIUM_PATH, or BROWSER_EXECUTABLE to run the browser regression");
  const fixture = path.join(__dirname, "ai-board-completion-gate-browser.html");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "zhuge-ai-board-gate-"));
  const args = ["--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage", "--no-first-run", "--disable-background-networking", "--disable-component-update", "--disable-sync", "--window-size=1600,1000", `--user-data-dir=${profile}`, "--virtual-time-budget=5000", "--dump-dom", `file://${fixture}`];
  const output = await new Promise((resolve, reject) => {
    const child = spawn(browserExecutable, args, { encoding: "utf8" });
    let stdout = ""; let stderr = ""; let settled = false;
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); try { child.kill("SIGKILL"); } catch {} error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => finish(new Error(stderr || "Chrome timed out before producing DOM output")), 60000);
    child.stdout.on("data", chunk => { stdout += chunk; if (stdout.includes("</html>")) finish(null, stdout); });
    child.stderr.on("data", chunk => { stderr += chunk; }); child.on("error", error => finish(error)); child.on("close", code => stdout ? finish(null, stdout) : finish(new Error(stderr || `Chrome exited with code ${code}`)));
  });
  assert.match(output, /calls=button-task:ws-done,drag-task:ws-qjc/);
  assert.match(output, /engineeringDone=0/);
  assert.match(output, /assignees=QJC,QJC/);
  assert.match(output, /gptCheckboxes=0/);
  assert.match(output, /gptLabel=true/);
});
