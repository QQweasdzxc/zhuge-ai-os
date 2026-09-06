const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const os = require("node:os");
const { resolveBrowserExecutable } = require("./browser-executable");

const FIXTURE = path.join(__dirname, "creator-mfa-control-browser.html");

function runBrowser(browserExecutable, query) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "zhuge-creator-mfa-"));
  const args = [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
    "--no-first-run", "--disable-background-networking", "--disable-component-update", "--disable-sync",
    "--window-size=1440,900", `--user-data-dir=${profile}`, "--virtual-time-budget=2000", "--dump-dom",
    `file://${FIXTURE}?${query}`
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
      try { child.kill("SIGKILL"); } catch {}
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => finish(new Error(stderr || "Chrome timed out before producing DOM output")), 60000);
    child.stdout.on("data", chunk => {
      stdout += chunk;
      if (stdout.includes("</html>")) finish(null, stdout);
    });
    child.stderr.on("data", chunk => { stderr += chunk; });
    child.on("error", error => finish(error));
    child.on("close", code => {
      if (stdout) finish(null, stdout);
      else finish(new Error(stderr || `Chrome exited with code ${code}`));
    });
  });
}

test("Creator sees both independent MFA controls and Non-Creator sees none", async t => {
  const browserExecutable = resolveBrowserExecutable();
  if (!browserExecutable) return t.skip("Set CHROME_PATH, CHROMIUM_PATH, or BROWSER_EXECUTABLE to run the Creator MFA browser regression");

  const creatorOutput = await runBrowser(browserExecutable, "creator=true");
  assert.match(creatorOutput, /"creator":true/);
  assert.match(creatorOutput, /"tab":true/);
  assert.match(creatorOutput, /"section":true/);
  assert.match(creatorOutput, /進入 Investment 時要求二次驗證/);
  assert.match(creatorOutput, /修改重要投資資料時要求二次驗證/);
  assert.match(creatorOutput, /進入 AI Board 時要求二次驗證/);
  assert.match(creatorOutput, /⚪ 已關閉/);
  assert.match(creatorOutput, /🟢 已開啟/);
  assert.match(creatorOutput, /"localStorageKeys":\[\]/);
  assert.match(creatorOutput, /"sessionStorageKeys":\[\]/);

  const nonCreatorOutput = await runBrowser(browserExecutable, "creator=false");
  assert.match(nonCreatorOutput, /"creator":false/);
  assert.match(nonCreatorOutput, /"tab":false/);
  assert.match(nonCreatorOutput, /"section":false/);
  assert.doesNotMatch(nonCreatorOutput, /進入 Investment 時要求二次驗證/);
  assert.doesNotMatch(nonCreatorOutput, /進入 AI Board 時要求二次驗證/);
});
