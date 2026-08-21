const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("EP-039 has one Golden Master presentation runtime for formal Board consumers", () => {
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
  assert.match(runtime, /taskChecklistPanel\.open = false/);
  assert.doesNotMatch(runtime, /key: "due-date"|action: "due-date"|label: "日期"/);
  assert.doesNotMatch(taskDrawerCss, /shared-task-due-date-picker|task-due-date/);
  assert.match(goldenMaster, /filter\(item => !\["priority", "due-date"\]/);
  assert.match(css, /Golden Master surface styles/);

  const runtimeLink = path.join(ROOT, "app/Board/ai/board-runtime.js");
  const stat = fs.lstatSync(runtimeLink);
  assert.equal(stat.isSymbolicLink(), true, "AI Board compatibility path must not contain a second runtime implementation");
  assert.match(fs.readlinkSync(runtimeLink), /golden-master-runtime\.js/);
  assert.doesNotMatch(worktodo, /modules\/worklog/);
});
