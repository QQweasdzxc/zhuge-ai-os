/* Canonical Template Management Center presentation.
 *
 * This component owns only the management presentation. Template capability,
 * adoption state, authorization and persistence remain owned by the existing
 * Template Adoption Registry/Service and Shared Navigation runtime.
 */
(function (root, factory) {
  const api = factory(root);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeTemplateManagementCenter = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function (root) {
  "use strict";

  const TEMPLATE_ORDER_FALLBACK = ["navigation", "workspace", "board"];
  // These are presentation groupings only. Runtime identity, adoption and
  // authority values are always read from BoardReadService/Cloud below; this
  // list is not an authority registry and cannot grant or change capability.
  const RUNTIME_VIEW_DEFINITIONS = Object.freeze([
    Object.freeze({
      key: "c-mother",
      label: "C Mother",
      pageId: "template-c",
      legacyLabel: "Legacy Authority",
      matches: instance => instance?.isTemplateInstance === true
    }),
    Object.freeze({
      key: "ai-board",
      label: "AI Board",
      pageId: "ai-board",
      legacyLabel: "Legacy Authority",
      matches: instance => normalizeRuntimeScope(instance) === "ai-board"
    }),
    Object.freeze({
      key: "worktodo",
      label: "工作待辦",
      pageId: "tasks-new",
      legacyLabel: "Legacy Create Authority",
      matches: instance => normalizeRuntimeScope(instance) === "worktodo"
    }),
    Object.freeze({
      key: "gas",
      label: "庶務行政（GAS）",
      pageId: "procurement",
      legacyLabel: "Legacy Authority",
      matches: instance => String(instance?.taskCodePrefix || "").trim().toUpperCase() === "GAS"
    }),
    Object.freeze({
      key: "investment",
      label: "投資組合（Investment）",
      pageId: "investment",
      legacyLabel: "Legacy Authority",
      readOnlyExpected: true,
      matches: instance => String(instance?.taskCodePrefix || "").trim().toUpperCase() === "IVTK"
    })
  ]);
  let policyEventsBound = false;
  let refreshCallback = null;
  let releaseState = { status: "idle", release: null, error: "" };
  let releaseRequest = null;
  let runtimeObservabilityState = { status: "idle", entries: [], error: "" };
  let runtimeObservabilityRequest = null;

  function escapeHtml(value = "") {
    return String(value).replace(/[&<>'"]/g, ch => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;"
    }[ch]));
  }

  function normalizeRuntimeScope(instance = {}) {
    return String(instance.legacyApplicationScope || instance.legacy_application_scope || "")
      .trim()
      .toLowerCase()
      .replace(/_/g, "-");
  }

  function firstDefined(source, ...keys) {
    if (!source || typeof source !== "object") return undefined;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(source, key) && source[key] !== undefined && source[key] !== null) return source[key];
    }
    return undefined;
  }

  function textValue(value, fallback = "") {
    return value === undefined || value === null ? fallback : String(value);
  }

  function lowerValue(value) {
    return textValue(value).trim().toLowerCase().replace(/[\s_-]+/g, "_");
  }

  function isPassish(value) {
    if (value === true) return true;
    const normalized = lowerValue(value);
    return ["pass", "passed", "ok", "verified", "active", "adopted", "configured", "canonical", "shared", "single"].includes(normalized);
  }

  function isCanonicalEvidence(value) {
    if (isPassish(value)) return true;
    const normalized = lowerValue(value);
    return normalized.includes("module_c")
      || normalized.includes("module-c")
      || normalized.includes("c_shared")
      || normalized.includes("c-shared")
      || normalized.includes("canonical")
      || normalized.includes("shared_runtime")
      || normalized.includes("shared-runtime")
      || (normalized.includes("controlled_security_definer_rpc") && normalized.includes("private_core"));
  }

  function navigationEntryPath(profile, navigation = root?.ZhugeSharedNavigation) {
    // template-preview is the existing C Mother runtime entry; Navigation's
    // destination() remains the source for every named Consumer entry.
    if (profile?.key === "c-mother") return "/app/Board/template-preview/";
    if (profile?.pageId && typeof navigation?.destination === "function") {
      const path = navigation.destination(profile.pageId, "/");
      if (path && path !== "#") return String(path);
    }
    return "正式入口待讀取";
  }

  function runtimeViewFor(instance = {}) {
    return RUNTIME_VIEW_DEFINITIONS.find(definition => definition.matches(instance)) || Object.freeze({
      key: `other-${textValue(instance.id, "unknown")}`,
      label: "其他 C 看板",
      pageId: null,
      legacyLabel: "Legacy Authority",
      matches: () => false
    });
  }

  function authorityFor(authorities, instance) {
    if (!authorities || !instance) return null;
    if (authorities instanceof Map) return authorities.get(instance.id) || authorities.get(instance.consumerId) || null;
    return authorities[instance.id] || authorities[instance.consumerId] || null;
  }

  function releaseAdoptionFor(release, instance, profile, authority) {
    const consumers = release?.consumers && typeof release.consumers === "object" ? release.consumers : {};
    const source = authority?.source || {};
    const candidateKeys = [
      firstDefined(source, "module_adoption_key", "moduleAdoptionKey"),
      instance?.id,
      instance?.consumerId,
      profile?.key === "c-mother" ? "c" : "",
      profile?.key === "ai-board" ? "ai-board" : "",
      profile?.key === "worktodo" ? "worktodo" : ""
    ].map(value => textValue(value).trim()).filter(Boolean);
    const exactKey = candidateKeys.find(key => consumers[key]);
    if (exactKey) return { key: exactKey, adoption: consumers[exactKey] };

    const normalized = candidateKeys.map(key => key.toLowerCase().replace(/_/g, "-"));
    const matchingKey = Object.keys(consumers).find(key => normalized.includes(String(key).toLowerCase().replace(/_/g, "-")));
    return matchingKey ? { key: matchingKey, adoption: consumers[matchingKey] } : { key: "", adoption: null };
  }

  function adoptionModel(release, instance, profile, authority) {
    const resolved = releaseAdoptionFor(release, instance, profile, authority);
    const adoption = resolved.adoption || {};
    const version = textValue(adoption.moduleVersion || adoption.module_version || adoption.templateVersion || adoption.template_version);
    const build = textValue(adoption.build);
    const publishedVersion = textValue(release?.publishedVersion);
    const publishedBuild = textValue(release?.publishedBuild);
    const status = lowerValue(adoption.status);
    const identityMatches = status === "adopted"
      && Boolean(version && build && publishedVersion && publishedBuild)
      && version === publishedVersion
      && build === publishedBuild;
    let label = "Unknown / Not Available";
    if (identityMatches) label = `已採用 · ${version} / ${build}`;
    else if (adoption.status || version || build) label = `${textValue(adoption.status, "待核對")} · ${version || "—"} / ${build || "—"}`;
    return Object.freeze({
      key: resolved.key,
      status: textValue(adoption.status),
      version,
      build,
      identityMatches,
      label
    });
  }

  function normalizeAuthorityEvidence(authority) {
    const value = authority && typeof authority === "object" ? authority : null;
    const status = lowerValue(value?.status);
    const source = value?.source && typeof value.source === "object" ? value.source : {};
    const authoritySection = value?.authority && typeof value.authority === "object" ? value.authority : {};
    const workflow = value?.workflow && typeof value.workflow === "object" ? value.workflow : {};
    const completion = value?.completion_designation || value?.completionDesignation || {};
    const archive = value?.archive_designation || value?.archiveDesignation || {};
    const policy = value?.policy && typeof value.policy === "object" ? value.policy : {};
    const legacy = value?.legacy_routes || value?.legacyRoutes || {};
    const runtimeRoute = value?.runtime_route || value?.runtimeRoute || {};
    return Object.freeze({
      value,
      status,
      source,
      authoritySection,
      workflow,
      completion,
      archive,
      policy,
      legacy,
      runtimeRoute,
      error: textValue(value?.error || value?.error_message || value?.errorMessage)
    });
  }

  function authorityModel(authority, profile, adoption) {
    const evidence = normalizeAuthorityEvidence(authority);
    const source = evidence.source;
    const feature = evidence.value?.feature && typeof evidence.value.feature === "object" ? evidence.value.feature : {};
    const sourceAdoptedField = firstDefined(source, "module_release_adopted", "moduleReleaseAdopted");
    const sourceAdopted = sourceAdoptedField === undefined ? null : sourceAdoptedField === true;
    const runtime = feature.shared_runtime === "module-c-golden-master-runtime" ? "C Shared Runtime" : "Unknown / Not Available";
    const dataScope = source.consumer_data_scope || source.consumerDataScope;
    const data = profile.key === "worktodo"
      ? "Existing WorkTodo Same Data · Board Instance-owned"
      : dataScope === "board-instance-owned"
        ? "Board Instance-owned Data"
        : textValue(dataScope, "Unknown / Not Available");

    const cardWriter = firstDefined(evidence.authoritySection, "card_writer", "cardWriter", "card");
    const cloudWriter = firstDefined(evidence.authoritySection, "cloud_writer", "cloudWriter", "writer");
    const writer = profile.readOnlyExpected
      ? "C Shared Contract · Read-only"
      : evidence.status === "pass" && isCanonicalEvidence(cardWriter) && isCanonicalEvidence(cloudWriter)
        ? "C Canonical Writer · Single Writer"
        : "Unknown / Not Available";

    const workflowStatus = lowerValue(firstDefined(evidence.workflow, "status", "workflow_status", "workflowStatus"));
    const workflow = workflowStatus === "not_configured" || workflowStatus === "not_applicable"
      ? "NOT_CONFIGURED / N/A"
      : workflowStatus === "published" || workflowStatus === "pass"
        ? "Configured / Published"
        : workflowStatus === "fail" || workflowStatus === "invalid"
          ? "Contract FAIL"
          : "Unknown / Not Available";

    const completionStatus = lowerValue(firstDefined(evidence.completion, "status", "completion_designation_status", "completionDesignationStatus"));
    const archiveStatus = lowerValue(firstDefined(evidence.archive, "status", "archive_designation_status", "archiveDesignationStatus"));
    const policyIdentity = textValue(firstDefined(evidence.policy, "policy_identity", "policyIdentity", "identity"));
    const policyVersion = Number(firstDefined(evidence.policy, "policy_version", "policyVersion") || 0);
    const policyDelay = Number(firstDefined(evidence.policy, "current_delay_seconds", "currentDelaySeconds", "archive_delay_seconds", "archiveDelaySeconds") || 0);
    const completionReady = completionStatus === "configured" || isCanonicalEvidence(firstDefined(evidence.authoritySection, "completion", "completion_lifecycle"));
    const archiveReady = archiveStatus === "configured" || isCanonicalEvidence(firstDefined(evidence.authoritySection, "archive", "archive_lifecycle"));
    const lifecycle = profile.readOnlyExpected
      ? "N/A（Read-only）"
      : evidence.status === "fail"
        ? "Contract FAIL"
        : completionStatus === "not_configured" && (archiveStatus === "not_applicable" || !archiveStatus)
          ? "N/A"
          : completionReady && archiveReady && policyIdentity === "module-c-completion-archive-policy" && policyDelay === 86400
            ? "C Shared / 24h"
            : "Unknown / Not Available";

    const legacyCurrent = firstDefined(evidence.legacy, "current_route", "currentRoute", "current_route_reachable", "currentRouteReachable");
    const legacy = profile.readOnlyExpected
      ? "N/A"
      : legacyCurrent === false
        ? "Retired"
        : legacyCurrent === true
          ? "Active"
          : "Unknown / Not Available";

    const runtimeEvidence = runtime === "C Shared Runtime";
    const releaseEvidence = sourceAdopted === null ? adoption.identityMatches : sourceAdopted === true && adoption.identityMatches;
    const health = evidence.status === "fail"
      ? "Contract FAIL"
      : evidence.status === "unverified" || !evidence.value
        ? "Unknown / Not Available"
        : evidence.status === "pass" && runtimeEvidence && releaseEvidence === true
          ? "Current / Healthy"
          : "Unknown / Not Available";

    return Object.freeze({
      status: evidence.status,
      contract: textValue(evidence.value?.contract || evidence.value?.contract_id || evidence.value?.contractId),
      runtime,
      data,
      writer,
      workflow,
      lifecycle,
      legacy,
      health,
      policyIdentity,
      policyVersion,
      policyDelay,
      sourceAdopted,
      error: evidence.error
    });
  }

  function buildRuntimeIdentityModel({ instances = [], authorities = {}, release = null, navigation = root?.ZhugeSharedNavigation } = {}) {
    const activeInstances = (Array.isArray(instances) ? instances : []).filter(instance => instance?.active !== false && instance?.id);
    const consumedInstances = new Set();
    const entries = [];
    const append = (profile, instance = null) => {
      if (instance?.id) consumedInstances.add(instance.id);
      const rawAuthority = authorityFor(authorities, instance);
      const authority = rawAuthority?.value || rawAuthority;
      const authorityError = rawAuthority?.error ? textValue(rawAuthority.error?.message || rawAuthority.error) : "";
      const adoption = adoptionModel(release, instance || {}, profile, authority);
      const authorityState = authorityModel(
        authorityError ? { status: "unverified", error: authorityError } : authority,
        profile,
        adoption
      );
      const instanceId = textValue(instance?.id);
      return Object.freeze({
        key: profile.key,
        label: profile.label,
        module: "C｜看板區",
        boardInstanceId: instanceId,
        instanceName: textValue(instance?.name),
        runtimeEntry: navigationEntryPath(profile, navigation),
        runtime: authorityState.runtime,
        data: authorityState.data,
        writer: authorityState.writer,
        workflow: authorityState.workflow,
        lifecycle: authorityState.lifecycle,
        legacy: authorityState.legacy,
        legacyLabel: profile.legacyLabel,
        adoption: adoption.label,
        adoptionKey: adoption.key,
        health: authorityState.health,
        authorityStatus: authorityState.status || "unknown",
        authorityContract: authorityState.contract,
        policyIdentity: authorityState.policyIdentity,
        policyVersion: authorityState.policyVersion,
        policyDelay: authorityState.policyDelay,
        authorityError: authorityState.error,
        readOnlyExpected: profile.readOnlyExpected === true,
        evidenceAvailable: Boolean(authority)
      });
    };

    RUNTIME_VIEW_DEFINITIONS.forEach(profile => {
      const matches = activeInstances.filter(instance => profile.matches(instance));
      if (matches.length) matches.forEach(instance => entries.push(append(profile, instance)));
      else entries.push(append(profile));
    });
    activeInstances.filter(instance => !consumedInstances.has(instance.id)).forEach(instance => entries.push(append(runtimeViewFor(instance), instance)));
    return entries;
  }

  function policyApi() {
    return root?.ZhugeTemplateAdoptionPolicy || null;
  }

  function runtimeSnapshot() {
    const runtime = root?.ZhugeTemplateAdoptionRuntime || null;
    const policy = runtime?.policy || null;
    const service = runtime?.service || null;
    const registry = policyApi();
    const templates = registry?.TEMPLATES || {};
    const pages = registry?.PAGE_REGISTRY || {};
    return {
      runtime,
      policy,
      service,
      templates,
      pages,
      userId: String(policy?.userId || ""),
      status: String(policy?.status || "loading"),
      isCreator: policy?.is_creator === true
    };
  }

  function templateOrder(templates = {}) {
    const registryOrder = policyApi()?.TEMPLATE_IDS;
    const ids = Array.isArray(registryOrder) && registryOrder.length ? registryOrder : TEMPLATE_ORDER_FALLBACK;
    return ids.map(id => templates[id]).filter(Boolean);
  }

  function isReady(snapshot) {
    return snapshot.status === "resolved" && Boolean(snapshot.service);
  }

  function enabledFor(snapshot, pageId, templateId) {
    if (!isReady(snapshot)) return false;
    return snapshot.service.isTemplateEnabled?.({
      pageId,
      templateId,
      userId: snapshot.userId
    }) === true;
  }

  function buildTemplateModel(snapshot = runtimeSnapshot()) {
    const ready = isReady(snapshot);
    return templateOrder(snapshot.templates).map(template => {
      const consumers = Object.values(snapshot.pages).filter(page => page?.isMother !== true && Array.isArray(page?.supportedTemplates) && page.supportedTemplates.includes(template.id));
      const rows = consumers.map(page => ({
        page,
        enabled: enabledFor(snapshot, page.id, template.id)
      }));
      return {
        template,
        consumers,
        rows,
        enabledCount: ready ? rows.filter(row => row.enabled).length : null
      };
    });
  }

  function statusMessage(snapshot) {
    if (snapshot.status === "loading") return "正在讀取 Supabase Cloud Adoption State…";
    if (snapshot.status === "error") return "設定讀取失敗；所有模板維持 OFF 安全預設。";
    if (!snapshot.isCreator) return "此區域僅 Creator 可修改；目前為唯讀狀態。";
    return "Capability 由 Registry 決定；Adoption 由 Supabase Cloud 決定。";
  }

  function adoptionLabel(snapshot, enabled) {
    if (!isReady(snapshot)) return "🟡 待讀取 Cloud 狀態";
    return enabled ? "🟢 已套用 (ON)" : "⚪ 未套用 (OFF)";
  }

  function publishedMotherRelease() {
    return root?.ZhugeMotherTemplateRelease?.getSnapshot?.() || null;
  }

  function moduleReleaseService() {
    return root?.ZhugeModulePublishService || null;
  }

  function developmentIdentity(service = moduleReleaseService()) {
    const staticRelease = publishedMotherRelease();
    const product = root?.ZhugeFoundationConfig?.version || {};
    const current = service?.getDevelopmentIdentity?.("c") || {};
    return {
      version: String(current.version || staticRelease?.developmentVersion || product.version || ""),
      build: String(current.build || staticRelease?.developmentBuild || product.build || ""),
      sourceCommit: String(current.sourceCommit || staticRelease?.developmentSourceCommit || staticRelease?.sourceCommit || product.commit || ""),
      sourceFingerprint: String(current.sourceFingerprint || staticRelease?.developmentSourceFingerprint || staticRelease?.sourceFingerprint || product.sourceFingerprint || ""),
    };
  }

  function refreshPublishedRelease({ force = false } = {}) {
    const service = moduleReleaseService();
    if (!service || typeof service.read !== "function") {
      releaseState = { status: "unavailable", release: null, error: "C 母版 Cloud Publish State 服務尚未載入。" };
      return Promise.resolve(null);
    }
    if (releaseRequest) return releaseRequest;
    if (!force && releaseState.status === "resolved") return Promise.resolve(releaseState.release);
    releaseState = { status: "loading", release: releaseState.release, error: "" };
    const request = Promise.resolve()
      .then(() => service.read("c", { force }))
      .then(release => {
        releaseState = { status: "resolved", release, error: "" };
        refreshCallback?.();
        return release;
      })
      .catch(error => {
        releaseState = { status: "error", release: null, error: error?.message || "C 母版 Cloud Publish State 讀取失敗。" };
        refreshCallback?.();
        return null;
      })
      .finally(() => {
        releaseRequest = null;
      });
    releaseRequest = request;
    return request;
  }

  function refreshRuntimeObservability({ force = false } = {}) {
    if (runtimeObservabilityRequest) return runtimeObservabilityRequest;
    if (!force && runtimeObservabilityState.status === "resolved") return Promise.resolve(runtimeObservabilityState.entries);

    const boardRead = root?.ZhugeBoardReadService;
    const gatewayApi = root?.ZhugeSupabaseGateway;
    if (!boardRead || typeof boardRead.listModuleConsumers !== "function" || typeof boardRead.createInstanceService !== "function" || typeof gatewayApi?.createDataGateway !== "function") {
      runtimeObservabilityState = { status: "unavailable", entries: [], error: "Runtime Identity / Authority 服務尚未載入；目前無法判定。" };
      refreshCallback?.();
      return Promise.resolve([]);
    }

    runtimeObservabilityState = { status: "loading", entries: runtimeObservabilityState.entries, error: "" };
    let gateway;
    try {
      gateway = gatewayApi.createDataGateway();
    } catch (error) {
      runtimeObservabilityState = { status: "error", entries: [], error: error?.message || "Shared Supabase Gateway 讀取失敗。" };
      refreshCallback?.();
      return Promise.resolve([]);
    }

    const releasePromise = releaseState.status === "resolved"
      ? Promise.resolve(releaseState.release)
      : refreshPublishedRelease();
    const request = Promise.all([
      boardRead.listModuleConsumers({ templateKey: "c", gateway }),
      releasePromise
    ])
      .then(async ([instances, release]) => {
        const activeInstances = (Array.isArray(instances) ? instances : []).filter(instance => instance?.id && instance.active !== false);
        const authorityPairs = await Promise.all(activeInstances.map(async instance => {
          try {
            const service = boardRead.createInstanceService({
              gateway,
              boardInstanceId: instance.id,
              consumerId: instance.consumerId || instance.id,
              templateKey: "c",
              readOnly: true
            });
            const value = await service.getAuthorityConformance();
            return [instance.id, { value }];
          } catch (error) {
            return [instance.id, { error }];
          }
        }));
        const authorities = new Map(authorityPairs);
        runtimeObservabilityState = {
          status: "resolved",
          entries: buildRuntimeIdentityModel({ instances: activeInstances, authorities, release }),
          error: ""
        };
        refreshCallback?.();
        return runtimeObservabilityState.entries;
      })
      .catch(error => {
        runtimeObservabilityState = { status: "error", entries: [], error: error?.message || "Runtime Identity / Authority 讀取失敗。" };
        refreshCallback?.();
        return [];
      })
      .finally(() => {
        runtimeObservabilityRequest = null;
      });
    runtimeObservabilityRequest = request;
    return request;
  }

  function runtimeObservabilityMarkup() {
    if (runtimeObservabilityState.status === "idle" || runtimeObservabilityState.status === "loading") {
      return `<section class="template-runtime-observability" data-template-runtime-observability data-template-runtime-status="loading" aria-labelledby="template-runtime-observability-title"><div class="template-runtime-observability-heading"><div><span class="template-management-kicker">Runtime Identity／Authority</span><h4 id="template-runtime-observability-title">C Consumer Runtime 身份與權限</h4><p>讀取實際 Board Instance、Cloud Authority 與 Runtime Entry；不以 Adoption 代替健康判定。</p></div><span class="template-runtime-observability-state">🟡 正在讀取 Cloud Evidence</span></div></section>`;
    }
    if (runtimeObservabilityState.status === "error" || runtimeObservabilityState.status === "unavailable") {
      return `<section class="template-runtime-observability" data-template-runtime-observability data-template-runtime-status="unavailable" aria-labelledby="template-runtime-observability-title"><div class="template-runtime-observability-heading"><div><span class="template-management-kicker">Runtime Identity／Authority</span><h4 id="template-runtime-observability-title">C Consumer Runtime 身份與權限</h4><p>目前沒有足夠的正式 Cloud Evidence；不會猜測 Runtime 或 Writer。</p></div><span class="template-runtime-observability-state is-unknown">Unknown / Not Available</span></div><p class="template-runtime-observability-error">${escapeHtml(runtimeObservabilityState.error || "無法取得正式 Runtime Evidence。")}</p></section>`;
    }
    const entries = runtimeObservabilityState.entries || [];
    return `<section class="template-runtime-observability" data-template-runtime-observability data-template-runtime-status="resolved" aria-labelledby="template-runtime-observability-title"><div class="template-runtime-observability-heading"><div><span class="template-management-kicker">Runtime Identity／Authority</span><h4 id="template-runtime-observability-title">C Consumer Runtime 身份與權限</h4><p>只讀取現有 Board Instance、Module Release 與 C Authority Conformance Evidence。</p></div><span class="template-runtime-observability-state">${escapeHtml(entries.length)} 個 C Runtime</span></div><div class="template-runtime-observability-grid">${entries.map(renderRuntimeIdentityEntry).join("")}</div></section>`;
  }

  function renderRuntimeIdentityEntry(entry) {
    const statusClass = entry.health === "Current / Healthy" ? "is-healthy" : entry.health === "Contract FAIL" ? "is-fail" : "is-unknown";
    const value = (label, content, className = "") => `<div class="template-runtime-observability-field ${className}"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(content || "Unknown / Not Available")}</dd></div>`;
    const technical = [
      value("Authority Contract", entry.authorityContract || "Unknown / Not Available"),
      value("Policy", entry.policyIdentity ? `${entry.policyIdentity} · v${entry.policyVersion || "—"} · ${entry.policyDelay || "—"} sec` : "Unknown / Not Available"),
      value("Cloud Adoption Key", entry.adoptionKey || "Unknown / Not Available"),
      value("Authority Evidence", entry.authorityError ? `讀取失敗：${entry.authorityError}` : `${entry.authorityStatus || "unknown"} · ${entry.evidenceAvailable ? "已取得" : "未取得"}`)
    ].join("");
    const legacyValue = entry.key === "worktodo" && entry.legacy === "Retired"
      ? "Legacy Create Authority：Retired"
      : entry.legacy;
    return `<details class="template-runtime-observability-card" data-template-runtime-entry="${escapeHtml(entry.key)}"><summary><span class="template-runtime-observability-name"><strong>${escapeHtml(entry.label)}</strong><small>${escapeHtml(entry.module)}</small></span><span class="template-runtime-observability-summary"><strong>${escapeHtml(entry.runtime)}</strong><small class="${statusClass}">${escapeHtml(entry.health)}</small></span><span class="template-runtime-observability-chevron" aria-hidden="true">⌄</span></summary><div class="template-runtime-observability-body"><dl class="template-runtime-observability-fields">${value("Runtime", entry.runtime)}${value("Board Instance", entry.boardInstanceId || "Unknown / Not Available")} ${value("Runtime Entry", entry.runtimeEntry)}${value("Data", entry.data)}${value("Writer Authority", entry.writer)}${value("Workflow", entry.workflow)}${value("Lifecycle", entry.lifecycle)}${value("Legacy Authority", legacyValue)}${value("Adoption", entry.adoption)}${value("Health", entry.health, `template-runtime-observability-health ${statusClass}`)}</dl><details class="template-runtime-observability-technical"><summary>Contract 詳細</summary><dl class="template-runtime-observability-fields">${technical}</dl></details></div></details>`;
  }

  function releaseStatusMarkup() {
    const service = moduleReleaseService();
    if (releaseState.status === "loading" || releaseState.status === "idle") {
      return `<div class="template-management-release" data-template-release-summary data-template-release-pending="unknown" role="status"><strong>🟡 正在讀取 C 母版發布狀態</strong><span>正在從 Supabase Cloud 取得最新 Publish State…</span></div>`;
    }
    if (releaseState.status === "error" || releaseState.status === "unavailable") {
      return `<div class="template-management-release" data-template-release-summary data-template-release-pending="unknown" role="status"><strong>🔴 C 母版發布狀態讀取失敗</strong><span>${escapeHtml(releaseState.error || "無法取得正式 Cloud Publish State。")}</span></div>`;
    }
    const release = releaseState.release;
    const development = developmentIdentity(service);
    const pendingValue = typeof service?.hasPendingDevelopment === "function"
      ? service.hasPendingDevelopment(release, development)
      : true;
    const pending = pendingValue === true;
    const pendingLabel = pending ? "🟠 有待發布變更" : "🟢 C 母版已同步";
    const developmentVersion = development.version || release?.developmentVersion || "—";
    const developmentBuild = development.build || release?.developmentBuild || "—";
    const publishedVersion = release?.publishedVersion || "尚未發布";
    const publishedBuild = release?.publishedBuild || "—";
    const snapshot = runtimeSnapshot();
    const consumers = [
      ["worktodo", "tasks-new", "工作待辦"],
      ["ai-board", "ai-board", "AI Board"],
      ["procurement", "procurement", "庶務行政"],
      ["investment-ivtk", "investment", "投資組合"]
    ].map(([releaseId, pageId, label]) => {
      const adoption = release?.consumers?.[releaseId];
      const cloudEnabled = enabledFor(snapshot, pageId, "board");
      const version = adoption?.templateVersion || (cloudEnabled ? publishedVersion : "—");
      const build = adoption?.build || (cloudEnabled ? publishedBuild : "—");
      const releaseMatches = adoption?.status === "adopted" && version === publishedVersion && build === publishedBuild;
      const state = releaseMatches || cloudEnabled ? "🟢 已採用" : "🟡 待核對";
      return `<span class="template-management-release-consumer"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(state)} · ${escapeHtml(version)} / ${escapeHtml(build)}</span></span>`;
    }).join("");
    return `<div class="template-management-release" data-template-release-summary data-template-release-pending="${pending}" role="status"><div><strong>${pendingLabel}</strong><span>開發版：${escapeHtml(developmentVersion)} / ${escapeHtml(developmentBuild)} · 已發布版：${escapeHtml(publishedVersion)} / ${escapeHtml(publishedBuild)}</span></div><div class="template-management-release-consumers">${consumers}</div></div>`;
  }

  function renderConsumerRows(model, snapshot) {
    if (!model.rows.length) return `<div class="template-management-empty">目前沒有此 Template 的 Consumer。</div>`;
    const canModify = isReady(snapshot) && snapshot.isCreator;
    return `<div class="template-management-table" role="table" aria-label="${escapeHtml(model.template.label)} Consumer 清單"><div class="template-management-table-head" role="row"><span role="columnheader">頁面 (Consumer)</span><span role="columnheader">採用狀態</span><span role="columnheader">Cloud State</span><span role="columnheader">操作</span></div>${model.rows.map(({ page, enabled }) => { const required = page.requiredTemplates?.includes(model.template.id); const switchDisabled = required || !canModify; const adoptionText = enabled ? `🟢 已採用 ${model.template.code}` : `⚪ 未採用 ${model.template.code}`; return `<div class="template-management-row" role="row" data-template-management-row="${escapeHtml(page.id)}-${escapeHtml(model.template.id)}"><span class="template-management-consumer" role="cell">${escapeHtml(page.label)}</span><span class="template-management-capability" role="cell">${escapeHtml(adoptionText)}</span><span role="cell"><span class="template-management-adoption ${enabled ? "is-on" : "is-off"}" data-template-management-adoption>${adoptionLabel(snapshot, enabled)}</span></span><span role="cell"><label class="template-management-switch"><span class="sr-only">${escapeHtml(page.label)} 套用 ${escapeHtml(model.template.code)}｜${escapeHtml(model.template.label)}</span><input type="checkbox" data-template-management-switch data-page-id="${escapeHtml(page.id)}" data-template-id="${escapeHtml(model.template.id)}" ${enabled ? "checked" : ""} ${switchDisabled ? "disabled" : ""}><span class="template-management-switch-track" aria-hidden="true"></span></label></span></div>`; }).join("")}</div>`;
  }

  function render(options = {}) {
    if (releaseState.status === "idle") refreshPublishedRelease();
    if (runtimeObservabilityState.status === "idle") refreshRuntimeObservability();
    const snapshot = runtimeSnapshot();
    const models = buildTemplateModel(snapshot);
    const cards = models.map(model => {
      const template = model.template;
      const count = model.enabledCount == null ? "—" : `${model.enabledCount} 頁`;
      const supportCount = model.consumers.length;
      const panelId = `template-management-panel-${template.id}`;
      return `<section class="template-management-card" data-template-management-template="${escapeHtml(template.id)}"><button class="template-management-card-header" type="button" data-template-management-toggle aria-expanded="false" aria-controls="${escapeHtml(panelId)}"><span class="template-management-code" aria-hidden="true">${escapeHtml(template.code)}</span><span class="template-management-card-title"><strong>${escapeHtml(template.code)} 區｜${escapeHtml(template.label)}</strong><small>${escapeHtml(template.description)}</small></span><span class="template-management-card-summary"><strong>已套用 ${escapeHtml(count)}</strong><small>Consumer ${supportCount} 頁</small></span><span class="template-management-card-chevron" aria-hidden="true">⌄</span></button><div class="template-management-card-body" id="${escapeHtml(panelId)}" data-template-management-panel hidden><div class="template-management-card-actions"><button class="btn2" type="button" data-template-management-preview data-template-id="${escapeHtml(template.id)}">查看模板</button></div>${renderConsumerRows(model, snapshot)}</div></section>`;
    }).join("");
    return `<section class="control-center-entry-group template-management-center" data-template-management-center><div class="template-management-heading"><div><span class="template-management-kicker">Creator Control／Template Adoption</span><h3>🧩 系統模板管理中心</h3><p class="muted">集中管理 A／B／C Template、正式 Consumer Capability 與 Cloud Adoption State。</p></div><span class="template-management-source">來源：Supabase Cloud Settings</span></div><div class="template-management-status" data-template-management-status role="status">${escapeHtml(statusMessage(snapshot))}</div>${releaseStatusMarkup()}${runtimeObservabilityMarkup()}<div class="template-management-cards">${cards || `<div class="template-management-empty">Template Registry 尚未載入。</div>`}</div></section>`;
  }

  async function reloadPolicy() {
    const runtime = root?.ZhugeTemplateAdoptionRuntime;
    if (!runtime?.service) throw new Error("Template Adoption Runtime 尚未準備完成。");
    if (root?.ZhugeSharedNavigation?.bootstrapTemplatePolicy) {
      return root.ZhugeSharedNavigation.bootstrapTemplatePolicy({ force: true });
    }
    return runtime.service.load({ userId: runtime.policy?.userId || "", isCreator: runtime.policy?.is_creator === true, force: true });
  }

  function ensurePolicyEvents(onUpdated) {
    refreshCallback = typeof onUpdated === "function" ? onUpdated : refreshCallback;
    if (policyEventsBound || !root?.document?.addEventListener) return;
    policyEventsBound = true;
    ["zhuge-template-adoption-ready", "zhuge-template-management-updated"].forEach(eventName => {
      root.document.addEventListener(eventName, () => refreshCallback?.());
    });
    ["zhuge-module-release-updated", "zhuge-module-adoption-updated"].forEach(eventName => {
      root.document.addEventListener(eventName, event => {
        const detail = event?.detail || {};
        if (detail.moduleId && String(detail.moduleId).toLowerCase() !== "c") return;
        runtimeObservabilityState = { status: "idle", entries: [], error: "" };
        if (detail.release) {
          releaseState = { status: "resolved", release: detail.release, error: "" };
          refreshCallback?.();
          refreshRuntimeObservability({ force: true });
          return;
        }
        refreshPublishedRelease({ force: true }).finally(() => refreshRuntimeObservability({ force: true }));
      });
    });
  }

  function bind(container, options = {}) {
    if (!container) return;
    ensurePolicyEvents(options.onUpdated);
    container.querySelectorAll("[data-template-management-toggle]").forEach(button => {
      button.addEventListener("click", () => {
        const panel = root.document?.getElementById(button.getAttribute("aria-controls"));
        if (!panel) return;
        const expanded = button.getAttribute("aria-expanded") === "true";
        button.setAttribute("aria-expanded", expanded ? "false" : "true");
        panel.hidden = expanded;
        button.querySelector(".template-management-card-chevron")?.replaceChildren(root.document.createTextNode(expanded ? "⌄" : "⌃"));
      });
    });
    container.querySelectorAll("[data-template-management-preview]").forEach(button => {
      button.addEventListener("click", event => {
        event.stopPropagation();
        options.onPreview?.(button.dataset.templateId || "");
      });
    });
    container.querySelectorAll("[data-template-management-switch]").forEach(input => {
      input.addEventListener("change", async event => {
        const control = event.currentTarget;
        const pageId = control.dataset.pageId;
        const templateId = control.dataset.templateId;
        const enabled = control.checked;
        const status = container.querySelector("[data-template-management-status]");
        control.disabled = true;
        try {
          const runtime = root?.ZhugeTemplateAdoptionRuntime;
          if (!runtime?.service || runtime.policy?.is_creator !== true) throw new Error("只有 Creator 可以變更系統模板套用設定。");
          await runtime.service.setEnabled({ pageId, templateId, userId: runtime.policy.userId, isCreator: true, enabled });
          const usesSharedPolicyBootstrap = Boolean(root?.ZhugeSharedNavigation?.bootstrapTemplatePolicy);
          await reloadPolicy();
          root?.ZhugeSharedNavigation?.autoMount?.();
          if (!usesSharedPolicyBootstrap) options.onUpdated?.();
        } catch (error) {
          control.checked = !enabled;
          control.disabled = false;
          if (status) status.textContent = error?.message || "模板套用設定寫入失敗，已維持原本狀態。";
        }
      });
    });
  }

  return Object.freeze({ render, bind, buildTemplateModel, buildRuntimeIdentityModel });
});
