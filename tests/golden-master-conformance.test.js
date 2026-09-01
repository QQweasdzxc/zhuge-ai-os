const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("EP-039 enforces direct Shared Golden Master runtime use for formal Board consumers", () => {
  const aiBoard = read("app/Board/ai/index.html");
  const worktodo = read("app/Board/worktodo/index.html");
  const goldenMaster = read("shared/components/golden-master.js");
  const runtime = read("shared/components/golden-master-runtime.js");
  const css = read("shared/theme/golden-master.css");
  const taskDrawerCss = read("shared/theme/task-drawer.css");

  const canonicalRuntime = /src="\.\.\/\.\.\/\.\.\/shared\/components\/golden-master-runtime\.js\?v=/;
  assert.match(aiBoard, canonicalRuntime);
  assert.match(worktodo, canonicalRuntime);
  assert.doesNotMatch(aiBoard, /<style[\s>]/i);
  assert.doesNotMatch(worktodo, /<style[\s>]/i);
  assert.doesNotMatch(aiBoard, /onclick\s*=/i);
  assert.doesNotMatch(worktodo, /onclick\s*=/i);
  assert.doesNotMatch(aiBoard, /id="addCardModal"|id="workspaceCreateDrawer"|id="archiveDrawer"/);
  assert.doesNotMatch(worktodo, /id="addCardModal"|id="workspaceCreateDrawer"|id="archiveDrawer"/);
  assert.match(aiBoard, /data-golden-master-surface/);
  assert.match(worktodo, /data-golden-master-surface/);
  assert.doesNotMatch(aiBoard, /class="(?:board-shell|board-toolbar|board)"/);
  assert.doesNotMatch(worktodo, /class="(?:board-shell|board-toolbar|board)"/);

  for (const method of ["renderHeaderActions", "renderOperations", "mountOperations", "renderCard", "renderColumns", "renderDrawer", "bindBoard"]) {
    assert.match(goldenMaster, new RegExp(`function ${method}\\(`));
  }
  for (const method of ["renderColumns", "renderCard", "renderDrawer", "bindBoard"]) {
    assert.match(runtime, new RegExp(`ZhugeGoldenMaster\\??\\.?.*${method}`));
  }
  assert.match(runtime, /ZhugeGoldenMaster\?\.renderBoard/);
  assert.match(runtime, /ZhugeGoldenMaster\?\.mountOperations/);
  assert.match(runtime, /ZhugeGoldenMaster\?\.renderHeaderActions/);
  assert.match(goldenMaster, /const mountTarget = target\.closest\?\.\("\.zhuge-module-shell"\)/);
  assert.match(goldenMaster, /mountTarget\.appendChild\(operations\)/);
  assert.match(goldenMaster, /function assertSharedDrawerContract\(/);
  assert.match(runtime, /taskChecklistPanel\.open = false/);
  // WorkTodo uses the Shared Drawer property contract for an agreed date.
  // Legacy progress/pin/estimated-time properties must not return through a
  // consumer-owned Drawer renderer.
  assert.match(runtime, /key: "agreement-schedule"/);
  assert.match(runtime, /label: agreedDateParts\(task, workTodoViewModel\)\.mode === "period" \? "約定期間" : "約定日期"/);
  assert.match(taskDrawerCss, /shared-agreed-date-editor/);
  assert.match(goldenMaster, /filter\(item => !\["priority"\]/);
  assert.doesNotMatch(runtime, /openWorkTodoTaskDetail|adapter\.render\(task/);
  assert.match(runtime, /assertSharedDrawerContract/);
  assert.doesNotMatch(runtime, /label: "進度"|label: "置頂"|label: "預估時間"|key: "estimated-minutes"/);
  assert.match(runtime, /data-shared-attachment-scope="progress_note"/);
  assert.match(runtime, /data-shared-attachment-scope="task"/);
  assert.doesNotMatch(runtime, /data-task-attachment-delete|data-progress-attachment-delete/);
  assert.match(css, /Golden Master surface styles/);

  const retiredRuntimeAlias = path.join(ROOT, "app/Board/ai/board-runtime.js");
  assert.equal(fs.existsSync(retiredRuntimeAlias), false, "AI Board must not retain a retired compatibility runtime alias");
  assert.match(worktodo, /modules\/worklog\/components\/worktodo-task-adapter\.js/);
  assert.doesNotMatch(worktodo, /shared\/api\/repositories\.js/);
  assert.doesNotMatch(worktodo, /shared\/api\/data-service\.js/);
  assert.match(read("modules/worklog/index.html"), /shared\/api\/repositories\.js/);
  assert.match(read("modules/worklog/index.html"), /shared\/api\/data-service\.js/);
  assert.doesNotMatch(worktodo, /modules\/worklog\/worklog-app\.js/);
});

test("C Mother Template, AI Board, and WorkTodo share one Board/Card/Drawer runtime contract", () => {
  const pages = [
    read("app/Board/template-preview/index.html"),
    read("app/Board/ai/index.html"),
    read("app/Board/worktodo/index.html")
  ];
  const sharedAssets = [
    "shared/components/task-card.js",
    "shared/components/task-drawer.js",
    "shared/components/task-board.js",
    "shared/components/golden-master.js",
    "shared/components/golden-master-runtime.js"
  ];
  for (const page of pages) {
    assert.match(page, /data-golden-master-surface/);
    assert.doesNotMatch(page, /<style[\s>]/i);
    assert.doesNotMatch(page, /onclick\s*=/i);
    for (const asset of sharedAssets) assert.match(page, new RegExp(asset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }

  const runtime = read("shared/components/golden-master-runtime.js");
  const board = read("shared/components/task-board.js");
  const card = read("shared/components/task-card.js");
  const drawer = read("shared/components/task-drawer.js");
  assert.match(runtime, /acceptTaskByCardDrop/);
  assert.match(runtime, /executeSharedTaskAction\(task, "updateGovernanceChecklist"/);
  assert.match(runtime, /state\.applicationScope === "ai_board" && isPmTurn\(task\) && isCompletionWorkspace\(target\)/);
  assert.doesNotMatch(board, /supabase|DataService|localStorage|sessionStorage|rpc\s*\(/i);
  assert.doesNotMatch(card, /supabase|DataService|localStorage|sessionStorage|rpc\s*\(/i);
  assert.doesNotMatch(drawer, /supabase|DataService|localStorage|sessionStorage|rpc\s*\(/i);
  assert.doesNotMatch(read("app/Board/template-preview/index.html"), /c-mtdk-store\.js/);
});

test("the shared Golden Master no longer exposes the low-use data health feature", () => {
  const goldenMaster = require(path.join(ROOT, "shared/components/golden-master.js"));
  const operations = goldenMaster.renderOperations({ applicationScope: "c", itemLabel: "MDTK" });
  assert.doesNotMatch(operations, /healthCheckModal|資料健康度檢查|資料健康檢查/);

  const runtime = read("shared/components/golden-master-runtime.js");
  assert.doesNotMatch(runtime, /healthCheckBtn|healthCheckModal|runHealthCheck\(|資料健康檢查/);
});
