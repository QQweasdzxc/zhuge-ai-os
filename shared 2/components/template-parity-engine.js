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

  const ENGINE_VERSION = "c-mother-template-parity-v2";
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
  // These fields are observations about the probe itself, not template
  // capabilities.  They must not become false-positive Consumer features,
  // while every other unexpected key remains an EXTRA capability.
  const OBSERVATION_ONLY_KEYS = new Set([
    "runtimePresent", "renderPresent", "probe", "classifierPresent", "bindPresent",
    "contractPresent", "apisPresent", "gatePresent", "methodsPresent"
  ]);

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

  function stripObservationOnly(value) {
    if (Array.isArray(value)) return value.map(stripObservationOnly);
    if (!value || typeof value !== "object") return value;
    return Object.keys(value).reduce((result, key) => {
      if (!OBSERVATION_ONLY_KEYS.has(key)) result[key] = stripObservationOnly(value[key]);
      return result;
    }, {});
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
      contract: item.contract,
      machineContract: item.contract
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
      if (observed === undefined) return undefined;
      if (!observed || typeof observed !== "object" || Array.isArray(observed)) return observed;
      const source = observed;
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
      "feature-surface": { owner: goldenMaster && runtime ? "C" : "", surface: goldenMaster && runtime ? "shared-board-runtime" : "", consumerBusinessRules: goldenMaster && runtime ? "adapter-only" : "" },
      "ui-layout": { surface: markers.length === 4 ? "golden-master" : "", markers },
      "shared-components": sharedApiNames,
      "card": { renderer: cardProbe ? "ZhugeSharedTaskCard.render" : "", framework: cardProbe ? "shared-task-card" : "" },
      "drawer": { renderer: drawerProbe ? "ZhugeSharedTaskDrawer.render" : "", framework: drawerProbe ? "shared-task-drawer" : "", regions: drawerProbe ? ["header", "work-body", "activity"] : [], agreementScheduleFrame: agreementScheduleProbe ? { key: "agreement-schedule", framework: "shared-task-drawer-property", label: "約定日期／約定期間", editor: "controlled-shared-agreement-date-editor", dataIndependent: true } : undefined },
      "checklist": { formalGate: typeof runtime?.completionGateStatus === "function" ? "pm-acceptance" : "", engineeringEvidence: ["developer-qa", "gpt-review", "regression-evidence"], runtimeGate: typeof runtime?.completionGateStatus === "function" ? "completionGateStatus" : "" },
      "attachment": { scopes: ["task", "progress_note"], actions: actionNames.filter(name => ["addGeneralAttachment", "addProgressAttachment", "deleteAttachment"].includes(name)) },
      "progress": { timeline: root.ZhugeSharedActivityClassifier ? "shared-task-timeline" : "", source: root.ZhugeSharedActivityClassifier ? "engineering_activity_log" : "", classifier: root.ZhugeSharedActivityClassifier ? "ZhugeSharedActivityClassifier" : "" },
      "drag-drop": { cardType: board?.CARD_DRAG_TYPE || "", columnType: board?.COLUMN_DRAG_TYPE || "", handler: typeof board?.bind === "function" ? "ZhugeSharedTaskBoard.bind" : "" },
      "shared-action-entry": { contract: actionContract ? "ZhugeSharedTaskActionContract" : "", adapters: root.ZhugeSharedTaskActionAdapters ? "ZhugeSharedTaskActionAdapters" : "", singleRuntime: Boolean(actionContract && root.ZhugeSharedTaskActionAdapters) },
      "operation-method": { actions: actionNames, readBack: actionContract ? "consumer-adapter" : "", duplicateConsumerRenderer: true === false },
      "lifecycle-flow": { flow: runtime?.openTaskDetail && runtime?.moveTaskToWorkspace ? ["read", "render", "shared-action", "cloud-read-back"] : [], pmCompletion: typeof runtime?.openTaskDetail === "function" ? "formal-pm-acceptance" : "", dragAndDrawer: typeof runtime?.moveTaskToWorkspace === "function" && typeof runtime?.openTaskDetail === "function" ? "same-contract" : "" },
      "runtime-behavior": { runtime: runtime ? "ZhugeBoardRuntime" : "", methods: runtimeMethods.filter(name => typeof runtime?.[name] === "function"), behavior: allSharedApisPresent && cardProbe && drawerProbe && markers.length === 4 ? "shared-canonical" : "incomplete" },
      "publish-adopt-boundary": { publish: typeof root.ZhugeModulePublishService?.publish === "function" ? "update" : "unavailable", adopt: typeof root.ZhugeModulePublishService?.adopt === "function" ? "update" : "unavailable", parity: "compare-detect-report-only", parityDoesNotRepair: true },
      "data-boundary": { baseline: "C", compareDirection: "consumer-to-c", ignored: ["data", "workspace", "card-content", "identity"] }
    };
  }

  function inventoryFromContracts(contracts, options = {}) {
    const definitions = expectedCapabilities();
    const capabilities = definitions.map(item => {
      const observed = contracts?.[item.id];
      const projected = projectContract(item.contract, observed);
      const machineContract = observed === undefined ? undefined : stripObservationOnly(observed);
      return {
        id: item.id,
        label: item.label,
        fingerprint: fingerprint({ id: item.id, contract: machineContract }),
        present: observed !== undefined,
        contract: projected,
        machineContract
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
      contract: entry?.contract,
      machineContract: entry?.machineContract !== undefined ? entry.machineContract : entry?.contract
    })).filter(entry => entry.id);
    return {
      engineVersion: ENGINE_VERSION,
      baseline: options.baseline || "Current Consumer",
      consumerId: options.consumerId || "",
      capabilities
    };
  }

  function statusType(status) {
    return ({ MATCH: "match", MISSING: "missing", EXTRA: "extra", DIFFERENT: "mismatch" }[status]) || "mismatch";
  }

  function childPath(path, key) {
    if (Array.isArray(path)) return `${path.join(".")}\[${key}\]`;
    return path ? `${path}.${key}` : String(key);
  }

  function childLabel(label, key, value) {
    const valueLabel = typeof value === "string" && value ? `：${value}` : "";
    return `${label || "未命名能力"} · ${String(key)}${valueLabel}`;
  }

  function compareContractNode(expected, current, options = {}) {
    const id = options.id || "";
    const label = options.label || id || "未命名能力";
    const path = options.path || "";
    const base = {
      id,
      label,
      path,
      motherPresent: expected !== undefined,
      consumerPresent: current !== undefined,
      motherFingerprint: expected === undefined ? null : fingerprint(expected),
      consumerFingerprint: current === undefined ? null : fingerprint(current),
      motherContract: expected === undefined ? null : expected,
      consumerContract: current === undefined ? null : current,
      children: []
    };
    if (expected === undefined && current !== undefined) {
      return { ...base, status: "EXTRA", type: "extra", detail: "目前 Consumer 存在，但 C 母版沒有此子模板能力。" };
    }
    if (current === undefined) {
      return { ...base, status: "MISSING", type: "missing", detail: "C 母版存在，但目前 Consumer 缺少此子模板能力。" };
    }
    if (Array.isArray(expected)) {
      if (!Array.isArray(current)) {
        return { ...base, status: "DIFFERENT", type: "mismatch", detail: "能力名稱相同，但目前 Consumer 的資料型態／Behavior 不一致。" };
      }
      const children = [];
      expected.forEach((value, index) => children.push(compareContractNode(value, current[index], {
        id: childPath(id, index),
        label: childLabel(label, index + 1, value),
        path: childPath(path, index)
      })));
      current.slice(expected.length).forEach((value, offset) => {
        const index = expected.length + offset;
        children.push(compareContractNode(undefined, value, {
          id: childPath(id, index),
          label: childLabel(label, index + 1, value),
          path: childPath(path, index)
        }));
      });
      const status = children.some(item => item.status !== "MATCH") ? "DIFFERENT" : "MATCH";
      return { ...base, status, type: statusType(status), children, detail: status === "MATCH" ? "此子能力及其子能力一致。" : "此子能力的清單內容存在差異。" };
    }
    if (expected && typeof expected === "object") {
      if (!current || typeof current !== "object" || Array.isArray(current)) {
        return { ...base, status: "DIFFERENT", type: "mismatch", detail: "能力名稱相同，但目前 Consumer 的資料型態／Behavior 不一致。" };
      }
      const children = [];
      Object.keys(expected).forEach(key => children.push(compareContractNode(expected[key], current[key], {
        id: childPath(id, key),
        label: childLabel(label, key, expected[key]),
        path: childPath(path, key)
      })));
      Object.keys(current).filter(key => !Object.prototype.hasOwnProperty.call(expected, key)).forEach(key => {
        children.push(compareContractNode(undefined, current[key], {
          id: childPath(id, key),
          label: childLabel(label, key, current[key]),
          path: childPath(path, key)
        }));
      });
      const status = children.some(item => item.status !== "MATCH") ? "DIFFERENT" : "MATCH";
      return { ...base, status, type: statusType(status), children, detail: status === "MATCH" ? "此子能力及其子能力一致。" : "此子能力下存在一個或多個模板子能力差異。" };
    }
    const status = stableSerialize(expected) === stableSerialize(current) ? "MATCH" : "DIFFERENT";
    return { ...base, status, type: statusType(status), detail: status === "MATCH" ? "C 母版與目前 Consumer 的子能力一致。" : "能力名稱相同，但 Fingerprint／Behavior 不一致。" };
  }

  function leafDifferences(node, result = []) {
    if (!node || node.status === "MATCH") return result;
    if (Array.isArray(node.children) && node.children.length) {
      node.children.forEach(child => leafDifferences(child, result));
    } else {
      result.push(node);
    }
    return result;
  }

  function flattenInventory(rows, result = [], depth = 0) {
    (Array.isArray(rows) ? rows : []).forEach(row => {
      result.push({ ...row, depth });
      flattenInventory(row.children, result, depth + 1);
    });
    return result;
  }

  function contractNodeCount(value) {
    if (value === undefined) return 0;
    if (Array.isArray(value)) return value.reduce((count, child) => count + 1 + contractNodeCount(child), 0);
    if (value && typeof value === "object") return Object.values(value).reduce((count, child) => count + 1 + contractNodeCount(child), 0);
    return 0;
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
        return { id: row.id, label: row.label, status: "MISSING", type: "missing", motherPresent: true, consumerPresent: false, motherFingerprint: row.fingerprint, consumerFingerprint: null, motherContract: row.contract, consumerContract: null, machineContract: row.machineContract, children: [], detail: "C 母版存在，但目前 Consumer 缺少此模板能力。" };
      }
      const expectedContract = row.machineContract !== undefined ? row.machineContract : row.contract;
      const currentContract = currentRow.machineContract !== undefined ? currentRow.machineContract : currentRow.contract;
      const tree = expectedContract !== undefined || currentContract !== undefined
        ? compareContractNode(expectedContract, currentContract, { id: row.id, label: row.label })
        : null;
      const status = tree && tree.status !== "MATCH"
        ? "DIFFERENT"
        : currentRow.fingerprint === row.fingerprint ? "MATCH" : "DIFFERENT";
      const children = tree?.children || [];
      return { id: row.id, label: row.label, status, type: statusType(status), motherPresent: true, consumerPresent: true, motherFingerprint: row.fingerprint, consumerFingerprint: currentRow.fingerprint, motherContract: row.contract, consumerContract: currentRow.contract, machineContract: expectedContract, machineConsumerContract: currentContract, children, detail: status === "MATCH" ? "C 母版與目前 Consumer 的模板能力及其子能力一致。" : tree?.detail || "能力名稱相同，但 Fingerprint／Behavior 不一致。" };
    });
    currentRows.filter(row => !motherMap.has(row.id) && row.present !== false).forEach(row => {
      inventory.push({ id: row.id, label: row.label, status: "EXTRA", type: "extra", motherPresent: false, consumerPresent: true, motherFingerprint: null, consumerFingerprint: row.fingerprint, motherContract: null, consumerContract: row.contract, machineContract: undefined, machineConsumerContract: row.machineContract, children: [], detail: "目前 Consumer 存在，但 C 母版沒有此模板能力。" });
    });
    const differences = inventory.filter(row => row.status !== "MATCH").map(row => ({ ...row }));
    const matched = inventory.filter(row => row.status === "MATCH");
    const differenceDetails = inventory.reduce((result, row) => {
      if (row.status === "MATCH") return result;
      const leaves = leafDifferences({ status: row.status, children: row.children, id: row.id, label: row.label, type: row.type, detail: row.detail, motherFingerprint: row.motherFingerprint, consumerFingerprint: row.consumerFingerprint, motherContract: row.motherContract, consumerContract: row.consumerContract });
      if (!leaves.length) leaves.push(row);
      return result.concat(leaves.map(item => ({ ...item, parentId: row.id, parentLabel: row.label })));
    }, []);
    const machineInventory = flattenInventory(inventory);
    const machineGapCount = differenceDetails.length;
    const machineMotherCount = motherRows.reduce((count, row) => count + 1 + contractNodeCount(row.machineContract !== undefined ? row.machineContract : row.contract), 0);
    const machineConsumerCount = currentRows.reduce((count, row) => count + 1 + contractNodeCount(row.machineContract !== undefined ? row.machineContract : row.contract), 0);
    const machineMatchCount = machineInventory.filter(row => row.status === "MATCH").length;
    const gapCount = machineGapCount || differences.length;
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
      differenceDetails,
      machineInventory,
      machineMotherCount,
      machineConsumerCount,
      machineMatchCount,
      machineGapCount,
      childMotherCount: Math.max(0, machineMotherCount - motherRows.length),
      childConsumerCount: Math.max(0, machineConsumerCount - currentRows.length),
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
      lines.push(`Capability Inventory：${item.inventory.length} 個頂層分類；子能力 ${Number(item.childMotherCount || 0)} 個，完整機器比對 ${Number(item.machineMatchCount || 0)} / ${Number(item.machineMotherCount || 0)}，Machine Gap ${Number(item.machineGapCount || 0)}`);
      const writeNode = (capability, depth = 0) => {
        const prefix = depth ? `${"  ".repeat(depth)}-` : "-";
        lines.push(`${prefix} ${capability.status || "UNKNOWN"}｜${capability.label || capability.id || "未命名能力"}｜${capability.id || "—"}｜C Fingerprint ${capability.motherFingerprint || "—"}｜Consumer Fingerprint ${capability.consumerFingerprint || "—"}`);
        (capability.children || []).forEach(child => writeNode(child, depth + 1));
      };
      item.inventory.forEach(capability => writeNode(capability));
    }
    if (Array.isArray(item.differences) && item.differences.length) {
      lines.push("差異：");
      item.differences.forEach(diff => lines.push(`- ${diff.type}｜${diff.label || diff.id}｜${diff.detail || ""}`));
    }
    if (Array.isArray(item.differenceDetails) && item.differenceDetails.length) {
      lines.push("子能力差異（機器比對）：");
      item.differenceDetails.forEach(diff => lines.push(`- ${diff.status || "UNKNOWN"}｜${diff.label || diff.id}｜${diff.path || diff.id}｜${diff.detail || ""}`));
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
