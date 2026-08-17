const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const os = require("node:os");
const { resolveBrowserExecutable } = require("./browser-executable");

const ROOT = path.join(__dirname, "..");

test("AI Board Browser UI exposes PM-readable drawer status, free workspace movement, and navigation", async t => {
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

  assert.doesNotMatch(output, /🛠️ 工程驗證狀態/);
  assert.match(output, /GPT 先讀取正式來源，再由 QJC 驗收/);
  assert.match(output, /checklist-audit/);
  assert.match(output, /🙋 需要你的操作/);
  assert.match(output, /PM Acceptance Criteria/);
  assert.match(output, /驗收通過/);
  assert.match(output, /退回修改/);
  assert.match(output, /engineering-records-audit/);
  assert.match(output, /⚙️ 工程紀錄/);
  assert.match(output, /data-shared-task-properties/);
  assert.match(output, /目前狀態/);
  assert.match(output, /工作內容/);
  assert.match(output, /📎 附件與交付物/);
  assert.match(output, /shared-task-attachment-list/);
  assert.match(output, /data-shared-task-timeline/);
  assert.match(output, /Engineering Evidence Detail/);
  assert.match(output, /Artifact \/ Build/);
  assert.match(output, /Co 開發驗證/);
  assert.match(output, /GPT 工程審查/);
  assert.match(output, /Evidence Reference/);
  assert.match(output, /新增工作進度/);
  assert.match(output, /人工工作進度 · Human Progress Note/);
  assert.match(output, /System Activity/);
  assert.match(output, /System Activity · Status/);
  assert.match(output, /System Activity · Workspace Move/);
  assert.match(output, /System Activity · Evidence/);
  assert.doesNotMatch(output, /Checklist／Evidence 原始資料/);
  assert.match(output, /aria-label="搜尋 TASK"/);
  assert.match(output, /data-work-code="TASK-026"/);
  assert.match(output, /GPT區/);
  assert.match(output, /Co區/);
  assert.match(output, /TASK 已建立並進入待辦/);
  assert.match(output, /data-zhuge-shared-navigation="true"/);
  assert.match(output, /data-shared-nav-item="worklog"/);
  assert.match(output, /data-shared-nav-item="tasks"/);
  assert.match(output, /data-shared-nav-item="investment"/);
  assert.match(output, /data-shared-nav-item="library"/);
  assert.match(output, /data-shared-nav-item="sync"/);
  assert.match(output, /data-shared-nav-item="settings"/);
  assert.match(output, /工作空間/);
  assert.match(output, /AI Board/);
  assert.match(output, /Version/);
  assert.match(output, /v0\.9\.0-alpha\.9\.13/);
  assert.match(output, /Build/);
  const build = JSON.parse(fs.readFileSync(path.join(ROOT, "version.json"), "utf8")).build;
  assert.match(output, new RegExp(build));
  assert.match(output, /工作看板/);
  assert.match(output, /工程準則/);
  assert.match(output, /系統藍圖/);
  assert.match(output, /nav-collapse-audit/);
  assert.match(output, /zhuge-nav-collapsed/);
  assert.match(output, /cross-workspace-audit/);
  // Engineering destinations live inside 控制台; the global rail keeps only
  // the canonical user-facing workspaces and system entry points.
  assert.match(output, /dashboard,worklog,tasks,investment,library,sync,settings/);
  assert.match(output, /heading=0;duplicateMenu=0;children=0/);
  assert.ok(args.includes("--window-size=1600,1000"), "Browser QA must execute with a desktop viewport");
  assert.match(output, /history-audit/);
  assert.match(output, /歷史完成/);
  assert.doesNotMatch(output, /QJC 可操作模式/);
  assert.doesNotMatch(output, /新增項目/);
  assert.doesNotMatch(output, /交接至 GPT/);
  assert.doesNotMatch(output, /PM QA 通過 → 完成/);
});
