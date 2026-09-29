import {
  coalesceProxyRequest,
  readResponseJsonCapped,
} from '../common/http.js';

/** Official MOENV AQI open-data API. The server-side API key is optional. */
export const MOENV_AQI_URL = 'https://data.moenv.gov.tw/api/v2/aqx_p_432';
export const MOENV_AQI_KEY_ENV = 'MOENV_API_KEY';

const PROVIDER_ID = 'taiwan.moenv.aqi';
const SOURCE = 'Taiwan Ministry of Environment Open Data';
const ATTRIBUTION = 'Taiwan Ministry of Environment Open Data';
const LICENSE = 'Open Government Data License, version 1.0';
const COVERAGE = 'Taiwan monitoring stations';
const MAX_BYTES = 4 * 1024 * 1024;

function text(value, max = 160) {
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
  throw new Error('moenv_aqi_payload_invalid');
}

/** Normalize only published MOENV station fields; blanks remain null. */
export function parseMoenvAqiPayload(payload, nowMs = Date.now()) {
  const records = rowsFromPayload(payload)
    .slice(0, 2_000)
    .map((row) => {
      const id = text(row?.siteid || row?.station_id || row?.stationId, 40);
      const name = text(row?.sitename || row?.station_name || row?.name, 120);
      if (!id || !name) return null;
      return {
        id,
        name,
        county: text(row?.county, 40) || null,
        latitude: numberOrNull(row?.latitude || row?.lat),
        longitude: numberOrNull(row?.longitude || row?.lon),
        aqi: numberOrNull(row?.aqi || row?.AQI),
        pollutant: text(row?.pollutant, 80) || null,
        status: text(row?.status, 80) || null,
        observedAt: isoOrNull(
          row?.publishtime || row?.publish_time || row?.timestamp,
        ),
        pm25: numberOrNull(row?.pm25 || row?.['pm2.5']),
        pm10: numberOrNull(row?.pm10),
        o3: numberOrNull(row?.o3),
        no2: numberOrNull(row?.no2),
        so2: numberOrNull(row?.so2),
        co: numberOrNull(row?.co),
      };
    })
    .filter(Boolean);
  if (!records.length) throw new Error('moenv_aqi_records_empty');
  const fetchedAt = new Date(nowMs).toISOString();
  const timestamps = records
    .map((record) => Date.parse(record.observedAt || ''))
    .filter(Number.isFinite);
  return {
    schemaVersion: 1,
    providerId: PROVIDER_ID,
    source: SOURCE,
    fetchedAt,
    dataTimestamp: timestamps.length
      ? new Date(Math.max(...timestamps)).toISOString()
      : fetchedAt,
    status: 'available',
    stale: false,
    attribution: ATTRIBUTION,
    license: LICENSE,
    geographicCoverage: COVERAGE,
    entities: records,
    features: [],
    providerMetadata: {
      dataset: 'AQI and pollutant monitoring station data',
      sourceUrl: MOENV_AQI_URL,
      updateCadence:
        'provider-published; observed timestamp is retained per station',
      browserDirect: false,
      rawResponseReturned: false,
    },
  };
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

function unavailable(now, errorCode) {
  return {
    schemaVersion: 1,
    providerId: PROVIDER_ID,
    source: SOURCE,
    fetchedAt: new Date(now()).toISOString(),
    dataTimestamp: '',
    status:
      errorCode === 'PROVIDER_NOT_CONFIGURED'
        ? 'provider_not_configured'
        : 'provider_unavailable',
    stale: false,
    attribution: ATTRIBUTION,
    license: LICENSE,
    geographicCoverage: COVERAGE,
    entities: [],
    features: [],
    providerMetadata: {
      cache: 'empty',
      errorCode,
      requiredSecret: MOENV_AQI_KEY_ENV,
      rawResponseReturned: false,
    },
  };
}

/** Read-only MOENV adapter. Credentials remain server-side and are never echoed. */
export function aqiProxy({
  fetchImpl = fetch,
  now = () => Date.now(),
  resolveApiKey = () => process.env[MOENV_AQI_KEY_ENV],
  timeoutMs = 15_000,
  ttlMs = 5 * 60_000,
} = {}) {
  let cached = null;
  let cachedAt = 0;
  const inFlight = new Map();

  async function load() {
    const apiKey = String(resolveApiKey() || '').trim();
    if (!apiKey)
      throw Object.assign(new Error('PROVIDER_NOT_CONFIGURED'), {
        code: 'PROVIDER_NOT_CONFIGURED',
      });
    const url = new URL(MOENV_AQI_URL);
    url.searchParams.set('api_key', apiKey);
    url.searchParams.set('format', 'json');
    url.searchParams.set('limit', '2000');
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`moenv_aqi_http_${response.status}`);
    return parseMoenvAqiPayload(
      await readResponseJsonCapped(response, MAX_BYTES),
      now(),
    );
  }

  async function read() {
    const age = now() - cachedAt;
    if (cached && age >= 0 && age <= ttlMs)
      return { value: cached, stale: false, cache: 'fresh' };
    const { promise } = coalesceProxyRequest(inFlight, 'all', load);
    try {
      const value = await promise;
      cached = value;
      cachedAt = now();
      return { value, stale: false, cache: 'miss' };
    } catch (error) {
      if (cached)
        return {
          value: { ...cached, status: 'stale', stale: true },
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
    if (!String(resolveApiKey() || '').trim())
      return writeJson(res, 200, unavailable(now, 'PROVIDER_NOT_CONFIGURED'));
    try {
      const result = await read();
      return writeJson(res, 200, {
        ...result.value,
        status: result.stale ? 'stale' : result.value.status,
        stale: result.stale || result.value.stale,
        providerMetadata: {
          ...result.value.providerMetadata,
          cache: result.cache,
        },
      });
    } catch (error) {
      return writeJson(
        res,
        200,
        unavailable(now, error?.code || 'PROVIDER_UNAVAILABLE'),
      );
    }
  }

  return {
    name: 'taiwan-moenv-aqi',
    configureServer({ middlewares }) {
      middlewares.use('/api/taiwan/aqi', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/taiwan/aqi', handler);
    },
  };
}
