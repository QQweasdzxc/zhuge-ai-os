/* Zhuge SkyEye read-only provider adapter.
 *
 * Browser -> Shared Supabase Gateway -> this function -> official/public
 * TDX/CWA/MOENV sources. No Product Data, Storage, service-role key, or
 * provider credential crosses the function boundary.
 *
 * Secrets required in the Edge environment (values are never returned):
 *   TDX_CLIENT_ID, TDX_CLIENT_SECRET
 *   CWA_API_KEY
 *   MOENV_API_KEY
 *
 * CCTV is intentionally opt-in. The initial map request never calls TDX; the
 * client must explicitly request the cctv layer first.
 */

type JsonObject = Record<string, unknown>;
type LayerName = "weather" | "radar" | "earthquake" | "aqi" | "cctv";

const CONTRACT = "zhuge-skyeye-read-v1";
const DEFAULT_ORIGIN = "https://qqweasdzxc.github.io";
const LAYERS: LayerName[] = ["weather", "radar", "earthquake", "aqi", "cctv"];
const DEFAULT_LAYERS: LayerName[] = ["weather", "radar", "earthquake", "aqi"];
const REQUEST_TIMEOUT_MS = 12000;
const FRESH_MS = 30 * 60 * 1000;
const TDX_TOKEN_URL = "https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token";
const TDX_CCTV_URL = "https://tdx.transportdata.tw/api/basic/v2/Road/Traffic/CCTV/City/Taipei?$top=200&$format=JSON";
const CWA_WEATHER_URL = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/O-A0001-001?format=JSON";
const CWA_EARTHQUAKE_URL = "https://opendata.cwa.gov.tw/api/v1/rest/datastore/E-A0015-001?format=JSON";
const MOENV_AQI_URL = "https://data.moenv.gov.tw/api/v2/aqx_p_432";
const CWA_RADAR_BASE = "https://www.cwa.gov.tw/Data/radar/CV1_3600_";

class ReadError extends Error {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 502) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

function text(value: unknown, max = 240) {
  return String(value ?? "").trim().slice(0, max);
}

function number(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(String(value).replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function firstNumber(value: JsonObject, keys: string[]) {
  for (const key of keys) {
    const result = number(value[key]);
    if (result !== null) return result;
  }
  return null;
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
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: anonKey, authorization }
  });
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

function freshness(asOf: string, now: number) {
  const timestamp = Date.parse(asOf);
  if (!Number.isFinite(timestamp)) return "unknown";
  const age = now - timestamp;
  if (age < -5 * 60 * 1000) return "unknown";
  return age <= FRESH_MS ? "fresh" : "stale";
}

function emptyLayer(key: LayerName, provider: string, source: string, sourceUrl: string, code: string) {
  return {
    key,
    available: false,
    provider,
    source,
    source_url: sourceUrl,
    retrieved_at: new Date().toISOString(),
    as_of: "",
    freshness: "unavailable",
    stale: false,
    evidence_status: "INSUFFICIENT_EVIDENCE",
    error_code: code,
    markers: []
  };
}

function coordinate(row: JsonObject) {
  const geo = (row.GeoInfo || row.Position || row.position || {}) as JsonObject;
  const coords = Array.isArray(geo.Coordinates) ? geo.Coordinates[0] as JsonObject : (geo.Coordinates || {}) as JsonObject;
  return {
    lat: firstNumber(row, ["lat", "latitude", "StationLatitude", "Latitude", "PositionLat", "EpicenterLatitude"]) ?? firstNumber(geo, ["lat", "latitude", "StationLatitude", "Latitude", "PositionLat", "EpicenterLatitude"]) ?? firstNumber(coords, ["PositionLat", "Latitude", "lat", "latitude", "EpicenterLatitude"]),
    lng: firstNumber(row, ["lng", "lon", "longitude", "StationLongitude", "Longitude", "PositionLon", "EpicenterLongitude"]) ?? firstNumber(geo, ["lng", "lon", "longitude", "StationLongitude", "Longitude", "PositionLon", "EpicenterLongitude"]) ?? firstNumber(coords, ["PositionLon", "Longitude", "lng", "lon", "longitude", "EpicenterLongitude"])
  };
}

function arrayFrom(payload: unknown, keys: string[]) {
  const root = payload && typeof payload === "object" ? payload as JsonObject : {};
  const records = root.records && typeof root.records === "object" ? root.records as JsonObject : root;
  for (const key of keys) {
    if (Array.isArray(records[key])) return records[key] as JsonObject[];
  }
  return Array.isArray(records) ? records as unknown as JsonObject[] : [];
}

