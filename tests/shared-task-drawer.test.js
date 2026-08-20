const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Drawer = require("../shared/components/task-drawer.js");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("Shared Task Drawer renders a reusable two-column presentation shell", () => {
  const html = Drawer.render({
    title: "TASK-TEST｜Shared Drawer",
    subtitle: "AI Board · Shared Task Drawer",
    properties: [{ key: "status", icon: "◉", label: "目前狀態", value: "等待 PM 驗收" }, { key: "due-date", action: "due-date", interactive: true, icon: "📅", label: "日期", value: "尚未設定日期" }],
    sections: [
      { id: "content", title: "需求內容", html: "<p>Adapter-owned content</p>" },
      { id: "optional-checklist", title: "Task Checklist", hidden: true, html: "<p>Optional shared checklist</p>" },
      { id: "details", title: "工程詳細資料", html: "<p>Canonical evidence</p>", collapsible: true }
    ],
    activity: { title: "💬 工作進度紀錄", topHtml: "<details data-task-checklist-panel><summary>☑ 工作 Checklist <span data-task-checklist-count>1 / 2</span></summary></details>", composerHtml: "<textarea>進度</textarea>", notesHtml: "<p>Human note</p>", html: "<p>System activity</p>" },
    footerHtml: "<button data-governance=\"cancelled\">取消 TASK</button>"
  });
  assert.match(html, /data-shared-task-drawer/);
  assert.match(html, /data-shared-task-framework="v1"/);
  assert.match(html, /data-shared-task-properties/);
  assert.match(html, /data-task-property="status"/);
  assert.match(html, /data-task-property-action="due-date"/);
  assert.match(html, /class="shared-task-drawer-property is-interactive"/);
  assert.match(html, /data-shared-task-region="work-body"/);
  assert.match(html, /data-shared-task-region="activity"/);
  assert.match(html, /data-shared-task-timeline/);
  assert.match(html, /shared-task-drawer-activity-top/);
  assert.match(html, /data-task-checklist-panel/);
  assert.match(html, /shared-task-drawer-grid/);
  assert.match(html, /shared-task-drawer-content/);
  assert.match(html, /shared-task-drawer-activity/);
  assert.match(html, /💬 工作進度紀錄/);
  assert.match(html, /Human note/);
  assert.match(html, /<textarea>進度<\/textarea>/);
  assert.match(html, /data-governance="cancelled"/);
  assert.match(html, /hidden data-shared-task-drawer-section="optional-checklist"/);
});

test("Shared Task Drawer has no domain, Cloud, authorization, or WorkLog ownership", () => {
  const source = read("shared/components/task-drawer.js");
  assert.doesNotMatch(source, /supabase|rpc|worklog|engineering_checklist|engineering_activity/i);
  assert.match(read("shared/components/README.md"), /does not read Cloud data|不會讀取 Cloud/i);
  assert.match(read("docs/SHARED_TASK_DRAWER_COMPATIBILITY_ASSESSMENT.md"), /WorkLog Runtime and Cloud data are unchanged/);
  assert.match(source, /renderProperties/);
  assert.match(read("shared/components/README.md"), /Shared Task UX Framework v1/);
});

test("AI Board is the first consumer and loads the shared Drawer assets", () => {
  const index = read("app/Board/ai/index.html");
  const runtime = read("app/Board/ai/board-runtime.js");
  assert.match(index, /shared\/components\/task-drawer\.js/);
  assert.match(index, /shared\/theme\/task-drawer\.css/);
  assert.match(runtime, /ZhugeSharedTaskDrawer/);
  assert.match(runtime, /💬 工作進度/);
  assert.match(runtime, /PM 驗收通過/);
  assert.match(runtime, /allowAcceptanceAction/);
  assert.doesNotMatch(runtime, /QJC 驗收通過/);
  assert.doesNotMatch(runtime, /board_tasks.*(?:INSERT|UPDATE|DELETE)/i);
});

test("WorkLog compatibility assessment preserves Date and Calendar as WorkLog domain fields", () => {
  const assessment = read("docs/SHARED_TASK_DRAWER_COMPATIBILITY_ASSESSMENT.md");
  assert.match(assessment, /dueDate/);
  assert.match(assessment, /Calendar/);
  assert.match(assessment, /no WorkLog Runtime, data,[\s\S]*Calendar Sync/);
  assert.match(assessment, /Not implemented in current WorkLog mapping/);
});
