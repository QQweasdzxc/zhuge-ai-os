const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const Board = require("../shared/components/task-board.js");
const Card = require("../shared/components/task-card.js");
const Adapter = require("../modules/worklog/components/worktodo-task-adapter.js");

test("Shared Task Board renders one reusable column contract", () => {
  const html = Board.render({
    boardKey: "test",
    columns: [
      { id: "not_started", key: "not_started", name: "待開始", cards: [{ id: "one" }], renderCard: () => Card.render({ code: "WLTK-001", title: "工作一", summary: "摘要" }) },
      { id: "blocked", key: "blocked", name: "阻塞", cards: [] }
    ]
  });

  assert.match(html, /data-shared-task-board="test"/);
  assert.match(html, /data-shared-task-board-column="not_started"/);
  assert.match(html, /data-shared-task-board-column="blocked"/);
  assert.match(html, /shared-task-board-column-header/);
  assert.match(html, /WLTK-001/);
  assert.match(html, /shared-task-board-empty/);
});

test("Shared Task Board source owns only presentation and drag contracts", () => {
  const source = read("shared/components/task-board.js");
  assert.match(source, /CARD_DRAG_TYPE/);
  assert.match(source, /COLUMN_DRAG_TYPE/);
  assert.match(source, /onCardDrop/);
  assert.match(source, /onColumnDrop/);
  assert.doesNotMatch(source, /supabase|DataService|localStorage|sessionStorage|rpc\s*\(/i);
});

test("WorkTodo uses the Golden Master board and six canonical status columns", () => {
  const runtime = read("modules/worklog/worklog-app.js");
  const index = read("modules/worklog/index.html");
  for (const label of ["待開始", "進行中", "等待回覆", "等待驗收", "阻塞", "完成"]) assert.match(runtime, new RegExp(label));
  assert.match(runtime, /WORKTODO_BOARD_COLUMNS/);
  assert.match(runtime, /data-shared-task-board=\\?"worktodo/);
  assert.match(runtime, /ZhugeSharedTaskBoard/);
  assert.match(runtime, /saveWorkTodoTaskPatch/);
  assert.match(index, /shared\/components\/task-board\.js/);
  assert.match(index, /shared\/theme\/task-board\.css/);
});

test("WorkTodo keeps the Golden Master header actions and first-column add-card entry", () => {
  const runtime = read("modules/worklog/worklog-app.js");
  const boardCss = read("shared/theme/task-board.css");
  assert.match(runtime, /data-task-new="1"/);
  assert.match(runtime, /data-worktodo-workspace-info/);
  assert.match(runtime, /data-task-filter="archived"/);
  assert.match(runtime, /data-worktodo-refresh/);
  assert.match(runtime, /shared-task-board-add-card/);
  assert.match(runtime, /taskUsageScenario/);
  assert.match(boardCss, /\.shared-task-board-add-card/);
});

test("Shared Task Board renders a consumer-provided add-card action without domain writes", () => {
  const html = Board.render({
    boardKey: "worktodo",
    columns: [{ id: "not_started", name: "待開始", addHtml: '<button class="shared-task-board-add-card">＋新增卡片</button>' }]
  });
  assert.match(html, /shared-task-board-add-card/);
  assert.match(html, /＋新增卡片/);
});

test("WorkTodo Golden Master removes the Card/Drawer work-property presentation", () => {
  const html = Adapter.render({
    id: "cloud-task-1",
    work_code: "WLTK-001",
    title: "整理需求",
    work_property: "產品規劃",
    estimated_minutes: 90,
    status: "blocked",
    priority: "p1"
  }, { drawer: require("../shared/components/task-drawer.js") });
  assert.doesNotMatch(html, /工作屬性/);
  assert.doesNotMatch(html, /data-task-property-action="work-property"/);
  assert.match(html, /阻塞/);
  assert.match(html, /預估時間/);
});
