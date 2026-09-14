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
  const CONSUMER_ID_ALIASES = Object.freeze({
    c: "c",
    "c-mother": "c",
    "template-c": "c",
    ai: "ai-board",
    aiboard: "ai-board",
    "ai-board": "ai-board",
    worktodo: "worktodo",
    "tasks-new": "worktodo",
    gas: "gas",
    "gas-instance": "gas",
    procurement: "gas",
    investment: "investment",
    ivtk: "investment",
    "investment-ivtk": "investment"
  });
  const SITE_MAP_MODULES = Object.freeze([
    Object.freeze({ key: "module-a", label: "Module A", detail: "Navigation / Shell", status: "unknown" }),
    Object.freeze({ key: "module-b", label: "Module B", detail: "Workspace / Composition", status: "unknown" }),
    Object.freeze({ key: "worklog", label: "WorkLog", detail: "Domain Runtime", status: "na" }),
    Object.freeze({ key: "investment-domain", label: "Investment Domain", detail: "Position / IVTK Domain", status: "na" }),
    Object.freeze({ key: "management-center", label: "Management Center", detail: "Observability / Navigation Surface", status: "na" })
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

  function normalizedIdentity(value) {
    const normalized = textValue(value).trim().toLowerCase().replace(/[\s_]+/g, "-");
    return CONSUMER_ID_ALIASES[normalized] || normalized;
  }

  function canonicalHealthStatus(value) {
    const normalized = lowerValue(value);
    if (["healthy", "pass", "passed", "ok", "current"].includes(normalized)) return "healthy";
    if (["partial", "degraded", "warning"].includes(normalized)) return "partial";
    if (["unhealthy", "fail", "failed", "error", "invalid"].includes(normalized)) return "unhealthy";
    if (["na", "n_a", "not_applicable", "not_configured"].includes(normalized)) return "na";
    return "unknown";
  }

  function healthLabel(status) {
    return {
      healthy: "HEALTHY",
      partial: "PARTIAL",
      unhealthy: "UNHEALTHY",
      na: "N/A",
      unknown: "UNKNOWN"
    }[canonicalHealthStatus(status)];
  }

  function healthClass(status) {
    return {
      healthy: "is-healthy",
      partial: "is-partial",
      unhealthy: "is-fail",
      na: "is-na",
      unknown: "is-unknown"
    }[canonicalHealthStatus(status)];
  }

  function objectValue(value) {
    return value && typeof value === "object" ? value : {};
  }

  function evidenceText(value, fallback = "Unknown / Not Available") {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
    try {
      return JSON.stringify(value);
    } catch (_) {
      return fallback;
    }
  }

  function evidenceItems(value) {
    const itemText = item => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        return textValue(firstDefined(item, "message", "reason", "detail", "rule", "name"), evidenceText(item));
      }
      return textValue(item);
    };
    if (!Array.isArray(value)) return value == null ? [] : [itemText(value)].filter(Boolean);
    return value.map(itemText).filter(Boolean);
  }

  function canonicalOverall(authority) {
    const value = authority && typeof authority === "object" ? authority : {};
    const overall = objectValue(value.overall);
    const rawStatus = firstDefined(overall, "status", "state")
      ?? firstDefined(value, "v2_status", "v2Status", "status");
    const rawReasons = firstDefined(overall, "reasons", "reason")
      ?? firstDefined(value, "reasons", "reason");
    const evidence = firstDefined(overall, "evidence", "details")
      ?? firstDefined(value, "evidence", "details");
    const rawGapCount = firstDefined(overall, "gap_count", "gapCount")
      ?? firstDefined(value, "gap_count", "gapCount");
    const gapCount = rawGapCount === undefined || rawGapCount === null || rawGapCount === ""
      ? null
      : Number(rawGapCount);
    return Object.freeze({
      rawStatus: textValue(rawStatus),
      status: canonicalHealthStatus(rawStatus),
      label: healthLabel(rawStatus),
      gapCount: Number.isFinite(gapCount) ? gapCount : null,
      reasons: evidenceItems(rawReasons),
      evidence: evidenceText(evidence)
    });
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
      profile?.key === "worktodo" ? "worktodo" : "",
      profile?.key === "gas" ? "gas" : "",
      profile?.key === "investment" ? "investment" : ""
    ].map(value => textValue(value).trim()).filter(Boolean);
    const exactKey = candidateKeys.find(key => Object.prototype.hasOwnProperty.call(consumers, key));
    if (exactKey) return { key: exactKey, adoption: consumers[exactKey] };

    const normalized = candidateKeys.map(normalizedIdentity);
    const matchingKey = Object.keys(consumers).find(key => normalized.includes(normalizedIdentity(key)));
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

  function capabilityStatus(section) {
    const status = lowerValue(firstDefined(objectValue(section), "status", "state", "result"));
    if (status === "not_configured") return "NOT_CONFIGURED / N/A";
    if (status === "not_applicable" || status === "na" || status === "n_a") return "N/A";
    if (["published", "configured", "pass", "passed", "active"].includes(status)) return status === "published" ? "Published" : "PASS";
    if (["fail", "failed", "unhealthy", "invalid", "error"].includes(status)) return "FAIL";
    return "UNKNOWN";
  }

  function persistenceStatus(authority) {
    const value = objectValue(authority);
    const persistence = value.persistence && typeof value.persistence === "object" ? value.persistence : {};
    const checks = value.checks && typeof value.checks === "object" ? value.checks : {};
    const status = firstDefined(persistence, "status", "state", "result")
      ?? firstDefined(checks, "persistence", "reload", "new_session");
    if (status && typeof status === "object") return capabilityStatus(status);
    if (status !== undefined) return capabilityStatus({ status });
    return "UNKNOWN";
  }

  function authorityModel(authority, profile, adoption) {
    const evidence = normalizeAuthorityEvidence(authority);
    const overall = canonicalOverall(evidence.value);
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
      : isCanonicalEvidence(cardWriter) && isCanonicalEvidence(cloudWriter)
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
      : completionStatus === "not_configured" && (archiveStatus === "not_applicable" || !archiveStatus)
          ? "N/A"
          : completionReady && archiveReady && policyIdentity === "module-c-completion-archive-policy" && policyDelay === 86400
            ? "C Shared / 24h"
            : "Unknown / Not Available";

    const legacyCurrent = firstDefined(evidence.legacy, "current_route", "currentRoute", "current_route_reachable", "currentRouteReachable");
    const legacy = profile.readOnlyExpected
      ? "N/A"
        : legacyCurrent === false
        ? "INACTIVE / Retired"
        : legacyCurrent === true
          ? "REACHABLE / Active"
          : "Unknown / Not Available";
    const completion = capabilityStatus(evidence.completion);
    const archive = capabilityStatus(evidence.archive);
    const persistence = persistenceStatus(evidence.value);

    return Object.freeze({
      status: evidence.status,
      contract: textValue(evidence.value?.contract || evidence.value?.contract_id || evidence.value?.contractId),
      overallStatus: overall.status,
      overallRawStatus: overall.rawStatus,
      overallLabel: overall.label,
      gapCount: overall.gapCount,
      reasons: overall.reasons,
      evidenceSummary: overall.evidence,
      runtime,
      data,
      writer,
      workflow,
      completion,
      archive,
      persistence,
      lifecycle,
      legacy,
      health: overall.label,
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
      const authoritySource = objectValue(authority?.source);
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
        completion: authorityState.completion,
        archive: authorityState.archive,
        persistence: authorityState.persistence,
        lifecycle: authorityState.lifecycle,
        legacy: authorityState.legacy,
        legacyLabel: profile.legacyLabel,
        adoption: adoption.label,
        adoptionKey: adoption.key,
        adoptionStatus: adoption.status,
        adoptionVersion: adoption.version,
        adoptionBuild: adoption.build,
        adoptionIdentityMatches: adoption.identityMatches,
        publishedVersion: textValue(release?.publishedVersion),
        publishedBuild: textValue(release?.publishedBuild),
        publishedSourceCommit: textValue(release?.sourceCommit),
        publishedSourceFingerprint: textValue(release?.sourceFingerprint),
        runtimeIdentity: textValue(firstDefined(authoritySource, "runtime_identity", "runtimeIdentity", "source_commit", "sourceCommit")),
        health: authorityState.health,
        overallStatus: authorityState.overallStatus,
        overallRawStatus: authorityState.overallRawStatus,
        overallLabel: authorityState.overallLabel,
        gapCount: authorityState.gapCount,
        reasons: authorityState.reasons,
        evidenceSummary: authorityState.evidenceSummary,
        authorityStatus: authorityState.status || "unknown",
        authorityContract: authorityState.contract,
        policyIdentity: authorityState.policyIdentity,
        policyVersion: authorityState.policyVersion,
        policyDelay: authorityState.policyDelay,
        authorityError: authorityState.error,
        checkerEvidence: authority,
        readOnlyExpected: profile.readOnlyExpected === true,
        evidenceAvailable: Boolean(authority)
      });
    };

    RUNTIME_VIEW_DEFINITIONS.forEach(profile => {
      activeInstances.filter(instance => profile.matches(instance)).forEach(instance => entries.push(append(profile, instance)));
    });
    activeInstances.filter(instance => !consumedInstances.has(instance.id)).forEach(instance => entries.push(append(runtimeViewFor(instance), instance)));
    return entries;
  }

  function checkerValue(entry) {
    return entry?.checkerEvidence && typeof entry.checkerEvidence === "object" ? entry.checkerEvidence : {};
  }

  function metricNumber(section, field) {
    const value = Number(firstDefined(objectValue(section), field));
    return Number.isFinite(value) ? value : null;
  }

  function deduplicatedSurfaceMetric(entries, sectionName, countField, predicate) {
    const identities = new Set();
    let reportedMax = 0;
    let hadSurfaceEvidence = false;
    (Array.isArray(entries) ? entries : []).forEach(entry => {
      const section = objectValue(checkerValue(entry)[sectionName]);
      const reported = metricNumber(section, countField);
      if (reported != null) reportedMax = Math.max(reportedMax, reported);
      const surfaces = Array.isArray(section.surfaces) ? section.surfaces : [];
      surfaces.forEach(surface => {
        if (typeof predicate === "function" && !predicate(surface)) return;
        hadSurfaceEvidence = true;
        const identity = [
          surface?.schema,
          surface?.name,
          surface?.capability,
          surface?.table,
          surface?.trigger,
          surface?.function
        ].map(value => textValue(value).trim()).filter(Boolean).join(":");
        if (identity) identities.add(identity);
      });
    });
    if (identities.size) return identities.size;
    return hadSurfaceEvidence || reportedMax ? reportedMax : null;
  }

  function deduplicatedReportedMetric(entries, sectionName, countField) {
    let max = null;
    (Array.isArray(entries) ? entries : []).forEach(entry => {
      const value = metricNumber(objectValue(checkerValue(entry)[sectionName]), countField);
      if (value != null) max = max == null ? value : Math.max(max, value);
    });
    return max;
  }

  function evidenceStatus(value) {
    const normalized = lowerValue(value);
    if (["pass", "passed", "healthy", "ok", "current"].includes(normalized)) return "PASS";
    if (["fail", "failed", "unhealthy", "error", "invalid"].includes(normalized)) return "FAIL";
    if (["partial", "degraded", "warning"].includes(normalized)) return "PARTIAL";
    if (["not_applicable", "na", "n_a", "not_configured"].includes(normalized)) return "N/A";
    return "UNKNOWN";
  }

  function evidenceStatusFromEntries(entries, selectors) {
    const statuses = [];
    (Array.isArray(entries) ? entries : []).forEach(entry => {
      let value = checkerValue(entry);
      for (const selector of selectors) {
        value = value?.[selector];
      }
      if (value && typeof value === "object") value = firstDefined(value, "status", "state", "result");
      if (typeof value === "boolean") statuses.push(value ? "FAIL" : "PASS");
      else if (value !== undefined && value !== null && value !== "") statuses.push(evidenceStatus(value));
    });
    if (!statuses.length) return "UNKNOWN";
    if (statuses.includes("FAIL")) return "FAIL";
    if (statuses.includes("PARTIAL")) return "PARTIAL";
    if (statuses.every(status => status === "N/A")) return "N/A";
    if (statuses.includes("UNKNOWN")) return "UNKNOWN";
    return "PASS";
  }

  function summarizeCheckerEvidence(entries = []) {
    const rows = (Array.isArray(entries) ? entries : []).filter(entry => entry?.boardInstanceId);
    const counts = { healthy: 0, partial: 0, unhealthy: 0, unknown: 0, na: 0 };
    rows.forEach(entry => { counts[canonicalOverall(checkerValue(entry)).status] += 1; });
    return Object.freeze({
      totalConsumers: rows.length,
      counts: Object.freeze(counts),
      activeAlternateWriters: deduplicatedSurfaceMetric(
        rows,
        "writers",
        "active_alternate_count",
        surface => surface?.alternate === true || lowerValue(surface?.classification) === "alternate"
      ),
      activeLegacyWriters: deduplicatedReportedMetric(rows, "legacy_routes", "active_legacy_writer_count"),
      reachableRetired48hWriters: deduplicatedReportedMetric(rows, "legacy_routes", "reachable_48h_writer_count"),
      activeLegacyTriggers: deduplicatedReportedMetric(rows, "triggers", "active_legacy_count"),
      crossInstanceLeakage: evidenceStatusFromEntries(rows, ["data_isolation", "cross_instance_leakage"]),
      provisioningDrift: evidenceStatusFromEntries(rows, ["checks", "provisioning_drift"]),
      releaseIdentityUnknown: rows.filter(entry => {
        const release = objectValue(checkerValue(entry).release);
        const status = lowerValue(firstDefined(release, "identity_status", "identityStatus", "status"));
        return !status || ["unknown", "unverified", "missing"].includes(status);
      }).length
    });
  }

  function siteMapNodeStatus(status) {
    return healthLabel(status || "unknown");
  }

  function buildSiteMapModel({ entries = [] } = {}) {
    const consumers = (Array.isArray(entries) ? entries : []).filter(entry => entry?.boardInstanceId);
    const summary = summarizeCheckerEvidence(consumers);
    const cStatus = summary.counts.unhealthy
      ? "unhealthy"
      : summary.counts.partial
        ? "partial"
        : summary.counts.unknown
          ? "unknown"
          : summary.totalConsumers
            ? "healthy"
            : "unknown";
    const consumerNodes = consumers.map(entry => ({
      key: `consumer-${entry.key}-${entry.boardInstanceId}`,
      label: entry.label,
      detail: entry.instanceName || entry.runtimeEntry,
      status: entry.overallStatus,
      boardInstanceId: entry.boardInstanceId,
      children: []
    }));
    const moduleNodes = SITE_MAP_MODULES.map(definition => {
      const children = definition.key === "module-a"
        ? [{ key: "navigation-shell", label: "Navigation / Shell", detail: "Shared Navigation", status: "unknown", children: [] }]
        : definition.key === "module-b"
          ? [{ key: "workspace-composition", label: "Workspace / Composition", detail: "Shared Workspace Contract", status: "unknown", children: [] }]
          : [];
      return { ...definition, children };
    });
    moduleNodes.splice(2, 0, {
      key: "module-c",
      label: "Module C",
      detail: "Shared Board Capability / Authority",
      status: cStatus,
      children: [{
        key: "template-c",
        label: "Template C",
        detail: `${summary.totalConsumers} 個 active C Consumer · Golden Master Runtime`,
        status: cStatus,
        children: consumerNodes
      }]
    });
    return {
      key: "system",
      label: "System",
      detail: "Zhuge AI OS",
      status: "na",
      children: moduleNodes
    };
  }

  function renderSiteMapNode(node) {
    const children = Array.isArray(node.children) && node.children.length
      ? `<ul class="template-site-map-children">${node.children.map(renderSiteMapNode).join("")}</ul>`
      : "";
    const identity = node.boardInstanceId ? `<code>${escapeHtml(node.boardInstanceId)}</code>` : "";
    return `<li class="template-site-map-node template-site-map-node-${escapeHtml(canonicalHealthStatus(node.status))}"><div class="template-site-map-node-row"><span class="template-site-map-node-label"><strong>${escapeHtml(node.label)}</strong><small>${escapeHtml(node.detail || "")}</small>${identity}</span><span class="template-site-map-node-status ${healthClass(node.status)}">${escapeHtml(siteMapNodeStatus(node.status))}</span></div>${children}</li>`;
  }

  function siteMapMarkup(entries = []) {
    const status = runtimeObservabilityState.status;
    const note = status === "resolved"
      ? "Module、Template、Consumer、Board Instance 與 Health 分層呈現；Consumer Data / Workflow 不作 parity 判定。"
      : "等待 Board Instance / Checker evidence；未取得的 Consumer 不建立假資料。";
    const model = buildSiteMapModel({ entries });
    return `<section class="template-site-map" data-template-site-map data-template-site-map-status="${escapeHtml(status)}" aria-labelledby="template-site-map-title"><div class="template-site-map-heading"><div><span class="template-management-kicker">System Map</span><h4 id="template-site-map-title">網站地圖／Template／Module／Consumer</h4><p>${escapeHtml(note)}</p></div><span class="template-site-map-state">${escapeHtml(status === "resolved" ? `${entries.length} 個 C Consumer` : "Cloud evidence pending")}</span></div><nav aria-label="System Site Map"><ul class="template-site-map-tree">${renderSiteMapNode(model)}</ul></nav></section>`;
  }

  function summaryMetric(value) {
    return value === null || value === undefined ? "UNKNOWN" : String(value);
  }

  function siteWideSummaryMarkup(entries = []) {
    if (runtimeObservabilityState.status !== "resolved") {
      return `<section class="template-site-summary" data-template-site-summary data-template-site-summary-status="unknown" aria-labelledby="template-site-summary-title"><div class="template-site-summary-heading"><div><span class="template-management-kicker">Canonical Evidence Summary</span><h4 id="template-site-summary-title">全站 C Health Summary</h4><p>等待 canonical Checker evidence；未取得資料不會被當成零或 Healthy。</p></div><span class="template-site-summary-state is-unknown">UNKNOWN</span></div></section>`;
    }
    const summary = summarizeCheckerEvidence(entries);
    const count = (key, label) => `<div class="template-site-summary-item"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(String(summary.counts[key] || 0))}</dd></div>`;
    const metric = (value, label) => `<div class="template-site-summary-item"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(summaryMetric(value))}</dd></div>`;
    return `<section class="template-site-summary" data-template-site-summary aria-labelledby="template-site-summary-title"><div class="template-site-summary-heading"><div><span class="template-management-kicker">Canonical Evidence Summary</span><h4 id="template-site-summary-title">全站 C Health Summary</h4><p>只彙總 Checker evidence；同一 writer identity 不因多個 Board 重複計算。</p></div><span class="template-site-summary-state">${escapeHtml(`${summary.totalConsumers} 個 C Consumer`)}</span></div><dl class="template-site-summary-grid">${count("healthy", "HEALTHY")}${count("partial", "PARTIAL")}${count("unhealthy", "UNHEALTHY")}${count("unknown", "UNKNOWN")}${count("na", "N/A")}${metric(summary.activeAlternateWriters, "Active Alternate Writers")}${metric(summary.activeLegacyWriters, "Active Legacy Writers")}${metric(summary.reachableRetired48hWriters, "Reachable Retired 48h Writers")}${metric(summary.activeLegacyTriggers, "Active Legacy Triggers")}${metric(summary.crossInstanceLeakage, "Cross-instance Leakage")}${metric(summary.provisioningDrift, "Provisioning Drift")}${metric(summary.releaseIdentityUnknown, "Release Identity Unknown")}</dl></section>`;
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
    if (snapshot.status === "error") return "設定讀取失敗；目前僅顯示可取得的正式 Evidence。";
    return "此頁為唯讀 Observability Surface；Capability 由 Registry 決定，Adoption 由 Supabase Cloud 提供。";
  }

  function adoptionLabel(snapshot, enabled) {
    if (!isReady(snapshot)) return "🟡 待讀取 Cloud 狀態";
    return enabled ? "🟢 Cloud Preference：ON（只讀）" : "⚪ Cloud Preference：OFF（只讀）";
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
    const statusClass = healthClass(entry.overallStatus || entry.health);
    const overallLabel = entry.overallLabel || healthLabel(entry.overallStatus || entry.health);
    const value = (label, content, className = "") => `<div class="template-runtime-observability-field ${className}"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(content || "Unknown / Not Available")}</dd></div>`;
    const reasons = Array.isArray(entry.reasons) && entry.reasons.length
      ? `<div class="template-runtime-observability-evidence"><dt>Reasons</dt><dd><ul>${entry.reasons.map(reason => `<li>${escapeHtml(reason)}</li>`).join("")}</ul></dd></div>`
      : value("Reasons", entry.evidenceAvailable ? "Checker 未提供理由" : "Unknown / Not Available");
    const technical = [
      value("Authority Contract", entry.authorityContract || "Unknown / Not Available"),
      value("Policy", entry.policyIdentity ? `${entry.policyIdentity} · v${entry.policyVersion || "—"} · ${entry.policyDelay || "—"} sec` : "Unknown / Not Available"),
      value("Cloud Adoption Key", entry.adoptionKey || "Unknown / Not Available"),
      value("Published Source Commit", entry.publishedSourceCommit || "Unknown / Not Available"),
      value("Published Fingerprint", entry.publishedSourceFingerprint || "Unknown / Not Available"),
      value("Runtime Identity", entry.runtimeIdentity || "Unknown / Not Available"),
      value("Checker Evidence", entry.authorityError ? `讀取失敗：${entry.authorityError}` : entry.evidenceSummary || `${entry.authorityStatus || "unknown"} · ${entry.evidenceAvailable ? "已取得" : "未取得"}`)
    ].join("");
    const legacyValue = entry.key === "worktodo" && entry.legacy === "INACTIVE / Retired"
      ? "Legacy Create Authority：Retired"
      : entry.legacy;
    const releaseIdentity = entry.publishedVersion && entry.publishedBuild
      ? `${entry.publishedVersion} / ${entry.publishedBuild}`
      : "Unknown / Not Available";
    return `<details class="template-runtime-observability-card" data-template-runtime-entry="${escapeHtml(entry.key)}" data-template-runtime-health="${escapeHtml(entry.overallStatus || "unknown")}"><summary><span class="template-runtime-observability-name"><strong>${escapeHtml(entry.label)}</strong><small>${escapeHtml(entry.module)}</small></span><span class="template-runtime-observability-summary"><strong>${escapeHtml(entry.runtime)}</strong><small class="${statusClass}">${escapeHtml(overallLabel)}</small></span><span class="template-runtime-observability-chevron" aria-hidden="true">⌄</span></summary><div class="template-runtime-observability-body"><dl class="template-runtime-observability-fields">${value("Overall Health", overallLabel, `template-runtime-observability-health ${statusClass}`)}${value("Gap Count", entry.gapCount == null ? "Unknown / Not Available" : String(entry.gapCount))}${value("Runtime", entry.runtime)}${value("Board Instance", entry.boardInstanceId || "Unknown / Not Available")}${value("Runtime Entry", entry.runtimeEntry)}${value("Data", entry.data)}${value("Writer Authority", entry.writer)}${value("Workflow", entry.workflow)}${value("Completion", entry.completion)}${value("Archive", entry.archive)}${value("Persistence", entry.persistence)}${value("Release", releaseIdentity)}${value("Adoption", entry.adoption)}${value("Legacy Authority", legacyValue)}${reasons}</dl><details class="template-runtime-observability-technical"><summary>Contract 詳細</summary><dl class="template-runtime-observability-fields">${technical}</dl></details></div></details>`;
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
    const runtimeEntries = runtimeObservabilityState.status === "resolved" ? runtimeObservabilityState.entries : [];
    const consumers = runtimeEntries.length
      ? runtimeEntries.map(entry => {
        const state = entry.adoptionIdentityMatches
          ? "🟢 MATCH"
          : entry.adoptionStatus || entry.adoptionVersion || entry.adoptionBuild
            ? "🟡 NOT MATCHED"
            : "⚪ UNKNOWN";
        const version = entry.adoptionVersion || "—";
        const build = entry.adoptionBuild || "—";
        return `<span class="template-management-release-consumer"><strong>${escapeHtml(entry.label)}</strong><span>${escapeHtml(state)} · ${escapeHtml(version)} / ${escapeHtml(build)} · key ${escapeHtml(entry.adoptionKey || "UNKNOWN")}</span></span>`;
      }).join("")
      : `<span class="template-management-release-consumer"><strong>Consumer Adoption</strong><span>⚪ UNKNOWN · 等待 Board Instance / Published Adoption evidence</span></span>`;
    return `<div class="template-management-release" data-template-release-summary data-template-release-pending="${pending}" role="status"><div><strong>${pendingLabel}</strong><span>開發版：${escapeHtml(developmentVersion)} / ${escapeHtml(developmentBuild)} · 已發布版：${escapeHtml(publishedVersion)} / ${escapeHtml(publishedBuild)}</span></div><div class="template-management-release-consumers">${consumers}</div></div>`;
  }

  function renderConsumerRows(model, snapshot) {
    if (!model.rows.length) return `<div class="template-management-empty">目前沒有此 Template 的 Consumer。</div>`;
    return `<div class="template-management-table" role="table" aria-label="${escapeHtml(model.template.label)} Consumer 清單"><div class="template-management-table-head" role="row"><span role="columnheader">頁面 (Consumer)</span><span role="columnheader">Template Capability</span><span role="columnheader">Cloud Adoption Preference</span><span role="columnheader">Management Center</span></div>${model.rows.map(({ page, enabled }) => { const capabilityText = `Registry · ${model.template.code} capability`; return `<div class="template-management-row" role="row" data-template-management-row="${escapeHtml(page.id)}-${escapeHtml(model.template.id)}"><span class="template-management-consumer" role="cell">${escapeHtml(page.label)}</span><span class="template-management-capability" role="cell">${escapeHtml(capabilityText)}</span><span role="cell"><span class="template-management-adoption ${enabled ? "is-on" : "is-off"}" data-template-management-adoption>${escapeHtml(adoptionLabel(snapshot, enabled))}</span></span><span class="template-management-readonly" role="cell">READ-ONLY · 不在此寫入</span></div>`; }).join("")}</div>`;
  }

  function render(options = {}) {
    if (releaseState.status === "idle") refreshPublishedRelease();
    if (runtimeObservabilityState.status === "idle") refreshRuntimeObservability();
    const snapshot = runtimeSnapshot();
    const models = buildTemplateModel(snapshot);
    const runtimeEntries = runtimeObservabilityState.entries || [];
    const cards = models.map(model => {
      const template = model.template;
      const count = model.enabledCount == null ? "—" : `${model.enabledCount} 頁`;
      const supportCount = model.consumers.length;
      const panelId = `template-management-panel-${template.id}`;
      return `<section class="template-management-card" data-template-management-template="${escapeHtml(template.id)}"><button class="template-management-card-header" type="button" data-template-management-toggle aria-expanded="false" aria-controls="${escapeHtml(panelId)}"><span class="template-management-code" aria-hidden="true">${escapeHtml(template.code)}</span><span class="template-management-card-title"><strong>${escapeHtml(template.code)} 區｜${escapeHtml(template.label)}</strong><small>${escapeHtml(template.description)}</small></span><span class="template-management-card-summary"><strong>已套用 ${escapeHtml(count)}</strong><small>Consumer ${supportCount} 頁</small></span><span class="template-management-card-chevron" aria-hidden="true">⌄</span></button><div class="template-management-card-body" id="${escapeHtml(panelId)}" data-template-management-panel hidden><div class="template-management-card-actions"><button class="btn2" type="button" data-template-management-preview data-template-id="${escapeHtml(template.id)}">查看模板</button></div>${renderConsumerRows(model, snapshot)}</div></section>`;
    }).join("");
    return `<section class="control-center-entry-group template-management-center" data-template-management-center><div class="template-management-heading"><div><span class="template-management-kicker">System Observability／Navigation Surface</span><h3>🧩 系統模板管理中心</h3><p class="muted">只讀取 Template、Module、Consumer、Release、Adoption 與 C Authority Evidence；不在此重新判定 Health。</p></div><span class="template-management-source">來源：Canonical Cloud Evidence</span></div><div class="template-management-status" data-template-management-status role="status">${escapeHtml(statusMessage(snapshot))}</div>${releaseStatusMarkup()}${siteMapMarkup(runtimeEntries)}${siteWideSummaryMarkup(runtimeEntries)}${runtimeObservabilityMarkup()}<div class="template-management-cards">${cards || `<div class="template-management-empty">Template Registry 尚未載入。</div>`}</div></section>`;
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
  }

  return Object.freeze({
    render,
    bind,
    buildTemplateModel,
    buildRuntimeIdentityModel,
    summarizeCheckerEvidence,
    buildSiteMapModel
  });
});
