/* Zhuge SkyEye read-only evidence contract.
 *
 * The UI consumes this normalized shape only. Provider credentials, raw
 * responses and provider-specific auth never cross this boundary.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.ZhugeSkyEyeContract = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const LAYERS = Object.freeze(["weather", "radar", "earthquake", "aqi", "cctv"]);
  const DATA_STATES = Object.freeze([
    "loading",
    "not_requested",
    "available",
    "empty",
    "provider_not_configured",
    "provider_unavailable",
    "stale",
    "error"
  ]);
  const SPATIAL_STRATEGIES = Object.freeze({
    weather: "location_observation",
    radar: "regional_overlay",
    earthquake: "regional_event_distance",
    aqi: "nearest_station",
    cctv: "nearby_point"
  });
  const AVAILABLE = "AVAILABLE";
  const INSUFFICIENT = "INSUFFICIENT_EVIDENCE";

  function text(value, max = 240) {
    return String(value == null ? "" : value).trim().slice(0, max);
  }

  function dataState(raw = {}) {
    const explicit = text(raw.state || raw.data_state || raw.dataState, 40).toLowerCase();
    if (DATA_STATES.includes(explicit)) return explicit;
    const code = text(raw.error_code || raw.errorCode, 100).toUpperCase();
    if (code === "NOT_REQUESTED") return "not_requested";
    if (raw.available === true) return raw.stale === true ? "stale" : "available";
    if (/(API_KEY|CREDENTIALS|CONFIGURATION)_UNAVAILABLE$/.test(code)) return "provider_not_configured";
    if (/PROVIDER_(TIMEOUT|NETWORK|HTTP)|_UNAVAILABLE$/.test(code)) return "provider_unavailable";
    if (/^NO_(COORDINATED|NEARBY)/.test(code)) return "empty";
    if (/MALFORMED|INVALID|FAILED|ERROR/.test(code)) return "error";
    if (raw.available === undefined && !code && !Array.isArray(raw.markers)) return "not_requested";
    return "empty";
  }

  function number(value) {
    if (value === null || value === undefined || value === "") return null;
    const parsed = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }

  function normalizeMarker(value = {}) {
    const item = value && typeof value === "object" ? value : {};
    const lat = number(item.lat ?? item.latitude);
    const lng = number(item.lng ?? item.lon ?? item.longitude);
    return Object.freeze({
      id: text(item.id || item.marker_id, 120),
      kind: text(item.kind || "marker", 40),
      label: text(item.label || item.title || item.name, 160),
      detail: text(item.detail || item.description, 360),
      lat,
      lng,
      observed_at: text(item.observed_at || item.as_of, 80),
      value: number(item.value),
      unit: text(item.unit, 40),
      status: text(item.status, 80),
      magnitude: number(item.magnitude),
      depth_km: number(item.depth_km),
      distance_m: number(item.distance_m ?? item.distanceMeters),
      bearing_degrees: number(item.bearing_degrees ?? item.bearingDegrees),
      direction: text(item.direction, 40),
      road_label: text(item.road_label || item.roadLabel, 180),
      intersection_label: text(item.intersection_label || item.intersectionLabel, 180),
      media_available: item.media_available === true || Boolean(item.image_url || item.stream_url),
      image_url: text(item.image_url, 800),
      stream_url: text(item.stream_url, 800),
      source: text(item.source, 160)
    });
  }

  function normalizeLayer(key, value = {}) {
    const raw = value && typeof value === "object" ? value : {};
    const normalizedKey = LAYERS.includes(key) ? key : text(key, 40);
    const markers = Array.isArray(raw.markers)
      ? raw.markers.map(normalizeMarker).filter(marker => marker.id && marker.lat !== null && marker.lng !== null)
      : [];
    const state = dataState(raw);
    const available = raw.available === true || state === "available" || state === "stale";
    const evidenceStatus = available ? AVAILABLE : INSUFFICIENT;
    const rawQuality = text(raw.data_quality || raw.dataQuality, 60);
    const inferredQuality = !available
      ? "unavailable"
      : text(raw.freshness, 40) === "unknown"
        ? "unverified"
        : raw.stale === true
          ? "stale"
          : "usable";
    return Object.freeze({
      key: normalizedKey,
      available,
      state,
      spatial_strategy: text(raw.spatial_strategy || raw.spatialStrategy, 60) || SPATIAL_STRATEGIES[normalizedKey] || "provider_defined",
      center: raw.center && typeof raw.center === "object"
        ? { lat: number(raw.center.lat), lng: number(raw.center.lng) }
        : null,
      radius_m: number(raw.radius_m ?? raw.radiusM),
      count: Number.isFinite(Number(raw.count)) ? Number(raw.count) : markers.length,
      provider: text(raw.provider, 120),
      source: text(raw.source, 200),
      source_url: text(raw.source_url || raw.sourceUrl, 800),
      retrieved_at: text(raw.retrieved_at || raw.retrievedAt, 80),
      as_of: text(raw.as_of || raw.asOf, 80),
      freshness: text(raw.freshness, 40) || "unavailable",
      stale: raw.stale === true,
      evidence_status: evidenceStatus,
      data_quality: rawQuality || inferredQuality,
      error_code: text(raw.error_code || raw.errorCode, 80),
      markers: Object.freeze(markers),
      overlay: raw.overlay && typeof raw.overlay === "object"
        ? Object.freeze({
            image_url: text(raw.overlay.image_url || raw.overlay.imageUrl, 800),
            bounds: Array.isArray(raw.overlay.bounds) ? raw.overlay.bounds : null
          })
        : null
    });
  }

  function normalizeResponse(value = {}) {
    const raw = value && typeof value === "object" ? value : {};
    const rawLayers = raw.layers && typeof raw.layers === "object" ? raw.layers : {};
    const layers = Object.freeze(LAYERS.reduce((result, key) => {
      result[key] = normalizeLayer(key, rawLayers[key]);
      return result;
    }, {}));
    const loaded = LAYERS.filter(key => layers[key].available);
    return Object.freeze({
      contract: text(raw.contract, 120),
      read_only: raw.read_only === true,
      generated_at: text(raw.generated_at, 80),
      layers,
      loaded_layers: Object.freeze(loaded),
      location_context: raw.location_context && typeof raw.location_context === "object"
        ? Object.freeze({
            label: text(raw.location_context.label, 180),
            source: text(raw.location_context.source, 80),
            center: raw.location_context.center && typeof raw.location_context.center === "object"
              ? { lat: number(raw.location_context.center.lat), lng: number(raw.location_context.center.lng) }
              : null,
            accuracy_m: number(raw.location_context.accuracy_m ?? raw.location_context.accuracyM),
            radius_m: number(raw.location_context.radius_m ?? raw.location_context.radiusM),
            bbox: Array.isArray(raw.location_context.bbox) ? raw.location_context.bbox : null,
            provider_context: raw.location_context.provider_context && typeof raw.location_context.provider_context === "object"
              ? { tdx_city: text(raw.location_context.provider_context.tdx_city, 80) }
              : { tdx_city: text(raw.location_context.tdx_city, 80) }
          })
        : null,
      requested_layers: Object.freeze(Array.isArray(raw.requested_layers) ? raw.requested_layers.map(value => text(value, 30)).filter(Boolean) : []),
      request_id: text(raw.request_id || raw.requestId, 120),
      summary: raw.summary && typeof raw.summary === "object"
        ? Object.freeze({ ...raw.summary })
        : Object.freeze({ loaded_layers: loaded.length })
    });
  }

  function summaryFromLoadedEvidence(response, visibleLayers = []) {
    const normalized = response?.layers ? response : normalizeResponse(response);
    const selected = (Array.isArray(visibleLayers) && visibleLayers.length ? visibleLayers : normalized.loaded_layers)
      .filter(key => LAYERS.includes(key) && normalized.layers[key]?.available);
    const location = normalized.location_context?.label ? `${normalized.location_context.label}：` : "";
    if (!selected.length) {
      return Object.freeze({
        status: INSUFFICIENT,
        text: `${location}目前沒有已載入的可驗證資料，諸葛暫時不做判斷。`,
        layers: Object.freeze([])
      });
    }
    const labels = { weather: "天氣", radar: "雷達", earthquake: "地震", aqi: "空氣品質", cctv: "道路影像" };
    const names = selected.map(key => labels[key] || key);
    return Object.freeze({
      status: AVAILABLE,
      text: `${location}目前已載入：${names.join("、")}。摘要只根據這些資料，請以各資料層的來源與更新時間為準。`,
      layers: Object.freeze(selected.slice())
    });
  }

  return Object.freeze({
    LAYERS,
    DATA_STATES,
    SPATIAL_STRATEGIES,
    AVAILABLE,
    INSUFFICIENT,
    normalizeMarker,
    normalizeLayer,
    normalizeResponse,
    summaryFromLoadedEvidence
  });
});
