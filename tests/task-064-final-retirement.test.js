const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("TASK-064 retirement removes the old WorkTodo entry without a second runtime", () => {
  const worktodo = read("app/Board/worktodo/index.html");
  const runtime = read("shared/components/golden-master-runtime.js");
  const boardRead = read("shared/board/board-read-service.js");
  const dataService = read("shared/api/data-service.js");
  const repositories = read("shared/api/repositories.js");

  assert.match(worktodo, /get\("consumer"\) === "worktodo-old"/);
  assert.match(worktodo, /window\.location\.replace/);
  assert.doesNotMatch(worktodo, /data-worktodo-old-entry|href="\?consumer=worktodo-old"/);
  assert.doesNotMatch(runtime, /function isWorkTodoComparisonMode\(\)|comparisonEntry/);
  assert.doesNotMatch(boardRead, /board_reconcile_completion_lifecycle\s*\(/);
  assert.doesNotMatch(dataService, /reconcileWorkTodoCompletionLifecycle/);
  assert.doesNotMatch(repositories, /reconcileWorkTodoCompletionLifecycle\s*\(/);
});

test("TASK-064 retirement disables only the legacy lifecycle authority surface", () => {
  const sql = read("docs/supabase/20260913_task_064_worktodo_legacy_retirement.sql");
  const code = sql.replace(/--.*$/gm, "");

  assert.match(code, /alter\s+table\s+public\.user_tasks\s+disable\s+trigger\s+worktodo_completion_lifecycle_before_write/i);
  for (const signature of [
    "worktodo_apply_completion_lifecycle()",
    "worktodo_reconcile_completion_lifecycle()",
    "board_reconcile_completion_lifecycle()",
    "board_reconcile_pm_acceptance_lifecycle(uuid, text)"
  ]) {
    const escapedSignature = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(code, new RegExp(`revoke\\s+all\\s+on\\s+function\\s+public\\.${escapedSignature}`, "i"));
  }
  assert.doesNotMatch(code, /\b(insert|update|delete|drop)\s+(into\s+)?/i);
  assert.match(sql, /Historical user_tasks/);
  assert.match(sql, /retained for rollback\/history/i);
});
