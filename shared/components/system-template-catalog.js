/*
 * Zhuge AI OS System Template Catalog
 *
 * This is a presentation-only contract.  It describes the one approved
 * Golden Master and the future template lifecycle without owning domain data,
 * persistence, authorization, or Cloud writes.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ZhugeSystemTemplateCatalog = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const GOLDEN_MASTER_ID = "ai-board-empty-golden-master";

  const adapters = Object.freeze([
    Object.freeze({
      id: "ai-board-adapter",
      label: "AI Board Adapter",
      owner: "AI Board",
      domainDataId: "ai-board-domain-data"
    }),
    Object.freeze({
      id: "worktodo-adapter",
      label: "WorkTodo Adapter",
      owner: "WorkTodo",
      domainDataId: "worktodo-domain-data"
    })
  ]);

  const domainData = Object.freeze([
    Object.freeze({ id: "ai-board-domain-data", label: "AI Board Domain Data", owner: "AI Board" }),
    Object.freeze({ id: "worktodo-domain-data", label: "WorkTodo Domain Data", owner: "WorkTodo" })
  ]);

  const previewColumns = Object.freeze([
    Object.freeze({
      id: "empty-template-preview",
      key: "empty-template-preview",
      name: "空白工作區",
      readOnly: true,
      reorderable: false,
      cards: [],
      emptyText: "Golden Master 不含任何 Domain Data。"
    })
  ]);

  const lifecycleAction = (key, label) => Object.freeze({
    key,
    label,
    enabled: false,
    state: "reserved",
    reason: "待核准模板生命週期與受控 Cloud 寫入流程"
  });

  const goldenMaster = Object.freeze({
    id: GOLDEN_MASTER_ID,
    name: "空白 AI Board",
    label: "AI Board Golden Master",
    type: "golden-master",
    status: "唯一正式模板",
    source: "AI Board",
    model: "single-template-two-adapters-two-domain-data",
    adapters,
    domainData,
    sharedSurfaces: Object.freeze(["Shared Task Board", "Shared Task Card", "Shared Task Drawer", "Work Journal Timeline"]),
    preview: Object.freeze({
      boardKey: "ai-board-golden-master-preview",
      columns: previewColumns
    }),
    capabilities: Object.freeze({
      catalog: "multi-template-ready",
      clone: lifecycleAction("clone", "複製模板"),
      apply: lifecycleAction("apply", "套用模板")
    }),
    persistence: Object.freeze({
      mode: "read-only",
      cloudWrites: false
    })
  });

  const catalog = Object.freeze([goldenMaster]);

  function list() {
    return catalog.slice();
  }

  function get(id = GOLDEN_MASTER_ID) {
    return catalog.find(template => template.id === id) || null;
  }

  function action(templateId, actionKey) {
    return get(templateId)?.capabilities?.[actionKey] || null;
  }

  return Object.freeze({
    GOLDEN_MASTER_ID,
    list,
    get,
    action
  });
});
