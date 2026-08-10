const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const os = require("node:os");
const { resolveBrowserExecutable } = require("./browser-executable");

const ROOT = path.join(__dirname, "..");

test("AI Board Browser UI exposes contract checklist, usage scenario, search, create flow, handoff, and navigation", async t => {
  const browserExecutable = resolveBrowserExecutable();
  if (!browserExecutable) return t.skip("Set CHROME_PATH, CHROMIUM_PATH, or BROWSER_EXECUTABLE to run the browser regression");
  const fixture = path.join(__dirname, "ai-board-batch-2-browser.html");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "zhuge-ai-board-batch2-"));
  const args = [
    "--headless=new", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
    "--no-first-run", "--disable-background-networking", "--disable-component-update", "--disable-sync",
    "--disable-features=Translate,MediaRouter,OptimizationHints", "--window-size=1600,1000", `--user-data-dir=${profile}`,
    "--virtual-time-budget=6000", "--dump-dom", `file://${fixture}`
  ];
  const output = await new Promise((resolve, reject) => {
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
  assert.ok(output, "Chrome produced no DOM output");

  assert.match(output, /Development Contract／PM QA Checklist/);
  assert.match(output, /GPT 先讀取正式來源，再由 QJC 驗收/);
  assert.match(output, /checklist-audit/);
  assert.match(output, /Co Developer QA 已完成/);
  assert.match(output, /Evidence/);
  assert.match(output, /退回 Co/);
  assert.match(output, /GPT Review 通過 → 交 QJC/);
  assert.match(output, /工作看板：顯示正式 Cloud TASK/);
  assert.match(output, /工程準則：📘 最高原則來自正式 engineering_knowledge/);
  assert.match(output, /系統藍圖：顯示目前正式系統組成/);
  assert.match(output, /搜尋「TASK-026」：找到 1 筆 TASK/);
  assert.match(output, /TASK 已建立並進入待辦/);
  assert.match(output, /data-zhuge-shared-navigation="true"/);
  assert.match(output, /data-shared-nav-item="worklog"/);
  assert.match(output, /data-shared-nav-item="tasks"/);
  assert.match(output, /data-shared-nav-item="investment"/);
  assert.match(output, /data-shared-nav-item="library"/);
  assert.match(output, /data-shared-nav-item="sync"/);
  assert.match(output, /data-shared-nav-item="settings"/);
  assert.match(output, /營帳/);
  assert.match(output, /AI Board/);
  assert.match(output, /工作看板/);
  assert.match(output, /工程準則/);
  assert.match(output, /系統藍圖/);
  assert.match(output, /nav-collapse-audit/);
  assert.match(output, /zhuge-nav-collapsed/);
  assert.match(output, /cross-workspace-audit/);
  assert.match(output, /worklog,tasks,investment,ai-board,ai-board-board,ai-board-principles,ai-board-system-map/);
  assert.match(output, /heading=1;duplicateMenu=0;children=3/);
  assert.ok(args.includes("--window-size=1600,1000"), "Browser QA must execute with a desktop viewport");
  assert.match(output, /history-audit/);
  assert.match(output, /歷史完成/);
  assert.doesNotMatch(output, /QJC 可操作模式/);
  assert.doesNotMatch(output, /新增項目/);
  assert.doesNotMatch(output, /交接至 GPT/);
  assert.doesNotMatch(output, /PM QA 通過 → 完成/);
});
