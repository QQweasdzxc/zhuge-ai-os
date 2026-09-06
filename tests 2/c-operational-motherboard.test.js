const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const read = file => fs.readFileSync(path.join(ROOT, file), "utf8");
const StoreModule = require("../shared/services/c-mtdk-store.js");
const Adapters = require("../shared/components/task-action-adapters.js");
const ActionContract = require("../shared/components/task-action-contract.js");
const GoldenMaster = require("../shared/components/golden-master.js");
const Drawer = require("../shared/components/task-drawer.js");
const Catalog = require("../shared/components/system-template-catalog.js");
const BoardReadService = require("../shared/board/board-read-service.js");

function memoryStorage() {
  const data = new Map();
  return {
    getItem(key) { return data.has(key) ? data.get(key) : null; },
    setItem(key, value) { data.set(key, String(value)); },
    removeItem(key) { data.delete(key); }
  };
}

test("C operational motherboard owns an independent, complete MDTK action surface", async () => {
  const storage = memoryStorage();
  const store = StoreModule.createStore({ storage, key: "test:c-mdtk" });
  await store.reset();

  const initial = await store.load();
  assert.equal(initial.applicationScope, "c");
  assert.equal(initial.tasks.length, 0);
  assert.deepEqual(initial.workspaces.map(workspace => workspace.id), ["c-mdtk-todo", "c-mdtk-progress", "c-mdtk-completed"]);

  const customWorkspace = await store.createWorkspace("MDTK 驗收區");
  let task = await store.createTask({
    workspaceId: customWorkspace.id,
    title: "C 母版操作驗收",
    summary: "只使用 C 母版與 MDTK 本機資料"
  });
  assert.equal(task.code, "MDTK-001");
  assert.equal(task.applicationScope, "c");
  assert.equal(task.ownerUuid, "mdtk");
  assert.doesNotMatch(task.code, /WLTK|TASK/);

  const adapter = Adapters.createCTemplateAdapter({ task, service: store });
  const contract = ActionContract.create({ consumer: "c_mdtk", adapter });
  assert.deepEqual(ActionContract.assert(contract).missing, []);
  assert.equal(GoldenMaster.assertSharedDrawerContract({ consumer: "c_mdtk", adapter, drawer: Drawer }).ok, true);

  task = await contract.execute("updateTitle", { taskId: task.id, title: "C 母版操作驗收（已編輯）" });
  await contract.execute("updateContent", { taskId: task.id, summary: "Shared C content", usageScenario: "MDTK flow" });
  await contract.execute("moveWorkspace", { taskId: task.id, workspaceId: "c-mdtk-progress" });
  await contract.execute("setAgreementSchedule", { taskId: task.id, mode: "period", startDate: "2026-08-28", endDate: "2026-09-03" });

  const checklist = await contract.execute("addChecklist", { taskId: task.id, label: "C Checklist" });
  await contract.execute("updateChecklist", { id: checklist.id, label: "C Checklist done", completed: true });
  const checklistAfterUpdate = await store.loadTaskChecklist(task.id);
  assert.equal(checklistAfterUpdate[0].completed, true);
  await contract.execute("deleteChecklist", { id: checklist.id });
  assert.equal((await store.loadTaskChecklist(task.id)).length, 0);

  const createdProgress = await contract.execute("addProgressNote", { taskId: task.id, note: "MDTK progress created" });
  assert.equal(createdProgress.activityType, "human_progress_note");
  const editedProgress = await contract.execute("editProgressNote", { activityId: createdProgress.id, note: "MDTK progress edited" });
  assert.equal(editedProgress.revisionOf, createdProgress.id);
  const deletedProgress = await contract.execute("deleteProgressNote", { activityId: editedProgress.id });
  assert.equal(deletedProgress.activityType, "system_activity");
  assert.equal(deletedProgress.action, "progress_note_deleted");
  assert.equal(deletedProgress.tombstoneOf, editedProgress.id);
  assert.equal((await store.load()).tasks.find(item => item.id === task.id).progressCount, 0);

  const generalAttachment = await contract.execute("addGeneralAttachment", {
    taskId: task.id,
    file: { name: "mdtk-general.txt", type: "text/plain" }
  });
  assert.equal((await contract.read("attachments", { taskId: task.id })).length, 1);
  await contract.execute("deleteAttachment", { taskId: task.id, attachmentId: generalAttachment.attachmentId });
  assert.equal((await contract.read("attachments", { taskId: task.id })).length, 0);

  const progressForAttachment = await contract.execute("addProgressNote", { taskId: task.id, note: "MDTK attachment progress" });
  const progressAttachment = await contract.execute("addProgressAttachment", {
    taskId: task.id,
    activityId: progressForAttachment.id,
    file: { name: "mdtk-progress.txt", type: "text/plain" }
  });
  assert.equal((await contract.read("attachments", { taskId: task.id })).length, 1);
  await contract.execute("deleteAttachment", {
    taskId: task.id,
    activityId: progressForAttachment.id,
    attachmentId: progressAttachment.attachmentId,
    scope: "progress_note"
  });
  assert.equal((await contract.read("attachments", { taskId: task.id })).length, 0);

  const reloadedStore = StoreModule.createStore({ storage, key: "test:c-mdtk" });
  const reloadedBeforeWorkspaceDelete = (await reloadedStore.load()).tasks.find(item => item.id === task.id);
  assert.equal(reloadedBeforeWorkspaceDelete.title, "C 母版操作驗收（已編輯）");
  assert.equal(reloadedBeforeWorkspaceDelete.workspaceId, "c-mdtk-progress");
  assert.equal(reloadedBeforeWorkspaceDelete.agreementMode, "period");

  const deleteResult = await contract.execute("deleteWorkspace", { workspaceId: customWorkspace.id, targetWorkspaceId: "c-mdtk-todo" });
  assert.equal(deleteResult.movedTaskCount, 0);
  const afterFirstDeleteStore = StoreModule.createStore({ storage, key: "test:c-mdtk" });
  const afterFirstDeleteModel = await afterFirstDeleteStore.load();
  assert.doesNotMatch(afterFirstDeleteModel.workspaces.map(workspace => workspace.id).join(","), new RegExp(customWorkspace.id));
  const taskInDefaultWorkspace = afterFirstDeleteModel.tasks.find(item => item.id === task.id);
  assert.ok(taskInDefaultWorkspace);
  assert.equal(taskInDefaultWorkspace.workspaceId, "c-mdtk-progress");

  const secondWorkspace = await afterFirstDeleteStore.createWorkspace("MDTK 刪除驗收區");
  const taskInDeletableWorkspace = await afterFirstDeleteStore.createTask({ workspaceId: secondWorkspace.id, title: "MDTK-002 Workspace Delete" });
  const secondDelete = await afterFirstDeleteStore.deleteWorkspace(secondWorkspace.id, "c-mdtk-todo");
  assert.equal(secondDelete.movedTaskCount, 1);
  const afterDelete = (await StoreModule.createStore({ storage, key: "test:c-mdtk" }).load()).tasks.find(item => item.id === taskInDeletableWorkspace.id);
  assert.equal(afterDelete.workspaceId, "c-mdtk-todo");

  const rendered = GoldenMaster.render({
    mode: "operational-motherboard",
    data: "c-mdtk-local",
    className: "c-motherboard-runtime",
    header: { title: "C 唯一看板母版", description: "MDTK" },
    columns: [],
    components: { drawer: Drawer }
  });
  assert.match(rendered, /data-golden-master="operational-motherboard"/);
  assert.match(rendered, /data-golden-master-data="c-mdtk-local"/);
  assert.doesNotMatch(rendered, /C-PREVIEW|WLTK-|TASK-\d+/);
  assert.equal(Catalog.get().operational, true);
  assert.equal(Catalog.get().moduleTaskPrefix, "MDTK");
});

