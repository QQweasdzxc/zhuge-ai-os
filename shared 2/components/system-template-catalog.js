/*
 * Zhuge AI OS System Template Catalog.
 *
 * C is the one operational motherboard. Board consumers apply this shared
 * presentation/runtime and retain only their own data and permission wiring.
 * MDTK is the C mother template's canonical Cloud board instance used to
 * exercise the published motherboard.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.ZhugeSystemTemplateCatalog = factory();
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  const GOLDEN_MASTER_ID = "ai-board-empty-golden-master";
  const CANONICAL_MOTHERBOARD_ID = GOLDEN_MASTER_ID;

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
    }),
    Object.freeze({
      id: "c-mtdk-adapter",
      label: "C Operational Motherboard / MDTK",
      owner: "C",
      domainDataId: "c-mdtk-cloud-data"
    })
  ]);

  const domainData = Object.freeze([
    Object.freeze({ id: "ai-board-domain-data", label: "AI Board Domain Data", owner: "AI Board" }),
    Object.freeze({ id: "worktodo-domain-data", label: "WorkTodo Domain Data", owner: "WorkTodo" }),
    Object.freeze({ id: "c-mdtk-cloud-data", label: "C MDTK Canonical Cloud Data", owner: "C" })
  ]);

  const lifecycleAction = (key, label) => Object.freeze({
    key,
    label,
    enabled: false,
    state: "reserved",
    reason: "待核准模板生命週期與受控套用流程"
  });

  const goldenMaster = Object.freeze({
    id: GOLDEN_MASTER_ID,
    name: "C 唯一看板母版",
    label: "C Operational Motherboard",
    type: "canonical-motherboard",
    status: "唯一正式母版",
    source: "C 模組",
    model: "single-c-motherboard-shared-runtime",
    publishedRelease: "shared/config/template-release.js",
    boardInstanceRegistry: "board_instances",
    moduleTaskPrefix: "MDTK",
    operational: true,
    adapters,
    domainData,
    sharedSurfaces: Object.freeze([
      "Shared Navigation / Shell",
      "Shared Header",
      "Shared Toolbar / Search / Filter / Sort",
      "Shared Workspace / Column / Move",
      "Shared Task Card",
      "Shared Task Drawer / Properties",
      "Shared Work Content / Usage Scenario",
      "Shared Checklist / Progress / Activity",
      "Shared General / Progress Attachment",
      "Shared Agreement / Schedule",
      "Shared GPT Analysis",
      "Shared Loading / Busy / Error / Confirm / Refresh",
      "Shared Responsive / Interaction"
    ]),
    emptySurface: Object.freeze({
      id: "c-motherboard-surface",
      renderer: "shared-golden-master",
      mode: "operational-motherboard",
      domainData: true,
      fixture: false,
      cloudWrites: true
    }),
    preview: Object.freeze({
      renderer: "shared-golden-master",
      mode: "operational-motherboard",
      domainData: true,
      fixture: false,
      cloudWrites: true
    }),
    capabilities: Object.freeze({
      catalog: "c-operational-motherboard",
      empty: Object.freeze({ domainData: true, fixture: false, cloudWrites: true }),
      workspace: Object.freeze({
        fixedColumns: false,
        source: "board_instances + board_workspaces",
        operations: Object.freeze(["add", "edit", "delete", "reorder", "move-task"])
      }),
      adoptionSwitch: Object.freeze({
        enabled: true,
        state: "published",
        off: "尚未採用已發布 C 母版",
        on: "使用已發布 C 母版與自身資料",
        phase: "Phase 3"
      }),
      clone: lifecycleAction("clone", "複製模板"),
      apply: Object.freeze({
        key: "apply",
        label: "套用 C",
        enabled: true,
        state: "published",
        reason: "使用既有已發布 C 母版；不複製共同 Runtime"
      })
    }),
    persistence: Object.freeze({
      mode: "canonical-supabase-board-instance",
      cloudWrites: true
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
    CANONICAL_MOTHERBOARD_ID,
    list,
    get,
    action
  });
});
