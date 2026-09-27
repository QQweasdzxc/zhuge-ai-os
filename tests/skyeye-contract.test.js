const test = require("node:test");
const assert = require("node:assert/strict");
const contract = require("../modules/skyeye/services/skyeye-contract.js");

test("SkyEye normalizes read-only layer evidence and preserves unavailable state", () => {
  const result = contract.normalizeResponse({
    contract: "zhuge-skyeye-read-v1",
    read_only: true,
    layers: {
      weather: {
        available: true,
        provider: "CWA",
        source: "Weather station observations",
      as_of: "2026-09-25T01:00:00.000Z",
      freshness: "fresh",
      data_quality: "usable",
      markers: [{ id: "station-1", label: "臺北", lat: 25.04, lng: 121.56, value: 27.2, unit: "°C" }]
      },
      aqi: { available: false, error_code: "CONFIGURATION_UNAVAILABLE" }
    }
  });
  assert.equal(result.read_only, true);
  assert.equal(result.layers.weather.available, true);
  assert.equal(result.layers.weather.markers.length, 1);
  assert.equal(result.layers.weather.data_quality, "usable");
  assert.equal(result.layers.aqi.evidence_status, "INSUFFICIENT_EVIDENCE");
  assert.equal(result.layers.aqi.data_quality, "unavailable");
  assert.equal(result.layers.aqi.error_code, "CONFIGURATION_UNAVAILABLE");
});

test("SkyEye summary never invents a conclusion without loaded evidence", () => {
  const empty = contract.summaryFromLoadedEvidence(contract.normalizeResponse({ layers: {} }));
  assert.equal(empty.status, "INSUFFICIENT_EVIDENCE");
  assert.match(empty.text, /暫時不做判斷/);

  const loaded = contract.summaryFromLoadedEvidence(contract.normalizeResponse({
    layers: { earthquake: { available: true, provider: "CWA", markers: [] } }
  }));
  assert.equal(loaded.status, "AVAILABLE");
  assert.match(loaded.text, /地震/);
});

test("SkyEye marker normalization rejects coordinates that cannot be placed", () => {
  const result = contract.normalizeLayer("cctv", {
    available: true,
    markers: [
      { id: "ok", label: "camera", lat: 25, lng: 121 },
      { id: "bad", label: "no coordinate" }
    ]
  });
  assert.equal(result.markers.length, 1);
  assert.equal(result.markers[0].id, "ok");
});

test("SkyEye does not label evidence usable when freshness cannot be verified", () => {
  const result = contract.normalizeLayer("weather", {
    available: true,
    freshness: "unknown",
    markers: [{ id: "station-1", lat: 25, lng: 121 }]
  });
  assert.equal(result.data_quality, "unverified");
});

test("SkyEye location contract preserves explicit data-state taxonomy and spatial evidence", () => {
  const result = contract.normalizeResponse({
    contract: "zhuge-skyeye-read-v2",
    read_only: true,
    location_context: {
      label: "板橋車站附近",
      source: "search",
      center: { lat: 25.014, lng: 121.463 },
      radius_m: 5000,
      provider_context: { tdx_city: "NewTaipei" }
    },
    layers: {
      cctv: {
        available: true,
        state: "available",
        count: 2,
        spatial_strategy: "nearby_point",
        markers: [{ id: "c-1", label: "文化路", lat: 25.014, lng: 121.463, distance_m: 12, road_label: "文化路", media_available: true }]
      },
      aqi: { available: false, state: "empty", error_code: "NO_NEARBY_AQI_ROWS" },
      weather: { available: false, state: "provider_not_configured", error_code: "CWA_API_KEY_UNAVAILABLE" },
      radar: { available: false, state: "not_requested", error_code: "NOT_REQUESTED" }
    }
  });
  assert.equal(result.location_context.label, "板橋車站附近");
  assert.equal(result.location_context.provider_context.tdx_city, "NewTaipei");
  assert.equal(result.layers.cctv.state, "available");
  assert.equal(result.layers.cctv.markers[0].distance_m, 12);
  assert.equal(result.layers.aqi.state, "empty");
  assert.equal(result.layers.weather.state, "provider_not_configured");
  assert.equal(result.layers.radar.state, "not_requested");
  assert.deepEqual(contract.DATA_STATES, ["loading", "not_requested", "available", "empty", "provider_not_configured", "provider_unavailable", "stale", "error"]);
});
