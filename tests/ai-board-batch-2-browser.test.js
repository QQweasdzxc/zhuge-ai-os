const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const os = require("node:os");
const { resolveBrowserExecutable } = require("./browser-executable");

const ROOT = path.join(__dirname, "..");

test("AI Board Browser UI exposes contract checklist, usage scenario, search, create flow, handoff, and navigation", t => {
  const browserExecutable = resolveBrowserExecutable();
  if (!browserExecutable) return t.skip("Set CHROME_PATH, CHROMIUM_PATH, or BROWSER_EXECUTABLE to run the browser regression");
  const fixture = path.join(__dirname, "ai-board-batch-2-browser.html");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "zhuge-ai-board-batch2-"));
  const result = spawnSync(browserExecutable, [
    "--headless", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
    "--no-first-run", `--user-data-dir=${profile}`,
    "--virtual-time-budget=2500", "--dump-dom", `file://${fixture}`
  ], { encoding: "utf8", timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  assert.ok(result.stdout, result.stderr || "Chrome produced no DOM output");
  const output = result.stdout;

  assert.match(output, /Development Contract／PM QA Checklist/);
  assert.match(output, /GPT 先讀取正式來源，再由 QJC 驗收/);
  assert.match(output, /checklist-check/);
  assert.match(output, /Evidence/);
  assert.match(output, /退回 Co/);
  assert.match(output, /GPT Review 通過 → 交 QJC/);
  assert.match(output, /全部工作：已顯示所有正式 Cloud TASK/);
  assert.match(output, /AI Board 首頁：顯示正式 Cloud TASK/);
  assert.match(output, /Engineering Center：左側固定區顯示已核准最高原則/);
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
  assert.doesNotMatch(output, /QJC 可操作模式/);
  assert.doesNotMatch(output, /新增項目/);
  assert.doesNotMatch(output, /交接至 GPT/);
  assert.doesNotMatch(output, /PM QA 通過 → 完成/);
});
