import {
  coalesceProxyRequest,
  readResponseJsonCapped,
} from '../common/http.js';

/** Water Resources Agency public dataset used by the Taiwan parity adapter. */
export const WRA_RESERVOIR_URL =
  'https://opendata.wra.gov.tw/api/v2/51023e88-4c76-4dbc-bbb9-470da690d539?format=JSON&sort=_importdate+asc';

const PROVIDER_ID = 'taiwan.wra.reservoir';
const SOURCE = 'Water Resources Agency, Ministry of Economic Affairs';
const ATTRIBUTION = 'Water Resources Agency, Ministry of Economic Affairs';
const LICENSE = 'Open Government Data License, version 1.0';
const COVERAGE = 'Taiwan reservoirs';
const MAX_BYTES = 2 * 1024 * 1024;

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

function latestTimestamp(records, fallback) {
  const timestamps = records
    .map((record) => Date.parse(record.observedAt || ''))
    .filter(Number.isFinite);
  return timestamps.length
    ? new Date(Math.max(...timestamps)).toISOString()
    : fallback;
}

/** Normalize only fields published by the WRA dataset; blank values stay null. */
export function parseWraReservoirPayload(payload, nowMs = Date.now()) {
  if (!Array.isArray(payload)) throw new Error('wra_reservoir_payload_invalid');
  const records = payload
    .slice(0, 2_000)
    .map((row) => {
      const id = text(row?.reservoiridentifier || row?.ReservoirIdentifier, 40);
      const name = text(row?.reservoirname || row?.ReservoirName, 120);
      const observedAt = isoOrNull(row?.datetime || row?.DateTime);
      if (!id || !name || !observedAt) return null;
      return {
        id,
        name,
        observedAt,
        basinRainfallMm: numberOrNull(row?.basinrainfall),
        capacityTenThousandM3: numberOrNull(row?.capacity),
        crossflowTenThousandM3: numberOrNull(row?.crossflow),
        deadWaterLevel: numberOrNull(row?.dwl),
        inflowTenThousandM3: numberOrNull(row?.inflow),
        fullWaterLevel: numberOrNull(row?.nwlmax),
        outflowTenThousandM3: numberOrNull(row?.outflow),
        outflowDischarge: numberOrNull(row?.outflowdischarge),
        outflowTotalTenThousandM3: numberOrNull(row?.outflowtotal),
        regulatoryDischarge: numberOrNull(row?.regulatorydischarge),
      };
    })
    .filter(Boolean);
  if (!records.length) throw new Error('wra_reservoir_records_empty');
  const fetchedAt = new Date(nowMs).toISOString();
  return {
    schemaVersion: 1,
    providerId: PROVIDER_ID,
    source: SOURCE,
    fetchedAt,
    dataTimestamp: latestTimestamp(records, fetchedAt),
    status: 'available',
    stale: false,
    attribution: ATTRIBUTION,
    license: LICENSE,
    geographicCoverage: COVERAGE,
    entities: records,
    features: [],
    providerMetadata: {
      dataset: 'Reservoir daily operation status',
      sourceUrl: WRA_RESERVOIR_URL,
      updateCadence:
        'daily; source notes that missing daily entries are omitted',
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

/** Read-only WRA adapter with bounded body, TTL, coalescing and stale fallback. */
export function reservoirProxy({
  fetchImpl = fetch,
  now = () => Date.now(),
  timeoutMs = 15_000,
  ttlMs = 15 * 60_000,
} = {}) {
  let cached = null;
  let cachedAt = 0;
  const inFlight = new Map();

  async function load() {
    const response = await fetchImpl(WRA_RESERVOIR_URL, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`wra_reservoir_http_${response.status}`);
    return parseWraReservoirPayload(
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
      return writeJson(res, 200, {
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
          cache: 'empty',
          errorCode: text(error?.message || 'wra_reservoir_unavailable', 120),
          rawResponseReturned: false,
        },
      });
    }
  }

  return {
    name: 'taiwan-wra-reservoir',
    configureServer({ middlewares }) {
      middlewares.use('/api/taiwan/reservoirs', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/taiwan/reservoirs', handler);
    },
  };
}
