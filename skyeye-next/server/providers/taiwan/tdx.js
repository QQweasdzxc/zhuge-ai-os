import {
  coalesceProxyRequest,
  readResponseJsonCapped,
} from '../common/http.js';

/** Official TDX OAuth and read-only transport endpoints. */
export const TDX_TOKEN_URL =
  'https://tdx.transportdata.tw/auth/realms/TDXConnect/protocol/openid-connect/token';
export const TDX_API_BASE_URL = 'https://tdx.transportdata.tw/api/basic/v2';
export const TDX_RAIL_LIVE_URL = `${TDX_API_BASE_URL}/Rail/TRA/LiveTrainDelay?$top=2000&$format=JSON`;
export const TDX_HIGHWAY_LIVE_URL = `${TDX_API_BASE_URL}/Road/Traffic/Live/Highway?$top=2000&$format=JSON`;

const TDX_CLIENT_ID_ENV = 'TDX_CLIENT_ID';
const TDX_CLIENT_SECRET_ENV = 'TDX_CLIENT_SECRET';
const PROVIDER_SOURCE =
  'TDX Transport Data eXchange, Ministry of Transportation and Communications';
const ATTRIBUTION = 'TDX Transport Data eXchange';
const LICENSE =
  'Open Government Data License, version 1.0; TDX API registration and rate terms apply';
const MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_TTL_MS = 30_000;
const DEFAULT_BACKOFF_MS = 30_000;
const METRO_OPERATORS = new Set([
  'TRTC',
  'KRTC',
  'TYMC',
  'TMRT',
  'KLRT',
  'NTDLRT',
  'NTMC',
  'NTALRT',
  'TRTCMG',
]);

function text(value, max = 240) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, max);
}

function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function isoOrNull(value) {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function rowsFromPayload(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.records)) return payload.records;
  if (Array.isArray(payload?.data)) return payload.data;
  throw new Error('tdx_payload_invalid');
}

function latestTimestamp(rows, fallback) {
  const timestamps = rows
    .flatMap((row) => [
      row?.UpdateTime,
      row?.SrcUpdateTime,
      row?.UpdateDate,
      row?.DataCollectTime,
    ])
    .map(isoOrNull)
    .filter(Boolean)
    .map(Date.parse);
  return timestamps.length
    ? new Date(Math.max(...timestamps)).toISOString()
    : fallback;
}

function baseContract({
  providerId,
  capability,
  coverage,
  sourceUrl,
  rows,
  nowMs,
}) {
  const fetchedAt = new Date(nowMs).toISOString();
  return {
    schemaVersion: 1,
    providerId,
    capability,
    source: PROVIDER_SOURCE,
    fetchedAt,
    dataTimestamp: latestTimestamp(rows, fetchedAt),
    status: 'available',
    stale: false,
    attribution: ATTRIBUTION,
    license: LICENSE,
    geographicCoverage: coverage,
    entities: [],
    features: [],
    providerMetadata: {
      sourceUrl,
      browserDirect: false,
      rawResponseReturned: false,
      credentialBoundary: 'server-only',
      cache: 'provider-read-through-ttl-coalesced-backoff-stale',
    },
  };
}

/** Normalize TDX TRA live train delay records without returning the raw payload. */
export function parseTdxRailLivePayload(payload, nowMs = Date.now()) {
  const rows = rowsFromPayload(payload).slice(0, 2_000);
  const result = baseContract({
    providerId: 'taiwan.tdx.rail-live',
    capability: 'rail-live',
    coverage: 'Taiwan Railway Corporation',
    sourceUrl: TDX_RAIL_LIVE_URL,
    rows,
    nowMs,
  });
  result.entities = rows
    .map((row) => {
      const trainNo = text(row?.TrainNo, 40);
      const stationId = text(row?.StationID, 40);
      if (!trainNo && !stationId) return null;
      return {
        id: `${trainNo || 'station'}:${stationId || 'unknown'}:${text(row?.Direction, 12)}`,
        trainNo: trainNo || null,
        stationId: stationId || null,
        stationName:
          text(row?.StationName?.Zh_tw || row?.StationName, 120) || null,
        direction: text(row?.Direction, 24) || null,
        trainClassification:
          text(
            row?.TrainClassificationName?.Zh_tw || row?.TrainClassificationName,
            120,
          ) || null,
        destination:
          text(row?.EndingStationName?.Zh_tw || row?.EndingStationName, 120) ||
          null,
        scheduledArrivalTime: text(row?.ScheduledArrivalTime, 32) || null,
        scheduledDepartureTime: text(row?.ScheduledDepartureTime, 32) || null,
        delayMinutes: numberOrNull(row?.DelayTime),
        platform: text(row?.Platform, 32) || null,
        observedAt: isoOrNull(row?.SrcUpdateTime || row?.UpdateTime),
      };
    })
    .filter(Boolean);
  return result;
}

