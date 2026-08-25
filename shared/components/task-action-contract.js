/*
 * Template C Shared Action Contract.
 *
 * The Drawer owns one interaction lifecycle: de-duplicate an in-flight action,
 * execute the active Consumer adapter operation, and let the caller perform
 * the canonical read-back. Adapters only supply domain mapping and controlled
 * operations; they do not render UI or own error/refresh presentation.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeSharedTaskActionContract = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const ACTIONS = Object.freeze([
    "createTask", "createWorkspace", "renameWorkspace", "reorderWorkspace", "updateTitle", "updateContent", "deleteTask",
    "addProgressNote", "editProgressNote", "deleteProgressNote",
    "addGeneralAttachment", "addProgressAttachment", "deleteAttachment",
    "addChecklist", "updateChecklist", "deleteChecklist", "updateGovernanceChecklist",
    "setAgreementSchedule", "moveWorkspace", "confirm"
  ]);

  function stableKey(name, payload, options = {}) {
    if (options.key) return String(options.key);
    const taskId = payload?.taskId || payload?.task_id || payload?.task?.id || "";
    const recordId = payload?.activityId || payload?.activity_id || payload?.attachmentId || payload?.attachment_id || payload?.id || "";
    return `${String(name || "action")}:${taskId}:${recordId}`;
  }

  function create(options = {}) {
    const adapter = options.adapter || {};
    const inFlight = new Map();
    const declaredActions = Object.freeze({ ...(adapter.actions || {}) });

    function execute(name, payload, lifecycle = {}) {
      const actionName = String(name || "").trim();
      const operation = declaredActions[actionName];
      if (typeof operation !== "function") {
        const error = new Error(`Shared Action Contract 未提供 ${actionName || "未命名"} 操作。`);
        error.code = "SHARED_ACTION_NOT_DECLARED";
        throw error;
      }
      const key = stableKey(actionName, payload, lifecycle);
      if (inFlight.has(key)) return inFlight.get(key);
      const promise = (async () => {
        try {
          const result = await operation(payload || {});
          if (typeof lifecycle.onReadBack === "function") await lifecycle.onReadBack({ action: actionName, payload, result });
          if (typeof lifecycle.onSuccess === "function") await lifecycle.onSuccess(result);
          return result;
        } catch (error) {
          if (typeof lifecycle.onError === "function") await lifecycle.onError(error);
          throw error;
        } finally {
          inFlight.delete(key);
        }
      })();
      inFlight.set(key, promise);
      return promise;
    }

    function has(name) {
      return typeof declaredActions[String(name || "").trim()] === "function";
    }

    async function read(name, payload) {
      const reader = adapter.read?.[String(name || "").trim()];
      if (typeof reader !== "function") {
        const error = new Error(`Shared Action Contract 未提供 ${String(name || "read")} 讀取。`);
        error.code = "SHARED_READ_NOT_DECLARED";
        throw error;
      }
      return reader(payload || {});
    }

    return Object.freeze({
      consumer: String(options.consumer || adapter.consumer || "").trim(),
      actions: declaredActions,
      capabilities: Object.freeze({ ...(adapter.capabilities || {}) }),
      execute,
      read,
      has,
      inFlight: () => inFlight.size
    });
  }

  function assert(contract, required = ACTIONS) {
    const missing = (Array.isArray(required) ? required : []).filter(name => !contract?.has?.(name));
    return Object.freeze({ ok: missing.length === 0, missing });
  }

  return Object.freeze({ ACTIONS, create, assert });
});
