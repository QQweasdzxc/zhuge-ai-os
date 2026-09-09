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
    "addGeneralAttachment", "addProgressAttachment", "updateAttachmentMetadata", "deleteAttachment",
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
  const BEHAVIOR_CONTRACT_ID = "module-c-lifecycle-acceptance-v1";
  const BEHAVIOR_CONTRACT_SOURCE = "module-c-mother";
  const BEHAVIOR_CONTRACT_CHECKS = Object.freeze([
    "workspaceDecision",
    "completionDecision",
    "reopenDecision",
    "acceptance",
    "audit",
    "atomicity"
  ]);
  const BEHAVIOR_POLICY = Object.freeze({
    c: Object.freeze({ mode: "required", label: "C 母版" }),
    ai_board: Object.freeze({ mode: "required", label: "AI Board" }),
    worktodo: Object.freeze({ mode: "approved", label: "WorkTodo", reason: "WorkTodo 保留個人工作產品語意，不啟用 Engineering Acceptance。" }),
    procurement: Object.freeze({ mode: "approved", label: "庶務行政", reason: "庶務行政依產品 Capability 使用自己的資料與操作邊界。" }),
    investment: Object.freeze({ mode: "approved", label: "Investment", reason: "Investment 維持 read-only 產品邊界，不啟用看板 Lifecycle 操作。" })
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

  function stripObservationOnly(value) {
    if (Array.isArray(value)) return value.map(stripObservationOnly);
    if (!value || typeof value !== "object") return value;
    return Object.keys(value).reduce((result, key) => {
      if (!OBSERVATION_ONLY_KEYS.has(key)) result[key] = stripObservationOnly(value[key]);
      return result;
    }, {});
  }

  function normalizeBehaviorScope(value) {
    const raw = String(value || "").trim().toLowerCase().replace(/[\s_-]+/g, "");
    if (raw === "ai" || raw === "aiboard" || raw === "aiboardconsumer") return "ai_board";
    if (raw === "worktodo" || raw === "worktodotasks" || raw === "tasksnew") return "worktodo";
    if (raw === "procurement" || raw === "gas" || raw === "庶務行政") return "procurement";
    if (raw === "investment" || raw === "ivtk" || raw === "portfolio") return "investment";
    if (raw === "c" || raw === "cmother" || raw === "c母版") return "c";
    return String(value || "").trim().toLowerCase() || "ai_board";
  }

  function inferBehaviorScope(options = {}, snapshot = {}) {
    const rawScope = options.applicationScope || snapshot.applicationScope || options.consumerId || options.consumerLabel || "";
    const scope = normalizeBehaviorScope(rawScope);
    if (scope !== "c" || snapshot.boardIsTemplate === true || options.isMotherTemplate === true) return scope;
    const prefix = String(options.taskCodePrefix || snapshot.taskCodePrefix || "").trim().toUpperCase();
    const label = String(options.consumerLabel || snapshot.boardName || "").trim().toLowerCase();
    if (prefix === "IVTK" || label.includes("investment") || label.includes("投資")) return "investment";
    if (prefix === "GAS" || label.includes("gas") || label.includes("庶務")) return "procurement";
    return scope;
  }

  function canonicalBehaviorContract() {
    return {
      id: BEHAVIOR_CONTRACT_ID,
      source: BEHAVIOR_CONTRACT_SOURCE,
      workspaceDecision: "canonical",
      completionDecision: "canonical",
      reopenDecision: "canonical",
      acceptance: "canonical",
      audit: "canonical",
      atomicity: "single-transaction"
    };
  }

  function cloneSerializable(value) {
    if (value === undefined) return undefined;
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_error) {
      return undefined;
    }
  }

  /*
   * A Published C semantic snapshot is intentionally separate from release
   * identity.  Version/build/commit tell us which artifact is in play; the
   * snapshot tells parity what actually changed.  This keeps a harmless
   * identity-only difference from becoming a false red layer.
   */
  function normalizeSemanticSnapshot(value) {
    if (!value || typeof value !== "object") return null;
    const raw = value.publishedSnapshot || value.semanticSnapshot || value.snapshot || value;
    if (!raw || typeof raw !== "object") return null;
    const rawInventory = raw.inventory || raw.capabilityInventory || (Array.isArray(raw.capabilities) ? raw : null);
    const inventory = rawInventory && Array.isArray(rawInventory.capabilities)
      ? createInventory(rawInventory.capabilities, {
        baseline: rawInventory.baseline || "C Mother Template",
        consumerId: rawInventory.consumerId || "",
        trigger: rawInventory.trigger || "published"
      })
      : null;
    const behaviorValue = raw.behaviorContract || raw.behavior || raw.lifecycleContract;
    const behaviorContract = behaviorValue && typeof behaviorValue === "object"
      ? cloneSerializable(behaviorValue)
      : null;
    if (!inventory && !behaviorContract) return null;
    return {
      schemaVersion: Number(raw.schemaVersion || raw.schema_version || 1),
      version: String(raw.version || raw.templateVersion || raw.publishedVersion || ""),
      build: String(raw.build || raw.publishedBuild || ""),
      sourceCommit: String(raw.sourceCommit || raw.source_commit || "").trim().toLowerCase(),
      sourceFingerprint: String(raw.sourceFingerprint || raw.source_fingerprint || "").trim().toLowerCase(),
      inventory,
      behaviorContract
    };
  }

  function behaviorObservationFromContract(value, options = {}) {
    const raw = value?.behaviorContract || value?.behavior || value?.lifecycleContract || value || {};
    const actual = cloneSerializable(raw) || {};
    const scope = inferBehaviorScope(options, actual);
    actual.applicationScope = scope;
    actual.consumer = String(options.consumerLabel || actual.consumer || scope || "Current Consumer");
    actual.contractId = String(actual.contractId || actual.id || "").trim();
    actual.source = String(actual.source || actual.implementationSource || "").trim().toLowerCase();
    actual.implementationSource = String(actual.implementationSource || actual.source || "").trim().toLowerCase() || "unknown";
    actual.sharedRuntime = actual.sharedRuntime === undefined ? true : Boolean(actual.sharedRuntime);
    return actual;
  }

  function semanticSnapshotIdentity(snapshot) {
    const item = snapshot || {};
    return {
      version: String(item.version || ""),
      build: String(item.build || ""),
      sourceCommit: String(item.sourceCommit || ""),
      sourceFingerprint: String(item.sourceFingerprint || "")
    };
  }

  function adoptionStatusIsIdentityOnly(value) {
    const status = String(value || "").trim().toLowerCase();
    return status === "stale" || status === "published_pending_reload" || status === "not_adopted";
  }

  function formatSnapshotIdentity(value) {
    const identity = value || {};
    const version = String(identity.version || "").trim();
    const build = String(identity.build || "").trim();
    const fingerprint = String(identity.sourceFingerprint || "").trim();
    const parts = [];
    if (version) parts.push(version);
    if (build) parts.push(`Build ${build}`);
    if (fingerprint) parts.push(`Fingerprint ${fingerprint}`);
    return parts.join(" · ") || "unavailable";
  }

  function unavailableBehaviorContract(expected, options = {}) {
    const scope = normalizeBehaviorScope(options.applicationScope || "ai_board");
    const policy = BEHAVIOR_POLICY[scope] || BEHAVIOR_POLICY.ai_board;
    return {
      id: BEHAVIOR_CONTRACT_ID,
      version: BEHAVIOR_CONTRACT_ID,
      applicationScope: scope,
      consumer: options.consumerLabel || policy.label,
      status: "unverified",
      layerStatus: "fail",
      differenceCount: 0,
      differences: [],
      approvedDifferences: [],
      expected,
      observed: null,
      policy: policy.mode,
      evidenceStatus: "unavailable",
      evidenceMessage: "目前採用版本尚未提供可比對的 C 功能／流程快照。"
    };
  }

  function behaviorObservation(options = {}) {
    if (options.behaviorObserved && typeof options.behaviorObserved === "object") {
      return { ...options.behaviorObserved, applicationScope: inferBehaviorScope(options, options.behaviorObserved) };
    }
    const root = options.root || runtimeRoot || globalThis;
    const runtime = root?.ZhugeBoardRuntime;
    const snapshot = typeof runtime?.getSnapshot === "function" ? (runtime.getSnapshot() || {}) : {};
    const scope = inferBehaviorScope(options, snapshot);
    const contract = snapshot.lifecycleContract || runtime?.lifecycleContract || root?.ZhugeBoardReadService?.lifecycleContract || {};
    const capabilities = snapshot.lifecycleCapabilities || runtime?.lifecycleCapabilities || {};
    const sharedRuntime = Boolean(
      runtime
      && typeof runtime.moveTaskToWorkspace === "function"
      && typeof runtime.getSnapshot === "function"
    );
    const implementationSource = String(
      options.implementationSource
      || snapshot.lifecycleImplementation
      || contract.source
      || ""
    ).trim().toLowerCase();
    const contractId = String(contract.id || "").trim();
    const isCanonicalContract = contractId === BEHAVIOR_CONTRACT_ID && implementationSource === BEHAVIOR_CONTRACT_SOURCE;
    const privateImplementation = /consumer[-_ ]?(specific|private)|private[-_ ]?consumer/.test(implementationSource)
      || snapshot.consumerLifecycleImplementation === "consumer-specific";
    const canonicalMethod = typeof runtime?.moveTaskToWorkspace === "function"
      && (
        capabilities.pmWorkspaceAuthority === true
        || scope === "worktodo"
        || scope === "procurement"
        || scope === "investment"
        || (scope === "c" && (snapshot.boardIsTemplate === true || options.isMotherTemplate === true))
      );
    return {
      applicationScope: scope,
      consumer: String(options.consumerLabel || snapshot.boardName || scope || "Current Consumer"),
      contractId,
      source: String(contract.source || "").trim().toLowerCase(),
      implementationSource: privateImplementation ? "consumer-specific" : implementationSource || "unknown",
      sharedRuntime,
      capabilities: { ...capabilities },
      workspaceDecision: sharedRuntime && canonicalMethod && isCanonicalContract ? "canonical" : "unavailable",
      completionDecision: isCanonicalContract && contract.completionDecisionAction === "pm-workspace-decision-to-completed" ? "canonical" : "unavailable",
      reopenDecision: isCanonicalContract && contract.reopenAction === "pm-workspace-decision-reopen" ? "canonical" : "unavailable",
      acceptance: isCanonicalContract
        && contract.acceptanceAction === "qjc-drop-to-completed"
        && contract.evidenceMode === "controlled-action-context" ? "canonical" : "unavailable",
      audit: isCanonicalContract && contract.audit === "engineering_activity_log" ? "canonical" : "unavailable",
      atomicity: isCanonicalContract && contract.atomicity === "single-transaction" ? "single-transaction" : "unverified",
      privateImplementation
    };
  }

  function behaviorDifference(check, expected, actual) {
    const copy = {
      workspaceDecision: {
        title: "卡片移動流程與 C 母版不同",
        cause: "目前 Consumer 沒有採用 C 母版的工作區決定流程。",
        impact: "PM 移動卡片時，工作區與正式狀態可能無法依同一套規則收斂。",
        recommendation: "由 Consumer 採用 C Mother 的 Workspace Decision Contract，不在頁面另做同義流程。"
      },
      completionDecision: {
        title: "完成流程與 C 母版不同",
        cause: "目前 Consumer 沒有使用 C Mother 定義的 PM Completion Decision。",
        impact: "PM 可能需要額外理解內部工作階段，或遇到不同的完成結果。",
        recommendation: "接回 C Mother 的受控完成流程；保留必要 Gate，但不要新增 Consumer-specific Acceptance。"
      },
      reopenDecision: {
        title: "重新開啟流程與 C 母版不同",
        cause: "目前 Consumer 沒有使用 C Mother 定義的 Reopen Decision。",
        impact: "完成後重新交回工作時，正式狀態、負責人與 Audit 可能不同步。",
        recommendation: "採用 C Mother 的 Reopen／Reconciliation Contract。"
      },
      acceptance: {
        title: "驗收流程與 C 母版不同",
        cause: "目前 Consumer 的 PM Acceptance 入口或操作 Context 沒有接到 C Mother。",
        impact: "PM 的完成決定可能被錯誤轉成手動工程 Evidence 要求。",
        recommendation: "使用 C Mother 的受控 Acceptance Context，不在 Consumer 複製驗收邏輯。"
      },
      audit: {
        title: "Audit 紀錄流程與 C 母版不同",
        cause: "目前 Consumer 沒有確認共用 Lifecycle Audit 的正式紀錄來源。",
        impact: "工作區移動、完成或重新開啟可能缺少可追溯紀錄。",
        recommendation: "沿用 C Mother 指定的 Cloud Audit 來源。"
      },
      atomicity: {
        title: "操作的原子性與 C 母版不同",
        cause: "目前 Consumer 沒有確認狀態、工作區與 Audit 是否在同一個受控交易中完成。",
        impact: "畫面位置與正式狀態可能短暫或永久分裂。",
        recommendation: "由 C Mother Contract 保持成功全寫入、失敗全不變。"
      }
    }[check] || {
      title: "操作與流程與 C 母版不同",
      cause: "目前 Consumer 尚未證明採用 C Mother 的共用流程。",
      impact: "可能造成不同頁面操作結果不一致。",
      recommendation: "回到 C Mother Contract 統一共用流程。"
    };
    return {
      id: `behavior.${check}`,
      check,
      kind: "behavior-contract",
      title: copy.title,
      cause: copy.cause,
      impact: copy.impact,
      recommendation: copy.recommendation,
      expected,
      actual: actual || "未提供"
    };
  }

  function compareBehaviorContractAgainst(observed, expectedContract, options = {}) {
    const actual = behaviorObservationFromContract(observed || {}, options);
    const scope = normalizeBehaviorScope(options.applicationScope || actual.applicationScope || "ai_board");
    const policy = BEHAVIOR_POLICY[scope] || BEHAVIOR_POLICY.ai_board;
    const expected = {
      ...canonicalBehaviorContract(),
      ...(expectedContract && typeof expectedContract === "object" ? expectedContract : {})
    };
    const differences = [];
    const approvedDifferences = [];

    if (policy.mode === "approved") {
      const canonicalIdentity = actual.contractId === expected.id
        && actual.implementationSource === String(expected.source || BEHAVIOR_CONTRACT_SOURCE).trim().toLowerCase();
      if (actual.privateImplementation || actual.implementationSource === "consumer-specific" || !canonicalIdentity) {
        differences.push({
          id: "behavior.private-implementation",
          check: "implementationSource",
          kind: "behavior-contract",
          title: "Consumer 尚未證明採用 C 母版流程",
          cause: actual.privateImplementation || actual.implementationSource === "consumer-specific"
            ? `${policy.label} 目前回報了 Consumer-specific Lifecycle 實作，而不是採用 C Mother。`
            : `${policy.label} 尚未回報完整的 C Canonical Contract 身分。`,
          impact: "共用看板流程可能在不同產品中逐步漂移。",
          recommendation: "保留產品 Capability 差異，但先由 Consumer 採用 C Mother Canonical Contract；不要在 Consumer 另做同義流程。",
          expected: expected.source || BEHAVIOR_CONTRACT_SOURCE,
          actual: actual.implementationSource || "未提供"
        });
      } else {
        approvedDifferences.push({
          id: `behavior.approved.${scope}`,
          kind: "approved-capability-difference",
          title: `${policy.label} 依產品 Capability 使用不同邊界`,
          detail: policy.reason
        });
      }
      return {
        id: BEHAVIOR_CONTRACT_ID,
        version: BEHAVIOR_CONTRACT_ID,
        applicationScope: scope,
        consumer: actual.consumer || policy.label,
        status: differences.length ? "gap" : "approved",
        layerStatus: differences.length ? "fail" : "pass",
        differenceCount: differences.length,
        differences,
        approvedDifferences,
        expected,
        observed: actual,
        policy: policy.mode
      };
    }

    if (actual.privateImplementation || actual.implementationSource === "consumer-specific") {
      differences.push({
        id: "behavior.private-implementation",
        check: "implementationSource",
        kind: "behavior-contract",
        title: "Consumer 有自己的同義流程",
        cause: "目前 Consumer 回報了 Consumer-specific Lifecycle 實作，而不是採用 C Mother。",
        impact: "這會讓畫面雖然同屬 C Consumer，操作流程卻可能逐步漂移。",
        recommendation: "回到 C Mother Canonical Contract 修正，不能以 Consumer patch 取代。",
        expected: BEHAVIOR_CONTRACT_SOURCE,
        actual: actual.implementationSource
      });
    }
    const expectedSource = String(expected.source || BEHAVIOR_CONTRACT_SOURCE).trim().toLowerCase();
    if (!actual.privateImplementation
      && actual.implementationSource !== expectedSource
      && actual.implementationSource !== "unknown") {
      differences.push(behaviorDifference("implementationSource", expectedSource, actual.implementationSource));
    }
    if (actual.contractId !== expected.id) {
      differences.push(behaviorDifference("completionDecision", expected.id, actual.contractId));
    }
    BEHAVIOR_CONTRACT_CHECKS.forEach(check => {
      if (actual[check] !== expected[check]) differences.push(behaviorDifference(check, expected[check], actual[check]));
    });
    return {
      id: BEHAVIOR_CONTRACT_ID,
      version: BEHAVIOR_CONTRACT_ID,
      applicationScope: scope,
      consumer: actual.consumer || policy.label,
      status: differences.length ? "gap" : "match",
      layerStatus: differences.length ? "fail" : "pass",
      differenceCount: differences.length,
      differences,
      approvedDifferences,
      expected,
      observed: actual,
      policy: policy.mode
    };
  }

  function compareBehaviorContract(observed, options = {}) {
    return compareBehaviorContractAgainst(observed, canonicalBehaviorContract(), options);
  }

  function sourceContract(options = {}) {
    const sourceIntegrity = String(options.sourceIntegrity || "").trim().toLowerCase();
    const adoptionStatus = String(options.adoptionStatus || "").trim().toLowerCase();
    const semanticEvidence = options.semanticEvidence === true;
    const status = sourceIntegrity === "mismatch"
      ? "gap"
      : semanticEvidence || sourceIntegrity === "match" || adoptionStatus === "adopted"
        ? "match"
        : adoptionStatus === "stale"
          ? "gap"
        : "approved";
    const semanticComparison = options.semanticComparison || null;
    return {
      id: "module-c-published-source-v1",
      status,
      layerStatus: status === "gap" ? "fail" : "pass",
      sourceIntegrity: sourceIntegrity || "unverified",
      adoptionStatus: adoptionStatus || "unverified",
      semanticEvidence: semanticEvidence ? "available" : "unavailable",
      semanticComparison,
      differences: status === "gap" ? [{
        id: "source.integrity",
        kind: "source-integrity",
        title: adoptionStatus === "stale" && !semanticEvidence ? "目前採用版本尚未取得可比對的語意資料" : "目前載入來源與 Published C 不一致",
        cause: adoptionStatus === "stale" && !semanticEvidence
          ? "目前只知道 Consumer 尚未採用最新版本，但沒有足夠的能力／流程快照可以確認實際差異。"
          : "Consumer 的程式來源沒有對上目前已發布的 C 母版。",
        impact: "在沒有語意比對證據前，不能把目前狀態視為與最新版 C 母版一致。",
        recommendation: "先取得 Consumer 目前採用版本的語意快照，再由 C Mother Compare／Detect／Report。"
      }] : [],
      detail: status === "match"
        ? semanticComparison?.identityOnlyDifference
          ? "版本身份不同，但目前比對到的功能與流程內容一致。"
          : semanticEvidence
            ? "已以 Latest Published C 與目前採用內容完成語意比對。"
            : "目前來源已對上 Published C。"
        : status === "gap"
          ? "來源完整性檢查未通過。"
          : "目前未發現來源衝突；完整來源證據保留在技術明細。"
    };
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

  function compare(baseline, consumer, options = {}) {
    const latestPublishedC = normalizeSemanticSnapshot(
      options.latestPublishedC
      || options.publishedC
      || options.templateRelease?.publishedSnapshot
    );
    const adoptedC = normalizeSemanticSnapshot(
      options.adoptedC
      || options.currentAdoptedC
      || options.templateRelease?.adoption?.snapshot
    );
    const adoptedIdentity = options.adoptedIdentity || options.templateRelease?.adoption || null;
    const semanticBaselineUnavailable = adoptionStatusIsIdentityOnly(options.adoptionStatus) && !adoptedC;
    const mother = baseline || latestPublishedC?.inventory || canonicalInventory();
    const runtimeConsumer = consumer || createInventory();
    const current = adoptedC?.inventory
      ? {
        ...adoptedC.inventory,
        baseline: "Consumer Current Adopted C",
        consumerId: runtimeConsumer.consumerId || adoptedC.inventory.consumerId || ""
      }
      : runtimeConsumer;
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
    const behaviorObserved = adoptedC?.behaviorContract
      ? behaviorObservationFromContract(adoptedC.behaviorContract, {
        applicationScope: options.applicationScope || runtimeConsumer.applicationScope || runtimeConsumer.consumerId,
        consumerLabel: options.consumerLabel || runtimeConsumer.baseline
      })
      : options.behaviorObserved || runtimeConsumer.behaviorContractObserved || behaviorObservation(options);
    const expectedBehavior = latestPublishedC?.behaviorContract || canonicalBehaviorContract();
    const behavior = semanticBaselineUnavailable
      ? unavailableBehaviorContract(expectedBehavior, {
        applicationScope: options.applicationScope || runtimeConsumer.applicationScope || runtimeConsumer.consumerId,
        consumerLabel: options.consumerLabel || runtimeConsumer.baseline
      })
      : compareBehaviorContractAgainst(behaviorObserved, expectedBehavior, {
        applicationScope: options.applicationScope || behaviorObserved.applicationScope || runtimeConsumer.applicationScope || runtimeConsumer.consumerId,
        consumerLabel: options.consumerLabel || runtimeConsumer.baseline
      });
    const semanticComparison = {
      mode: adoptedC ? "consumer-adopted-vs-latest-published" : "consumer-runtime-vs-latest-published",
      status: semanticBaselineUnavailable ? "unverified" : "verified",
      evidence: semanticBaselineUnavailable ? "adopted-semantic-snapshot-unavailable" : "available",
      latestPublishedC: latestPublishedC ? semanticSnapshotIdentity(latestPublishedC) : { source: "c-mother-canonical-source" },
      consumerCurrentAdoptedC: adoptedC ? semanticSnapshotIdentity(adoptedC) : adoptedIdentity ? semanticSnapshotIdentity(adoptedIdentity) : { source: "adopted-semantic-snapshot-unavailable" },
      interfaceStatus: semanticBaselineUnavailable ? "unverified" : gapCount === 0 ? "match" : "gap",
      behaviorStatus: semanticBaselineUnavailable ? "unverified" : behavior.layerStatus === "pass" ? "match" : "gap",
      identityOnlyDifference: Boolean(
        adoptionStatusIsIdentityOnly(options.adoptionStatus)
        && gapCount === 0
        && behavior.layerStatus === "pass"
      )
    };
    const source = sourceContract({
      sourceIntegrity: options.sourceIntegrity,
      adoptionStatus: options.adoptionStatus,
      semanticEvidence: !semanticBaselineUnavailable,
      semanticComparison
    });
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
      fingerprint: semanticBaselineUnavailable ? "UNVERIFIED" : gapCount === 0 ? "MATCH" : "MISMATCH",
      status: semanticBaselineUnavailable || gapCount > 0 ? "gap" : "match",
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
      trigger: current.trigger || "manual",
      sourceContract: source,
      behaviorContract: behavior,
      compareBaseline: semanticComparison,
      overallStatus: !semanticBaselineUnavailable && gapCount === 0 && source.layerStatus === "pass" && behavior.layerStatus === "pass" ? "match" : "gap"
    };
  }

  function run(options = {}) {
    const baseline = options.baseline || canonicalInventory();
    const consumer = options.consumerInventory
      ? { ...options.consumerInventory, trigger: options.trigger || options.consumerInventory.trigger || "manual" }
      : collectConsumerInventory({ ...options, consumerId: options.consumerId, baseline: options.consumerLabel || "Current Consumer" });
    return compare(baseline, consumer, {
      ...options,
      behaviorObserved: options.behaviorObserved,
      applicationScope: options.applicationScope,
      sourceIntegrity: options.sourceIntegrity,
      adoptionStatus: options.adoptionStatus
    });
  }

  function runManual(options = {}) {
    return run({ ...options, trigger: "manual" });
  }

  function runAutoGuard(options = {}) {
    return run({ ...options, trigger: options.trigger || "regression" });
  }

  function summary(report) {
    const item = report || {};
    const healthy = item.overallStatus
      ? item.overallStatus === "match"
      : item.gapCount === 0;
    const prefix = healthy ? "🟢 C 母版一致" : "🔴 C 母版不一致";
    return `${prefix}｜${Number(item.matchCount || 0)} / ${Number(item.motherCount || 0)}${item.gapCount ? `｜Gap ${item.gapCount}` : ""}`;
  }

  function arrayAlignment(expected, current) {
    if (!Array.isArray(expected) || !Array.isArray(current)) return null;
    const equal = (left, right) => stableSerialize(left) === stableSerialize(right);
    const findInsertion = (source, target, direction) => {
      if (target.length !== source.length + 1) return null;
      let sourceIndex = 0;
      let targetIndex = 0;
      let insertedIndex = -1;
      let insertedValue;
      while (sourceIndex < source.length && targetIndex < target.length) {
        if (equal(source[sourceIndex], target[targetIndex])) {
          sourceIndex += 1;
          targetIndex += 1;
          continue;
        }
        if (insertedIndex >= 0) return null;
        insertedIndex = targetIndex;
        insertedValue = target[targetIndex];
        targetIndex += 1;
      }
      if (insertedIndex < 0 && targetIndex < target.length) {
        insertedIndex = targetIndex;
        insertedValue = target[targetIndex];
        targetIndex += 1;
      }
      if (sourceIndex !== source.length || targetIndex !== target.length || insertedIndex < 0) return null;
      return { direction, index: insertedIndex, value: insertedValue };
    };
    const inserted = findInsertion(expected, current, "extra");
    if (inserted) return inserted;
    const removed = findInsertion(current, expected, "missing");
    if (removed) return { direction: "missing", index: removed.index, value: removed.value };
    return null;
  }

  function findArrayAlignment(expected, current, path = "") {
    const direct = arrayAlignment(expected, current);
    if (direct) return { ...direct, path: path || "(root)" };
    if (!expected || !current || typeof expected !== "object" || typeof current !== "object" || Array.isArray(expected) || Array.isArray(current)) return null;
    for (const key of Object.keys(expected)) {
      if (!Object.prototype.hasOwnProperty.call(current, key)) continue;
      const nested = findArrayAlignment(expected[key], current[key], path ? `${path}.${key}` : key);
      if (nested) return nested;
    }
    return null;
  }

  function diagnosisForRow(row, rowDifferences, alignment) {
    const label = row?.label || row?.id || "未命名能力";
    if (alignment) {
      const value = typeof alignment.value === "object" ? stableSerialize(alignment.value) : String(alignment.value);
      const rawCount = rowDifferences.length;
      const shiftedCount = Math.max(0, rawCount - 1);
      if (alignment.direction === "extra") {
        return {
          id: row.id,
          kind: "array-shift",
          label,
          title: `${label}清單多出 1 項`,
          cause: `目前 Consumer 的 ${alignment.path} 比 C 母版多出「${value}」。`,
          impact: `這 1 個插入項讓後續 ${shiftedCount} 個位置產生連鎖位移；機器列出的 ${rawCount} 個差異，不代表 ${rawCount} 個獨立功能問題。`,
          recommendation: "先確認插入項是否屬於正式共用 Contract；若是，應從唯一 C 共用來源同步 canonical inventory，不要逐一修改 Consumer。",
          rawDifferenceCount: rawCount,
          technicalDifferences: rowDifferences
        };
      }
      return {
        id: row.id,
        kind: "array-shift",
        label,
        title: `${label}清單少 1 項`,
        cause: `目前 Consumer 的 ${alignment.path} 少了 C 母版項目「${value}」。`,
        impact: `後續 ${shiftedCount} 個位置可能因此被連鎖判定不同；目前的 ${rawCount} 個機器差異應先視為同一個清單對齊問題。`,
        recommendation: "確認缺少項目是否仍是正式共用 Contract；若是，應從唯一 C 共用來源補齊，不要在 Consumer 建立私有能力。",
        rawDifferenceCount: rawCount,
        technicalDifferences: rowDifferences
      };
    }
    const status = row?.status || "DIFFERENT";
    const paths = rowDifferences.map(item => item.path || item.id).filter(Boolean);
    if (status === "MISSING") {
      return {
        id: row.id,
        kind: "missing",
        label,
        title: `${label}缺少`,
        cause: `Consumer 沒有 C 母版要求的「${label}」能力。`,
        impact: paths.length ? `機器比對指出：${paths.join("、")}。` : "Consumer 可能無法使用這項 C 共用能力。",
        recommendation: "回到唯一 C Module 來源確認是否應由共用 Runtime 提供；不要在 Consumer 另做一份。",
        rawDifferenceCount: rowDifferences.length || 1,
        technicalDifferences: rowDifferences
      };
    }
    if (status === "EXTRA") {
      return {
        id: row.id,
        kind: "extra",
        label,
        title: `${label}為 Consumer 額外能力`,
        cause: `Consumer 出現 C 母版沒有宣告的「${label}」能力。`,
        impact: paths.length ? `機器比對指出：${paths.join("、")}；這可能造成 Consumer 與 C 逐步漂移。` : "這會讓 Consumer 不再只使用唯一 C Module。",
        recommendation: "確認是否應回到 C canonical contract；不要以 Consumer-specific 實作繞過 Parity。",
        rawDifferenceCount: rowDifferences.length || 1,
        technicalDifferences: rowDifferences
      };
    }
    return {
      id: row.id,
      kind: "different",
      label,
      title: `${label}的共用 Contract 不一致`,
      cause: `C 母版與 Consumer 都有「${label}」，但 Contract、Fingerprint 或操作行為不同。`,
      impact: paths.length ? `機器比對指出：${paths.join("、")}；這是實際模板差異，不是資料內容差異。` : "Consumer 的共用模板行為可能與 C 不一致。",
      recommendation: "回到唯一 C Module 來源修正或重新組合；不要只在 Consumer 做視覺或行為補丁。",
      rawDifferenceCount: rowDifferences.length || 1,
      technicalDifferences: rowDifferences
    };
  }

  function diagnose(report) {
    const item = report || {};
    const rawDifferences = Array.isArray(item.differenceDetails) && item.differenceDetails.length
      ? item.differenceDetails
      : Array.isArray(item.differences) ? item.differences : [];
    if (Number(item.gapCount || 0) === 0) {
      return {
        status: "match",
        headline: "C 與目前 Consumer 已一致",
        cause: "目前 Consumer 已使用與 C 母版一致的共用模板能力。",
        impact: "沒有需要處理的模板差異；資料、工作區、卡片內容與識別資料仍依各自來源管理。",
        recommendation: "不需修正；完整機器比對與技術明細可在下方展開查看。",
        rawDifferenceCount: 0,
        anomalies: []
      };
    }
    const anomalies = [];
    const rows = Array.isArray(item.inventory) ? item.inventory.filter(row => row.status !== "MATCH") : [];
    rows.forEach(row => {
      const rowDifferences = rawDifferences.filter(diff => diff.parentId === row.id || (!diff.parentId && diff.id === row.id));
      const alignment = findArrayAlignment(row.machineContract || row.motherContract, row.machineConsumerContract || row.consumerContract);
      anomalies.push(diagnosisForRow(row, rowDifferences, alignment));
    });
    if (!anomalies.length && rawDifferences.length) {
      anomalies.push(diagnosisForRow({ id: "report", label: "模板比對結果", status: "DIFFERENT" }, rawDifferences));
    }
    return {
      status: "gap",
      headline: "C 母版有需要處理的差異",
      cause: "以下先顯示依共用能力彙整後的真正問題；完整機器差異保留在技術明細。",
      impact: `${anomalies.length} 個差異群組，原始機器差異 ${rawDifferences.length} 項。`,
      recommendation: "依差異群組回到唯一 C Module／正式 Contract 處理，不要在 Consumer 建立副本。",
      rawDifferenceCount: rawDifferences.length,
      anomalies
    };
  }

  function formatReport(report) {
    const item = report || {};
    const lines = [
      `Engine：${item.engineVersion || ENGINE_VERSION}`,
      `Baseline：${item.baseline || "C Mother Template"}`,
      ...(item.compareBaseline ? [
        `Compare Baseline：${item.compareBaseline.mode || "consumer-to-c"}`,
        `Latest Published C：${formatSnapshotIdentity(item.compareBaseline.latestPublishedC)}`,
        `Consumer Current Adopted C：${formatSnapshotIdentity(item.compareBaseline.consumerCurrentAdoptedC)}`,
        `Semantic Layers：Interface ${item.compareBaseline.interfaceStatus || "unverified"}｜Behavior ${item.compareBaseline.behaviorStatus || "unverified"}`
      ] : []),
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
    if (item.sourceContract) {
      lines.push(`Source Contract：${item.sourceContract.id || "—"}｜${item.sourceContract.status || "UNKNOWN"}｜Integrity ${item.sourceContract.sourceIntegrity || "unverified"}｜Adoption ${item.sourceContract.adoptionStatus || "unverified"}`);
    }
    if (item.behaviorContract) {
      lines.push(`Behavior Contract：${item.behaviorContract.id || "—"}｜${item.behaviorContract.status || "UNKNOWN"}｜Consumer ${item.behaviorContract.consumer || "—"}`);
      (item.behaviorContract.differences || []).forEach(diff => lines.push(`- BEHAVIOR ${diff.check || diff.id || "unknown"}｜${diff.title || "操作與流程不同"}｜expected=${diff.expected || "—"}｜actual=${diff.actual || "—"}`));
      (item.behaviorContract.approvedDifferences || []).forEach(diff => lines.push(`- APPROVED CAPABILITY｜${diff.title || diff.id || "產品能力差異"}｜${diff.detail || ""}`));
    }
    return lines.join("\n");
  }

  return Object.freeze({
    ENGINE_VERSION,
    BEHAVIOR_CONTRACT_ID,
    BEHAVIOR_CONTRACT_SOURCE,
    REQUIRED_ACTIONS,
    SHARED_COMPONENT_APIS,
    expectedCapabilities,
    fingerprint,
    canonicalInventory,
    collectConsumerInventory,
    createInventory,
    canonicalBehaviorContract,
    normalizeSemanticSnapshot,
    behaviorObservation,
    compareBehaviorContractAgainst,
    compareBehaviorContract,
    sourceContract,
    compare,
    run,
    runManual,
    runAutoGuard,
    summary,
    diagnose,
    formatReport
  });
});
