const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require("playwright");
const { resolveBrowserExecutable, fixtureURL } = require("./browser-executable");

const ROOT = path.join(__dirname, "..");

test("AI Board Browser UI exposes PM-readable drawer status, free workspace movement, and navigation", async t => {
  const browserExecutable = resolveBrowserExecutable();
  if (!browserExecutable) return t.skip("Set CHROME_PATH, CHROMIUM_PATH, or BROWSER_EXECUTABLE to run the browser regression");
  const fixture = path.join(__dirname, "ai-board-batch-2-browser.html");
  const build = JSON.parse(fs.readFileSync(path.join(ROOT, "version.json"), "utf8")).build;
  const preparedFixture = path.join(__dirname, `.ai-board-batch-2-browser-${process.pid}.html`);
  const fixtureSource = fs.readFileSync(fixture, "utf8").replaceAll("__RUNTIME_BUILD__", build);
  fs.writeFileSync(preparedFixture, fixtureSource);
  t.after(() => fs.rmSync(preparedFixture, { force: true }));
  const browser = await chromium.launch({
    headless: true,
    executablePath: browserExecutable,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-background-networking"]
  });
  t.after(() => browser.close());
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto(await fixtureURL(preparedFixture), { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => [
    "checklist-audit", "drawer-markup-audit", "board-nav-audit", "principles-nav-audit",
    "system-map-nav-audit", "search-audit", "history-audit", "nav-collapse-audit",
    "cross-workspace-audit", "ai-board-ia-audit", "golden-master-column-audit"
  ].every(id => document.getElementById(id)), null, { timeout: 30000 });
  const output = await page.content();
  assert.ok(output, "Chrome produced no DOM output");

  assert.doesNotMatch(output, /🛠️ 工程驗證狀態/);
  assert.match(output, /GPT 先讀取正式來源，再由 QJC 驗收/);
  assert.match(output, /checklist-audit/);
  assert.match(output, /🙋 需要你的操作/);
  assert.match(output, /PM Acceptance Criteria/);
  assert.match(output, /驗收通過/);
  assert.match(output, /退回修改/);
  assert.doesNotMatch(output, /engineering-records-audit/);
  assert.doesNotMatch(output, /⚙️ 工程紀錄/);
  assert.doesNotMatch(output, /⋯ 更多/);
  assert.match(output, /data-shared-task-properties/);
  assert.match(output, /golden-master-column/);
  assert.match(output, /golden-master-column-audit/);
  assert.match(output, /background=rgb\(18, 28, 44\)/);
  assert.doesNotMatch(output, /data-task-property-action="due-date"/);
  assert.doesNotMatch(output, /尚未設定日期/);
  assert.doesNotMatch(output, /task-due-date-section/);
  assert.doesNotMatch(output, /data-task-due-date-edit/);
  assert.match(output, /目前狀態/);
  assert.match(output, /工作內容/);
  assert.match(output, /shared-task-drawer-activity-top/);
  assert.match(output, /data-task-checklist-panel/);
  assert.match(output, /工作 Checklist/);
  assert.match(output, /1 \/ 2/);
  assert.match(output, /📎 附件/);
  assert.match(output, /shared-task-attachment-list/);
  assert.match(output, /data-shared-task-timeline/);
  assert.doesNotMatch(output, /Engineering Evidence Detail/);
  assert.doesNotMatch(output, /Artifact \/ Build/);
  assert.doesNotMatch(output, /Evidence Reference/);
  assert.match(output, /新增工作進度/);
  assert.match(output, /工作進度/);
  assert.match(output, /System Activity 與 Workspace Audit 保留於正式紀錄/);
  assert.doesNotMatch(output, /System Activity · (Status|Workspace Move|Evidence)/);
  assert.doesNotMatch(output, /Checklist／Evidence 原始資料/);
  assert.match(output, /aria-label="搜尋 TASK"/);
  assert.match(output, /data-work-code="TASK-026"/);
  assert.match(output, /GPT區/);
  assert.match(output, /Co區/);
  assert.match(output, /TASK 已建立並進入待辦/);
  assert.match(output, /data-zhuge-shared-navigation="true"/);
  assert.match(output, /data-shared-nav-item="worklog"/);
  assert.match(output, /data-shared-nav-item="tasks-new"/);
  assert.doesNotMatch(output, /data-shared-nav-item="tasks"/);
  assert.match(output, /data-shared-nav-item="investment"/);
  assert.match(output, /data-shared-nav-item="library"/);
  assert.match(output, /data-shared-nav-item="labs"/);
  assert.match(output, /title="Lab 實驗室"/);
  assert.match(output, /data-shared-nav-item="sync"/);
  assert.match(output, /data-shared-nav-item="settings"/);
  assert.match(output, /工作空間/);
  assert.match(output, /AI Board/);
  assert.doesNotMatch(output, /class="sidebar-version-summary"/);
  assert.match(output, /Build/);
  assert.match(output, new RegExp(build));
  assert.match(output, /工作看板/);
  assert.match(output, /工程準則/);
  assert.match(output, /系統藍圖/);
  assert.match(output, /nav-collapse-audit/);
  assert.match(output, /zhuge-nav-collapsed/);
  assert.match(output, /collapsed-visible=worklog,tasks-new,procurement,investment,skyeye,library,labs,sync,management,settings/);
  assert.match(output, /collapsed-new-tasks-tag=A/);
  assert.match(output, /collapsed-new-tasks-title=工作待辦/);
  assert.match(output, /collapsed-new-tasks-href=.*app\/Board\/worktodo\//);
  assert.match(output, /cross-workspace-audit/);
  // The global rail exposes the canonical user-facing workspaces and system
  // entries, including the standalone management module.
  assert.match(output, /dashboard,worklog,tasks-new,procurement,investment,skyeye,library,labs,sync,management,settings/);
  assert.match(output, /heading=0;duplicateMenu=0;children=0/);
  assert.deepEqual(page.viewportSize(), { width: 1600, height: 1000 }, "Browser QA must execute with a desktop viewport");
  assert.match(output, /history-audit/);
  assert.match(output, /歷史完成/);
  assert.doesNotMatch(output, /QJC 可操作模式/);
  assert.doesNotMatch(output, /新增項目/);
  assert.doesNotMatch(output, /交接至 GPT/);
  assert.doesNotMatch(output, /PM QA 通過 → 完成/);
});
