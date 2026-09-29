import {
  coalesceProxyRequest,
  readResponseTextCapped,
} from '../common/http.js';

/** Official Taipei Port marine observation feed published by MOTC. */
export const TAIPEI_PORT_MARINE_URL =
  'https://isohe.ihmt.gov.tw/station/OpenData/XML/GetTPstationXML.aspx';

const PROVIDER_ID = 'taiwan.marine.wave';
const SOURCE =
  'Institute of Transportation, Ministry of Transportation and Communications';
const ATTRIBUTION = SOURCE;
const LICENSE = 'Open Government Data License, version 1.0';
const COVERAGE = 'Taipei commercial port observation station';
const MAX_BYTES = 512 * 1024;

function text(value, max = 160) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, max);
}

function number(value) {
  const parsed = Number(String(value ?? '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(value) {
  const raw = String(value ?? '')
    .trim()
    .replace(' ', 'T');
  const parsed = Date.parse(
    /(?:Z|[+-]\d\d:\d\d)$/.test(raw) ? raw : `${raw}+08:00`,
  );
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function tag(block, name) {
  return (
    new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i').exec(block)?.[1] || ''
  );
}

function blocks(xml, name) {
  return [
    ...String(xml || '').matchAll(
      new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'gi'),
    ),
  ].map((match) => match[1]);
}

/** Normalize wave observations without exposing the upstream XML. */
export function parseTaipeiPortMarineXml(xml, nowMs = Date.now()) {
  const fetchedAt = new Date(nowMs).toISOString();
  const entities = blocks(xml, 'History')
    .slice(0, 168)
    .map((block, index) => {
      const observedAt = iso(tag(block, 'Date_Time'));
      const latitude = number(tag(block, 'Latitude'));
      const longitude = number(tag(block, 'Longitude'));
      if (
        !observedAt ||
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude)
      )
        return null;
      return {
        id: `${PROVIDER_ID}:${observedAt}:${index}`,
        observedAt,
        latitude,
        longitude,
        waveHeightM: number(tag(block, 'HS')),
        peakPeriodSeconds: number(tag(block, 'TP')),
        waveDirectionDegrees: number(tag(block, 'MDIR')),
        meanPeriodSeconds: number(tag(block, 'Tmean')),
        currentSpeedMps: number(tag(block, 'Velocity')),
        currentDirectionDegrees: number(tag(block, 'Vmdir')),
        statusCode: text(tag(block, 'Status'), 24) || null,
      };
    })
    .filter(Boolean);
  if (!entities.length) throw new Error('taipei_port_marine_records_empty');
  return {
    schemaVersion: 1,
    providerId: PROVIDER_ID,
    source: SOURCE,
    fetchedAt,
    dataTimestamp: entities[0].observedAt,
    status: 'available',
    stale: false,
    attribution: ATTRIBUTION,
    license: LICENSE,
    geographicCoverage: COVERAGE,
    entities,
    features: [],
    providerMetadata: {
      sourceUrl: TAIPEI_PORT_MARINE_URL,
      updateCadence: 'hourly',
      observationStationCount: new Set(
        entities.map((entity) => `${entity.latitude},${entity.longitude}`),
      ).size,
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
      sourceUrl: TAIPEI_PORT_MARINE_URL,
      errorCode: text(errorCode || 'PROVIDER_UNAVAILABLE', 120),
      cache,
      rawResponseReturned: false,
    },
  };
}

/** Read-only bounded marine feed with TTL, request coalescing and stale fallback. */
export function marineProxy({
  fetchImpl = fetch,
  now = () => Date.now(),
  timeoutMs = 15_000,
  ttlMs = 5 * 60_000,
} = {}) {
  let cached = null;
  let cachedAt = 0;
  const inFlight = new Map();

  async function load() {
    const response = await fetchImpl(TAIPEI_PORT_MARINE_URL, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/xml,text/xml' },
    });
    if (!response.ok) throw new Error(`marine_http_${response.status}`);
    return parseTaipeiPortMarineXml(
      await readResponseTextCapped(response, MAX_BYTES),
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
    name: 'taiwan-marine-wave',
    configureServer({ middlewares }) {
      middlewares.use('/api/taiwan/marine/wave', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/taiwan/marine/wave', handler);
    },
  };
}
