const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../supabase/functions/zhuge-skyeye-read/weather-state.mjs");
const NOW = Date.parse("2026-10-19T08:05:00.000Z");
const observed = (condition, precipitation = "0.0") => ({ records: { Station: [{
  StationId: "466920", StationName: "臺北", GeoInfo: { Coordinates: ["121.5654", "25.033"] },
  ObsTime: { DateTime: "2026-10-19T08:00:00.000Z" },
  WeatherElement: { Weather: condition, Precipitation: precipitation, AirTemperature: "27.2" }
}] } });
const rainfall = (precipitation, dateTime = "2026-10-19T08:00:00.000Z") => ({ records: { Station: [{
  StationId: "466920", StationName: "臺北雨量站", GeoInfo: { Coordinates: ["121.5654", "25.033"] },
  RainfallElement: { Past10Min: { Precipitation: precipitation, DateTime: dateTime } }
}] } });
const alert = (datasetDescription, rows) => ({ records: { datasetDescription, TropicalCyclone: rows, location: rows } });

test("official CWA observations map sunny, cloudy and rain without inferring from temperature", async () => {
  const { normalizeCityWeather } = await load();
  const emptyAlert = alert("颱風警報", []);
  const noWind = alert("陸上強風特報", []);
  const cases = [
    ["晴", "0.0", "sunny", 0],
    ["陰", "0.0", "cloudy", 0],
    ["陣雨", "1.5", "rainy", 1.5],
  ];
  for (const [weather, rain, expected, precipitation] of cases) {
    const result = normalizeCityWeather({ cityId: "taipei", observationPayload: observed(weather, rain), rainfallPayload: rainfall(rain), typhoonPayload: emptyAlert, strongWindPayload: noWind, fetchedAt: new Date(NOW).toISOString(), now: NOW });
    assert.equal(result.condition, expected);
    assert.equal(result.precipitationMm, precipitation);
    assert.equal(result.temperatureC, 27.2);
    assert.equal(result.freshness, "fresh");
    assert.equal(result.source, "CWA");
    assert.equal(result.precipitationObservedAt, "2026-10-19T08:00:00.000Z");
    assert.match(result.precipitationSourceUrl, /O-A0002-001/);
  }
  const temperatureOnly = observed("", "");
  const unknown = normalizeCityWeather({ cityId: "taipei", observationPayload: temperatureOnly, rainfallPayload: rainfall("0"), typhoonPayload: emptyAlert, strongWindPayload: noWind, fetchedAt: new Date(NOW).toISOString(), now: NOW });
  assert.equal(unknown.condition, "unknown");
  assert.equal(unknown.errorCode, "CWA_OBSERVATION_UNVERIFIED");
});

test("only the official current CWA warning datasets can mark typhoon or strong wind active", async () => {
  const { normalizeOfficialAlert } = await load();
  const current = { records: { datasetDescription: "颱風警報", TropicalCyclone: [{ phenomenon: "颱風警報發布中", startTime: "2026-10-19T07:00:00.000Z", endTime: "2026-10-19T10:00:00.000Z" }] } };
  const activeWind = { records: { datasetDescription: "天氣特報-陸上強風特報", location: [{ hazard: "陸上強風特報" }] } };
  assert.equal(normalizeOfficialAlert(current, "typhoon", NOW).status, "active");
  assert.equal(normalizeOfficialAlert(activeWind, "strongWind", NOW).status, "active");
  assert.equal(normalizeOfficialAlert({ records: { datasetDescription: "颱風警報", TropicalCyclone: [] } }, "typhoon", NOW).status, "none");
  assert.equal(normalizeOfficialAlert({ records: { datasetDescription: "風速觀測", location: [{ text: "颱風" }] } }, "typhoon", NOW).status, "unknown");
  assert.equal(normalizeOfficialAlert({ records: { datasetDescription: "颱風警報", other: [] } }, "typhoon", NOW).status, "unknown");
});

test("city contract is a fixed manual Taiwan city list with Taipei default and no GPS input", async () => {
  const { WEATHER_CITIES, unknownWeatherState } = await load();
  assert.equal(WEATHER_CITIES.taipei.name, "臺北市");
  assert.ok(Object.keys(WEATHER_CITIES).length >= 20);
  assert.equal(unknownWeatherState("taipei", new Date(NOW).toISOString()).city.id, "taipei");
  assert.equal(unknownWeatherState("not-allowed", new Date(NOW).toISOString()).city.id, "taipei");
});

test("stale or malformed observations fail closed and never preserve current-looking weather", async () => {
  const { normalizeCityWeather } = await load();
  const stale = normalizeCityWeather({ cityId: "taipei", observationPayload: { records: { Station: [{
    StationName: "臺北", GeoInfo: { Coordinates: [121.5654, 25.033] }, ObsTime: { DateTime: "2026-10-19T05:00:00.000Z" },
    WeatherElement: { Weather: "晴", AirTemperature: "30", Precipitation: "0" }
  }] } }, rainfallPayload: rainfall("2.0", "2026-10-19T05:00:00.000Z"), typhoonPayload: null, strongWindPayload: null, fetchedAt: new Date(NOW).toISOString(), now: NOW });
  assert.equal(stale.freshness, "stale");
  assert.equal(stale.condition, "unknown");
  assert.equal(stale.temperatureC, null);
  assert.equal(stale.typhoonWarning.status, "unknown");
  assert.equal(stale.precipitationMm, null);
  const malformed = normalizeCityWeather({ cityId: "taipei", observationPayload: { records: "bad" }, fetchedAt: new Date(NOW).toISOString(), now: NOW });
  assert.equal(malformed.condition, "unknown");
  assert.equal(malformed.errorCode, "CWA_WEATHER_MALFORMED");
});

test("current rainfall is independent evidence and stale rain is not presented as current", async () => {
  const { normalizeCityWeather } = await load();
  const value = normalizeCityWeather({
    cityId: "taipei", observationPayload: observed("晴", ""), rainfallPayload: rainfall("1.2"),
    typhoonPayload: null, strongWindPayload: null, fetchedAt: new Date(NOW).toISOString(), now: NOW,
  });
  assert.equal(value.precipitationMm, 1.2);
  assert.equal(value.condition, "rainy");
  assert.equal(value.precipitationObservedAt, "2026-10-19T08:00:00.000Z");
});