test("C route loads the canonical Cloud MDTK host and shared runtime", () => {
  const html = read("app/Board/template-preview/index.html");
  const runtime = read("shared/components/golden-master-runtime.js");
  assert.match(html, /data-template-page-id="template-c"/);
  assert.doesNotMatch(html, /shared\/services\/c-mtdk-store\.js/);
  assert.match(html, /shared\/board\/board-read-service\.js/);
  assert.match(html, /shared\/supabase\/supabase-gateway\.js/);
  assert.match(html, /shared\/components\/task-action-adapters\.js/);
  assert.doesNotMatch(html, /worklog-app|repositories\.js|data-service\.js/);
  assert.match(runtime, /applicationScope === "c"/);
  assert.doesNotMatch(runtime, /ZhugeCTemplateMDTKStore/);
});

test("C service resolves the registry and uses the generic board contract", async () => {
  const calls = [];
  const gateway = {
    async rpc(name, args) {
      calls.push({ name, args });
      if (name === "board_resolve_template_instance") {
        return { id: "c-instance", task_code_prefix: "MDTK", template_key: "c", authorization_mode: "owner", owner_uuid: "owner" };
      }
      if (name === "board_instance_create_task") {
        return { id: "mdtk-task-1", board_instance_id: "c-instance", work_code: "MDTK-001", title: args.p_title, status: args.p_status, workspace_id: "mdtk-todo" };
      }
      if (name === "board_instance_create_workspace") {
        return { id: "mdtk-workspace-1", board_instance_id: "c-instance", workspace_key: args.p_workspace_key, name: args.p_name, sort_order: 60, active: true };
      }
      throw new Error(`Unexpected RPC ${name}`);
    }
  };
  const service = BoardReadService.createInstanceService({ gateway, templateKey: "c" });
  const task = await service.createTask({ title: "MDTK Cloud task", summary: "canonical" });
  const workspace = await service.createWorkspace("MDTK QA");
  assert.equal(task.boardInstanceId, "c-instance");
  assert.equal(task.applicationScope, "c");
  assert.equal(task.workCode, "MDTK-001");
  assert.equal(workspace.boardInstanceId, "c-instance");
  assert.match(workspace.key, /^mdtk-custom-/);
  assert.deepEqual(calls.map(call => call.name), [
    "board_resolve_template_instance",
    "board_instance_create_task",
    "board_instance_create_workspace"
  ]);
  assert.equal(calls[1].args.p_board_instance_id, "c-instance");
});