async function loadWeather(now: number) {
  const source = "CWA weather station observations";
  const apiKey = text(Deno.env.get("CWA_API_KEY"), 400);
  if (!apiKey) return emptyLayer("weather", "CWA", source, CWA_WEATHER_URL, "CWA_API_KEY_UNAVAILABLE");
  try {
    const payload = await fetchJson(CWA_WEATHER_URL, { headers: { accept: "application/json", Authorization: apiKey } });
    const rows = arrayFrom(payload, ["Station", "station", "location", "Location"]);
    const retrievedAt = new Date(now).toISOString();
    const markers = rows.map((row, index) => {
      const point = coordinate(row);
      const station = text(row.StationName || row.LocationName || row.name || `weather-${index + 1}`, 120);
      const obs = (row.WeatherElement || row.weatherElement || row.Observation || {}) as JsonObject;
      const temperature = firstNumber(row, ["Temperature", "temperature", "AirTemperature"]) ?? firstNumber(obs, ["Temperature", "temperature", "AirTemperature"]);
      return point.lat === null || point.lng === null ? null : {
        id: `cwa-weather-${text(row.StationId || row.stationId || index, 60)}`,
        kind: "weather",
        label: station,
        detail: temperature === null ? "CWA 氣象站資料" : `氣溫 ${temperature}°C`,
        lat: point.lat,
        lng: point.lng,
        observed_at: text(row.ObsTime || row.observedAt || retrievedAt, 80),
        value: temperature,
        unit: temperature === null ? "" : "°C",
        source: "CWA"
      };
    }).filter(Boolean);
    return {
      key: "weather",
      available: markers.length > 0,
      provider: "CWA",
      source,
      source_url: CWA_WEATHER_URL,
      retrieved_at: retrievedAt,
      as_of: retrievedAt,
      freshness: freshness(retrievedAt, now),
      stale: false,
      evidence_status: markers.length > 0 ? "AVAILABLE" : "INSUFFICIENT_EVIDENCE",
      error_code: markers.length > 0 ? "" : "NO_COORDINATED_WEATHER_ROWS",
      markers
    };
  } catch (error) {
    return emptyLayer("weather", "CWA", source, CWA_WEATHER_URL, error instanceof ReadError ? error.code : "CWA_WEATHER_UNAVAILABLE");
  }
}

async function loadEarthquake(now: number) {
  const source = "CWA earthquake reports";
  const apiKey = text(Deno.env.get("CWA_API_KEY"), 400);
  if (!apiKey) return emptyLayer("earthquake", "CWA", source, CWA_EARTHQUAKE_URL, "CWA_API_KEY_UNAVAILABLE");
  try {
    const payload = await fetchJson(CWA_EARTHQUAKE_URL, { headers: { accept: "application/json", Authorization: apiKey } });
    const rows = arrayFrom(payload, ["Earthquake", "earthquake", "Earthquakes"]);
    const retrievedAt = new Date(now).toISOString();
    const markers = rows.map((row, index) => {
      const info = (row.EarthquakeInfo || row.earthquakeInfo || row) as JsonObject;
      const epicenter = (info.Epicenter || info.epicenter || {}) as JsonObject;
      const point = coordinate(epicenter);
      const magnitudeInfo = (info.EarthquakeMagnitude || info.magnitude || {}) as JsonObject;
      const magnitude = firstNumber(magnitudeInfo, ["MagnitudeValue", "value", "magnitude"]);
      const eventAt = text(info.OriginTime || info.originTime || row.OriginTime || retrievedAt, 80);
      const title = text(epicenter.Location || epicenter.location || row.ReportContent || `地震 ${index + 1}`, 160);
      return point.lat === null || point.lng === null ? null : {
        id: `cwa-quake-${text(row.EarthquakeNo || row.id || index, 60)}`,
        kind: "earthquake",
        label: title,
        detail: magnitude === null ? "CWA 地震資料" : `規模 M${magnitude}`,
        lat: point.lat,
        lng: point.lng,
        observed_at: eventAt,
        magnitude,
        depth_km: firstNumber(info, ["FocalDepth", "depth", "Depth"]),
        source: "CWA"
      };
    }).filter(Boolean);
    return {
      key: "earthquake",
      available: markers.length > 0,
      provider: "CWA",
      source,
      source_url: CWA_EARTHQUAKE_URL,
      retrieved_at: retrievedAt,
      as_of: markers[0]?.observed_at || retrievedAt,
      freshness: freshness(markers[0]?.observed_at || retrievedAt, now),
      stale: false,
      evidence_status: markers.length > 0 ? "AVAILABLE" : "INSUFFICIENT_EVIDENCE",
      error_code: markers.length > 0 ? "" : "NO_COORDINATED_EARTHQUAKE_ROWS",
      markers
    };
  } catch (error) {
    return emptyLayer("earthquake", "CWA", source, CWA_EARTHQUAKE_URL, error instanceof ReadError ? error.code : "CWA_EARTHQUAKE_UNAVAILABLE");
  }
}

