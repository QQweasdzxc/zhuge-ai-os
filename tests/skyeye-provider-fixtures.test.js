const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const fixtures = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures/skyeye-provider-fixtures.json"), "utf8"));
const normalizersPromise = import("../supabase/functions/zhuge-skyeye-read/normalizers.mjs");

test("SkyEye provider fixtures normalize weather, earthquake, AQI and CCTV evidence", async () => {
  const normalizers = await normalizersPromise;
  const retrievedAt = "2026-09-26T00:05:00.000Z";
  const weather = normalizers.normalizeWeatherRows(fixtures.weather, retrievedAt);
  const earthquake = normalizers.normalizeEarthquakeRows(fixtures.earthquake, retrievedAt);
  const aqi = normalizers.normalizeAqiRows(fixtures.aqi, retrievedAt);
  const cctv = normalizers.normalizeCctvRows(fixtures.cctv, retrievedAt);

  assert.equal(weather.malformed, false);
  assert.equal(weather.markers[0].label, "臺北");
  assert.equal(weather.markers[0].value, 27.2);
  assert.equal(weather.markers[0].lat, 25.04);
  assert.equal(weather.markers[0].lng, 121.56);
  assert.equal(earthquake.markers[0].magnitude, 4.2);
  assert.equal(earthquake.markers[0].depth_km, 18);
  assert.equal(aqi.markers[0].value, 42);
  assert.equal(cctv.markers[0].detail, "點擊標記後才載入影像");
  assert.equal(cctv.markers[0].stream_url, "https://example.invalid/cctv.m3u8");
});

test("SkyEye malformed and coordinate-incomplete provider responses fail closed", async () => {
  const normalizers = await normalizersPromise;
  const malformed = normalizers.normalizeWeatherRows(fixtures.malformed, "2026-09-26T00:05:00.000Z");
  const incomplete = normalizers.normalizeAqiRows({ records: [{ sitename: "無座標", aqi: 10 }] }, "2026-09-26T00:05:00.000Z");
  assert.equal(malformed.malformed, true);
  assert.deepEqual(malformed.markers, []);
  assert.equal(incomplete.malformed, false);
  assert.deepEqual(incomplete.markers, []);
});

test("SkyEye freshness contract distinguishes fresh, stale and unknown evidence", async () => {
  const normalizers = await normalizersPromise;
  const now = Date.parse("2026-09-26T00:30:00.000Z");
  assert.deepEqual(normalizers.freshnessFor("2026-09-26T00:20:00.000Z", now), { freshness: "fresh", stale: false });
  assert.deepEqual(normalizers.freshnessFor("2026-09-25T22:00:00.000Z", now), { freshness: "stale", stale: true });
  assert.deepEqual(normalizers.freshnessFor("not-a-timestamp", now), { freshness: "unknown", stale: false });
});

test("SkyEye source keeps provider errors and secret boundaries explicit", () => {
  const source = fs.readFileSync(path.join(__dirname, "../supabase/functions/zhuge-skyeye-read/index.ts"), "utf8");
  assert.match(source, /PROVIDER_TIMEOUT/);
  assert.match(source, /PROVIDER_MALFORMED_RESPONSE/);
  assert.match(source, /CWA_API_KEY_UNAVAILABLE/);
  assert.match(source, /TDX_CREDENTIALS_UNAVAILABLE/);
  assert.match(source, /MOENV_API_KEY_UNAVAILABLE/);
  assert.doesNotMatch(source, /console\.(log|error|warn)\(/);
  assert.doesNotMatch(source, /return[^\n]*(?:apiKey|clientSecret|access_token)/i);
});
