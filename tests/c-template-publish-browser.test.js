const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { spawn } = require("node:child_process");
const { resolveBrowserExecutable } = require("./browser-executable");

const FIXTURE = path.join(__dirname, "c-template-publish-browser.html");

function runBrowser(browserExecutable) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "zhuge-c-publish-"));
  const args = [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
    "--no-first-run", "--disable-background-networking", "--disable-component-update",
    "--disable-sync", "--window-size=1600,1000", `--user-data-dir=${profile}`,
    "--virtual-time-budget=3200", "--dump-dom", pathToFileURL(FIXTURE).href,
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
    const parse = () => {
      const match = stdout.match(/<pre id="c-publish-audit">([^<]*)<\/pre>/);
      return match ? JSON.parse(match[1]) : null;
    };
    const timer = setTimeout(() => finish(new Error(stderr || "Chrome timed out while rendering the C publish fixture")), 30000);
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
      finish(new Error(stderr || `Chrome exited with code ${code} without C publish audit output`));
    });
  });
}

test("C publish UI sends the current identity and keeps health check removed", async t => {
  const browserExecutable = resolveBrowserExecutable();
  if (!browserExecutable) return t.skip("Set CHROME_PATH, CHROMIUM_PATH, or BROWSER_EXECUTABLE to run the C publish browser regression");

  const audit = await runBrowser(browserExecutable);
  assert.equal(audit.build, "20260901-1610");
  assert.equal(audit.buttonBeforeClick, true);
  assert.equal(audit.buttonDisabledAfter, false);
  assert.equal(audit.publishCalls, 1);
  assert.deepEqual(audit.publishConsumerIds, ["c", "worktodo", "ai-board"]);
  assert.equal(audit.publishBuild, "20260901-1610");
  assert.deepEqual(audit.adoptCalls, ["c:20260901-1550", "c:20260901-1610"]);
  assert.equal(audit.publishedBuild, "20260901-1610");
  assert.match(audit.feedback, /Published C 已更新/);
  assert.equal(audit.healthEntry, false);
});
