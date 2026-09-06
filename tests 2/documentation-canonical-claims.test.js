const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("Checklist compatibility documentation distinguishes formal Template C from Legacy WorkLog", () => {
  const document = read("docs/SHARED_TASK_DRAWER_COMPATIBILITY_ASSESSMENT.md");

  assert.match(
    document,
    /Formal Template C WorkTodo Checklist uses:[\s\S]*`board_tasks`[\s\S]*`board_task_checklist_items`[\s\S]*`board_\*_task_checklist_item`[\s\S]*Shared Action Contract/i
  );
  assert.match(document, /The mapping retained below describes the active Legacy WorkLog compatibility/i);
  assert.match(document, /`user_tasks`\s*→\s*`worktodo_checklist_items`\s*→\s*legacy/i);
  assert.match(document, /must not be used\s+as the canonical reference/i);
  assert.doesNotMatch(
    document,
    /^\| Checklist \| `worktodo_checklist_items`.*\| Canonical capability implemented/m
  );
});
