import { freshnessFor, normalizeRainfallRows, normalizeWeatherRows, text } from "./normalizers.mjs";

export const WEATHER_CITIES = Object.freeze({
  taipei: { id: "taipei", name: "臺北市", lat: 25.033, lng: 121.5654 },
  newTaipei: { id: "newTaipei", name: "新北市", lat: 25.0169, lng: 121.4628 },
  keelung: { id: "keelung", name: "基隆市", lat: 25.1276, lng: 121.7392 },
  taoyuan: { id: "taoyuan", name: "桃園市", lat: 24.9936, lng: 121.301 },
  hsinchu: { id: "hsinchu", name: "新竹市", lat: 24.8138, lng: 120.9675 },
  hsinchuCounty: { id: "hsinchuCounty", name: "新竹縣", lat: 24.8387, lng: 121.0177 },
  taichung: { id: "taichung", name: "臺中市", lat: 24.1477, lng: 120.6736 },
  changhua: { id: "changhua", name: "彰化縣", lat: 24.0518, lng: 120.5161 },
  nantou: { id: "nantou", name: "南投縣", lat: 23.9609, lng: 120.9719 },
  yunlin: { id: "yunlin", name: "雲林縣", lat: 23.7092, lng: 120.4313 },
  chiayi: { id: "chiayi", name: "嘉義市", lat: 23.4801, lng: 120.4491 },
  chiayiCounty: { id: "chiayiCounty", name: "嘉義縣", lat: 23.4589, lng: 120.2919 },
  tainan: { id: "tainan", name: "臺南市", lat: 22.9999, lng: 120.2269 },
  kaohsiung: { id: "kaohsiung", name: "高雄市", lat: 22.6273, lng: 120.3014 },
  pingtung: { id: "pingtung", name: "屏東縣", lat: 22.5519, lng: 120.5487 },
  yilan: { id: "yilan", name: "宜蘭縣", lat: 24.7021, lng: 121.7378 },
  hualien: { id: "hualien", name: "花蓮縣", lat: 23.9872, lng: 121.6015 },
  taitung: { id: "taitung", name: "臺東縣", lat: 22.7972, lng: 121.0714 },
  penghu: { id: "penghu", name: "澎湖縣", lat: 23.5711, lng: 119.5793 },
  kinmen: { id: "kinmen", name: "金門縣", lat: 24.4493, lng: 118.3767 },
  lienchiang: { id: "lienchiang", name: "連江縣", lat: 26.1605, lng: 119.9517 }
});

export const WEATHER_SOURCE = Object.freeze({
  observation: "https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0001-001?format=JSON",
  rainfall: "https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0002-001?format=JSON",
  typhoon: "https://opendata.cwa.gov.tw/api/v1/rest/datastore/W-C0034-001?format=JSON",
  strongWind: "https://opendata.cwa.gov.tw/api/v1/rest/datastore/W-C0033-006?format=JSON"
});

function readPath(value, path) {
  return path.reduce((current, key) => current && typeof current === "object" ? current[key] : undefined, value);
}

function alertCollection(payload, kind) {
  const records = payload?.records;
  if (!records || typeof records !== "object") return { recognized: false, rows: [] };
  const description = text(records.datasetDescription || records.DatasetDescription, 240);
  const token = kind === "typhoon" ? "颱風" : "強風";
  if (!description.includes(token)) return { recognized: false, rows: [] };
  const candidates = kind === "typhoon"
    ? [
        ["tropicalCyclones", "tropicalCyclone"], ["TropicalCyclones", "TropicalCyclone"],
        ["tropicalCyclone"], ["TropicalCyclone"], ["typhoon"], ["Typhoon"],
        ["location"], ["locations", "location"], ["record"]
      ]
    : [["location"], ["locations", "location"], ["record"], ["warnings", "warning"], ["warning"]];
  for (const path of candidates) {
    const value = readPath(records, path);
    if (Array.isArray(value)) return { recognized: true, rows: value };
    if (value && typeof value === "object") {
      const nested = Object.values(value).find(Array.isArray);
      if (nested) return { recognized: true, rows: nested };
    }
  }
  return { recognized: false, rows: [] };
}

