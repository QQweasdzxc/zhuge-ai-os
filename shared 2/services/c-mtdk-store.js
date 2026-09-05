/*
 * C operational motherboard / MDTK domain store.
 *
 * This is deliberately independent from the formal AI Board and WorkTodo
 * domains.  C uses the same Shared Golden Master presentation and action
 * contract, but its MDTK validation data is local to this host until a later
 * PM-approved adoption phase.  It never calls Supabase, Storage, or a
 * consumer-specific RPC.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeCTemplateMDTKStore = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const STORAGE_KEY = "zhuge-ai-os:c-mdtk:v1";
  const NOW = () => new Date().toISOString();
  const STATUS_LABELS = Object.freeze({
    not_started: "待開始",
    in_progress: "進行中",
    completed: "完成",
    waiting_reply: "等待回覆",
    waiting_acceptance: "等待驗收",
    blocked: "阻塞"
  });
  const STATUS_BY_WORKSPACE = Object.freeze({
    "c-mdtk-todo": "not_started",
    "c-mdtk-progress": "in_progress",
    "c-mdtk-completed": "completed"
  });
  const DEFAULT_WORKSPACES = Object.freeze([
    { id: "c-mdtk-todo", key: "c-mdtk-todo", name: "待開始", label: "待開始", sortOrder: 0 },
    { id: "c-mdtk-progress", key: "c-mdtk-progress", name: "進行中", label: "進行中", sortOrder: 1 },
    { id: "c-mdtk-completed", key: "c-mdtk-completed", name: "完成", label: "完成", sortOrder: 2 }
  ]);

  const fallbackStorage = (() => {
    const data = new Map();
    return {
      getItem(key) { return data.has(key) ? data.get(key) : null; },
      setItem(key, value) { data.set(key, String(value)); },
      removeItem(key) { data.delete(key); }
    };
  })();

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function safeStorage(candidate) {
    if (candidate && typeof candidate.getItem === "function" && typeof candidate.setItem === "function") return candidate;
    try {
      if (root?.localStorage && typeof root.localStorage.getItem === "function") return root.localStorage;
    } catch (error) { /* private browsing or restricted storage */ }
    return fallbackStorage;
  }

  function defaultModel() {
    return {
      version: 1,
      workspaces: DEFAULT_WORKSPACES.map(workspace => ({ ...workspace, applicationScope: "c", ownerUuid: "mdtk", active: true })),
      tasks: [],
      activities: [],
      checklist: [],
      attachments: [],
      nextTaskNumber: 1,
      nextWorkspaceNumber: 1,
      nextActivityNumber: 1,
      nextChecklistNumber: 1,
      nextAttachmentNumber: 1
    };
  }

  function normalizeModel(value) {
    const baseline = defaultModel();
    if (!value || typeof value !== "object") return baseline;
    const model = {
      ...baseline,
      ...value,
      workspaces: Array.isArray(value.workspaces) ? value.workspaces : baseline.workspaces,
      tasks: Array.isArray(value.tasks) ? value.tasks : [],
      activities: Array.isArray(value.activities) ? value.activities : [],
      checklist: Array.isArray(value.checklist) ? value.checklist : [],
      attachments: Array.isArray(value.attachments) ? value.attachments : []
    };
    model.workspaces = model.workspaces.map((workspace, index) => ({
      ...workspace,
      id: workspace.id || `c-mdtk-custom-${index + 1}`,
      key: workspace.key || workspace.id,
      name: workspace.name || workspace.label || "未命名工作區",
      label: workspace.label || workspace.name || "未命名工作區",
      sortOrder: Number.isFinite(workspace.sortOrder) ? workspace.sortOrder : index,
      applicationScope: "c",
      ownerUuid: "mdtk",
      active: workspace.active !== false
    }));
    return model;
  }

  function readModel(storage, key) {
    try {
      const raw = storage.getItem(key);
      return raw ? normalizeModel(JSON.parse(raw)) : defaultModel();
    } catch (error) {
      return defaultModel();
    }
  }

  function normalizeStatus(status) {
    const value = String(status || "not_started").trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (STATUS_LABELS[value]) return value;
    if (["ready", "todo", "pending"].includes(value)) return "not_started";
    if (["doing", "working", "active"].includes(value)) return "in_progress";
    if (["done", "complete", "closed"].includes(value)) return "completed";
    return "not_started";
  }

  function statusDescriptorFor(status) {
    const key = normalizeStatus(status);
    return { key, label: STATUS_LABELS[key] || "未知工程狀態", isTerminal: key === "completed" };
  }

  function activityType(item) {
    return item?.activityType || item?.activity_type || "";
  }

  function action(item) {
    return item?.action || "";
  }

  function revisionOf(item) {
    return item?.revisionOf || item?.revision_of || null;
  }

  function tombstoneOf(item) {
    return item?.tombstoneOf || item?.tombstone_of || null;
  }

  function activityTimestamp(item) {
    return item?.timestamp || item?.createdAt || item?.created_at || "";
  }

  function sortByTimestamp(items) {
    return [...items].sort((left, right) => String(activityTimestamp(left)).localeCompare(String(activityTimestamp(right))));
  }

  function visibleProgress(model, taskId) {
    const rows = sortByTimestamp(model.activities.filter(item => String(item.taskId || item.task_id) === String(taskId)));
    const deleted = new Set(rows.map(tombstoneOf).filter(Boolean).map(String));
    const revisions = new Map();
    rows.forEach(item => {
      const source = revisionOf(item);
      if (source) revisions.set(String(source), item);
    });
    return rows.filter(item => {
      const type = activityType(item);
      const isHuman = type === "human_progress_note" && ["progress_note_created", "progress_note_edited"].includes(action(item));
      return isHuman && !deleted.has(String(item.id)) && !revisions.has(String(item.id));
    });
  }

  function workspaceFor(model, task) {
    return model.workspaces.find(workspace => String(workspace.id) === String(task.workspaceId || task.workspace_id)
      || String(workspace.key) === String(task.workspaceKey || task.workspace_key)) || model.workspaces[0];
  }

  function decorateWorkspace(workspace) {
    if (!workspace) return null;
    return {
      ...workspace,
      key: workspace.key || workspace.id,
      label: workspace.label || workspace.name,
      applicationScope: "c",
      ownerUuid: "mdtk"
    };
  }

  function decorateTask(model, task) {
    if (!task) return null;
    const workspace = workspaceFor(model, task);
    const status = normalizeStatus(task.status || STATUS_BY_WORKSPACE[workspace?.id]);
    const progress = visibleProgress(model, task.id);
    const latestProgress = progress[progress.length - 1] || null;
    return {
      ...task,
      id: task.id,
      code: task.code || task.taskCode || task.workCode,
      taskCode: task.taskCode || task.code,
      workCode: task.workCode || task.code,
      title: task.title || "未命名 MDTK",
      summary: task.summary || "",
      usageScenario: task.usageScenario || task.usage_scenario || "",
      usage_scenario: task.usage_scenario || task.usageScenario || "",
      workspaceId: workspace?.id || task.workspaceId,
      workspace_id: workspace?.id || task.workspace_id,
      workspaceKey: workspace?.key || task.workspaceKey,
      workspace_key: workspace?.key || task.workspace_key,
      workspaceName: workspace?.name || "",
      status,
      rawStatus: status,
      applicationScope: "c",
      ownerUuid: task.ownerUuid || task.owner_uuid || "mdtk",
      owner_uuid: task.owner_uuid || task.ownerUuid || "mdtk",
      latestProgress,
      progressNote: latestProgress?.content || latestProgress?.note || "",
      progressCount: progress.length,
      checklistCount: model.checklist.filter(item => String(item.taskId) === String(task.id) && !item.deletedAt).length,
      attachmentCount: model.attachments.filter(item => String(item.taskId) === String(task.id) && !item.deletedAt).length,
      isTemplateTask: true,
      templateId: "c-operational-motherboard"
    };
  }

  function makeId(prefix, number) {
    return `${prefix}-${number}`;
  }

  function createStore(options = {}) {
    let storage = safeStorage(options.storage);
    let key = options.key || STORAGE_KEY;
    let model = null;
    const listeners = new Set();

    function getModel() {
      if (!model) model = readModel(storage, key);
      return model;
    }

    function publish(reason) {
      listeners.forEach(listener => {
        try { listener({ reason, source: "c-mdtk" }); } catch (error) { /* subscriber isolation */ }
      });
    }

    function commit(reason) {
      try { storage.setItem(key, JSON.stringify(getModel())); } catch (error) { /* local persistence is best effort */ }
      publish(reason);
    }

    function findTask(taskId) {
      return getModel().tasks.find(task => String(task.id) === String(taskId));
    }

    function findActivity(activityId) {
      return getModel().activities.find(item => String(item.id) === String(activityId));
    }

    function load() {
      const current = getModel();
      const workspaces = [...current.workspaces].sort((left, right) => left.sortOrder - right.sortOrder).map(decorateWorkspace);
      const tasks = current.tasks.filter(task => !task.deletedAt).map(task => decorateTask(current, task));
      return Promise.resolve({
        applicationScope: "c",
        workspaces,
        tasks,
        principles: [],
        systemMaps: [],
        engineeringMemoryFailures: [],
        findingCount: 0
      });
    }

    function subscribe(listener) {
      if (typeof listener === "function") listeners.add(listener);
      return Promise.resolve(() => listeners.delete(listener));
    }

    function createTask(payload = {}) {
      const current = getModel();
      const workspace = current.workspaces.find(row => String(row.id) === String(payload.workspaceId || payload.workspace_id)
        || String(row.key) === String(payload.workspaceKey || payload.workspace_key)) || current.workspaces[0];
      const number = current.nextTaskNumber++;
      const timestamp = NOW();
      const status = normalizeStatus(payload.status || STATUS_BY_WORKSPACE[workspace?.id]);
      const task = {
        id: makeId("c-mdtk-task", number),
        code: `MDTK-${String(number).padStart(3, "0")}`,
        title: String(payload.title || payload.summary || `MDTK-${String(number).padStart(3, "0")}`),
        summary: String(payload.summary || ""),
        usageScenario: String(payload.usageScenario || payload.usage_scenario || ""),
        usage_scenario: String(payload.usage_scenario || payload.usageScenario || ""),
        workspaceId: workspace?.id || "c-mdtk-todo",
        workspaceKey: workspace?.key || "c-mdtk-todo",
        status,
        rawStatus: status,
        applicationScope: "c",
        ownerUuid: "mdtk",
        owner_uuid: "mdtk",
        createdAt: timestamp,
        updatedAt: timestamp,
        agreementMode: null,
        agreementStartDate: null,
        agreementEndDate: null,
        deletedAt: null,
        isTemplateTask: true
      };
      current.tasks.push(task);
      commit("task-created");
      return Promise.resolve(decorateTask(current, task));
    }

    function createWorkspace(name) {
      const current = getModel();
      const number = current.nextWorkspaceNumber++;
      const timestamp = NOW();
      const workspace = {
        id: makeId("c-mdtk-custom", number),
        key: makeId("c-mdtk-custom", number),
        name: String(name || `MDTK 工作區 ${number}`),
        label: String(name || `MDTK 工作區 ${number}`),
        sortOrder: current.workspaces.length,
        applicationScope: "c",
        ownerUuid: "mdtk",
        active: true,
        createdAt: timestamp,
        updatedAt: timestamp
      };
      current.workspaces.push(workspace);
      commit("workspace-created");
      return Promise.resolve(decorateWorkspace(workspace));
    }

    function renameWorkspace(workspaceId, name) {
      const workspace = getModel().workspaces.find(row => String(row.id) === String(workspaceId));
      if (!workspace) throw new Error("C MDTK 工作區不存在。");
      workspace.name = String(name || workspace.name);
      workspace.label = workspace.name;
      workspace.updatedAt = NOW();
      commit("workspace-renamed");
      return Promise.resolve(decorateWorkspace(workspace));
    }

    function deleteWorkspace(workspaceId, targetWorkspaceId) {
      const current = getModel();
      const workspace = current.workspaces.find(row => String(row.id) === String(workspaceId));
      if (!workspace) throw new Error("C MDTK 工作區不存在。");
      if (["c-mdtk-todo", "c-mdtk-progress", "c-mdtk-completed"].includes(workspace.id)) throw new Error("C 母版必要工作區不可刪除。");
      const target = current.workspaces.find(row => String(row.id) === String(targetWorkspaceId)) || current.workspaces[0];
      let movedTaskCount = 0;
      current.tasks.forEach(task => {
        if (String(task.workspaceId) === String(workspace.id)) {
          task.workspaceId = target.id;
          task.workspaceKey = target.key;
          task.updatedAt = NOW();
          movedTaskCount += 1;
        }
      });
      current.workspaces = current.workspaces.filter(row => String(row.id) !== String(workspace.id));
      commit("workspace-deleted");
      return Promise.resolve({ workspaceId: workspace.id, movedTaskCount });
    }

    function reorderWorkspaces(workspaceIds = []) {
      const current = getModel();
      const ordered = new Map(workspaceIds.map((id, index) => [String(id), index]));
      current.workspaces.forEach((workspace, index) => {
        workspace.sortOrder = ordered.has(String(workspace.id)) ? ordered.get(String(workspace.id)) : index;
      });
      commit("workspace-reordered");
      return load();
    }

    function updateTaskTitle(payload = {}) {
      const task = findTask(payload.taskId);
      if (!task) throw new Error("C MDTK Task 不存在。");
      task.title = String(payload.title || task.title);
      task.updatedAt = NOW();
      commit("task-title-updated");
      return Promise.resolve(decorateTask(getModel(), task));
    }

    function updateTaskContent(payload = {}) {
      const task = findTask(payload.taskId);
      if (!task) throw new Error("C MDTK Task 不存在。");
      if (payload.summary !== undefined) task.summary = String(payload.summary || "");
      if (payload.usageScenario !== undefined) task.usageScenario = String(payload.usageScenario || "");
      if (payload.usage_scenario !== undefined) task.usageScenario = String(payload.usage_scenario || "");
      task.usage_scenario = task.usageScenario;
      task.updatedAt = NOW();
      commit("task-content-updated");
      return Promise.resolve(decorateTask(getModel(), task));
    }

    function deleteTask(taskId) {
      const task = findTask(taskId);
      if (!task) throw new Error("C MDTK Task 不存在。");
      task.deletedAt = NOW();
      task.updatedAt = task.deletedAt;
      commit("task-deleted");
      return Promise.resolve({ taskId: task.id });
    }

    function moveTaskWorkspace(taskId, workspaceId) {
      const task = findTask(taskId);
      const workspace = getModel().workspaces.find(row => String(row.id) === String(workspaceId));
      if (!task || !workspace) throw new Error("C MDTK Task 或工作區不存在。");
      task.workspaceId = workspace.id;
      task.workspaceKey = workspace.key;
      task.status = normalizeStatus(task.status || STATUS_BY_WORKSPACE[workspace.id]);
      if (STATUS_BY_WORKSPACE[workspace.id]) task.status = STATUS_BY_WORKSPACE[workspace.id];
      task.updatedAt = NOW();
      commit("task-workspace-moved");
      return Promise.resolve(decorateTask(getModel(), task));
    }

    function addTaskProgressNote(taskId, note) {
      const task = findTask(taskId);
      if (!task) throw new Error("C MDTK Task 不存在。");
      const current = getModel();
      const number = current.nextActivityNumber++;
      const timestamp = NOW();
      const item = {
        id: makeId("c-mdtk-activity", number),
        taskId: task.id,
        task_id: task.id,
        activityType: "human_progress_note",
        activity_type: "human_progress_note",
        action: "progress_note_created",
        content: String(note || ""),
        note: String(note || ""),
        actorLabel: "MDTK",
        timestamp,
        createdAt: timestamp,
        revisionOf: null,
        revision_of: null,
        tombstoneOf: null,
        tombstone_of: null,
        isTombstone: false
      };
      current.activities.push(item);
      task.updatedAt = timestamp;
      commit("progress-created");
      return Promise.resolve(clone(item));
    }

    function editTaskProgressNote(activityId, note) {
      const original = findActivity(activityId);
      if (!original) throw new Error("C MDTK 工作進度不存在。");
      const current = getModel();
      const number = current.nextActivityNumber++;
      const timestamp = NOW();
      const item = {
        id: makeId("c-mdtk-activity", number),
        taskId: original.taskId,
        task_id: original.task_id || original.taskId,
        activityType: "human_progress_note",
        activity_type: "human_progress_note",
        action: "progress_note_edited",
        content: String(note || ""),
        note: String(note || ""),
        actorLabel: "MDTK",
        timestamp,
        createdAt: timestamp,
        revisionOf: original.id,
        revision_of: original.id,
        tombstoneOf: null,
        tombstone_of: null,
        isTombstone: false
      };
      current.activities.push(item);
      const task = findTask(original.taskId);
      if (task) task.updatedAt = timestamp;
      commit("progress-edited");
      return Promise.resolve(clone(item));
    }

    function deleteTaskProgressNote(activityId) {
      const original = findActivity(activityId);
      if (!original) throw new Error("C MDTK 工作進度不存在。");
      const current = getModel();
      const number = current.nextActivityNumber++;
      const timestamp = NOW();
      const item = {
        id: makeId("c-mdtk-activity", number),
        taskId: original.taskId,
        task_id: original.task_id || original.taskId,
        activityType: "system_activity",
        activity_type: "system_activity",
        action: "progress_note_deleted",
        content: "",
        note: "",
        actorLabel: "MDTK",
        timestamp,
        createdAt: timestamp,
        revisionOf: null,
        revision_of: null,
        tombstoneOf: original.id,
        tombstone_of: original.id,
        isTombstone: true
      };
      current.activities.push(item);
      const task = findTask(original.taskId);
      if (task) task.updatedAt = timestamp;
      commit("progress-deleted");
      return Promise.resolve(clone(item));
    }

    function prepareAttachment(scope, payload = {}) {
      const current = getModel();
      const number = current.nextAttachmentNumber++;
      const file = payload.file || {};
      const activityId = payload.activityId || null;
      const activity = activityId
        ? current.activities.find(item => String(item.id) === String(activityId))
        : null;
      const taskId = payload.taskId || activity?.taskId || activity?.task_id || null;
      const attachment = {
        id: makeId("c-mdtk-attachment", number),
        attachmentId: makeId("c-mdtk-attachment", number),
        taskId,
        activityId,
        attachmentScope: scope,
        attachment_scope: scope,
        fileName: String(file.name || payload.fileName || "attachment"),
        file_name: String(file.name || payload.fileName || "attachment"),
        mimeType: String(file.type || "application/octet-stream"),
        storagePath: `c-mdtk/${scope}/${makeId("attachment", number)}/${String(file.name || "attachment")}`,
        storage_path: `c-mdtk/${scope}/${makeId("attachment", number)}/${String(file.name || "attachment")}`,
        storageBucket: "c-mdtk-local",
        storage_bucket: "c-mdtk-local",
        status: "prepared",
        createdAt: NOW(),
        deletedAt: null,
        previewUrl: ""
      };
      current.attachments.push(attachment);
      commit("attachment-prepared");
      return Promise.resolve(clone(attachment));
    }

    function uploadTaskAttachment(prepared) {
      const attachment = getModel().attachments.find(item => String(item.id) === String(prepared?.attachmentId || prepared?.id));
      if (!attachment) throw new Error("C MDTK 附件暫存資料不存在。");
      attachment.status = "uploaded";
      commit("attachment-uploaded");
      return Promise.resolve(clone(attachment));
    }

    function completeTaskAttachment(attachmentId) {
      const attachment = getModel().attachments.find(item => String(item.id) === String(attachmentId));
      if (!attachment) throw new Error("C MDTK 附件不存在。");
      attachment.status = "active";
      attachment.completedAt = NOW();
      commit("attachment-completed");
      return Promise.resolve(clone(attachment));
    }

    function deleteAttachment(attachmentId) {
      const attachment = getModel().attachments.find(item => String(item.id) === String(attachmentId));
      if (!attachment) throw new Error("C MDTK 附件不存在。");
      attachment.deletedAt = NOW();
      attachment.status = "deleted";
      commit("attachment-deleted");
      return Promise.resolve(clone(attachment));
    }

    function addTaskChecklistItem(payload = {}) {
      const task = findTask(payload.taskId);
      if (!task) throw new Error("C MDTK Task 不存在。");
      const current = getModel();
      const number = current.nextChecklistNumber++;
      const item = { id: makeId("c-mdtk-checklist", number), taskId: task.id, label: String(payload.label || ""), completed: false, sortOrder: Number(payload.sortOrder || number), createdAt: NOW(), updatedAt: NOW(), deletedAt: null };
      current.checklist.push(item);
      commit("checklist-created");
      return Promise.resolve(clone(item));
    }

    function updateTaskChecklistItem(payload = {}) {
      const item = getModel().checklist.find(row => String(row.id) === String(payload.id));
      if (!item) throw new Error("C MDTK Checklist 不存在。");
      if (payload.label !== undefined) item.label = String(payload.label || "");
      if (payload.completed !== undefined) item.completed = Boolean(payload.completed);
      if (payload.sortOrder !== undefined) item.sortOrder = Number(payload.sortOrder);
      item.updatedAt = NOW();
      commit("checklist-updated");
      return Promise.resolve(clone(item));
    }

    function deleteTaskChecklistItem(id) {
      const item = getModel().checklist.find(row => String(row.id) === String(id));
      if (!item) throw new Error("C MDTK Checklist 不存在。");
      item.deletedAt = NOW();
      item.updatedAt = item.deletedAt;
      commit("checklist-deleted");
      return Promise.resolve(clone(item));
    }

    function setAgreementSchedule(payload = {}) {
      const task = findTask(payload.taskId);
      if (!task) throw new Error("C MDTK Task 不存在。");
      task.agreementMode = payload.mode || null;
      task.agreementStartDate = payload.startDate || null;
      task.agreementEndDate = payload.endDate || null;
      task.agreement_start_date = task.agreementStartDate;
      task.agreement_end_date = task.agreementEndDate;
      task.updatedAt = NOW();
      commit("agreement-updated");
      return Promise.resolve(decorateTask(getModel(), task));
    }

    function loadChecklist() { return Promise.resolve([]); }
    function loadTaskChecklist(taskId) { return Promise.resolve(getModel().checklist.filter(item => String(item.taskId) === String(taskId) && !item.deletedAt).sort((left, right) => left.sortOrder - right.sortOrder).map(clone)); }
    function loadActivity(taskId) { return Promise.resolve(sortByTimestamp(getModel().activities.filter(item => String(item.taskId || item.task_id) === String(taskId))).map(clone)); }
    function loadArtifacts() { return Promise.resolve([]); }
    function loadTaskAttachments(taskId) { return Promise.resolve(getModel().attachments.filter(item => String(item.taskId) === String(taskId) && !item.deletedAt && item.status === "active").map(clone)); }
    function taskAttachmentUrl(attachment) { return Promise.resolve(attachment?.previewUrl || ""); }
    function runHealthCheck() { return Promise.resolve({ taskCount: getModel().tasks.filter(task => !task.deletedAt).length, findingCount: 0, findings: [], engineeringMemoryFailures: [] }); }

    function configure(next = {}) {
      if (next.storage) storage = safeStorage(next.storage);
      if (next.key) key = String(next.key);
      model = null;
      return api;
    }

    function reset() {
      model = defaultModel();
      try { storage.removeItem(key); } catch (error) { /* best effort */ }
      publish("reset");
      return load();
    }

    const api = {
      STORAGE_KEY: key,
      applicationScope: "c",
      load,
      subscribe,
      statusDescriptorFor,
      normalizeStatus,
      isGovernanceTerminal: task => statusDescriptorFor(task?.status).isTerminal,
      isArchiveTask: task => Boolean(task?.archivedAt || task?.deletedAt),
      completionGateStatus: () => ({ allowed: true, requiredCount: 0, completedCount: 0, missing: [] }),
      runHealthCheck,
      loadChecklist,
      loadTaskChecklist,
      loadActivity,
      loadArtifacts,
      loadTaskAttachments,
      taskAttachmentUrl,
      createTask,
      createWorkspace,
      renameWorkspace,
      deleteWorkspace,
      reorderWorkspaces,
      updateTaskTitle,
      updateTaskContent,
      deleteTask,
      moveTaskWorkspace,
      addTaskProgressNote,
      editTaskProgressNote,
      deleteTaskProgressNote,
      prepareTaskAttachment: payload => prepareAttachment("task", payload),
      prepareProgressNoteAttachment: payload => prepareAttachment("progress_note", payload),
      uploadTaskAttachment,
      completeTaskAttachment,
      deleteTaskAttachment: deleteAttachment,
      deleteProgressNoteAttachment: payload => deleteAttachment(payload?.attachmentId || payload?.id),
      addTaskChecklistItem,
      updateTaskChecklistItem,
      deleteTaskChecklistItem,
      updateChecklistItem: payload => updateTaskChecklistItem({ id: payload.id, completed: payload.state === "completed", label: payload.evidenceNote || payload.label }),
      setAgreementSchedule,
      worktodoSetAgreementSchedule: setAgreementSchedule,
      worktodoCreateTask: createTask,
      worktodoCreateWorkspace: createWorkspace,
      worktodoRenameWorkspace: renameWorkspace,
      worktodoDeleteWorkspace: deleteWorkspace,
      worktodoReorderWorkspaces: reorderWorkspaces,
      worktodoUpdateTask: payload => updateTaskContent({ taskId: payload.taskId, ...(payload.patch || {}) }),
      worktodoDeleteTask: deleteTask,
      worktodoAddTaskProgressNote: payload => addTaskProgressNote(payload.taskId, payload.note),
      worktodoEditTaskProgressNote: payload => editTaskProgressNote(payload.activityId, payload.note),
      worktodoDeleteTaskProgressNote: deleteTaskProgressNote,
      reset,
      configure
    };
    return api;
  }

  const singleton = createStore();
  return Object.freeze({ ...singleton, createStore, STORAGE_KEY });
});
