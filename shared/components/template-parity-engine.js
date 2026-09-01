/*
 * C Mother Template Parity Engine.
 *
 * C / Shared Golden Master is the only template baseline.  This module owns
 * comparison only: it inventories semantic capabilities, compares one
 * Consumer to C, and reports differences.  It never publishes, adopts,
 * repairs, moves cards, or writes Cloud data.
 */
(function (root, factory) {
  const api = factory(root || globalThis);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeTemplateParityEngine = api;
})(typeof window !== "undefined" ? window : globalThis, function (runtimeRoot) {
  "use strict";

  const ENGINE_VERSION = "c-mother-template-parity-v1";
  const REQUIRED_ACTIONS = Object.freeze([
    "createTask", "createWorkspace", "renameWorkspace", "deleteWorkspace", "reorderWorkspace", "updateTitle", "updateContent", "deleteTask",
    "addProgressNote", "editProgressNote", "deleteProgressNote",
    "addGeneralAttachment", "addProgressAttachment", "deleteAttachment",
    "addChecklist", "updateChecklist", "deleteChecklist", "updateGovernanceChecklist",
    "setAgreementSchedule", "moveWorkspace", "confirm"
  ]);
  const SHARED_COMPONENT_APIS = Object.freeze({
    goldenMaster: ["renderHeader", "renderHeaderActions", "renderToolbar", "renderOperations", "mountOperations", "renderCard", "renderColumns", "renderBoard", "renderDrawer", "render", "mount", "bindBoard"],
    board: ["CARD_DRAG_TYPE", "COLUMN_DRAG_TYPE", "renderColumns", "render", "bind"],
    card: ["render"],
    drawer: ["renderProperties", "render", "mount"]
  });

  function stableSerialize(value) {
    if (value === undefined) return '"__undefined__"';
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(",")}}`;
  }

  // A small deterministic digest keeps the browser contract self-contained;
  // this is a semantic inventory fingerprint, never a source-line counter.
  function fingerprint(value) {
    const input = stableSerialize(value);
    let hash = 2166136261;
    for (let index = 0; index < input.length; index += 1) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619) >>> 0;
    }
    return `fnv1a-${hash.toString(16).padStart(8, "0")}`;
  }

  function expectedCapabilities() {
    return [
      { id: "feature-surface", label: "功能", contract: { owner: "C", surface: "shared-board-runtime", consumerBusinessRules: "adapter-only" } },
      { id: "ui-layout", label: "UI／版面", contract: { surface: "golden-master", markers: ["data-golden-master-surface", "data-golden-master-toolbar", "data-golden-master-board-mount", "data-shared-task-board"] } },
      { id: "shared-components", label: "共用元件", contract: SHARED_COMPONENT_APIS },
      { id: "card", label: "Card", contract: { renderer: "ZhugeSharedTaskCard.render", framework: "shared-task-card" } },
      { id: "drawer", label: "Drawer", contract: { renderer: "ZhugeSharedTaskDrawer.render", framework: "shared-task-drawer", regions: ["header", "work-body", "activity"], agreementScheduleFrame: { key: "agreement-schedule", framework: "shared-task-drawer-property", label: "約定日期／約定期間", editor: "controlled-shared-agreement-date-editor", dataIndependent: true } } },
      { id: "checklist", label: "Checklist", contract: { formalGate: "pm-acceptance", engineeringEvidence: ["developer-qa", "gpt-review", "regression-evidence"], runtimeGate: "completionGateStatus" } },
      { id: "attachment", label: "Attachment", contract: { scopes: ["task", "progress_note"], actions: ["addGeneralAttachment", "addProgressAttachment", "deleteAttachment"] } },
      { id: "progress", label: "Progress", contract: { timeline: "shared-task-timeline", source: "engineering_activity_log", classifier: "ZhugeSharedActivityClassifier" } },
      { id: "drag-drop", label: "Drag & Drop", contract: { cardType: "application/x-zhuge-shared-task-card", columnType: "application/x-zhuge-shared-task-column", handler: "ZhugeSharedTaskBoard.bind" } },
      { id: "shared-action-entry", label: "共用操作入口", contract: { contract: "ZhugeSharedTaskActionContract", adapters: "ZhugeSharedTaskActionAdapters", singleRuntime: true } },
      { id: "operation-method", label: "操作方式", contract: { actions: REQUIRED_ACTIONS.slice().sort(), readBack: "consumer-adapter", duplicateConsumerRenderer: false } },
      { id: "lifecycle-flow", label: "操作流程", contract: { flow: ["read", "render", "shared-action", "cloud-read-back"], pmCompletion: "formal-pm-acceptance", dragAndDrawer: "same-contract" } },
      { id: "runtime-behavior", label: "Runtime Behavior", contract: { runtime: "ZhugeBoardRuntime", methods: ["refresh", "openTaskDetail", "moveTaskToWorkspace", "completionGateStatus", "completionGateMessage", "runParityGuard"], behavior: "shared-canonical" } },
      { id: "publish-adopt-boundary", label: "Publish／Adopt 邊界", contract: { publish: "update", adopt: "update", parity: "compare-detect-report-only", parityDoesNotRepair: true } },
      { id: "data-boundary", label: "資料邊界", contract: { baseline: "C", compareDirection: "consumer-to-c", ignored: ["data", "workspace", "card-content", "identity"] } }
    ];
  }

  function canonicalInventory() {
    const capabilities = expectedCapabilities().map(item => ({
      id: item.id,
      label: item.label,
      fingerprint: fingerprint({ id: item.id, contract: item.contract }),
      present: true,
      contract: item.contract
    }));
    return {
      engineVersion: ENGINE_VERSION,
      baseline: "C Mother Template",
      capabilities
    };
  }

  function functionMap(api, names) {
    const source = api || {};
    return names.reduce((result, name) => {
      result[name] = typeof source[name] === "function" || (name in source && source[name] != null);
      return result;
    }, {});
  }

  function htmlProbe(api, args, marker) {
    try {
      const value = api?.render?.(args);
      return typeof value === "string" && value.includes(marker);
    } catch (_error) {
      return false;
    }
  }

  function domMarkers(documentObject) {
    const document = documentObject;
    if (!document?.querySelector) return [];
    const selectors = [
      "[data-golden-master-surface]",
      "[data-golden-master-toolbar=\"true\"]",
      "[data-golden-master-board-mount]",
      "[data-shared-task-board]"
    ];
    return selectors.filter(selector => document.querySelector(selector)).map(selector => selector.match(/\[([^=\]]+)/)?.[1] || selector);
  }

  function projectContract(expected, observed) {
    if (Array.isArray(expected)) return Array.isArray(observed) ? observed : undefined;
    if (expected && typeof expected === "object") {
      const source = observed && typeof observed === "object" ? observed : {};
      return Object.keys(expected).reduce((result, key) => {
        result[key] = projectContract(expected[key], source[key]);
        return result;
      }, {});
    }
    return observed;
  }

  function observedContracts(options = {}) {
    const root = options.root || runtimeRoot || globalThis;
    const document = options.document || root.document;
    const goldenMaster = root.ZhugeGoldenMaster;
    const board = root.ZhugeSharedTaskBoard;
    const card = root.ZhugeSharedTaskCard;
    const drawer = root.ZhugeSharedTaskDrawer;
    const actionContract = root.ZhugeSharedTaskActionContract;
    const runtime = root.ZhugeBoardRuntime;
    const actionNames = Array.isArray(actionContract?.ACTIONS) ? actionContract.ACTIONS.slice().sort() : [];
    const markers = domMarkers(document);
    const cardProbe = htmlProbe(card, { code: "PARITY", title: "Parity", summary: "Parity" }, "shared-task-card-title");
    const drawerProbe = htmlProbe(drawer, { title: "Parity", titleCode: "PARITY", sections: [], activity: { html: "" } }, "data-shared-task-region=\"activity\"");
    const agreementScheduleProbe = htmlProbe(drawer, { title: "Parity", titleCode: "PARITY", properties: [{ key: "agreement-schedule", action: "agreement-schedule", interactive: true, icon: "📅", label: "約定日期", value: "尚未設定" }], sections: [], activity: { html: "" } }, "data-task-property=\"agreement-schedule\"");
    const goldenMasterMethods = functionMap(goldenMaster, SHARED_COMPONENT_APIS.goldenMaster);
    const boardMethods = functionMap(board, SHARED_COMPONENT_APIS.board);
    const cardMethods = functionMap(card, SHARED_COMPONENT_APIS.card);
    const drawerMethods = functionMap(drawer, SHARED_COMPONENT_APIS.drawer);
    const allSharedApis = { goldenMaster: goldenMasterMethods, board: boardMethods, card: cardMethods, drawer: drawerMethods };
    const sharedApiNames = Object.fromEntries(Object.entries(allSharedApis).map(([group, methods]) => [group, Object.keys(methods).filter(name => methods[name])]));
    const allSharedApisPresent = Object.values(allSharedApis).every(group => Object.values(group).every(Boolean));
    const runtimeMethods = ["refresh", "openTaskDetail", "moveTaskToWorkspace", "completionGateStatus", "completionGateMessage", "runParityGuard"];
    return {
      "feature-surface": { owner: "C", surface: "shared-board-runtime", consumerBusinessRules: "adapter-only", runtimePresent: Boolean(goldenMaster && runtime) },
      "ui-layout": { surface: "golden-master", markers },
      "shared-components": sharedApiNames,
      "card": { renderer: "ZhugeSharedTaskCard.render", framework: "shared-task-card", renderPresent: Boolean(card?.render), probe: cardProbe },
      "drawer": { renderer: "ZhugeSharedTaskDrawer.render", framework: "shared-task-drawer", regions: ["header", "work-body", "activity"], agreementScheduleFrame: { key: "agreement-schedule", framework: "shared-task-drawer-property", label: "約定日期／約定期間", editor: "controlled-shared-agreement-date-editor", dataIndependent: true, renderPresent: Boolean(drawer?.render), probe: agreementScheduleProbe }, renderPresent: Boolean(drawer?.render), probe: drawerProbe },
      "checklist": { formalGate: "pm-acceptance", engineeringEvidence: ["developer-qa", "gpt-review", "regression-evidence"], runtimeGate: "completionGateStatus", gatePresent: typeof runtime?.completionGateStatus === "function" },
      "attachment": { scopes: ["task", "progress_note"], actions: actionNames.filter(name => ["addGeneralAttachment", "addProgressAttachment", "deleteAttachment"].includes(name)), contractPresent: Boolean(actionContract) },
      "progress": { timeline: "shared-task-timeline", source: "engineering_activity_log", classifier: "ZhugeSharedActivityClassifier", classifierPresent: Boolean(root.ZhugeSharedActivityClassifier) },
      "drag-drop": { cardType: board?.CARD_DRAG_TYPE || "", columnType: board?.COLUMN_DRAG_TYPE || "", handler: "ZhugeSharedTaskBoard.bind", bindPresent: typeof board?.bind === "function" },
      "shared-action-entry": { contract: "ZhugeSharedTaskActionContract", adapters: "ZhugeSharedTaskActionAdapters", singleRuntime: true, apisPresent: Boolean(actionContract && root.ZhugeSharedTaskActionAdapters) },
      "operation-method": { actions: actionNames, readBack: "consumer-adapter", duplicateConsumerRenderer: true === false },
      "lifecycle-flow": { flow: ["read", "render", "shared-action", "cloud-read-back"], pmCompletion: "formal-pm-acceptance", dragAndDrawer: "same-contract", methodsPresent: typeof runtime?.moveTaskToWorkspace === "function" && typeof runtime?.openTaskDetail === "function" },
      "runtime-behavior": { runtime: "ZhugeBoardRuntime", methods: runtimeMethods.filter(name => typeof runtime?.[name] === "function"), behavior: allSharedApisPresent && cardProbe && drawerProbe && markers.length === 4 ? "shared-canonical" : "incomplete" },
      "publish-adopt-boundary": { publish: typeof root.ZhugeModulePublishService?.publish === "function" ? "update" : "unavailable", adopt: typeof root.ZhugeModulePublishService?.adopt === "function" ? "update" : "unavailable", parity: "compare-detect-report-only", parityDoesNotRepair: true },
      "data-boundary": { baseline: "C", compareDirection: "consumer-to-c", ignored: ["data", "workspace", "card-content", "identity"] }
    };
  }

  function inventoryFromContracts(contracts, options = {}) {
    const definitions = expectedCapabilities();
    const capabilities = definitions.map(item => {
      const observed = contracts?.[item.id];
      const projected = projectContract(item.contract, observed);
      return {
        id: item.id,
        label: item.label,
        fingerprint: fingerprint({ id: item.id, contract: projected }),
        present: observed !== undefined,
        contract: projected
      };
    });
    return {
      engineVersion: ENGINE_VERSION,
      baseline: options.baseline || "Current Consumer",
      consumerId: options.consumerId || "",
      trigger: options.trigger || "manual",
      capabilities
    };
  }

  function collectConsumerInventory(options = {}) {
    const contracts = options.contracts || observedContracts(options);
    return inventoryFromContracts(contracts, { baseline: options.baseline || "Current Consumer", consumerId: options.consumerId, trigger: options.trigger });
  }

  function createInventory(entries = [], options = {}) {
    const capabilities = (Array.isArray(entries) ? entries : []).map(entry => ({
      id: String(entry?.id || "").trim(),
      label: String(entry?.label || entry?.id || "").trim(),
      fingerprint: String(entry?.fingerprint || fingerprint(entry?.contract || entry?.value || null)),
      present: entry?.present !== false,
      contract: entry?.contract
    })).filter(entry => entry.id);
    return {
      engineVersion: ENGINE_VERSION,
      baseline: options.baseline || "Current Consumer",
      consumerId: options.consumerId || "",
      capabilities
    };
  }

  function compare(baseline, consumer) {
    const mother = baseline || canonicalInventory();
    const current = consumer || createInventory();
    const motherRows = Array.isArray(mother.capabilities) ? mother.capabilities : [];
    const currentRows = Array.isArray(current.capabilities) ? current.capabilities : [];
    const motherMap = new Map(motherRows.map(row => [row.id, row]));
    const currentMap = new Map(currentRows.map(row => [row.id, row]));
    const inventory = motherRows.map(row => {
      const currentRow = currentMap.get(row.id);
      if (!currentRow || currentRow.present === false) {
        return { id: row.id, label: row.label, status: "MISSING", type: "missing", motherPresent: true, consumerPresent: false, motherFingerprint: row.fingerprint, consumerFingerprint: null, motherContract: row.contract, consumerContract: null, detail: "C 母版存在，但目前 Consumer 缺少此模板能力。" };
      }
      if (currentRow.fingerprint !== row.fingerprint) {
        return { id: row.id, label: row.label, status: "DIFFERENT", type: "mismatch", motherPresent: true, consumerPresent: true, motherFingerprint: row.fingerprint, consumerFingerprint: currentRow.fingerprint, motherContract: row.contract, consumerContract: currentRow.contract, detail: "能力名稱相同，但 Fingerprint／Behavior 不一致。" };
      }
      return { id: row.id, label: row.label, status: "MATCH", type: "match", motherPresent: true, consumerPresent: true, motherFingerprint: row.fingerprint, consumerFingerprint: currentRow.fingerprint, motherContract: row.contract, consumerContract: currentRow.contract, detail: "C 母版與目前 Consumer 的模板能力一致。" };
    });
    currentRows.filter(row => !motherMap.has(row.id) && row.present !== false).forEach(row => {
      inventory.push({ id: row.id, label: row.label, status: "EXTRA", type: "extra", motherPresent: false, consumerPresent: true, motherFingerprint: null, consumerFingerprint: row.fingerprint, motherContract: null, consumerContract: row.contract, detail: "目前 Consumer 存在，但 C 母版沒有此模板能力。" });
    });
    const differences = inventory.filter(row => row.status !== "MATCH").map(row => ({ ...row }));
    const matched = inventory.filter(row => row.status === "MATCH");
    const gapCount = differences.length;
    return {
      engineVersion: ENGINE_VERSION,
      baseline: "C Mother Template",
      consumer: current.baseline || "Current Consumer",
      consumerId: current.consumerId || "",
      motherCount: motherRows.length,
      consumerCount: currentRows.length,
      matchCount: matched.length,
      gapCount,
      templateGap: gapCount,
      fingerprint: gapCount === 0 ? "MATCH" : "MISMATCH",
      status: gapCount === 0 ? "match" : "gap",
      inventory,
      differences,
      ignoredData: ["data", "workspace", "card-content", "identity"],
      direction: "consumer-to-c",
      trigger: current.trigger || "manual"
    };
  }

  function run(options = {}) {
    const baseline = options.baseline || canonicalInventory();
    const consumer = options.consumerInventory
      ? { ...options.consumerInventory, trigger: options.trigger || options.consumerInventory.trigger || "manual" }
      : collectConsumerInventory({ ...options, consumerId: options.consumerId, baseline: options.consumerLabel || "Current Consumer" });
    return compare(baseline, consumer);
  }

  function runManual(options = {}) {
    return run({ ...options, trigger: "manual" });
  }

  function runAutoGuard(options = {}) {
    return run({ ...options, trigger: options.trigger || "regression" });
  }

  function summary(report) {
    const item = report || {};
    const prefix = item.gapCount === 0 ? "🟢 C 母版一致" : "🔴 C 母版不一致";
    return `${prefix}｜${Number(item.matchCount || 0)} / ${Number(item.motherCount || 0)}${item.gapCount ? `｜Gap ${item.gapCount}` : ""}`;
  }

  function formatReport(report) {
    const item = report || {};
    const lines = [
      `C Mother Template：${Number(item.motherCount || 0)}`,
      `目前 Consumer：${Number(item.consumerCount || 0)}`,
      `MATCH：${Number(item.matchCount || 0)} / ${Number(item.motherCount || 0)}`,
      `Template Gap：${Number(item.gapCount || 0)}`,
      `Fingerprint：${item.fingerprint || "MISMATCH"}`
    ];
    if (Array.isArray(item.inventory)) {
      lines.push("Capability Inventory：");
      item.inventory.forEach(capability => lines.push(`- ${capability.status || "UNKNOWN"}｜${capability.label || capability.id || "未命名能力"}｜C Fingerprint ${capability.motherFingerprint || "—"}｜Consumer Fingerprint ${capability.consumerFingerprint || "—"}`));
    }
    if (Array.isArray(item.differences) && item.differences.length) {
      lines.push("差異：");
      item.differences.forEach(diff => lines.push(`- ${diff.type}｜${diff.label || diff.id}｜${diff.detail || ""}`));
    }
    return lines.join("\n");
  }

  return Object.freeze({
    ENGINE_VERSION,
    REQUIRED_ACTIONS,
    SHARED_COMPONENT_APIS,
    expectedCapabilities,
    fingerprint,
    canonicalInventory,
    collectConsumerInventory,
    createInventory,
    compare,
    run,
    runManual,
    runAutoGuard,
    summary,
    formatReport
  });
});