async function loadAqi(now: number) {
  const source = "MOENV AQI monitoring stations";
  const apiKey = text(Deno.env.get("MOENV_API_KEY"), 400);
  if (!apiKey) return emptyLayer("aqi", "MOENV", source, MOENV_AQI_URL, "MOENV_API_KEY_UNAVAILABLE");
  try {
    const url = new URL(MOENV_AQI_URL);
    url.searchParams.set("format", "json");
    url.searchParams.set("limit", "1000");
    url.searchParams.set("api_key", apiKey);
    const payload = await fetchJson(url.toString(), { headers: { accept: "application/json" } });
    const rows = arrayFrom(payload, ["records", "Records"]);
    const retrievedAt = new Date(now).toISOString();
    const markers = rows.map((row, index) => {
      const point = coordinate(row);
      const station = text(row.sitename || row.SiteName || row.site_name || `AQI-${index + 1}`, 120);
      const aqi = firstNumber(row, ["aqi", "AQI"]);
      return point.lat === null || point.lng === null ? null : {
        id: `moenv-aqi-${text(row.siteid || row.SiteId || index, 60)}`,
        kind: "aqi",
        label: station,
        detail: aqi === null ? "MOENV 空氣品質資料" : `AQI ${aqi}`,
        lat: point.lat,
        lng: point.lng,
        observed_at: text(row.publishtime || row.PublishTime || retrievedAt, 80),
        value: aqi,
        unit: aqi === null ? "" : "AQI",
        status: text(row.status || row.Status, 60),
        source: "MOENV"
      };
    }).filter(Boolean);
    return {
      key: "aqi",
      available: markers.length > 0,
      provider: "MOENV",
      source,
      source_url: MOENV_AQI_URL,
      retrieved_at: retrievedAt,
      as_of: markers[0]?.observed_at || retrievedAt,
      freshness: freshness(markers[0]?.observed_at || retrievedAt, now),
      stale: false,
      evidence_status: markers.length > 0 ? "AVAILABLE" : "INSUFFICIENT_EVIDENCE",
      error_code: markers.length > 0 ? "" : "NO_COORDINATED_AQI_ROWS",
      markers
    };
  } catch (error) {
    return emptyLayer("aqi", "MOENV", source, MOENV_AQI_URL, error instanceof ReadError ? error.code : "MOENV_AQI_UNAVAILABLE");
  }
}