/** Normalize TDX provincial-highway live traffic records. */
export function parseTdxHighwayLivePayload(payload, nowMs = Date.now()) {
  const rows = rowsFromPayload(payload).slice(0, 4_000);
  const result = baseContract({
    providerId: 'taiwan.tdx.highway-live',
    capability: 'traffic-live',
    coverage: 'Taiwan provincial highways',
    sourceUrl: TDX_HIGHWAY_LIVE_URL,
    rows,
    nowMs,
  });
  result.entities = rows
    .map((row, index) => {
      const id = text(
        row?.SectionID || row?.RoadSectionID || row?.RoadID || row?.LinkID,
        80,
      );
      if (!id) return null;
      return {
        id: `${id}:${index}`,
        roadId: text(row?.RoadID, 40) || null,
        sectionId: id,
        roadName: text(row?.RoadName || row?.RoadNameZh, 120) || null,
        travelTimeSeconds: numberOrNull(row?.TravelTime),
        travelSpeedKph: numberOrNull(row?.TravelSpeed),
        congestionLevel: numberOrNull(row?.CongestionLevel),
        congestionLevelId: text(row?.CongestionLevelID, 24) || null,
        dataCollectTime: isoOrNull(
          row?.DataCollectTime || row?.SrcUpdateTime || row?.UpdateTime,
        ),
        geometry: row?.Geometry || row?.geometry || null,
      };
    })
    .filter(Boolean);
  return result;
}

/** Normalize TDX Metro LiveBoard records; this is not a crowd-density contract. */
export function parseTdxMetroLivePayload(
  payload,
  operator,
  nowMs = Date.now(),
) {
  const rows = rowsFromPayload(payload).slice(0, 2_000);
  const sourceUrl = `${TDX_API_BASE_URL}/Rail/Metro/LiveBoard/${operator}?$top=2000&$format=JSON`;
  const result = baseContract({
    providerId: 'taiwan.tdx.metro-live-board',
    capability: 'metro-live-board',
    coverage: `${operator} metro system`,
    sourceUrl,
    rows,
    nowMs,
  });
  result.entities = rows
    .map((row, index) => {
      const stationId = text(row?.StationID, 40);
      const stationName = text(
        row?.StationName?.Zh_tw || row?.StationName,
        120,
      );
      const destination = text(
        row?.DestinationName?.Zh_tw || row?.DestinationName,
        120,
      );
      if (!stationId && !stationName) return null;
      return {
        id: `${operator}:${stationId || index}:${text(row?.TrainType, 32)}`,
        operator,
        stationId: stationId || null,
        stationName: stationName || null,
        direction: text(row?.Direction, 24) || null,
        destination: destination || null,
        estimateSeconds: numberOrNull(row?.EstimateTime),
        trainType: text(row?.TrainType, 40) || null,
        observedAt: isoOrNull(row?.SrcUpdateTime || row?.UpdateTime),
      };
    })
    .filter(Boolean);
  return result;
}

function writeJson(res, status, value) {
  if (res.destroyed) return;
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...(status === 405 ? { Allow: 'GET' } : {}),
  });
  res.end(JSON.stringify(value));
}

