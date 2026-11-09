/* Zhuge SkyEye location-centric read-only provider adapter.
 *
 * Browser -> Shared Supabase Gateway -> this function -> official/public
 * TDX/CWA/MOENV/Nominatim sources. No Product Data, Storage, service-role key,
 * provider credential, or precise location history crosses this boundary.
 * Precise location exists only for the lifetime of this request/response.
 *
 * Secrets required in the Edge environment (values are never returned):
 *   TDX_CLIENT_ID, TDX_CLIENT_SECRET
 *   CWA_API_KEY
 *   MOENV_API_KEY
 */

import {
  freshnessFor,
  latestObservedAt,
  normalizeAqiRows,
  normalizeCctvRows,
  normalizeEarthquakeRows,
  normalizeWeatherRows,
  text
} from "./normalizers.mjs";

type JsonObject = Record<string, unknown>;
type LayerName = "weather" | "radar" | "earthquake" | "aqi" | "cctv";

const CONTRACT = "zhuge-skyeye-read-v2";
const GEOCODE_CONTRACT = "zhuge-skyeye-geocode-v1";
const DEFAULT_ORIGIN = "https://qqweasdzxc.github.io";
const LAYERS: LayerName[] = ["weather", "radar", "earthquake", "aqi", "cctv"];
const DEFAULT_LAYERS: LayerName[] = ["weather", "radar", "earthquake", "aqi"];
const REQUEST_TIMEOUT_MS = 12000;
const DEFAULT_RADIUS_M = 5000;
const MAX_CCTV_MARKERS = 80;
const TDX_TOKEN_URL = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const TDX_CCTV_ROOT = "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/CCTV/City";
const DEFAULT_TDX_CITY = "Taipei";
const CWA_WEATHER_URL = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0001-001?format=JSON";
const CWA_EARTHQUAKE_URL = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/E-A0015-001?format=JSON";
const MOENV_AQI_URL = "https://data.moenv.gov.tw/api/v2/aqx_p_432";
const CWA_RADAR_BASE = "https://www.cwa.gov.tw/Data/radar/CV1_3600_";
const GEOCODE_URL = "https://nominatim.openstreetmap.org/search";
const GEOCODE_SOURCE = "Nominatim / OpenStreetMap";

class ReadError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function authOrigin(request: Request) {
  const configured = text(Deno.env.get("SKYEYE_ALLOWED_ORIGINS"), 1000)
    .split(",").map(value => value.trim()).filter(Boolean);
  const allowed = new Set([DEFAULT_ORIGIN, ...configured]);
  const origin = text(request.headers.get("origin"), 240);
  if (origin && !allowed.has(origin)) throw new ReadError("ORIGIN_NOT_ALLOWED", "Origin is not allowed.", 403);
  return origin;
}

function headers(origin = "") {
  const result = new Headers({
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  });
  if (origin) {
    result.set("access-control-allow-origin", origin);
    result.set("access-control-allow-headers", "authorization, apikey, x-client-info, content-type");
    result.set("access-control-allow-methods", "POST, OPTIONS");
    result.set("vary", "Origin");
  }
  return result;
}

function json(value: JsonObject, status = 200, origin = "") {
  return new Response(JSON.stringify(value), { status, headers: headers(origin) });
}

async function requireAuth(request: Request) {
  const authorization = text(request.headers.get("authorization"), 4096);
  if (!/^Bearer\s+\S+$/i.test(authorization)) throw new ReadError("AUTH_REQUIRED", "Authenticated Zhuge AI OS session is required.", 401);
  const supabaseUrl = text(Deno.env.get("SUPABASE_URL"), 240).replace(/\/$/, "");
  const anonKey = text(Deno.env.get("SUPABASE_ANON_KEY"), 512);
  if (!supabaseUrl || !anonKey) throw new ReadError("AUTH_VALIDATION_UNAVAILABLE", "Auth validation is not configured.", 503);
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anonKey, authorization } });
  if (!response.ok) throw new ReadError("AUTH_REQUIRED", "Authenticated Zhuge AI OS session is required.", 401);
  const user = await response.json().catch(() => ({})) as JsonObject;
  if (!text(user.id, 120)) throw new ReadError("AUTH_REQUIRED", "Authenticated Zhuge AI OS session is required.", 401);
}

