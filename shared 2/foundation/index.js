/* Foundation Runtime contracts (TASK-001/002/003/004/005/006). */
(function (root) {
  const foundation = {
    storage: root.ZhugeStorageMigration || null,
    data: root.ZhugeDataResult || null,
    identity: root.ZhugeIdentityHealth || null,
    session: root.ZhugeSessionLifecycle || null,
    bootstrap: root.ZhugeRepositoryBootstrap || null,
    sync: root.ZhugeSyncQueue || null
  };
  if (typeof module === "object" && module.exports) module.exports = foundation;
  if (root) root.ZhugeFoundationRuntime = Object.freeze(foundation);
})(typeof globalThis !== "undefined" ? globalThis : this);