function flattenText(value, depth = 5) {
  if (depth < 0 || value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map(item => flattenText(item, depth - 1)).join(" ");
  if (typeof value === "object") return Object.values(value).map(item => flattenText(item, depth - 1)).join(" ");
  return "";
}

export function normalizeOfficialAlert(payload, kind, now = Date.now()) {
  const collection = alertCollection(payload, kind);
  if (!collection.recognized) return { status: "unknown", source: "CWA", freshness: "unknown", observedAt: "", errorCode: "CWA_ALERT_SCHEMA_UNRECOGNIZED" };
  if (!collection.rows.length) return { status: "none", source: "CWA", freshness: "fresh", observedAt: new Date(now).toISOString(), errorCode: "" };
  const needle = kind === "typhoon" ? /(颱風|tropical cyclone|typhoon)/i : /(強風|陸上強風|strong wind)/i;
  const matching = collection.rows.filter(row => needle.test(flattenText(row)));
  if (!matching.length) return { status: "unknown", source: "CWA", freshness: "unknown", observedAt: "", errorCode: "CWA_ALERT_CONTENT_UNRECOGNIZED" };
  const active = matching.some(row => {
    const start = Date.parse(text(row?.startTime || row?.StartTime || row?.start_time || row?.effectiveTime, 100));
    const end = Date.parse(text(row?.endTime || row?.EndTime || row?.end_time || row?.expiresAt, 100));
    if (Number.isFinite(start) && now < start) return false;
    if (Number.isFinite(end) && now > end) return false;
    return true; // Dataset is the CWA's current alert collection; no time bound means preserve official current-feed semantics.
  });
  const observedAt = text(payload?.records?.sent || payload?.records?.updateTime || payload?.records?.DataTime, 100) || new Date(now).toISOString();
  return { status: active ? "active" : "none", source: "CWA", freshness: "fresh", observedAt, errorCode: "" };
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const rad = Math.PI / 180;
  const dLat = (lat2 - lat1) * rad;
  const dLng = (lng2 - lng1) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2;
  return 6371008.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function unknownWeatherState(cityId = "taipei", fetchedAt = new Date().toISOString(), errorCode = "WEATHER_UNAVAILABLE") {
  const city = WEATHER_CITIES[cityId] || WEATHER_CITIES.taipei;
  return {
    contract: "zhuge-weather-v1",
    city: { id: city.id, name: city.name, lat: city.lat, lng: city.lng },
    condition: "unknown",
    temperatureC: null,
    precipitationMm: null,
    precipitationObservedAt: "",
    precipitationSourceUrl: WEATHER_SOURCE.rainfall,
    strongWind: { status: "unknown", source: "CWA official land strong-wind alert", sourceUrl: WEATHER_SOURCE.strongWind, observedAt: "", freshness: "unknown" },
    typhoonWarning: { status: "unknown", source: "CWA official typhoon warning", sourceUrl: WEATHER_SOURCE.typhoon, observedAt: "", freshness: "unknown" },
    observedAt: "",
    fetchedAt,
    source: "CWA",
    sourceUrl: WEATHER_SOURCE.observation,
    freshness: "unknown",
    errorCode
  };
}

export function normalizeCityWeather({ cityId = "taipei", observationPayload, rainfallPayload, typhoonPayload, strongWindPayload, fetchedAt = new Date().toISOString(), now = Date.parse(fetchedAt) }) {
  const city = WEATHER_CITIES[cityId];
  if (!city) return unknownWeatherState("taipei", fetchedAt, "CITY_NOT_SUPPORTED");
  const normalized = normalizeWeatherRows(observationPayload, fetchedAt);
  if (normalized.malformed) return unknownWeatherState(cityId, fetchedAt, "CWA_WEATHER_MALFORMED");
  const nearest = normalized.markers
    .map(marker => ({ marker, distance: distanceMeters(city.lat, city.lng, marker.lat, marker.lng) }))
    .filter(value => value.distance <= 100_000)
    .sort((left, right) => left.distance - right.distance)[0]?.marker;
  const rainfall = rainfallPayload ? normalizeRainfallRows(rainfallPayload) : { malformed: true, markers: [] };
  const nearestRainfall = rainfall.markers
    .map(marker => ({ marker, distance: distanceMeters(city.lat, city.lng, marker.lat, marker.lng) }))
    .filter(value => value.distance <= 100_000)
    .sort((left, right) => left.distance - right.distance)[0]?.marker;
  const rainfallAge = freshnessFor(nearestRainfall?.observed_at || "", now, 90 * 60 * 1000);
  const age = freshnessFor(nearest?.observed_at || "", now, 90 * 60 * 1000);
  const precipitationMm = rainfallAge.freshness === "fresh" ? nearestRainfall?.precipitation_mm ?? null : null;
  const condition = age.freshness === "fresh"
    ? (precipitationMm !== null && precipitationMm > 0 ? "rainy" : nearest?.condition || "unknown")
    : "unknown";
  const typhoonWarning = normalizeOfficialAlert(typhoonPayload, "typhoon", now);
  const strongWind = normalizeOfficialAlert(strongWindPayload, "strongWind", now);
  return {
    contract: "zhuge-weather-v1",
    city: { id: city.id, name: city.name, lat: city.lat, lng: city.lng },
    condition,
    temperatureC: age.freshness === "fresh" ? nearest?.value ?? null : null,
    precipitationMm,
    precipitationObservedAt: rainfallAge.freshness === "fresh" ? nearestRainfall?.observed_at || "" : "",
    precipitationSourceUrl: WEATHER_SOURCE.rainfall,
    strongWind: { ...strongWind, sourceUrl: WEATHER_SOURCE.strongWind },
    typhoonWarning: { ...typhoonWarning, sourceUrl: WEATHER_SOURCE.typhoon },
    observedAt: nearest?.observed_at || "",
    fetchedAt,
    source: "CWA",
    sourceUrl: WEATHER_SOURCE.observation,
    freshness: age.freshness,
    errorCode: age.freshness === "fresh" && condition !== "unknown" ? "" : age.freshness === "stale" ? "CWA_OBSERVATION_STALE" : "CWA_OBSERVATION_UNVERIFIED"
  };
}
