import {
  coalesceProxyRequest,
  readResponseJsonCapped,
} from '../common/http.js';

/** Official WRA reservoir storage-range WFS catalog. */
export const WRA_RESERVOIR_SHAPES_URL =
  'https://maps.wra.gov.tw/arcgis/services/WMS/GIC_WMS/MapServer/WFSServer?service=WFS&version=2.0.0&request=GetFeature&typeNames=GIC_WMS%3Aressub&outputFormat=geojson&count=500';

const PROVIDER_ID = 'taiwan.wra.reservoir-shapes';
const SOURCE = 'Water Resources Agency, Ministry of Economic Affairs';
const ATTRIBUTION = 'Water Resources Agency, Ministry of Economic Affairs';
const LICENSE = 'Open Government Data License, version 1.0';
const COVERAGE = 'Taiwan reservoir storage ranges';
const MAX_BYTES = 24 * 1024 * 1024;
const MAX_PLACEMARKS = 500;
const MAX_COORDINATES_PER_RING = 600;

function text(value, max = 160) {
  return String(value ?? '')
    .replace(/<!\[CDATA\[|\]\]>/g, '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, max);
}

function parseRing(value) {
  const coordinates = (Array.isArray(value) ? value : [])
    .map((point) => [Number(point?.[0]), Number(point?.[1])])
    .filter(
      ([longitude, latitude]) =>
        Number.isFinite(longitude) &&
        Number.isFinite(latitude) &&
        longitude >= 118 &&
        longitude <= 123.5 &&
        latitude >= 20 &&
        latitude <= 26.5,
    );
  if (coordinates.length < 3) return [];
  if (coordinates.length <= MAX_COORDINATES_PER_RING) return coordinates;
  const stride = Math.ceil(coordinates.length / MAX_COORDINATES_PER_RING);
  const reduced = coordinates.filter((_, index) => index % stride === 0);
  const last = coordinates[coordinates.length - 1];
  if (reduced.at(-1)?.[0] !== last[0] || reduced.at(-1)?.[1] !== last[1])
    reduced.push(last);
  return reduced.length >= 3 ? reduced : [];
}

function geometryRings(geometry) {
  if (geometry?.type === 'Polygon') return geometry.coordinates || [];
  if (geometry?.type === 'MultiPolygon')
    return (geometry.coordinates || []).flatMap((polygon) => polygon || []);
  return [];
}

/** Normalize official WRA WFS GeoJSON into bounded line geometry. */
export function parseWraReservoirShapesGeoJson(payload, nowMs = Date.now()) {
  if (payload?.type !== 'FeatureCollection' || !Array.isArray(payload.features))
    throw new Error('wra_reservoir_shapes_payload_invalid');
  const entities = payload.features
    .slice(0, MAX_PLACEMARKS)
    .map((feature, index) => {
      const properties = feature?.properties || {};
      const name = text(
        properties.NAME || properties.RES_NAME || properties.name,
        120,
      );
      const rings = geometryRings(feature?.geometry)
        .map(parseRing)
        .filter((ring) => ring.length >= 3)
        .slice(0, 8);
      if (!name || !rings.length) return null;
      const sourceId = text(
        properties.GmlID || properties.OBJECTID || properties.Id,
        80,
      );
      return {
        id: sourceId || `wra-reservoir-shape-${index + 1}`,
        name,
        rings,
      };
    })
    .filter(Boolean);
  if (!entities.length) throw new Error('wra_reservoir_shapes_empty');
  const fetchedAt = new Date(nowMs).toISOString();
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
      dataset: 'Reservoir storage range WFS GeoJSON catalog',
      sourceUrl: WRA_RESERVOIR_SHAPES_URL,
      updateCadence: 'irregular; provider-published catalog',
      browserDirect: false,
      rawResponseReturned: false,
      geometry: 'bounded reservoir outlines; coordinates reduced for map use',
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
    status: 'provider_unavailable',
    stale: false,
    attribution: ATTRIBUTION,
    license: LICENSE,
    geographicCoverage: COVERAGE,
    entities: [],
    features: [],
    providerMetadata: {
      cache: 'empty',
      errorCode: text(errorCode || 'wra_reservoir_shapes_unavailable', 120),
      rawResponseReturned: false,
    },
  };
}

/** Read-only WRA geometry adapter with bounded fetch, TTL and stale fallback. */
export function reservoirShapesProxy({
  fetchImpl = fetch,
  now = () => Date.now(),
  timeoutMs = 30_000,
  ttlMs = 24 * 60 * 60_000,
} = {}) {
  let cached = null;
  let cachedAt = 0;
  const inFlight = new Map();

  async function load() {
    const response = await fetchImpl(WRA_RESERVOIR_SHAPES_URL, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/geo+json, application/json' },
    });
    if (!response.ok)
      throw new Error(`wra_reservoir_shapes_http_${response.status}`);
    return parseWraReservoirShapesGeoJson(
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
      return writeJson(res, 200, unavailable(now, error?.message));
    }
  }

  return {
    name: 'taiwan-wra-reservoir-shapes',
    configureServer({ middlewares }) {
      middlewares.use('/api/taiwan/reservoirs/shapes', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/taiwan/reservoirs/shapes', handler);
    },
  };
}
