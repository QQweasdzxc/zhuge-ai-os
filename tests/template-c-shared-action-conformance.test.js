const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");

test("Template C formal consumers use one Shared Action Contract and no legacy WorkTodo bypass", () => {
  const ai = read("app/Board/ai/index.html");
  const worktodo = read("app/Board/worktodo/index.html");
  const runtime = read("shared/components/golden-master-runtime.js");
  const contract = read("shared/components/task-action-contract.js");
  const adapters = read("shared/components/task-action-adapters.js");

  for (const html of [ai, worktodo]) {
    assert.match(html, /shared\/components\/task-action-contract\.js\?v=/);
    assert.match(html, /shared\/components\/task-action-adapters\.js\?v=/);
    assert.doesNotMatch(html, /modules\/worklog\/worklog-app\.js/);
  }
  for (const action of [
    "createTask", "createWorkspace", "renameWorkspace", "reorderWorkspace", "updateTitle", "updateContent", "deleteTask",
    "addProgressNote", "editProgressNote", "deleteProgressNote", "addGeneralAttachment", "addProgressAttachment", "deleteAttachment",
    "addChecklist", "updateChecklist", "deleteChecklist", "updateGovernanceChecklist", "setAgreementSchedule", "moveWorkspace", "confirm"
  ]) assert.match(contract, new RegExp(`"${action}"`));

  assert.match(runtime, /function sharedTaskActionContract\(task\)/);
  assert.match(runtime, /function executeSharedTaskAction\(task, action/);
  assert.match(runtime, /sharedActionContracts/);
  assert.doesNotMatch(runtime, /DataService\.deleteWorkJournalEntry|DataService\.loadWorkJournal/);
  assert.doesNotMatch(runtime, /openWorkTodoTaskDetail|adapter\.render\(task/);
  assert.match(runtime, /querySelectorAll\("\[data-shared-attachment-delete\]"\)/);
  assert.doesNotMatch(runtime, /data-task-attachment-delete|data-progress-attachment-delete/);

  assert.match(adapters, /deleteProgressNote: payload => required\(service, "deleteTaskProgressNote"\)/);
  assert.match(adapters, /deleteProgressNote: payload => required\(service, "worktodoDeleteTaskProgressNote"\)/);
  assert.match(adapters, /payload\.scope === "progress_note"[\s\S]*deleteProgressNoteAttachment/);
  assert.match(adapters, /deleteAttachment: payload => callDomain\("deleteWorkTodoAttachment"/);
});

test("Shared Action Contract de-duplicates one in-flight operation and preserves read-back hooks", async () => {
  const Contract = require("../shared/components/task-action-contract.js");
  let calls = 0;
  let readBacks = 0;
  let resolveOperation;
  const operation = new Promise(resolve => { resolveOperation = resolve; });
  const contract = Contract.create({
    consumer: "fixture",
    adapter: {
      actions: { deleteProgressNote: async () => { calls += 1; return operation; } }
    }
  });
  const first = contract.execute("deleteProgressNote", { taskId: "task-1", activityId: "activity-1" }, {
    onReadBack: () => { readBacks += 1; }
  });
  const second = contract.execute("deleteProgressNote", { taskId: "task-1", activityId: "activity-1" });
  assert.strictEqual(first, second);
  assert.equal(calls, 1);
  assert.equal(contract.inFlight(), 1);
  resolveOperation({ ok: true });
  await first;
  assert.equal(readBacks, 1);
  assert.equal(contract.inFlight(), 0);
});

test("Approved Agreement Schedule and controlled progress lifecycle stay in separate Domain paths", () => {
  const sql = read("docs/supabase/20260825_template_c_shared_action_agreement_schedule.sql");
  const audit = read("docs/rfc/20260825-template-c-shared-action-conformance-audit.md");

  assert.match(sql, /agreement_mode/);
  assert.match(sql, /agreement_start_date/);
  assert.match(sql, /agreement_end_date/);
  assert.match(sql, /agreement_mode = 'single'[\s\S]*agreement_end_date is null/);
  assert.match(sql, /agreement_mode = 'period'[\s\S]*agreement_end_date is not null/);
  assert.match(sql, /worktodo_set_agreement_schedule/);
  assert.match(sql, /worktodo_edit_task_progress_note/);
  assert.match(sql, /worktodo_delete_task_progress_note/);
  assert.match(sql, /board_request_delete_progress_attachment/);
  assert.match(sql, /board_finalize_delete_progress_attachment/);
  assert.doesNotMatch(sql, /from public\.work_journal_entries|into public\.work_journal_entries|update public\.work_journal_entries|delete from public\.work_journal_entries/i);
  assert.match(sql, /due_date remains a separate Task field/);

  for (const action of [
    "Create", "Edit", "Delete", "Progress Add / Edit / Delete", "General Attachment Add / Delete",
    "Progress Attachment Add / Delete", "Checklist", "Drawer Action / Confirm", "Error Handling",
    "Read-back / Refresh", "Workspace interaction"
  ]) assert.match(audit, new RegExp(action.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});