function radarStamp(date: Date) {
  const rounded = new Date(date.getTime() - (date.getMinutes() % 10) * 60_000 - date.getSeconds() * 1000 - date.getMilliseconds());
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${rounded.getUTCFullYear()}${pad(rounded.getUTCMonth() + 1)}${pad(rounded.getUTCDate())}${pad(rounded.getUTCHours())}${pad(rounded.getUTCMinutes())}`;
}

async function loadRadar(now: number) {
  const source = "CWA official radar image";
  const retrievedAt = new Date(now).toISOString();
  for (let offset = 0; offset <= 6; offset += 1) {
    const candidate = new Date(now - offset * 10 * 60 * 1000);
    const stamp = radarStamp(candidate);
    const imageUrl = `${CWA_RADAR_BASE}${stamp}.png`;
    if (!await head(imageUrl)) continue;
    const asOf = candidate.toISOString();
    return {
      key: "radar",
      available: true,
      provider: "CWA",
      source,
      source_url: "https://www.cwa.gov.tw/V8/C/W/OBS_Radar.html",
      retrieved_at: retrievedAt,
      as_of: asOf,
      freshness: freshness(asOf, now),
      stale: freshness(asOf, now) === "stale",
      evidence_status: "AVAILABLE",
      error_code: "",
      markers: [],
      overlay: { image_url: imageUrl, bounds: [[21.5, 119.2], [25.5, 122.1]] }
    };
  }
  return emptyLayer("radar", "CWA", source, "https://www.cwa.gov.tw/V8/C/W/OBS_Radar.html", "CWA_RADAR_UNAVAILABLE");
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

async function loadCctv(now: number) {
  const source = "TDX Taipei CCTV metadata";
  try {
    const token = await tdxToken();
    const payload = await fetchJson(TDX_CCTV_URL, { headers: { accept: "application/json", authorization: `Bearer ${token}` } });
    const rows = Array.isArray(payload) ? payload as JsonObject[] : [];
    const retrievedAt = new Date(now).toISOString();
    const markers = rows.map((row, index) => {
      const point = coordinate(row);
      const id = text(row.CCTVID || row.CctvId || row.id || index, 100);
      return point.lat === null || point.lng === null ? null : {
        id: `tdx-cctv-${id}`,
        kind: "cctv",
        label: text(row.RoadName || row.RoadNameZh || row.roadName || `CCTV ${index + 1}`, 160),
        detail: "點擊標記後才載入影像",
        lat: point.lat,
        lng: point.lng,
        observed_at: retrievedAt,
        image_url: text(row.VideoImageUrl || row.VideoImageURL || row.videoImageUrl, 800),
        stream_url: text(row.VideoStreamUrl || row.VideoStreamURL || row.videoStreamUrl, 800),
        source: "TDX"
      };
    }).filter(Boolean);
    return {
      key: "cctv",
      available: markers.length > 0,
      provider: "TDX",
      source,
      source_url: TDX_CCTV_URL.replace(/\?.*$/, ""),
      retrieved_at: retrievedAt,
      as_of: retrievedAt,
      freshness: "unknown",
      stale: false,
      evidence_status: markers.length > 0 ? "AVAILABLE" : "INSUFFICIENT_EVIDENCE",
      error_code: markers.length > 0 ? "" : "NO_COORDINATED_CCTV_ROWS",
      markers
    };
  } catch (error) {
    return emptyLayer("cctv", "TDX", source, TDX_CCTV_URL.replace(/\?.*$/, ""), error instanceof ReadError ? error.code : "TDX_CCTV_UNAVAILABLE");
  }
}

function requestedLayers(input: JsonObject) {
  const values = Array.isArray(input.layers) ? input.layers : DEFAULT_LAYERS;
  return Array.from(new Set(values.map(value => text(value, 30).toLowerCase()).filter((value): value is LayerName => LAYERS.includes(value as LayerName)))) as LayerName[];
}

Deno.serve(async request => {
  let origin = "";
  try {
    origin = authOrigin(request);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: headers(origin) });
    if (request.method !== "POST") throw new ReadError("METHOD_NOT_ALLOWED", "POST is required.", 405);
    await requireAuth(request);
    const input = await request.json().catch(() => ({})) as JsonObject;
    const layers = requestedLayers(input);
    const includeCctv = input.include_cctv === true || input.includeCctv === true;
    if (includeCctv && !layers.includes("cctv")) layers.push("cctv");
    const now = Date.now();
    const values: Record<LayerName, JsonObject> = {
      weather: emptyLayer("weather", "CWA", "CWA weather station observations", CWA_WEATHER_URL, "NOT_REQUESTED"),
      radar: emptyLayer("radar", "CWA", "CWA official radar image", "https://www.cwa.gov.tw/V8/C/W/OBS_Radar.html", "NOT_REQUESTED"),
      earthquake: emptyLayer("earthquake", "CWA", "CWA earthquake reports", CWA_EARTHQUAKE_URL, "NOT_REQUESTED"),
      aqi: emptyLayer("aqi", "MOENV", "MOENV AQI monitoring stations", MOENV_AQI_URL, "NOT_REQUESTED"),
      cctv: emptyLayer("cctv", "TDX", "TDX Taipei CCTV metadata", TDX_CCTV_URL.replace(/\?.*$/, ""), "NOT_REQUESTED")
    };
    const loaders: Partial<Record<LayerName, Promise<JsonObject>>> = {
      weather: layers.includes("weather") ? loadWeather(now) : undefined,
      radar: layers.includes("radar") ? loadRadar(now) : undefined,
      earthquake: layers.includes("earthquake") ? loadEarthquake(now) : undefined,
      aqi: layers.includes("aqi") ? loadAqi(now) : undefined,
      cctv: includeCctv && layers.includes("cctv") ? loadCctv(now) : undefined
    };
    await Promise.all(LAYERS.map(async key => { if (loaders[key]) values[key] = await loaders[key]!; }));
    const loaded = LAYERS.filter(key => values[key].available === true);
    return json({
      contract: CONTRACT,
      read_only: true,
      generated_at: new Date(now).toISOString(),
      layers: values,
      summary: {
        loaded_layers: loaded,
        loaded_evidence_count: loaded.reduce((count, key) => count + (Array.isArray(values[key].markers) ? values[key].markers.length : 0) + (values[key].overlay ? 1 : 0), 0),
        cctv_requested: includeCctv
      },
      provider_trace: LAYERS.reduce((trace, key) => { trace[key] = { provider: values[key].provider, available: values[key].available, freshness: values[key].freshness }; return trace; }, {} as JsonObject),
      product_data_mutation: false,
      stream_subscriptions: 0,
      trading_operations: 0
    }, 200, origin);
  } catch (error) {
    if (error instanceof ReadError) return json({ code: error.code, message: error.message }, error.status, origin);
    return json({ code: "SKYEYE_READ_FAILED", message: "SkyEye read adapter failed." }, 500, origin);
  }
});
