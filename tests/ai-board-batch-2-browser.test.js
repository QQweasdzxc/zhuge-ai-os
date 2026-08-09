const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const os = require("node:os");

const ROOT = path.join(__dirname, "..");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

test("AI Board Browser UI exposes contract checklist, explicit handoff, and working navigation", () => {
  if (!fs.existsSync(CHROME)) {
    assert.fail("Chrome executable is required for the browser regression test");
  }
  const fixture = path.join(__dirname, "ai-board-batch-2-browser.html");
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "zhuge-ai-board-batch2-"));
  const result = spawnSync(CHROME, [
    "--headless", "--disable-gpu", "--no-sandbox", "--disable-dev-shm-usage",
    "--no-first-run", `--user-data-dir=${profile}`,
    "--virtual-time-budget=2500", "--dump-dom", `file://${fixture}`
  ], { encoding: "utf8", timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  assert.ok(result.stdout, result.stderr || "Chrome produced no DOM output");
  const output = result.stdout;

  assert.match(output, /Development Contract／PM QA Checklist/);
  assert.match(output, /checklist-check/);
  assert.match(output, /Evidence/);
  assert.match(output, /退回 Co/);
  assert.match(output, /GPT Review 通過 → 交 QJC/);
  assert.match(output, /全部工作：已顯示所有正式 Cloud TASK/);
  assert.doesNotMatch(output, /QJC 可操作模式/);
  assert.doesNotMatch(output, /新增項目/);
  assert.doesNotMatch(output, /交接至 GPT/);
  assert.doesNotMatch(output, /PM QA 通過 → 完成/);
});
