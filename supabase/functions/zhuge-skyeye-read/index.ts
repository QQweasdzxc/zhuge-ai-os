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

const CONTRACT = "zhuge-skyeye-read-v1";
const DEFAULT_ORIGIN = "https://qqweasdzxc.github.io";
const LAYERS: LayerName[] = ["weather", "radar", "earthquake", "aqi", "cctv"];
const DEFAULT_LAYERS: LayerName[] = ["weather", "radar", "earthquake", "aqi"];
const REQUEST_TIMEOUT_MS = 12000;
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
    data_quality: "unavailable",
    error_code: code,
    markers: []
  };
}

function layerFromMarkers(key: LayerName, provider: string, source: string, sourceUrl: string, markers: JsonObject[], now: number, fallbackAsOf: string, extra: JsonObject = {}) {
  const retrievedAt = new Date(now).toISOString();
  const asOf = latestObservedAt(markers, fallbackAsOf);
  const state = freshnessFor(asOf, now);
  const available = markers.length > 0 || Boolean(extra.overlay);
  const dataQuality = !available
    ? "insufficient"
    : state.freshness === "unknown"
      ? "unverified"
      : state.stale
        ? "stale"
        : "usable";
  return {
    key,
    available,
    provider,
    source,
    source_url: sourceUrl,
    retrieved_at: retrievedAt,
    as_of: asOf,
    freshness: state.freshness,
    stale: state.stale,
    evidence_status: available ? "AVAILABLE" : "INSUFFICIENT_EVIDENCE",
    data_quality: dataQuality,
    error_code: available ? "" : "NO_COORDINATED_ROWS",
    markers,
    ...extra
  };
}

async function loadWeather(now: number) {
  const source = "CWA weather station observations";
  const apiKey = text(Deno.env.get("CWA_API_KEY"), 400);
  if (!apiKey) return emptyLayer("weather", "CWA", source, CWA_WEATHER_URL, "CWA_API_KEY_UNAVAILABLE");
  try {
    const payload = await fetchJson(CWA_WEATHER_URL, { headers: { accept: "application/json", Authorization: apiKey } });
    const retrievedAt = new Date(now).toISOString();
    const normalized = normalizeWeatherRows(payload, retrievedAt);
    if (normalized.malformed) return emptyLayer("weather", "CWA", source, CWA_WEATHER_URL, "PROVIDER_MALFORMED_RESPONSE");
    return layerFromMarkers("weather", "CWA", source, CWA_WEATHER_URL, normalized.markers, now, "", {
      error_code: normalized.markers.length > 0 ? "" : "NO_COORDINATED_WEATHER_ROWS"
    });
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
    const retrievedAt = new Date(now).toISOString();
    const normalized = normalizeEarthquakeRows(payload, retrievedAt);
    if (normalized.malformed) return emptyLayer("earthquake", "CWA", source, CWA_EARTHQUAKE_URL, "PROVIDER_MALFORMED_RESPONSE");
    return layerFromMarkers("earthquake", "CWA", source, CWA_EARTHQUAKE_URL, normalized.markers, now, "", {
      error_code: normalized.markers.length > 0 ? "" : "NO_COORDINATED_EARTHQUAKE_ROWS"
    });
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
    const retrievedAt = new Date(now).toISOString();
    const normalized = normalizeAqiRows(payload, retrievedAt);
    if (normalized.malformed) return emptyLayer("aqi", "MOENV", source, MOENV_AQI_URL, "PROVIDER_MALFORMED_RESPONSE");
    return layerFromMarkers("aqi", "MOENV", source, MOENV_AQI_URL, normalized.markers, now, "", {
      error_code: normalized.markers.length > 0 ? "" : "NO_COORDINATED_AQI_ROWS"
    });
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
    const state = freshnessFor(asOf, now);
    return {
      key: "radar",
      available: true,
      provider: "CWA",
      source,
      source_url: "https://www.cwa.gov.tw/V8/C/W/OBS_Radar.html",
      retrieved_at: retrievedAt,
      as_of: asOf,
      freshness: state.freshness,
      stale: state.stale,
      evidence_status: "AVAILABLE",
      data_quality: state.stale ? "stale" : "usable",
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
    const retrievedAt = new Date(now).toISOString();
    const normalized = normalizeCctvRows(payload, retrievedAt);
    if (normalized.malformed) return emptyLayer("cctv", "TDX", source, TDX_CCTV_URL.replace(/\?.*$/, ""), "PROVIDER_MALFORMED_RESPONSE");
    return layerFromMarkers("cctv", "TDX", source, TDX_CCTV_URL.replace(/\?.*$/, ""), normalized.markers, now, retrievedAt, {
      error_code: normalized.markers.length > 0 ? "" : "NO_COORDINATED_CCTV_ROWS",
      data_quality: normalized.markers.length > 0 ? "metadata_only" : "insufficient",
      freshness: "unknown",
      stale: false
    });
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
