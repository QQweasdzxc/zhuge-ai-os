/* Zhuge AI OS — Canonical Engineering Memory Resolver.
 *
 * The resolver is intentionally a narrow Cloud boundary. Approved Principle
 * content is returned only by the engineering_knowledge RPC; knowledge_sources
 * and knowledge_units are never used as a content fallback.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeEngineeringMemory = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const UNKNOWN = "Unknown";
  const NOT_FOUND = "Not Found";
  const AUTHORIZATION_FAILED = "Authorization Failed";
  const CANONICAL_RETRIEVAL_FAILED = "Canonical Retrieval Failed";
  const CANONICAL_CONFLICT = "Canonical Conflict / Need PM Decision";

  function gatewayFrom(options = {}) {
    const gateway = options.gateway;
    if (!gateway || typeof gateway.rpc !== "function") {
      const error = new Error("Shared Supabase Gateway 尚未就緒。");
      error.code = "ENGINEERING_MEMORY_GATEWAY_UNAVAILABLE";
      throw error;
    }
    return gateway;
  }

  function normalizeCodes(codes) {
    if (!Array.isArray(codes)) return [];
    return [...new Set(codes.map(code => String(code || "").trim().toUpperCase()).filter(Boolean))];
  }

  function payloadObject(payload) {
    if (Array.isArray(payload) && payload.length === 1 && payload[0] && typeof payload[0] === "object") return payload[0];
    return payload && typeof payload === "object" && !Array.isArray(payload) ? payload : null;
  }

  function normalizeRecord(row = {}) {
    return Object.freeze({
      knowledgeCode: String(row.knowledge_code || row.code || ""),
      knowledgeType: String(row.knowledge_type || row.knowledgeType || ""),
      title: String(row.title || ""),
      summary: row.summary == null ? "" : String(row.summary),
      content: row.content == null ? "" : String(row.content),
      version: String(row.version || ""),
      updatedAt: row.updated_at || row.updatedAt || null,
      source: "public.engineering_knowledge"
    });
  }

  function normalizeFailure(row = {}, fallbackCode = "") {
    const count = Number(row.candidate_count ?? row.candidateCount ?? 0);
    const reason = String(row.reason || CANONICAL_RETRIEVAL_FAILED);
    const normalizedReason = reason === CANONICAL_CONFLICT
      ? CANONICAL_CONFLICT
      : reason === AUTHORIZATION_FAILED
        ? AUTHORIZATION_FAILED
        : reason === NOT_FOUND
          ? NOT_FOUND
        : CANONICAL_RETRIEVAL_FAILED;
    return Object.freeze({
      knowledgeCode: String(row.knowledge_code || row.code || fallbackCode || ""),
      reason: normalizedReason,
      candidateCount: Number.isFinite(count) ? count : 0,
      detail: String(row.detail || "")
    });
  }

  function isAuthorizationError(error) {
    const status = Number(error?.status || error?.statusCode || 0);
    const code = String(error?.code || "").toLowerCase();
    return status === 401 || status === 403 || code === "42501"
      || /auth|unauthoriz|forbidden|permission|capability/.test(code);
  }

  function failedPrinciples(detail = "", reason = CANONICAL_RETRIEVAL_FAILED) {
    return Object.freeze({
      source: "public.engineering_knowledge",
      status: "failed",
      records: [],
      failures: [normalizeFailure({ reason, detail })]
    });
  }

  async function resolveCurrentCanonical(options = {}) {
    const codes = normalizeCodes(options.codes);
    let payload;
    try {
      payload = await gatewayFrom(options).rpc("resolve_current_engineering_memory", {
        p_knowledge_codes: codes.length ? codes : null
      });
    } catch (error) {
      return failedPrinciples(
        error?.message || CANONICAL_RETRIEVAL_FAILED,
        isAuthorizationError(error) ? AUTHORIZATION_FAILED : CANONICAL_RETRIEVAL_FAILED
      );
    }
    const body = payloadObject(payload);
    if (!body || !Array.isArray(body.records) || !Array.isArray(body.failures)) {
      return failedPrinciples("Resolver returned an invalid canonical payload.");
    }
    const records = body.records.map(normalizeRecord).filter(record => record.knowledgeCode);
    const failures = body.failures.map(row => normalizeFailure(row));
    return Object.freeze({
      source: String(body.source || "public.engineering_knowledge"),
      status: failures.length ? "failed" : String(body.status || "ready"),
      records,
      failures
    });
  }

  function normalizeCheckpoint(row) {
    if (!row || typeof row !== "object") return null;
    return Object.freeze({
      checkpointKey: String(row.checkpoint_key || "current"),
      currentTask: String(row.current_task || row.currentTask || ""),
      currentStage: String(row.current_stage || row.currentStage || ""),
      completed: Array.isArray(row.completed) ? row.completed : [],
      pending: Array.isArray(row.pending) ? row.pending : [],
      filesChanged: Array.isArray(row.files_changed) ? row.files_changed : [],
      cloudChanges: Array.isArray(row.cloud_changes) ? row.cloud_changes : [],
      qaStatus: String(row.qa_status || row.qaStatus || ""),
      blocking: Array.isArray(row.blocking) ? row.blocking : [],
      nextAction: String(row.next_action || row.nextAction || ""),
      branch: String(row.branch || ""),
      commit: String(row.git_commit || row.commit || ""),
      workingTreeState: String(row.working_tree_state || row.workingTreeState || ""),
      updatedAt: row.updated_at || row.updatedAt || null
    });
  }

  function normalizeBaseline(row) {
    if (!row || typeof row !== "object") return null;
    if (String(row.pm_acceptance_status || row.pmAcceptanceStatus || "").toLowerCase() !== "accepted") return null;
    return Object.freeze({
      productVersion: String(row.product_version || row.productVersion || ""),
      runtimeBuild: String(row.runtime_build || row.runtimeBuild || ""),
      gitCommit: String(row.git_commit || row.gitCommit || ""),
      artifactReference: String(row.artifact_reference || row.artifactReference || ""),
      pmAcceptedAt: row.pm_accepted_at || row.pmAcceptedAt || null,
      pmAcceptanceStatus: "accepted",
      notes: String(row.notes || "")
    });
  }

  function normalizeArtifactRule(row) {
    if (!row || typeof row !== "object") return null;
    const root = String(row.artifact_root || row.artifactRoot || "").trim();
    if (!root) return null;
    return Object.freeze({
      artifactRoot: root,
      immutable: row.immutable === true,
      appendOnly: row.append_only !== false && row.appendOnly !== false,
      overwriteAllowed: row.overwrite_allowed === true || row.overwriteAllowed === true,
      allowedArtifactTypes: Array.isArray(row.allowed_artifact_types) ? row.allowed_artifact_types.map(String) : [],
      identityFields: Array.isArray(row.identity_fields) ? row.identity_fields.map(String) : [],
      unavailableBehavior: String(row.unavailable_behavior || row.unavailableBehavior || "Artifact Root Unavailable"),
      availability: "Artifact Root Unavailable"
    });
  }

  async function artifactRuleWithAvailability(rule, options = {}) {
    if (!rule) return null;
    const probe = options.artifactRootProbe;
    if (typeof probe !== "function") return rule;
    try {
      const available = await probe(rule.artifactRoot);
      return Object.freeze({ ...rule, availability: available === true ? "available" : "Artifact Root Unavailable" });
    } catch {
      return Object.freeze({ ...rule, availability: "Artifact Root Unavailable" });
    }
  }

  async function readStartupGate(options = {}) {
    const codes = normalizeCodes(options.codes);
    let payload;
    try {
      payload = await gatewayFrom(options).rpc("resolve_engineering_startup_gate", {
        p_knowledge_codes: codes.length ? codes : null
      });
    } catch (error) {
      const reason = isAuthorizationError(error) ? AUTHORIZATION_FAILED : CANONICAL_RETRIEVAL_FAILED;
      return Object.freeze({
        principles: failedPrinciples(error?.message || CANONICAL_RETRIEVAL_FAILED, reason),
        checkpoint: null,
        pmAcceptedBaseline: null,
        artifactRule: null,
        artifactRecords: [],
        status: "failed",
        error: error?.message || CANONICAL_RETRIEVAL_FAILED
      });
    }
    const body = payloadObject(payload);
    if (!body) {
      return Object.freeze({
        principles: failedPrinciples("Startup Gate returned an invalid payload."),
        checkpoint: null,
        pmAcceptedBaseline: null,
        artifactRule: null,
        artifactRecords: [],
        status: "failed",
        error: CANONICAL_RETRIEVAL_FAILED
      });
    }
    const principlesBody = payloadObject(body.principles);
    const principles = principlesBody && Array.isArray(principlesBody.records) && Array.isArray(principlesBody.failures)
      ? Object.freeze({
        source: String(principlesBody.source || "public.engineering_knowledge"),
        status: principlesBody.failures.length ? "failed" : String(principlesBody.status || "ready"),
        records: principlesBody.records.map(normalizeRecord).filter(record => record.knowledgeCode),
        failures: principlesBody.failures.map(row => normalizeFailure(row))
      })
      : failedPrinciples(CANONICAL_RETRIEVAL_FAILED);
    const artifactRule = await artifactRuleWithAvailability(normalizeArtifactRule(body.artifact_rule), options);
    return Object.freeze({
      principles,
      checkpoint: normalizeCheckpoint(body.checkpoint),
      pmAcceptedBaseline: normalizeBaseline(body.pm_accepted_baseline),
      artifactRule,
      artifactRecords: Array.isArray(body.artifact_records) ? body.artifact_records : [],
      status: principles.failures.length ? "failed" : "ready",
      error: ""
    });
  }

  function receiptValue(value) {
    return value == null || value === "" ? UNKNOWN : value;
  }

  function startupGateReceipt(gate) {
    const checkpoint = gate?.checkpoint;
    const principles = gate?.principles;
    return Object.freeze({
      "Principles Loaded": principles?.records?.length
        ? principles.records.map(record => ({
          code: record.knowledgeCode,
          version: receiptValue(record.version),
          title: receiptValue(record.title),
          summary: receiptValue(record.summary),
          content: receiptValue(record.content),
          updatedAt: receiptValue(record.updatedAt)
        }))
        : principles?.failures?.length
          ? principles.failures.map(failure => ({ code: receiptValue(failure.knowledgeCode), reason: failure.reason }))
          : UNKNOWN,
      "Current Project State": {
        branch: receiptValue(checkpoint?.branch),
        commit: receiptValue(checkpoint?.commit),
        workingTreeState: receiptValue(checkpoint?.workingTreeState)
      },
      "Current TASK": receiptValue(checkpoint?.currentTask),
      "Last Checkpoint": checkpoint || UNKNOWN,
      "PM Accepted Baseline": gate?.pmAcceptedBaseline || UNKNOWN,
      "Artifact Rule": gate?.artifactRule || UNKNOWN
    });
  }

  function writeCheckpoint(checkpoint, options = {}) {
    return gatewayFrom(options).rpc("write_engineering_checkpoint", { p_checkpoint: checkpoint || {} });
  }

  function setPMAcceptedBaseline(baseline, options = {}) {
    return gatewayFrom(options).rpc("set_engineering_pm_accepted_baseline", { p_baseline: baseline || {} });
  }

  function registerArtifact(artifact, options = {}) {
    return gatewayFrom(options).rpc("register_engineering_artifact", { p_artifact: artifact || {} });
  }

  return Object.freeze({
    UNKNOWN,
    NOT_FOUND,
    CANONICAL_RETRIEVAL_FAILED,
    CANONICAL_CONFLICT,
    AUTHORIZATION_FAILED,
    normalizeCodes,
    normalizeRecord,
    normalizeFailure,
    resolveCurrentCanonical,
    normalizeCheckpoint,
    normalizeBaseline,
    normalizeArtifactRule,
    readStartupGate,
    startupGateReceipt,
    writeCheckpoint,
    setPMAcceptedBaseline,
    registerArtifact
  });
});
