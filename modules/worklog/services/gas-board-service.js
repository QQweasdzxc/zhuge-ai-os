/* 庶務行政／GAS C Consumer data boundary.
 *
 * GAS owns its future data source, but that source is not present in this
 * release.  Keep the canonical C runtime usable with a truthful empty state;
 * never borrow WorkLog, WorkTodo, Investment, or fixture data to fill it.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.GasBoardService = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const CONSUMER_ID = "worklog-procurement";
  const APPLICATION_SCOPE = "procurement";
  const WORKSPACE = Object.freeze({
    id: "procurement-gas-workspace",
    key: "procurement-gas",
    name: "GAS",
    applicationScope: APPLICATION_SCOPE,
    sortOrder: 0,
    active: true
  });

  function notConfiguredError(action = "這項操作") {
    const error = new Error(`庶務行政正式資料來源尚未建立，${action}未執行。`);
    error.code = "GAS_DATA_SOURCE_NOT_CONFIGURED";
    return error;
  }

  function emptyResult() {
    return Object.freeze({
      consumerId: CONSUMER_ID,
      applicationScope: APPLICATION_SCOPE,
      boardName: "庶務行政",
      taskCodePrefix: "GAS",
      dataStatus: "not-configured",
      dataSource: "正式庶務行政資料來源尚未建立",
      workspaces: Object.freeze([WORKSPACE]),
      tasks: Object.freeze([]),
      principles: Object.freeze([]),
      systemMaps: Object.freeze([]),
      workTodoJournal: Object.freeze([]),
      engineeringMemoryFailures: Object.freeze([])
    });
  }

  function create() {
    const service = {
      consumerId: CONSUMER_ID,
      applicationScope: APPLICATION_SCOPE,
      load: async () => emptyResult(),
      subscribe: async () => () => {},
      normalizeStatus: value => String(value || "ready").trim().toLowerCase() || "ready",
      statusDescriptorFor: value => ({ key: String(value || "ready"), label: "待接入", code: String(value || "ready") }),
      completionGateStatus: () => Object.freeze({ allowed: false, status: "not-configured", required: [], missing: [] }),
      isArchiveTask: () => false,
      isGovernanceTerminal: () => false,
      loadChecklist: async () => [],
      loadTaskActivity: async () => [],
      loadTaskAttachments: async () => [],
      loadTaskJournal: async () => [],
      createTask: async () => { throw notConfiguredError("建立 GAS 卡片"); },
      moveTaskToWorkspace: async () => { throw notConfiguredError("移動 GAS 卡片"); },
      updateTask: async () => { throw notConfiguredError("更新 GAS 卡片"); },
      updateTaskChecklistItem: async () => { throw notConfiguredError("更新 GAS Checklist"); },
      updateGovernanceChecklist: async () => { throw notConfiguredError("更新 GAS 治理 Checklist"); },
      createWorkspace: async () => { throw notConfiguredError("建立 GAS 工作區"); },
      renameWorkspace: async () => { throw notConfiguredError("重新命名 GAS 工作區"); },
      reorderWorkspaces: async () => { throw notConfiguredError("排序 GAS 工作區"); },
      deleteWorkspace: async () => { throw notConfiguredError("刪除 GAS 工作區"); },
      governanceAction: async () => { throw notConfiguredError("執行 GAS 治理動作"); },
      updateProgress: async () => { throw notConfiguredError("更新 GAS 進度"); },
      uploadTaskAttachment: async () => { throw notConfiguredError("上傳 GAS 附件"); }
    };
    return Object.freeze(service);
  }

  const singleton = create();
  return Object.freeze({
    consumerId: CONSUMER_ID,
    applicationScope: APPLICATION_SCOPE,
    workspace: WORKSPACE,
    create,
    createInstanceService: create,
    load: singleton.load,
    subscribe: singleton.subscribe
  });
});
