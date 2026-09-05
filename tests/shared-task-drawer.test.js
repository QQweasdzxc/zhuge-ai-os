const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Drawer = require("../shared/components/task-drawer.js");
const Card = require("../shared/components/task-card.js");

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
  assert.match(html, /id="taskActivityList" class="shared-task-drawer-activity-list" data-shared-task-timeline/);
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

test("Shared Task Drawer applies the approved activity gap to the real card container", () => {
  const css = read("shared/theme/task-drawer.css");
  assert.match(css, /\.shared-task-drawer-activity-list\{[^}]*display:grid;gap:8px/);
  assert.match(css, /\.shared-task-drawer-activity-row\[data-activity-kind="human"\]\{[^}]*padding:10px 11px/);
  assert.match(css, /\.shared-task-drawer-activity-row\[data-activity-kind="system"\]\{[^}]*padding:8px 10px/);
  assert.doesNotMatch(css, /\.shared-task-drawer-activity-row\{[^}]*margin-(?:top|bottom):/);
});

test("Shared Task Drawer has no domain, Cloud, authorization, or WorkLog ownership", () => {
  const source = read("shared/components/task-drawer.js");
  assert.doesNotMatch(source, /supabase|rpc|worklog|engineering_checklist|engineering_activity/i);
  assert.match(read("shared/components/README.md"), /does not read Cloud data|不會讀取 Cloud/i);
  assert.match(read("docs/SHARED_TASK_DRAWER_COMPATIBILITY_ASSESSMENT.md"), /Formal Template C AI Board and\s+WorkTodo Checklist operations use the Shared Action Contract and the Board\s+canonical data path\./);
  assert.match(source, /renderProperties/);
  assert.match(read("shared/components/README.md"), /Shared Task UX Framework v1/);
});

test("Shared Task Card is the domain-neutral card shell for both consumers", () => {
  const html = Card.render({
    className: "card taskcard",
    code: "TASK-TEST",
    title: "共用卡片",
    summary: "共用摘要",
    actionsHtml: "<button>開啟</button>",
    attributes: { "data-task-id": "task-1", tabindex: "0" }
  });
  assert.match(html, /shared-task-card/);
  assert.match(html, /shared-task-card-code code/);
  assert.match(html, /shared-task-card-title/);
  assert.match(html, /shared-task-card-summary/);
  assert.match(html, /shared-task-card-actions/);
  assert.match(html, /data-task-id="task-1"/);
  const source = read("shared/components/task-card.js");
  assert.doesNotMatch(source, /supabase|DataService|localStorage|sessionStorage|rpc\s*\(/i);
});

test("Shared Task Card renders an optional Agreement Schedule badge without creating card interaction", () => {
  const single = Card.render({
    code: "WLTK-005",
    title: "工作待辦",
    agreementSchedule: { mode: "single", startDate: "2026-09-03", endDate: null },
    attributes: { "data-task-id": "task-5" }
  });
  assert.match(single, /class="shared-task-card-agreement"/);
  assert.match(single, /📅<\/span><span class="shared-task-card-agreement-value">9\/3<\/span>/);
  assert.match(single, /aria-label="約定日期：2026\/09\/03"/);
  assert.doesNotMatch(single, /data-agreement|data-task-property-action/);

  const period = Card.render({
    code: "WLTK-006",
    title: "多日工作",
    agreementSchedule: { mode: "period", startDate: "2026-09-02", endDate: "2026-09-03" }
  });
  assert.match(period, /9\/2 → 9\/3/);
  assert.match(period, /aria-label="約定期間：2026\/09\/02 至 2026\/09\/03"/);

  const singleWithIgnoredEnd = Card.render({
    code: "WLTK-008",
    title: "單日語意",
    agreementSchedule: { mode: "single", startDate: "2026-09-03", endDate: "2026-09-04" }
  });
  assert.match(singleWithIgnoredEnd, /9\/3/);
  assert.doesNotMatch(singleWithIgnoredEnd, /9\/4/);

  const incompletePeriod = Card.render({
    code: "WLTK-009",
    title: "不完整期間",
    agreementSchedule: { mode: "period", startDate: "2026-09-02", endDate: null }
  });
  assert.doesNotMatch(incompletePeriod, /shared-task-card-agreement/);

  const empty = Card.render({ code: "WLTK-007", title: "未設定" });
  assert.doesNotMatch(empty, /shared-task-card-agreement/);
});

test("AI Board is the first consumer and loads the shared Drawer assets", () => {
  const index = read("app/Board/ai/index.html");
  const runtime = read("shared/components/golden-master-runtime.js");
  assert.match(index, /shared\/components\/task-card\.js/);
  assert.match(index, /shared\/theme\/task-card\.css/);
  assert.match(index, /shared\/components\/task-drawer\.js/);
  assert.match(index, /shared\/theme\/task-drawer\.css/);
  assert.match(runtime, /ZhugeSharedTaskDrawer/);
  assert.match(runtime, /💬 工作進度/);
  assert.match(runtime, /PM 驗收通過/);
  assert.match(runtime, /allowAcceptanceAction/);
  assert.doesNotMatch(runtime, /QJC 驗收通過/);
  assert.doesNotMatch(runtime, /board_tasks.*(?:INSERT|UPDATE|DELETE)/i);
  assert.match(runtime, /ZhugeSharedTaskCard/);
});

test("WorkLog compatibility assessment preserves Date and Calendar as WorkLog domain fields", () => {
  const assessment = read("docs/SHARED_TASK_DRAWER_COMPATIBILITY_ASSESSMENT.md");
  assert.match(assessment, /dueDate/);
  assert.match(assessment, /Calendar/);
  assert.match(assessment, /WorkLog-specific functional field/);
  assert.match(assessment, /Canonical capability implemented/);
  assert.match(assessment, /Calendar capability/);
});