async function fetchJson(url: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const raw = await response.text().catch(() => "");
    let payload: unknown = null;
    try { payload = raw ? JSON.parse(raw) : null; } catch { payload = null; }
    if (!response.ok) throw new ReadError(`PROVIDER_HTTP_${response.status}`, "Provider did not return a usable response.", 502);
    return payload;
  } catch (error) {
    if (error instanceof ReadError) throw error;
    if (error instanceof Error && error.name === "AbortError") throw new ReadError("PROVIDER_TIMEOUT", "Provider request timed out.", 504);
    throw new ReadError("PROVIDER_NETWORK_ERROR", "Provider request failed.", 502);
  } finally {
    clearTimeout(timer);
  }
}

async function head(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { method: "HEAD", signal: controller.signal });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

function spatialStrategy(key: LayerName) {
  return ({
    weather: "location_observation",
    radar: "regional_overlay",
    earthquake: "regional_event_distance",
    aqi: "nearest_station",
    cctv: "nearby_point"
  } as Record<LayerName, string>)[key];
}

function stateForCode(code: string, available = false, stale = false) {
  const normalized = text(code, 100).toUpperCase();
  if (available) return stale ? "stale" : "available";
  if (normalized === "NOT_REQUESTED") return "not_requested";
  if (/(_API_KEY|_CREDENTIALS|_CONFIGURATION)_UNAVAILABLE$/.test(normalized)) return "provider_not_configured";
  if (/PROVIDER_(TIMEOUT|NETWORK|HTTP)|_UNAVAILABLE$/.test(normalized)) return "provider_unavailable";
  if (/^NO_(COORDINATED|NEARBY|LOCATION)/.test(normalized)) return "empty";
  if (/MALFORMED|INVALID|FAILED|ERROR/.test(normalized)) return "error";
  return "empty";
}

function emptyLayer(key: LayerName, provider: string, source: string, sourceUrl: string, code: string, location: JsonObject | null = null) {
  return {
    key,
    available: false,
    state: stateForCode(code),
    spatial_strategy: spatialStrategy(key),
    center: location?.center || null,
    radius_m: location?.radius_m || null,
    count: 0,
    provider,
    source,
    source_url: sourceUrl,
    retrieved_at: new Date().toISOString(),
    as_of: "",
    freshness: "unavailable",
    stale: false,
    evidence_status: "INSUFFICIENT_EVIDENCE",
    data_quality: "unavailable",
    error_code: code,
    markers: []
  };
}

function number(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function clamp(value: unknown, minimum: number, maximum: number, fallback: number) {
  const parsed = number(value);
  return parsed === null ? fallback : Math.min(maximum, Math.max(minimum, parsed));
}

function parseLocation(input: JsonObject) {
  const raw = (input.location_context || input.location || {}) as JsonObject;
  const centerRaw = (raw.center && typeof raw.center === "object" ? raw.center : raw) as JsonObject;
  const providerContext = raw.provider_context && typeof raw.provider_context === "object"
    ? raw.provider_context as JsonObject
    : {};
  const lat = number(centerRaw.lat ?? centerRaw.latitude ?? input.center_lat);
  const lng = number(centerRaw.lng ?? centerRaw.lon ?? centerRaw.longitude ?? input.center_lng);
  if (lat === null || lng === null || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return {
    label: text(raw.label || input.location_label, 180),
    source: text(raw.source || input.location_source, 80) || "browser_or_search",
    center: { lat, lng },
    accuracy_m: clamp(raw.accuracy_m ?? raw.accuracyM, 0, 100000, 0),
    radius_m: clamp(raw.radius_m ?? raw.radiusM ?? input.radius_m, 250, 50000, DEFAULT_RADIUS_M),
    bbox: Array.isArray(raw.bbox) ? raw.bbox.slice(0, 4) : null,
    provider_context: {
      tdx_city: text(raw.tdx_city || providerContext.tdx_city, 80)
    }
  };
}

function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number) {
  const earth = 6371008.8;
  const rad = Math.PI / 180;
  const dLat = (bLat - aLat) * rad;
  const dLng = (bLng - aLng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(aLat * rad) * Math.cos(bLat * rad) * Math.sin(dLng / 2) ** 2;
  return Math.round(earth * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)));
}

