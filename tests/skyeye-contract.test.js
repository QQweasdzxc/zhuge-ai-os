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
        markers: [{ id: "station-1", label: "臺北", lat: 25.04, lng: 121.56, value: 27.2, unit: "°C" }]
      },
      aqi: { available: false, error_code: "CONFIGURATION_UNAVAILABLE" }
    }
  });
  assert.equal(result.read_only, true);
  assert.equal(result.layers.weather.available, true);
  assert.equal(result.layers.weather.markers.length, 1);
  assert.equal(result.layers.aqi.evidence_status, "INSUFFICIENT_EVIDENCE");
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
