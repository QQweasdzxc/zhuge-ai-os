const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const Adapter = require("../modules/worklog/components/worktodo-task-adapter.js");
const Drawer = require("../shared/components/task-drawer.js");
const Card = require("../shared/components/task-card.js");

test("WorkTodo adapter normalizes domain fields and newest-first journal", () => {
  const view = Adapter.normalize({
    id: "task-1",
    cloudId: "cloud-1",
    title: "  補充採購資料  ",
    note: "整理供應商回覆",
    status: "done",
    progress: 40,
    priority: "p1",
    userPinned: true,
    dueDate: "2026-08-25T12:00:00.000Z",
    completedAt: "2026-08-20T01:00:00.000Z",
    completedNote: "已完成"
  }, [
    { id: "old", content: "先確認需求", created_at: "2026-08-18T01:00:00.000Z", entry_type: "progress" },
    { id: "new", content: "已完成確認", created_at: "2026-08-19T01:00:00.000Z", entry_type: "completion" }
  ]);

  assert.deepEqual({
    id: view.id,
    cloudId: view.cloudId,
    title: view.title,
    note: view.note,
    status: view.status,
    progress: view.progress,
    priority: view.priority,
    userPinned: view.userPinned,
    dueDate: view.dueDate,
    completedAt: view.completedAt
  }, {
    id: "task-1",
    cloudId: "cloud-1",
    title: "補充採購資料",
    note: "整理供應商回覆",
    status: "completed",
    progress: 100,
    priority: "p1",
    userPinned: true,
    dueDate: "2026-08-25",
    completedAt: "2026-08-20T01:00:00.000Z"
  });
  assert.deepEqual(view.journal.map(entry => entry.id), ["new", "old"]);
  assert.equal(view.journal[0].entryType, "completion");
});

test("WorkTodo adapter renders the shared Drawer without owning Cloud access", () => {
  const html = Adapter.render({ id: "task-1", title: "補充採購資料", note: "整理供應商回覆", status: "in_progress", progress: 25, priority: "p2" }, {
    drawer: Drawer,
    journal: [{ id: "journal-1", content: "已開始整理", created_at: "2026-08-20T01:00:00.000Z" }],
    actorLabel: "QJC"
  });

  assert.match(html, /data-shared-task-framework="v1"/);
  assert.match(html, /WorkTodo · Shared Task Drawer/);
  assert.match(html, /補充採購資料/);
  assert.match(html, /data-worktodo-shared-drawer/);
  assert.match(html, /工作進度/);
  assert.match(html, /已開始整理/);
  assert.match(html, /data-worktodo-journal-entry="journal-1"/);
  assert.doesNotMatch(html, /Checklist|GPT 分析與建議|工程詳細資料/);

  const source = read("modules/worklog/components/worktodo-task-adapter.js");
  assert.doesNotMatch(source, /\b(?:DataService|supabase|localStorage|sessionStorage)\s*(?:\.|\()/i);
  assert.doesNotMatch(source, /\brpc\s*\(/i);
});

test("WorkTodo adapter renders cards through the shared Task Card shell", () => {
  const html = Adapter.renderCard({ id: "task-2", title: "整理採購資料", note: "等待供應商回覆", status: "in_progress", progress: 30, priority: "p2" }, {
    card: Card,
    titleHtml: "<span>工作</span> 整理採購資料",
    summaryHtml: "<small>期限：2026/08/25</small>",
    actionsHtml: "<button data-task-edit=\"task-2\">編輯</button>",
    bodyHtml: "<div data-progress>30%</div>"
  });
  assert.match(html, /shared-task-card/);
  assert.match(html, /data-worktodo-open-task="task-2"/);
  assert.match(html, /shared-task-card-actions/);
  assert.match(html, /data-task-edit="task-2"/);
  assert.match(html, /data-progress/);
});

test("WorkTodo adapter exposes explicit capability gaps instead of fake UI", () => {
  assert.equal(Adapter.CAPABILITIES.title, true);
  assert.equal(Adapter.CAPABILITIES.note, true);
  assert.equal(Adapter.CAPABILITIES.status, true);
  assert.equal(Adapter.CAPABILITIES.progress, true);
  assert.equal(Adapter.CAPABILITIES.priority, true);
  assert.equal(Adapter.CAPABILITIES.pin, true);
  assert.equal(Adapter.CAPABILITIES.dueDate, true);
  assert.equal(Adapter.CAPABILITIES.completion, true);
  assert.equal(Adapter.CAPABILITIES.workJournal, true);
  assert.equal(Adapter.CAPABILITIES.checklist, false);
  assert.equal(Adapter.CAPABILITIES.generalAttachment, false);
  assert.equal(Adapter.CAPABILITIES.progressNoteAttachment, false);
  assert.equal(Adapter.CAPABILITIES.gptAnalysis, false);
  assert.equal(Adapter.CAPABILITIES.usageScenario, false);
});

test("WorkLog loads the shared Drawer and keeps WorkTodo writes in its existing path", () => {
  const index = read("modules/worklog/index.html");
  const runtime = read("modules/worklog/worklog-app.js");
  assert.match(index, /shared\/components\/task-drawer\.js/);
  assert.match(index, /components\/worktodo-task-adapter\.js/);
  assert.match(index, /shared\/theme\/task-drawer\.css/);
  assert.match(runtime, /ZhugeWorkTodoTaskAdapter/);
  assert.match(runtime, /DataService\.saveTasksNow/);
  assert.match(runtime, /DataService\.saveWorkJournalEntry/);
  assert.doesNotMatch(runtime, /board_add_task_progress_note|set_creator_mfa_preference|engineering-transition/);
});
