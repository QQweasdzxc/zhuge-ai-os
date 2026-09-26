const test = require("node:test");
const assert = require("node:assert/strict");

const loadNormalizers = () => import("../supabase/functions/zhuge-skyeye-read/normalizers.mjs");
const now = Date.parse("2026-09-25T08:00:00.000Z");

test("CWA weather normalizer handles nested station records and provider timestamps", async () => {
  const { normalizeWeatherRows } = await loadNormalizers();
  const result = normalizeWeatherRows({ records: { Station: [{
    StationId: "466920",
    StationName: "臺北",
    GeoInfo: { Coordinates: ["121.56", "25.04"] },
    ObsTime: { DateTime: "2026-09-25T07:50:00.000Z" },
    WeatherElement: [{ ElementName: "AirTemperature", ElementValue: { value: "27.2" } }]
  }] } }, "2026-09-25T08:00:00.000Z");
  assert.equal(result.malformed, false);
  assert.equal(result.markers.length, 1);
  assert.equal(result.markers[0].lat, 25.04);
  assert.equal(result.markers[0].lng, 121.56);
  assert.equal(result.markers[0].value, 27.2);
  assert.equal(result.markers[0].observed_at, "2026-09-25T07:50:00.000Z");
});

test("CWA earthquake and MOENV AQI normalizers preserve evidence fields", async () => {
  const { normalizeEarthquakeRows, normalizeAqiRows } = await loadNormalizers();
  const earthquake = normalizeEarthquakeRows({ records: { Earthquake: [{
    EarthquakeNo: "E-1",
    EarthquakeInfo: {
      OriginTime: { DateTime: "2026-09-25T06:00:00.000Z" },
      Epicenter: { Location: "花蓮近海", EpicenterLatitude: "23.9", EpicenterLongitude: "121.6" },
      EarthquakeMagnitude: { MagnitudeValue: "5.1" },
      FocalDepth: "18"
    }
  }] } }, "2026-09-25T08:00:00.000Z");
  assert.equal(earthquake.malformed, false);
  assert.equal(earthquake.markers[0].magnitude, 5.1);
  assert.equal(earthquake.markers[0].depth_km, 18);
  assert.equal(earthquake.markers[0].observed_at, "2026-09-25T06:00:00.000Z");

  const aqi = normalizeAqiRows({ records: [{
    siteid: "AQ-1", sitename: "臺北市", latitude: "25.04", longitude: "121.56",
    aqi: "42", publishtime: "2026-09-25 07:00"
  }] }, "2026-09-25T08:00:00.000Z");
  assert.equal(aqi.malformed, false);
  assert.equal(aqi.markers[0].value, 42);
  assert.equal(aqi.markers[0].observed_at, "2026-09-25 07:00");
});

test("TDX CCTV normalization remains metadata-only and does not invent freshness", async () => {
  const { normalizeCctvRows } = await loadNormalizers();
  const result = normalizeCctvRows([{
    CCTVID: "C-1", RoadName: "測試道路", PositionLat: "25.04", PositionLon: "121.56",
    VideoImageUrl: "https://example.invalid/image.jpg"
  }], "2026-09-25T08:00:00.000Z");
  assert.equal(result.malformed, false);
  assert.equal(result.markers.length, 1);
  assert.equal(result.markers[0].observed_at, "");
  assert.equal(result.markers[0].image_url, "https://example.invalid/image.jpg");
});

test("malformed provider shapes become insufficient evidence instead of fake rows", async () => {
  const { normalizeWeatherRows, rowsFrom } = await loadNormalizers();
  assert.equal(rowsFrom({ records: { Station: "not-an-array" } }, ["Station"]).malformed, true);
  assert.equal(normalizeWeatherRows({ error: "provider failure" }, "2026-09-25T08:00:00.000Z").malformed, true);
  assert.equal(normalizeWeatherRows([], "2026-09-25T08:00:00.000Z").malformed, false);
  assert.deepEqual(normalizeWeatherRows([], "2026-09-25T08:00:00.000Z").markers, []);
});

test("freshness is explicit for fresh, stale, and unverifiable timestamps", async () => {
  const { freshnessFor, latestObservedAt } = await loadNormalizers();
  assert.deepEqual(freshnessFor("2026-09-25T07:45:00.000Z", now), { freshness: "fresh", stale: false });
  assert.deepEqual(freshnessFor("2026-09-25T06:00:00.000Z", now), { freshness: "stale", stale: true });
  assert.deepEqual(freshnessFor("not-a-date", now), { freshness: "unknown", stale: false });
  assert.equal(latestObservedAt([{ observed_at: "" }], ""), "");
});
