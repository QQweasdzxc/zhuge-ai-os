/*
 * Template C domain adapters.
 *
 * These adapters contain only Consumer data/RPC/storage mapping. The Shared
 * Task Drawer calls them through ZhugeSharedTaskActionContract and remains the
 * single place for presentation, confirmation, busy state, errors, and
 * read-back/refresh lifecycle.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeSharedTaskActionAdapters = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  function required(service, name) {
    if (typeof service?.[name] === "function") return service[name].bind(service);
    return async () => {
      const error = new Error(`正式 Domain Operation ${name} 尚未載入。`);
      error.code = "DOMAIN_OPERATION_UNAVAILABLE";
      throw error;
    };
  }

  function rawWorkTodoAttachment(item = {}) {
    return {
      ...item,
      id: item.id || item.attachmentId,
      attachmentId: item.attachmentId || item.id,
      storage_path: item.storage_path || item.storagePath,
      storage_bucket: item.storage_bucket || item.storageBucket,
      attachment_scope: item.attachment_scope || item.attachmentScope,
      journal_entry_uuid: item.journal_entry_uuid || item.journalEntryUuid
    };
  }

  function createAiBoardAdapter({ task, service } = {}) {
    const taskId = task?.id;
    return {
      consumer: "ai_board",
      capabilities: Object.freeze({
        progressNoteAttachment: true,
        agreementSchedule: false,
        taskChecklist: true,
        governanceChecklist: true
      }),
      actions: {
        createTask: payload => required(service, "createTask")(payload),
        createWorkspace: payload => required(service, "createWorkspace")(payload.name),
        renameWorkspace: payload => required(service, "renameWorkspace")(payload.workspaceId, payload.name),
        deleteWorkspace: payload => required(service, "deleteWorkspace")(payload.workspaceId),
        reorderWorkspace: payload => required(service, "reorderWorkspaces")(payload.workspaceIds),
        updateTitle: payload => required(service, "updateTaskTitle")({ taskId: payload.taskId || taskId, title: payload.title }),
        updateContent: payload => required(service, "updateTaskContent")({
          taskId: payload.taskId || taskId,
          summary: payload.summary,
          usageScenario: payload.usageScenario
        }),
        deleteTask: payload => required(service, "deleteTask")(payload.taskId || taskId),
        addProgressNote: payload => required(service, "addTaskProgressNote")(payload.taskId || taskId, payload.note),
        editProgressNote: payload => required(service, "editTaskProgressNote")(payload.activityId, payload.note),
        deleteProgressNote: payload => required(service, "deleteTaskProgressNote")(payload.activityId),
        addGeneralAttachment: async payload => {
          const prepared = await required(service, "prepareTaskAttachment")({ taskId: payload.taskId || taskId, file: payload.file });
          await required(service, "uploadTaskAttachment")(prepared, payload.file);
          return required(service, "completeTaskAttachment")(prepared.attachmentId);
        },
        addProgressAttachment: async payload => {
          const prepared = await required(service, "prepareProgressNoteAttachment")({ activityId: payload.activityId, file: payload.file });
          await required(service, "uploadTaskAttachment")(prepared, payload.file);
          return required(service, "completeTaskAttachment")(prepared.attachmentId);
        },
        deleteAttachment: payload => payload.scope === "progress_note"
          ? required(service, "deleteProgressNoteAttachment")({ attachmentId: payload.attachmentId, taskId: payload.taskId || taskId, activityId: payload.activityId })
          : required(service, "deleteTaskAttachment")(payload.attachmentId),
        addChecklist: payload => required(service, "addTaskChecklistItem")({ taskId: payload.taskId || taskId, label: payload.label, sortOrder: payload.sortOrder }),
        updateChecklist: payload => required(service, "updateTaskChecklistItem")({ id: payload.id, completed: payload.completed, label: payload.label, sortOrder: payload.sortOrder }),
        deleteChecklist: payload => required(service, "deleteTaskChecklistItem")(payload.id),
        updateGovernanceChecklist: payload => required(service, "updateChecklistItem")({ id: payload.id, state: payload.state, evidenceNote: payload.evidenceNote, evidenceRef: payload.evidenceRef }),
        moveWorkspace: payload => required(service, "moveTaskWorkspace")(payload.taskId || taskId, payload.workspaceId, payload.reason),
        confirm: payload => payload
      },
      read: {
        activity: payload => required(service, "loadActivity")(payload.taskId || taskId, payload.options || {}),
        attachments: payload => required(service, "loadTaskAttachments")(payload.taskId || taskId),
        checklist: payload => required(service, "loadTaskChecklist")(payload.taskId || taskId),
        attachmentUrl: payload => required(service, "taskAttachmentUrl")(payload.attachment)
      }
    };
  }

  function createWorkTodoAdapter({ task, service, dataService, repository } = {}) {
    const taskId = task?.id;
    const domain = dataService || root?.DataService;
    const repo = repository || root?.SupabaseRepository;
    const callDomain = (name, ...args) => required(domain, name)(...args);
    return {
      consumer: "worktodo",
      capabilities: Object.freeze({
        progressNoteAttachment: true,
        agreementSchedule: true,
        taskChecklist: true,
        governanceChecklist: false
      }),
      actions: {
        createTask: payload => required(service, "worktodoCreateTask")(payload),
        createWorkspace: payload => required(service, "worktodoCreateWorkspace")(payload.name),
        renameWorkspace: payload => required(service, "worktodoRenameWorkspace")(payload.workspaceId, payload.name),
        deleteWorkspace: payload => required(service, "worktodoDeleteWorkspace")(payload.workspaceId),
        reorderWorkspace: payload => required(service, "worktodoReorderWorkspaces")(payload.workspaceIds),
        updateTitle: payload => required(service, "worktodoUpdateTask")({ taskId: payload.taskId || taskId, patch: { title: payload.title } }),
        updateContent: payload => required(service, "worktodoUpdateTask")({
          taskId: payload.taskId || taskId,
          patch: { summary: payload.summary, usage_scenario: payload.usageScenario }
        }),
        deleteTask: payload => required(service, "worktodoDeleteTask")(payload.taskId || taskId),
        addProgressNote: payload => required(service, "worktodoAddTaskProgressNote")({ taskId: payload.taskId || taskId, note: payload.note }),
        editProgressNote: payload => required(service, "worktodoEditTaskProgressNote")({ activityId: payload.activityId, note: payload.note }),
        deleteProgressNote: payload => required(service, "worktodoDeleteTaskProgressNote")(payload.activityId),
        addGeneralAttachment: payload => callDomain("uploadWorkTodoAttachment", payload.taskId || taskId, payload.file, { scope: "task" }),
        addProgressAttachment: payload => callDomain("uploadWorkTodoProgressAttachment", payload.taskId || taskId, payload.activityId, payload.file),
        deleteAttachment: payload => callDomain("deleteWorkTodoAttachment", rawWorkTodoAttachment(payload.item || payload)),
        addChecklist: payload => callDomain("addWorkTodoChecklistItem", payload.taskId || taskId, payload.label, payload.sortOrder),
        updateChecklist: payload => callDomain("updateWorkTodoChecklistItem", payload.id, { completed: payload.completed, label: payload.label, sortOrder: payload.sortOrder }),
        deleteChecklist: payload => callDomain("deleteWorkTodoChecklistItem", payload.id),
        setAgreementSchedule: payload => required(service, "worktodoSetAgreementSchedule")({
          taskId: payload.taskId || taskId,
          mode: payload.mode,
          startDate: payload.startDate,
          endDate: payload.endDate
        }),
        moveWorkspace: payload => required(service, "worktodoUpdateTask")({
          taskId: payload.taskId || taskId,
          patch: payload.status ? { status: payload.status } : { workspace_id: payload.workspaceId }
        }),
        confirm: payload => payload
      },
      read: {
        activity: payload => required(service, "loadActivity")(payload.taskId || taskId, payload.options || {}),
        capabilities: async payload => {
          if (typeof domain?.loadWorkTodoTaskCapabilities !== "function") return { checklist: [], attachments: [] };
          return domain.loadWorkTodoTaskCapabilities(payload.taskId || taskId);
        },
        attachmentUrl: async payload => {
          const item = rawWorkTodoAttachment(payload.attachment);
          if (typeof repo?.signedWorkTodoAttachmentUrl !== "function") return "";
          return repo.signedWorkTodoAttachmentUrl(item.storage_path, 300);
        }
      }
    };
  }

  function create(options = {}) {
    return options.workTodo
      ? createWorkTodoAdapter(options)
      : createAiBoardAdapter(options);
  }

  return Object.freeze({ create, createAiBoardAdapter, createWorkTodoAdapter, rawWorkTodoAttachment });
});