function errorCode(error) {
  const code = String(
    error?.code || error?.message || 'TDX_PROVIDER_UNAVAILABLE',
  );
  if (code === 'PROVIDER_NOT_CONFIGURED') return code;
  if (code === 'TDX_AUTH_UNAVAILABLE') return code;
  if (code === 'TDX_PAYLOAD_INVALID') return code;
  if (/429/.test(code)) return 'TDX_RATE_LIMITED';
  return 'TDX_PROVIDER_UNAVAILABLE';
}

function unavailable({
  now,
  providerId,
  capability,
  coverage,
  sourceUrl,
  code,
  cache,
}) {
  return {
    schemaVersion: 1,
    providerId,
    capability,
    source: PROVIDER_SOURCE,
    fetchedAt: new Date(now()).toISOString(),
    dataTimestamp: '',
    status:
      code === 'PROVIDER_NOT_CONFIGURED'
        ? 'provider_not_configured'
        : 'provider_unavailable',
    stale: false,
    attribution: ATTRIBUTION,
    license: LICENSE,
    geographicCoverage: coverage,
    entities: [],
    features: [],
    providerMetadata: {
      sourceUrl,
      cache: cache || 'empty',
      errorCode: code,
      requiredSecrets: [TDX_CLIENT_ID_ENV, TDX_CLIENT_SECRET_ENV],
      rawResponseReturned: false,
      upstreamCalled: code !== 'PROVIDER_NOT_CONFIGURED',
      credentialBoundary: 'server-only',
    },
  };
}

function feedDefinition(kind, operator = 'KRTC') {
  if (kind === 'rail') {
    return {
      providerId: 'taiwan.tdx.rail-live',
      capability: 'rail-live',
      coverage: 'Taiwan Railway Corporation',
      sourceUrl: TDX_RAIL_LIVE_URL,
      route: '/rail/live',
      parse: parseTdxRailLivePayload,
    };
  }
  if (kind === 'highway') {
    return {
      providerId: 'taiwan.tdx.highway-live',
      capability: 'traffic-live',
      coverage: 'Taiwan provincial highways',
      sourceUrl: TDX_HIGHWAY_LIVE_URL,
      route: '/highway/live',
      parse: parseTdxHighwayLivePayload,
    };
  }
  return {
    providerId: 'taiwan.tdx.metro-live-board',
    capability: 'metro-live-board',
    coverage: `${operator} metro system`,
    sourceUrl: `${TDX_API_BASE_URL}/Rail/Metro/LiveBoard/${operator}?$top=2000&$format=JSON`,
    route: '/metro/live',
    parse: (payload, nowMs) =>
      parseTdxMetroLivePayload(payload, operator, nowMs),
  };
}

