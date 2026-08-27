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
  const classifier = read("shared/components/activity-classifier.js");
  const contract = read("shared/components/task-action-contract.js");
  const adapters = read("shared/components/task-action-adapters.js");

  for (const html of [ai, worktodo]) {
    assert.match(html, /shared\/components\/task-action-contract\.js\?v=/);
    assert.match(html, /shared\/components\/task-action-adapters\.js\?v=/);
    assert.match(html, /shared\/components\/activity-classifier\.js\?v=/);
    assert.doesNotMatch(html, /modules\/worklog\/worklog-app\.js/);
  }
  for (const action of [
    "createTask", "createWorkspace", "renameWorkspace", "deleteWorkspace", "reorderWorkspace", "updateTitle", "updateContent", "deleteTask",
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
  assert.match(runtime, /function isHumanProgressActivity\(item\)/);
  assert.match(runtime, /sharedActivityClassifier\?\.isHumanProgressActivity\?\.\(item\) === true/);
  assert.match(classifier, /activityType === "human_progress_note"[\s\S]*HUMAN_PROGRESS_ACTIONS\.includes\(action\)/);
  assert.match(runtime, /function visibleHumanProgressRows\(activity\)/);

  assert.match(adapters, /deleteProgressNote: payload => required\(service, "deleteTaskProgressNote"\)/);
  assert.match(adapters, /deleteProgressNote: payload => required\(service, "worktodoDeleteTaskProgressNote"\)/);
  assert.match(adapters, /deleteWorkspace: payload => required\(service, "deleteWorkspace"\)\(payload\.workspaceId, payload\.targetWorkspaceId\)/);
  assert.match(adapters, /deleteWorkspace: payload => required\(service, "worktodoDeleteWorkspace"\)\(payload\.workspaceId, payload\.targetWorkspaceId\)/);
  assert.match(adapters, /payload\.scope === "progress_note"[\s\S]*deleteProgressNoteAttachment/);
  const worktodoAdapter = adapters.match(/function createWorkTodoAdapter[\s\S]*?\n  function create\(/)?.[0] || "";
  assert.match(worktodoAdapter, /prepareTaskAttachment/);
  assert.match(worktodoAdapter, /prepareProgressNoteAttachment/);
  assert.match(worktodoAdapter, /loadTaskAttachments/);
  assert.match(worktodoAdapter, /taskAttachmentUrl/);
  assert.match(worktodoAdapter, /deleteProgressNoteAttachment/);
  assert.doesNotMatch(worktodoAdapter, /uploadWorkTodoAttachment|uploadWorkTodoProgressAttachment|deleteWorkTodoAttachment|loadWorkTodoTaskAttachments|signedWorkTodoAttachmentUrl/);
  assert.match(worktodoAdapter, /addChecklist: payload => required\(service, "addTaskChecklistItem"\)/);
  assert.match(worktodoAdapter, /updateChecklist: payload => required\(service, "updateTaskChecklistItem"\)/);
  assert.match(worktodoAdapter, /deleteChecklist: payload => required\(service, "deleteTaskChecklistItem"\)/);
  assert.match(worktodoAdapter, /required\(service, "loadTaskChecklist"\)/);
  assert.doesNotMatch(worktodoAdapter, /addWorkTodoChecklistItem|updateWorkTodoChecklistItem|deleteWorkTodoChecklistItem|loadWorkTodoTaskCapabilities/);
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

test("Workspace Delete uses one Shared Action and explicit domain-controlled delete contracts", () => {
  const service = read("shared/board/board-read-service.js");
  const runtime = read("shared/components/golden-master-runtime.js");
  const sql = read("docs/supabase/20260826_custom_workspace_delete.sql");

  assert.match(runtime, /data-workspace-menu/);
  assert.match(runtime, /function openWorkspaceMenu\(button, workspace\)/);
  assert.match(runtime, /function deleteWorkspace\(workspace\)/);
  assert.match(runtime, /第一次確認/);
  assert.match(runtime, /第二次確認/);
  assert.match(runtime, /移至「待開始」/);
  assert.match(runtime, /Task、Checklist、Progress、Attachment 與 Storage Object 將全部保留/);
  assert.match(runtime, /isCustomWorkspace/);
  assert.match(runtime, /executeSharedTaskAction\(null, "deleteWorkspace"/);
  assert.match(service, /board_request_delete_workspace/);
  assert.match(service, /board_finalize_delete_workspace/);
  assert.match(service, /worktodo_request_delete_workspace/);
  assert.match(service, /worktodo_finalize_delete_workspace/);
  assert.match(service, /board_move_task_workspace/);
  assert.match(service, /worktodo_update_task/);
  assert.match(sql, /board_workspace/);
  assert.match(sql, /workspace_deleted/);
  assert.match(sql, /delete from public\.board_workspaces/);
  assert.match(sql, /tasks_preserved/);
  assert.match(sql, /workspace tasks must be moved before deleting the workspace/i);
  assert.doesNotMatch(sql, /delete from public\.board_task_attachments/i);
  assert.doesNotMatch(sql, /delete from public\.engineering_checklist_items/i);
  assert.doesNotMatch(sql, /delete from public\.board_task_checklist_items/i);
  assert.doesNotMatch(sql, /delete from public\.board_tasks/i);
  assert.doesNotMatch(sql, /storage\.objects/i);
  assert.doesNotMatch(sql, /p_attachment_ids/i);
  assert.match(sql, /System\/Canonical AI Board workspaces are not deletable/);
  assert.match(sql, /System\/Canonical WorkTodo workspaces are not deletable/);
  assert.doesNotMatch(sql, /board_restore_workspace|board_reopen_workspace|archive_workspace/i);
});
