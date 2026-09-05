const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const Adapters = require("../shared/components/task-action-adapters.js");
const Contract = require("../shared/components/task-action-contract.js");

function createHarness() {
  const calls = [];
  const rows = [];
  const file = Object.freeze({ name: "QA-canonical.png", type: "image/png", size: 128 });
  const canonicalAttachment = (scope, activityId = "") => ({
    attachmentId: `${scope}-attachment-1`,
    taskId: "worktodo-task-1",
    activityId,
    attachmentScope: scope,
    filename: file.name,
    mimeType: file.type,
    byteSize: file.size,
    storageBucket: "board-task-attachments",
    storagePath: `worktodo-task-1/${scope}-attachment-1/${file.name}`,
    uploadStatus: "uploading",
    deletionStatus: "active"
  });
  const service = {
    async loadTaskChecklist() {
      calls.push("loadTaskChecklist");
      return [];
    },
    async loadTaskAttachments(taskId) {
      calls.push(["loadTaskAttachments", taskId]);
      return rows.filter(row => row.taskId === taskId && row.deletionStatus !== "deleted").map(row => ({ ...row }));
    },
    async prepareTaskAttachment(input) {
      calls.push(["prepareTaskAttachment", input.taskId, input.file.name]);
      const row = canonicalAttachment("task");
      rows.push(row);
      return { ...row };
    },
    async prepareProgressNoteAttachment(input) {
      calls.push(["prepareProgressNoteAttachment", input.activityId, input.file.name]);
      const row = canonicalAttachment("progress_note", String(input.activityId));
      rows.push(row);
      return { ...row };
    },
    async uploadTaskAttachment(attachment, uploadFile) {
      calls.push(["uploadTaskAttachment", attachment.storageBucket, attachment.storagePath, uploadFile.name]);
      return attachment;
    },
    async completeTaskAttachment(attachmentId) {
      calls.push(["completeTaskAttachment", attachmentId]);
      const row = rows.find(item => item.attachmentId === attachmentId);
      row.uploadStatus = "ready";
      return { ...row };
    },
    async deleteTaskAttachment(attachmentId) {
      calls.push(["deleteTaskAttachment", attachmentId]);
      const row = rows.find(item => item.attachmentId === attachmentId);
      row.deletionStatus = "deleted";
      return { ...row };
    },
    async deleteProgressNoteAttachment(input) {
      calls.push(["deleteProgressNoteAttachment", input.attachmentId, input.activityId]);
      const row = rows.find(item => item.attachmentId === input.attachmentId);
      row.deletionStatus = "deleted";
      return { ...row };
    },
    async taskAttachmentUrl(attachment) {
      calls.push(["taskAttachmentUrl", attachment.storageBucket, attachment.storagePath]);
      return "https://signed.example/board-task-attachments";
    }
  };
  const legacy = new Proxy({}, {
    get(_target, name) {
      return async () => { throw new Error(`Legacy attachment path called: ${String(name)}`); };
    }
  });
  return { calls, rows, file, service, legacy };
}

test("Formal WorkTodo General Attachment uses Board canonical lifecycle and read-back", async () => {
  const harness = createHarness();
  const adapter = Adapters.createWorkTodoAdapter({
    task: { id: "worktodo-task-1" },
    service: harness.service,
    dataService: harness.legacy,
    repository: harness.legacy
  });
  const contract = Contract.create({ consumer: "worktodo", adapter });

  await contract.execute("addGeneralAttachment", { taskId: "worktodo-task-1", file: harness.file });
  const afterAddReload = (await contract.read("capabilities", { taskId: "worktodo-task-1" })).attachments;
  assert.equal(afterAddReload.length, 1);
  assert.equal(afterAddReload[0].storageBucket, "board-task-attachments");
  assert.equal(await contract.read("attachmentUrl", { attachment: afterAddReload[0] }), "https://signed.example/board-task-attachments");

  await contract.execute("deleteAttachment", {
    taskId: "worktodo-task-1",
    attachmentId: afterAddReload[0].attachmentId,
    scope: "task",
    item: afterAddReload[0]
  });
  assert.deepEqual((await contract.read("capabilities", { taskId: "worktodo-task-1" })).attachments, []);
  assert.deepEqual(harness.calls.map(call => Array.isArray(call) ? call[0] : call), [
    "prepareTaskAttachment", "uploadTaskAttachment", "completeTaskAttachment",
    "loadTaskChecklist", "loadTaskAttachments", "taskAttachmentUrl",
    "deleteTaskAttachment", "loadTaskChecklist", "loadTaskAttachments"
  ]);
});

test("Formal WorkTodo Progress Attachment uses engineering_activity_log activity id", async () => {
  const harness = createHarness();
  const adapter = Adapters.createWorkTodoAdapter({
    task: { id: "worktodo-task-1" },
    service: harness.service,
    dataService: harness.legacy,
    repository: harness.legacy
  });
  const contract = Contract.create({ consumer: "worktodo", adapter });

  await contract.execute("addProgressAttachment", {
    taskId: "worktodo-task-1",
    activityId: "9001",
    file: harness.file
  });
  const attachment = (await contract.read("capabilities", { taskId: "worktodo-task-1" })).attachments[0];
  assert.equal(attachment.attachmentScope, "progress_note");
  assert.equal(attachment.activityId, "9001");
  assert.equal(attachment.journalEntryUuid, undefined);
  await contract.execute("deleteAttachment", {
    taskId: "worktodo-task-1",
    activityId: "9001",
    attachmentId: attachment.attachmentId,
    scope: "progress_note",
    item: attachment
  });
  assert.deepEqual((await contract.read("capabilities", { taskId: "worktodo-task-1" })).attachments, []);
  assert.deepEqual(harness.calls.filter(call => Array.isArray(call)).map(call => call[0]), [
    "prepareProgressNoteAttachment", "uploadTaskAttachment", "completeTaskAttachment",
    "loadTaskAttachments", "deleteProgressNoteAttachment", "loadTaskAttachments"
  ]);
  const prepare = harness.calls.find(call => Array.isArray(call) && call[0] === "prepareProgressNoteAttachment");
  const deleteCall = harness.calls.find(call => Array.isArray(call) && call[0] === "deleteProgressNoteAttachment");
  assert.equal(prepare[1], "9001");
  assert.equal(deleteCall[2], "9001");
});

test("Formal WorkTodo attachment adapter has no legacy attachment operation mapping", () => {
  const source = fs.readFileSync(path.join(ROOT, "shared/components/task-action-adapters.js"), "utf8");
  const worktodo = source.match(/function createWorkTodoAdapter[\s\S]*?\n  function create\(/)?.[0] || "";
  assert.doesNotMatch(worktodo, /worktodo_prepare_attachment|worktodo_complete_attachment|worktodo_request_attachment_delete|worktodo_finalize_attachment_delete/);
  assert.doesNotMatch(worktodo, /uploadWorkTodoAttachment|uploadWorkTodoProgressAttachment|deleteWorkTodoAttachment|loadWorkTodoTaskAttachments|signedWorkTodoAttachmentUrl/);
  assert.match(worktodo, /board|prepareTaskAttachment|prepareProgressNoteAttachment|loadTaskAttachments|taskAttachmentUrl/);
});
