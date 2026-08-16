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
    meta: [{ label: "工程狀態", value: "驗證中" }],
    sections: [
      { id: "content", title: "需求內容", html: "<p>Adapter-owned content</p>" },
      { id: "optional-checklist", title: "Task Checklist", hidden: true, html: "<p>Optional shared checklist</p>" },
      { id: "details", title: "工程詳細資料", html: "<p>Canonical evidence</p>", collapsible: true }
    ],
    activity: { title: "💬 工作進度紀錄", notesHtml: "<p>Human note</p>", html: "<p>System activity</p>" },
    footerHtml: "<button data-governance=\"cancelled\">取消 TASK</button>"
  });
  assert.match(html, /data-shared-task-drawer/);
  assert.match(html, /shared-task-drawer-grid/);
  assert.match(html, /shared-task-drawer-content/);
  assert.match(html, /shared-task-drawer-activity/);
  assert.match(html, /💬 工作進度紀錄/);
  assert.match(html, /Human note/);
  assert.match(html, /data-governance="cancelled"/);
  assert.match(html, /hidden data-shared-task-drawer-section="optional-checklist"/);
});

test("Shared Task Drawer has no domain, Cloud, authorization, or WorkLog ownership", () => {
  const source = read("shared/components/task-drawer.js");
  assert.doesNotMatch(source, /supabase|rpc|worklog|engineering_checklist|engineering_activity/i);
  assert.match(read("shared/components/README.md"), /does not read Cloud data|不會讀取 Cloud/i);
  assert.match(read("docs/SHARED_TASK_DRAWER_COMPATIBILITY_ASSESSMENT.md"), /WorkLog Runtime and Cloud data are unchanged/);
});

test("AI Board is the first consumer and loads the shared Drawer assets", () => {
  const index = read("app/Board/ai/index.html");
  const runtime = read("app/Board/ai/board-runtime.js");
  assert.match(index, /shared\/components\/task-drawer\.js/);
  assert.match(index, /shared\/theme\/task-drawer\.css/);
  assert.match(runtime, /ZhugeSharedTaskDrawer/);
  assert.match(runtime, /💬 工作進度紀錄/);
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