function withSpatialEvidence(key: LayerName, markers: JsonObject[], location: JsonObject | null) {
  if (!location?.center) return markers;
  const center = location.center as JsonObject;
  const located = markers.map(marker => ({
    ...marker,
    distance_m: distanceMeters(Number(center.lat), Number(center.lng), Number(marker.lat), Number(marker.lng))
  })).sort((left, right) => Number(left.distance_m) - Number(right.distance_m));
  const radius = Number(location.radius_m) || DEFAULT_RADIUS_M;
  if (key === "cctv") return located.filter(marker => Number(marker.distance_m) <= radius).slice(0, MAX_CCTV_MARKERS);
  if (key === "weather" || key === "aqi") return located.filter(marker => Number(marker.distance_m) <= Math.max(radius * 10, 50000)).slice(0, 12);
  if (key === "earthquake") return located.slice(0, 20);
  return located;
}

function layerFromMarkers(key: LayerName, provider: string, source: string, sourceUrl: string, markers: JsonObject[], now: number, fallbackAsOf: string, location: JsonObject | null, extra: JsonObject = {}) {
  const retrievedAt = new Date(now).toISOString();
  const contextualized = withSpatialEvidence(key, markers, location);
  const asOf = latestObservedAt(contextualized, fallbackAsOf);
  const freshness = freshnessFor(asOf, now);
  const available = contextualized.length > 0 || Boolean(extra.overlay);
  const dataQuality = !available
    ? "insufficient"
    : freshness.freshness === "unknown"
      ? "unverified"
      : freshness.stale
        ? "stale"
        : key === "cctv"
          ? "metadata_only"
          : "usable";
  const code = available ? "" : location ? `NO_NEARBY_${key.toUpperCase()}_ROWS` : `NO_COORDINATED_${key.toUpperCase()}_ROWS`;
  return {
    key,
    available,
    state: stateForCode(code, available, freshness.stale),
    spatial_strategy: spatialStrategy(key),
    center: location?.center || null,
    radius_m: location?.radius_m || null,
    count: contextualized.length,
    provider,
    source,
    source_url: sourceUrl,
    retrieved_at: retrievedAt,
    as_of: asOf,
    freshness: freshness.freshness,
    stale: freshness.stale,
    evidence_status: available ? "AVAILABLE" : "INSUFFICIENT_EVIDENCE",
    data_quality: dataQuality,
    error_code: code,
    markers: contextualized,
    ...extra
  };
}

async function loadWeather(now: number, location: JsonObject | null) {
  const source = "CWA weather station observations";
  const apiKey = text(Deno.env.get("CWA_API_KEY"), 400);
  if (!apiKey) return emptyLayer("weather", "CWA", source, CWA_WEATHER_URL, "CWA_API_KEY_UNAVAILABLE", location);
  try {
    const payload = await fetchJson(CWA_WEATHER_URL, { headers: { accept: "application/json", Authorization: apiKey } });
    const normalized = normalizeWeatherRows(payload, new Date(now).toISOString());
    if (normalized.malformed) return emptyLayer("weather", "CWA", source, CWA_WEATHER_URL, "PROVIDER_MALFORMED_RESPONSE", location);
    return layerFromMarkers("weather", "CWA", source, CWA_WEATHER_URL, normalized.markers, now, "", location);
  } catch (error) {
    return emptyLayer("weather", "CWA", source, CWA_WEATHER_URL, error instanceof ReadError ? error.code : "CWA_WEATHER_UNAVAILABLE", location);
  }
}

async function loadEarthquake(now: number, location: JsonObject | null) {
  const source = "CWA earthquake reports";
  const apiKey = text(Deno.env.get("CWA_API_KEY"), 400);
  if (!apiKey) return emptyLayer("earthquake", "CWA", source, CWA_EARTHQUAKE_URL, "CWA_API_KEY_UNAVAILABLE", location);
  try {
    const payload = await fetchJson(CWA_EARTHQUAKE_URL, { headers: { accept: "application/json", Authorization: apiKey } });
    const normalized = normalizeEarthquakeRows(payload, new Date(now).toISOString());
    if (normalized.malformed) return emptyLayer("earthquake", "CWA", source, CWA_EARTHQUAKE_URL, "PROVIDER_MALFORMED_RESPONSE", location);
    return layerFromMarkers("earthquake", "CWA", source, CWA_EARTHQUAKE_URL, normalized.markers, now, "", location);
  } catch (error) {
    return emptyLayer("earthquake", "CWA", source, CWA_EARTHQUAKE_URL, error instanceof ReadError ? error.code : "CWA_EARTHQUAKE_UNAVAILABLE", location);
  }
}

