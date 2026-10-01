import {
  coalesceProxyRequest,
  readResponseJsonCapped,
} from '../common/http.js';

/** Official Taiwan fishing-port location catalogue. */
export const TAIWAN_FISHING_PORTS_URL =
  'https://data.moa.gov.tw/Service/OpenData/FaRss.aspx?key=063&IsTransData=1&UnitId=B28';

const PROVIDER_ID = 'taiwan.moa.fishing-ports';
const SOURCE = 'Ministry of Agriculture Taiwan Open Data';
const ATTRIBUTION = 'Ministry of Agriculture, Taiwan';
const LICENSE = 'Open Government Data License, version 1.0';
const COVERAGE = 'Taiwan fishing ports';
const MAX_BYTES = 2 * 1024 * 1024;

function text(value, max = 180) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, max);
}

function number(value) {
  const parsed = Number(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

/** Normalize official fishing-port records into point entities. */
export function parseTaiwanFishingPortsPayload(payload, nowMs = Date.now()) {
  if (!Array.isArray(payload)) throw new Error('taiwan_fishing_ports_invalid');
  const fetchedAt = new Date(nowMs).toISOString();
  const entities = payload
    .slice(0, 1_000)
    .map((row, index) => {
      const longitude = number(row?.經度 ?? row?.longitude ?? row?.lon);
      const latitude = number(row?.緯度 ?? row?.latitude ?? row?.lat);
      const name = text(row?.漁港名稱 ?? row?.name, 120);
      if (!name || !Number.isFinite(latitude) || !Number.isFinite(longitude))
        return null;
      return {
        id: `${PROVIDER_ID}:${text(row?.編號 ?? index, 48)}`,
        name,
        category: text(row?.分類 ?? row?.category, 48) || null,
        countyCode: text(row?.縣市 ?? row?.countyCode, 24) || null,
        longitude,
        latitude,
        phone: text(row?.電話 ?? row?.phone, 48) || null,
        address: text(row?.地址 ?? row?.address, 180) || null,
      };
    })
    .filter(Boolean);
  if (!entities.length) throw new Error('taiwan_fishing_ports_empty');
  return {
    schemaVersion: 1,
    providerId: PROVIDER_ID,
    source: SOURCE,
    fetchedAt,
    dataTimestamp: fetchedAt,
    status: 'available',
    stale: false,
    attribution: ATTRIBUTION,
    license: LICENSE,
    geographicCoverage: COVERAGE,
    entities,
    features: [],
    providerMetadata: {
      sourceUrl: TAIWAN_FISHING_PORTS_URL,
      updateCadence: 'irregular official catalogue update',
      browserDirect: false,
      rawResponseReturned: false,
    },
  };
}

function unavailable(now, errorCode, cache = 'empty') {
  return {
    schemaVersion: 1,
    providerId: PROVIDER_ID,
    source: SOURCE,
    fetchedAt: new Date(now()).toISOString(),
    dataTimestamp: '',
    status: 'provider_unavailable',
    stale: false,
    attribution: ATTRIBUTION,
    license: LICENSE,
    geographicCoverage: COVERAGE,
    entities: [],
    features: [],
    providerMetadata: {
      sourceUrl: TAIWAN_FISHING_PORTS_URL,
      errorCode: text(errorCode || 'PROVIDER_UNAVAILABLE', 120),
      cache,
      rawResponseReturned: false,
    },
  };
}

/** Read-only bounded fishing-port catalogue with stale fallback. */
export function fishingPortsProxy({
  fetchImpl = fetch,
  now = () => Date.now(),
  timeoutMs = 15_000,
  ttlMs = 24 * 60 * 60_000,
} = {}) {
  let cached = null;
  let cachedAt = 0;
  const inFlight = new Map();

  async function load() {
    const response = await fetchImpl(TAIWAN_FISHING_PORTS_URL, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`fishing_ports_http_${response.status}`);
    return parseTaiwanFishingPortsPayload(
      await readResponseJsonCapped(response, MAX_BYTES),
      now(),
    );
  }

  async function read() {
    if (cached && now() - cachedAt <= ttlMs)
      return { value: cached, cache: 'fresh', stale: false };
    const { promise } = coalesceProxyRequest(inFlight, 'all', load);
    try {
      const value = await promise;
      cached = value;
      cachedAt = now();
      return { value, cache: 'miss', stale: false };
    } catch (error) {
      if (cached)
        return {
          value: { ...cached, status: 'stale', stale: true },
          cache: 'stale-fallback',
          stale: true,
          error,
        };
      throw error;
    }
  }

  async function handler(req, res) {
    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET', 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error_code: 'METHOD_NOT_ALLOWED' }));
      return;
    }
    try {
      const result = await read();
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(
        JSON.stringify({
          ...result.value,
          status: result.stale ? 'stale' : result.value.status,
          stale: result.stale || result.value.stale,
          providerMetadata: {
            ...result.value.providerMetadata,
            cache: result.cache,
            rawResponseReturned: false,
          },
        }),
      );
    } catch (error) {
      const value = unavailable(now, error?.message);
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(value));
    }
  }

  return {
    name: 'taiwan-fishing-ports',
    configureServer({ middlewares }) {
      middlewares.use('/api/taiwan/ports/fishing', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/taiwan/ports/fishing', handler);
    },
  };
}