/** Read-only TDX adapter with server-only OAuth, cache, coalescing, backoff and stale fallback. */
export function tdxProxy({
  fetchImpl = fetch,
  now = () => Date.now(),
  resolveClientId = () => process.env[TDX_CLIENT_ID_ENV],
  resolveClientSecret = () => process.env[TDX_CLIENT_SECRET_ENV],
  timeoutMs = DEFAULT_TIMEOUT_MS,
  ttlMs = DEFAULT_TTL_MS,
  backoffMs = DEFAULT_BACKOFF_MS,
} = {}) {
  const caches = new Map();
  const inFlight = new Map();
  const failures = new Map();
  let tokenCache = null;
  let tokenInFlight = null;

  async function accessToken() {
    const clientId = String(resolveClientId() || '').trim();
    const clientSecret = String(resolveClientSecret() || '').trim();
    if (!clientId || !clientSecret)
      throw Object.assign(new Error('PROVIDER_NOT_CONFIGURED'), {
        code: 'PROVIDER_NOT_CONFIGURED',
      });
    if (tokenCache && tokenCache.expiresAt > now() + 30_000)
      return tokenCache.value;
    if (tokenInFlight) return tokenInFlight;
    tokenInFlight = (async () => {
      const response = await fetchImpl(TDX_TOKEN_URL, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: clientId,
          client_secret: clientSecret,
        }),
      });
      if (!response.ok)
        throw Object.assign(new Error('TDX_AUTH_UNAVAILABLE'), {
          code: 'TDX_AUTH_UNAVAILABLE',
        });
      const payload = await readResponseJsonCapped(response, 128 * 1024);
      const value = String(payload?.access_token || '').trim();
      if (!value)
        throw Object.assign(new Error('TDX_AUTH_UNAVAILABLE'), {
          code: 'TDX_AUTH_UNAVAILABLE',
        });
      const expiresIn = Math.max(60, Number(payload?.expires_in) || 300);
      tokenCache = { value, expiresAt: now() + expiresIn * 1000 };
      return value;
    })();
    try {
      return await tokenInFlight;
    } finally {
      tokenInFlight = null;
    }
  }

  async function load(definition) {
    const blockedUntil = failures.get(definition.providerId) || 0;
    if (blockedUntil > now())
      throw Object.assign(new Error('TDX_RATE_LIMITED'), {
        code: 'TDX_RATE_LIMITED',
      });
    const token = await accessToken();
    const response = await fetchImpl(definition.sourceUrl, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
    });
    if (response.status === 429) {
      failures.set(definition.providerId, now() + backoffMs);
      throw Object.assign(new Error('TDX_RATE_LIMITED'), {
        code: 'TDX_RATE_LIMITED',
      });
    }
    if (!response.ok)
      throw Object.assign(new Error('TDX_PROVIDER_UNAVAILABLE'), {
        code: 'TDX_PROVIDER_UNAVAILABLE',
      });
    failures.delete(definition.providerId);
    return definition.parse(
      await readResponseJsonCapped(response, MAX_BYTES),
      now(),
    );
  }

  async function read(definition) {
    const cached = caches.get(definition.providerId);
    const age = cached ? now() - cached.savedAt : Infinity;
    if (cached && age >= 0 && age <= ttlMs)
      return { value: cached.value, stale: false, cache: 'fresh' };
    const { promise } = coalesceProxyRequest(
      inFlight,
      definition.providerId,
      () => load(definition),
    );
    try {
      const value = await promise;
      caches.set(definition.providerId, { value, savedAt: now() });
      return { value, stale: false, cache: 'miss' };
    } catch (error) {
      if (cached)
        return {
          value: { ...cached.value, status: 'stale', stale: true },
          stale: true,
          cache: 'stale-fallback',
          error,
        };
      throw error;
    }
  }

  async function handler(req, res) {
    if (req.method !== 'GET')
      return writeJson(res, 405, { error_code: 'METHOD_NOT_ALLOWED' });
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    let definition;
    if (pathname === '/rail/live') definition = feedDefinition('rail');
    else if (pathname === '/highway/live')
      definition = feedDefinition('highway');
    else if (pathname === '/metro/live') {
      const operator = String(
        url.searchParams.get('operator') || 'KRTC',
      ).toUpperCase();
      if (!METRO_OPERATORS.has(operator))
        return writeJson(res, 400, { error_code: 'UNSUPPORTED_TDX_OPERATOR' });
      definition = feedDefinition('metro', operator);
    } else return writeJson(res, 404, { error_code: 'NOT_FOUND' });

    try {
      const result = await read(definition);
      return writeJson(res, 200, {
        ...result.value,
        status: result.stale ? 'stale' : result.value.status,
        stale: result.stale || result.value.stale,
        providerMetadata: {
          ...result.value.providerMetadata,
          cache: result.cache,
          upstreamCalled: true,
        },
      });
    } catch (error) {
      return writeJson(
        res,
        200,
        unavailable({
          now,
          providerId: definition.providerId,
          capability: definition.capability,
          coverage: definition.coverage,
          sourceUrl: definition.sourceUrl,
          code: errorCode(error),
          cache: 'empty',
        }),
      );
    }
  }

  return {
    name: 'taiwan-tdx-read-only',
    configureServer({ middlewares }) {
      middlewares.use('/api/taiwan/tdx', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/taiwan/tdx', handler);
    },
  };
}

export const tdxSecretNames = Object.freeze([
  TDX_CLIENT_ID_ENV,
  TDX_CLIENT_SECRET_ENV,
]);