async function loadAqi(now: number, location: JsonObject | null) {
  const source = "MOENV AQI monitoring stations";
  const apiKey = text(Deno.env.get("MOENV_API_KEY"), 400);
  if (!apiKey) return emptyLayer("aqi", "MOENV", source, MOENV_AQI_URL, "MOENV_API_KEY_UNAVAILABLE", location);
  try {
    const url = new URL(MOENV_AQI_URL);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1000");
    url.searchParams.set("api_key", apiKey);
    const payload = await fetchJson(url.toString(), { headers: { accept: "application/json" } });
    const normalized = normalizeAqiRows(payload, new Date(now).toISOString());
    if (normalized.malformed) return emptyLayer("aqi", "MOENV", source, MOENV_AQI_URL, "PROVIDER_MALFORMED_RESPONSE", location);
    return layerFromMarkers("aqi", "MOENV", source, MOENV_AQI_URL, normalized.markers, now, "", location);
  } catch (error) {
    return emptyLayer("aqi", "MOENV", source, MOENV_AQI_URL, error instanceof ReadError ? error.code : "MOENV_AQI_UNAVAILABLE", location);
  }
}

function radarStamp(date: Date) {
  const rounded = new Date(date.getTime() - (date.getMinutes() % 10) * 60_000 - date.getSeconds() * 1000 - date.getMilliseconds());
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${rounded.getUTCFullYear()}${pad(rounded.getUTCMonth() + 1)}${pad(rounded.getUTCDate())}${pad(rounded.getUTCHours())}${pad(rounded.getUTCMinutes())}`;
}

async function loadRadar(now: number, location: JsonObject | null) {
  const source = "CWA official radar image";
  const retrievedAt = new Date(now).toISOString();
  for (let offset = 0; offset <= 6; offset += 1) {
    const candidate = new Date(now - offset * 10 * 60 * 1000);
    const imageUrl = `${CWA_RADAR_BASE}${radarStamp(candidate)}.png`;
    if (!await head(imageUrl)) continue;
    const asOf = candidate.toISOString();
    const freshness = freshnessFor(asOf, now);
    return {
      key: "radar",
      available: true,
      state: stateForCode("", true, freshness.stale),
      spatial_strategy: spatialStrategy("radar"),
      center: location?.center || null,
      radius_m: location?.radius_m || null,
      count: 1,
      provider: "CWA",
      source,
      source_url: "https://www.cwa.gov.tw/V8/C/W/OBS_Radar.html",
      retrieved_at: retrievedAt,
      as_of: asOf,
      freshness: freshness.freshness,
      stale: freshness.stale,
      evidence_status: "AVAILABLE",
      data_quality: freshness.stale ? "stale" : "usable",
      error_code: "",
      markers: [],
      overlay: { image_url: imageUrl, bounds: [[21.5, 119.2], [25.5, 122.1]] }
    };
  }
  return emptyLayer("radar", "CWA", source, "https://www.cwa.gov.tw/V8/C/W/OBS_Radar.html", "CWA_RADAR_UNAVAILABLE", location);
}

async function tdxToken() {
  const clientId = text(Deno.env.get("TDX_CLIENT_ID"), 400);
  const clientSecret = text(Deno.env.get("TDX_CLIENT_SECRET"), 400);
  if (!clientId || !clientSecret) throw new ReadError("TDX_CREDENTIALS_UNAVAILABLE", "TDX credentials are not configured.", 503);
  const body = new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret });
  const payload = await fetchJson(TDX_TOKEN_URL, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" }, body });
  const token = text((payload as JsonObject)?.access_token, 4096);
  if (!token) throw new ReadError("TDX_TOKEN_UNAVAILABLE", "TDX access token was not returned.", 502);
  return token;
}

function tdxCctvUrl(location: JsonObject | null = null) {
  const providerContext = location?.provider_context && typeof location.provider_context === "object"
    ? location.provider_context as JsonObject
    : {};
  const city = text(providerContext.tdx_city, 80) || text(Deno.env.get("TDX_CCTV_CITY"), 80) || DEFAULT_TDX_CITY;
  return `${TDX_CCTV_ROOT}/${encodeURIComponent(city)}?$top=1000&$format=JSON`;
}

async function loadCctv(now: number, location: JsonObject | null) {
  const source = "TDX CCTV nearby metadata";
  const sourceUrl = tdxCctvUrl(location).replace(/\?.*$/, "");
  if (!location?.center) return emptyLayer("cctv", "TDX", source, sourceUrl, "LOCATION_REQUIRED", location);
  try {
    const token = await tdxToken();
    const url = tdxCctvUrl(location);
    const payload = await fetchJson(url, { headers: { accept: "application/json", authorization: `Bearer ${token}` } });
    const normalized = normalizeCctvRows(payload, new Date(now).toISOString());
    if (normalized.malformed) return emptyLayer("cctv", "TDX", source, sourceUrl, "PROVIDER_MALFORMED_RESPONSE", location);
    return layerFromMarkers("cctv", "TDX", source, sourceUrl, normalized.markers, now, new Date(now).toISOString(), location);
  } catch (error) {
    return emptyLayer("cctv", "TDX", source, sourceUrl, error instanceof ReadError ? error.code : "TDX_CCTV_UNAVAILABLE", location);
  }
}

function requestedLayers(input: JsonObject) {
  const values = Array.isArray(input.layers) ? input.layers : DEFAULT_LAYERS;
  return Array.from(new Set(values.map(value => text(value, 30).toLowerCase()).filter((value): value is LayerName => LAYERS.includes(value as LayerName)))) as LayerName[];
}

function tdxCityFromAddress(address: JsonObject = {}) {
  const aliases: Record<string, string> = {
    "臺北市": "Taipei", "台北市": "Taipei", Taipei: "Taipei",
    "新北市": "NewTaipei", "New Taipei City": "NewTaipei",
    "桃園市": "Taoyuan", Taoyuan: "Taoyuan",
    "臺中市": "Taichung", "台中市": "Taichung", Taichung: "Taichung",
    "臺南市": "Tainan", "台南市": "Tainan", Tainan: "Tainan",
    "高雄市": "Kaohsiung", Kaohsiung: "Kaohsiung",
    "基隆市": "Keelung", Keelung: "Keelung",
    "新竹市": "Hsinchu", Hsinchu: "Hsinchu",
    "新竹縣": "HsinchuCounty", "苗栗縣": "Miaoli", "彰化縣": "Changhua",
    "南投縣": "Nantou", "雲林縣": "Yunlin", "嘉義市": "Chiayi", "嘉義縣": "ChiayiCounty",
    "屏東縣": "Pingtung", "宜蘭縣": "Yilan", "花蓮縣": "Hualien", "臺東縣": "Taitung", "台東縣": "Taitung",
    "澎湖縣": "Penghu", "金門縣": "Kinmen", "連江縣": "Lienchiang"
  };
  for (const key of ["city", "town", "county", "state", "municipality"]) {
    const value = text(address[key], 80);
    if (aliases[value]) return aliases[value];
  }
  return "";
}

function geocodeRows(payload: unknown, retrievedAt: string) {
  if (!Array.isArray(payload)) throw new ReadError("PROVIDER_MALFORMED_RESPONSE", "Geocoder did not return a list.", 502);
  return payload.map((row, index) => {
    const item = row && typeof row === "object" ? row as JsonObject : {};
    const address = item.address && typeof item.address === "object" ? item.address as JsonObject : {};
    const lat = number(item.lat);
    const lng = number(item.lon);
    if (lat === null || lng === null) return null;
    const bounds = Array.isArray(item.boundingbox)
      ? item.boundingbox.map(value => number(value)).filter(value => value !== null).map(value => Number(value))
      : null;
    return {
      id: `geocode-${index + 1}`,
      label: text(item.display_name || item.name || `搜尋結果 ${index + 1}`, 240),
      center: { lat, lng },
      bbox: bounds && bounds.length === 4 ? [bounds[0], bounds[2], bounds[1], bounds[3]] : null,
      provider_context: { tdx_city: tdxCityFromAddress(address) },
      source: GEOCODE_SOURCE,
      source_url: GEOCODE_URL,
      retrieved_at: retrievedAt,
      freshness: "fresh"
    };
  }).filter(Boolean);
}

async function geocode(query: string, now: number) {
  const value = text(query, 180);
  if (!value) throw new ReadError("GEOCODE_QUERY_REQUIRED", "搜尋地點或地址後再試。", 400);
  const url = new URL(GEOCODE_URL);
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "5");
  url.searchParams.set("countrycodes", "tw");
  url.searchParams.set("q", value);
  const payload = await fetchJson(url.toString(), {
    headers: { accept: "application/json", "user-agent": "Zhuge AI OS SkyEye/2.0 (location search)" }
  });
  const results = geocodeRows(payload, new Date(now).toISOString());
  return {
    contract: GEOCODE_CONTRACT,
    read_only: true,
    query: value,
    retrieved_at: new Date(now).toISOString(),
    results,
    state: results.length ? "available" : "empty",
    error_code: results.length ? "" : "GEOCODE_NO_RESULT",
    product_data_mutation: false,
    stream_subscriptions: 0,
    trading_operations: 0
  };
}

Deno.serve(async request => {
  let origin = "";
  try {
    origin = authOrigin(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(origin) });
    if (request.method !== "POST") throw new ReadError("METHOD_NOT_ALLOWED", "POST is required.", 405);
    await requireAuth(request);
    const input = await request.json().catch(() => ({})) as JsonObject;
    const now = Date.now();
    if (text(input.operation || input.action, 40).toLowerCase() === "geocode") {
      return json(await geocode(text(input.query, 180), now), 200, origin);
    }
    const layers = requestedLayers(input);
    const includeCctv = input.include_cctv === true || input.includeCctv === true;
    if (includeCctv && !layers.includes("cctv")) layers.push("cctv");
    const location = parseLocation(input);
    const values: Record<LayerName, JsonObject> = {
      weather: emptyLayer("weather", "CWA", "CWA weather station observations", CWA_WEATHER_URL, "NOT_REQUESTED", location),
      radar: emptyLayer("radar", "CWA", "CWA official radar image", "https://www.cwa.gov.tw/V8/C/W/OBS_Radar.html", "NOT_REQUESTED", location),
      earthquake: emptyLayer("earthquake", "CWA", "CWA earthquake reports", CWA_EARTHQUAKE_URL, "NOT_REQUESTED", location),
      aqi: emptyLayer("aqi", "MOENV", "MOENV AQI monitoring stations", MOENV_AQI_URL, "NOT_REQUESTED", location),
      cctv: emptyLayer("cctv", "TDX", "TDX CCTV nearby metadata", tdxCctvUrl(location).replace(/\?.*$/, ""), includeCctv && !location ? "LOCATION_REQUIRED" : "NOT_REQUESTED", location)
    };
    const loaders: Partial<Record<LayerName, Promise<JsonObject>>> = {
      weather: layers.includes("weather") ? loadWeather(now, location) : undefined,
      radar: layers.includes("radar") ? loadRadar(now, location) : undefined,
      earthquake: layers.includes("earthquake") ? loadEarthquake(now, location) : undefined,
      aqi: layers.includes("aqi") ? loadAqi(now, location) : undefined,
      cctv: includeCctv && layers.includes("cctv") ? loadCctv(now, location) : undefined
    };
    await Promise.all(LAYERS.map(async key => { if (loaders[key]) values[key] = await loaders[key]!; }));
    const loaded = LAYERS.filter(key => values[key].available === true);
    return json({
      contract: CONTRACT,
      read_only: true,
      generated_at: new Date(now).toISOString(),
      location_context: location,
      request_id: text(input.request_id || input.requestId, 120),
      requested_layers: layers,
      layers: values,
      summary: {
        loaded_layers: loaded,
        loaded_evidence_count: loaded.reduce((count, key) => count + (Array.isArray(values[key].markers) ? values[key].markers.length : 0) + (values[key].overlay ? 1 : 0), 0),
        cctv_requested: includeCctv,
        location_state: location ? "available" : "not_requested"
      },
      provider_trace: LAYERS.reduce((trace, key) => {
        trace[key] = { provider: values[key].provider, state: values[key].state, available: values[key].available, freshness: values[key].freshness, spatial_strategy: values[key].spatial_strategy };
        return trace;
      }, {} as JsonObject),
      product_data_mutation: false,
      stream_subscriptions: 0,
      trading_operations: 0
    }, 200, origin);
  } catch (error) {
    if (error instanceof ReadError) return json({ code: error.code, message: error.message }, error.status, origin);
    return json({ code: "SKYEYE_READ_FAILED", message: "SkyEye read adapter failed." }, 500, origin);
  }
});
