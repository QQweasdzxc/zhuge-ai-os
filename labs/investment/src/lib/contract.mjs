export const DATA_TRUTH = Object.freeze([
  "OFFICIAL",
  "REAL",
  "FINMIND",
  "YAHOO",
  "DELAYED",
  "FALLBACK",
  "KEY_REQUIRED",
  "PLAN_REQUIRED",
  "NOT_CONNECTED",
  "UNAVAILABLE",
  "SIMULATED",
]);

export const EVIDENCE_STATUS = Object.freeze([
  "AVAILABLE",
  "PARTIAL",
  "NOT_APPLICABLE",
  "NOT_CONNECTED",
  "PROVIDER_REVIEW_REQUIRED",
  "UNAVAILABLE",
]);

export function makeEvidence({
  status = "UNAVAILABLE",
  dataTruth = "UNAVAILABLE",
  provider = "未指定",
  source = [],
  dataTimestamp = null,
  publishedAt = null,
  fetchedAt = null,
  stale = null,
  delayed = false,
  fallback = false,
  attribution = null,
  license = null,
  note = "",
  errorCode = null,
  data = null,
}) {
  if (!EVIDENCE_STATUS.includes(status)) throw new Error("EVIDENCE_STATUS_INVALID");
  if (!DATA_TRUTH.includes(dataTruth)) throw new Error("DATA_TRUTH_INVALID");
  return {
    status,
    dataTruth,
    provider,
    source: Array.isArray(source) ? source : [source],
    dataTimestamp,
    publishedAt,
    fetchedAt,
    stale,
    delayed: Boolean(delayed),
    fallback: Boolean(fallback),
    attribution,
    license,
    note,
    errorCode,
    data,
  };
}

export function unavailableEvidence(provider, source, errorCode, note = "目前無法取得資料。") {
  return makeEvidence({
    status: "UNAVAILABLE",
    dataTruth: "UNAVAILABLE",
    provider,
    source,
    note,
    errorCode: sanitizeErrorCode(errorCode),
  });
}

export function sanitizeErrorCode(value) {
  const raw = String(value ?? "UNKNOWN_ERROR").toUpperCase();
  const known = raw.match(/^(HTTP_[1-5]\d\d|TIMEOUT|NETWORK_ERROR|INVALID_JSON|INVALID_RESPONSE|EMPTY_RESPONSE|SOURCE_SCHEMA_CHANGED|SYMBOL_NOT_FOUND|HISTORY_NOT_CONNECTED|PROVIDER_NOT_CONFIGURED|WORKBOOK_[A-Z_]+|WORLD_BANK_[A-Z_]+)$/);
  return known?.[0] ?? "PROVIDER_READ_FAILED";
}

export function dataTruthLabel(evidence) {
  if (!evidence) return "UNAVAILABLE";
  if (evidence.fallback) return "FALLBACK";
  if (evidence.status === "PROVIDER_REVIEW_REQUIRED" || evidence.status === "NOT_CONNECTED") return "NOT_CONNECTED";
  if (evidence.status === "NOT_APPLICABLE") return "NOT_CONNECTED";
  if (evidence.status === "UNAVAILABLE") return "UNAVAILABLE";
  if (evidence.delayed) return "DELAYED";
  return evidence.dataTruth;
}
