import {
  readResponseBytesCapped,
  readResponseJsonCapped,
  readResponseTextCapped,
  coalesceProxyRequest,
} from '../common/http.js';

const RADAR_URL =
  'https://cwaopendata.s3.ap-northeast-1.amazonaws.com/Observation/O-A0058-003.png';
const TYPHOON_URL =
  'https://c01.twipcam.com/data/live/cwa/W-C0034-002/fifows_typhoon.kml';
const WIND_LIST_URL =
  'https://c01.twipcam.com/data/live/cwa/GFS/1000hPa/list.json';
const WIND_ROOT = 'https://c01.twipcam.com/data/live/cwa/GFS/1000hPa/';
const RADAR_REGION = Object.freeze({
  west: 118,
  south: 20,
  east: 123,
  north: 27,
});
const WIND_REGION = Object.freeze({
  west: 81,
  south: 3.5,
  east: 161,
  north: 38.5,
});
const CWA_ATTRIBUTION = 'Central Weather Administration, Taiwan';
const CWA_TERMS =
  'CWA-labelled public distribution observed in runtime recon; verify current reuse terms before production activation';
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const RADAR_IMAGE_WIDTH = 3600;
const RADAR_IMAGE_HEIGHT = 3600;
const MAX_KML_BYTES = 1 * 1024 * 1024;
const MAX_WIND_BYTES = 2 * 1024 * 1024;
const MAX_GRID_POINTS = 250_000;

const iso = (value, fallback) => {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : fallback;
};

function sourceTime(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const normalized = value.trim().replace(' ', 'T');
  return iso(
    /(?:Z|[+-]\d\d:\d\d)$/.test(normalized) ? normalized : `${normalized}Z`,
    fallback,
  );
}

function boundedText(value, max = 240) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, max);
}

function safePath(value) {
  return typeof value === 'string' && /^[a-z0-9._-]+\.json$/i.test(value);
}

function validGridHeader(header, data) {
  const nx = Number(header?.nx);
  const ny = Number(header?.ny);
  const count = nx * ny;
  return (
    Number.isInteger(nx) &&
    Number.isInteger(ny) &&
    nx >= 2 &&
    ny >= 2 &&
    count <= MAX_GRID_POINTS &&
    Array.isArray(data) &&
    data.length === count &&
    [
      header.lo1,
      header.la1,
      header.lo2,
      header.la2,
      header.dx,
      header.dy,
    ].every(Number.isFinite) &&
    header.dx > 0 &&
    header.dy > 0 &&
    data.every((value) => Number.isFinite(value))
  );
}

/** Convert the observed CWA GFS JSON into the existing wind grid contract. */
export function parseCwaWindPayload(
  payload,
  nowMs = Date.now(),
  fileName = '',
) {
  if (!Array.isArray(payload?.data) || payload.data.length < 2)
    throw new Error('cwa_wind_payload_invalid');
  const east = payload.data.find(
    (entry) => entry?.header?.parameterNumberName === 'eastward_wind',
  );
  const north = payload.data.find(
    (entry) => entry?.header?.parameterNumberName === 'northward_wind',
  );
  if (!east || !north || !validGridHeader(east.header, east.data))
    throw new Error('cwa_wind_grid_invalid');
  if (
    east.header.nx !== north.header.nx ||
    east.header.ny !== north.header.ny ||
    !validGridHeader(north.header, north.data)
  )
    throw new Error('cwa_wind_components_mismatch');
  const runIso = sourceTime(east.header.refTime, new Date(nowMs).toISOString());
  const forecastHour = Number(east.header.forecastTime);
  const validIso = new Date(
    Date.parse(runIso) +
      (Number.isFinite(forecastHour) ? forecastHour : 0) * 3600_000,
  ).toISOString();
  const grid = {
    nx: east.header.nx,
    ny: east.header.ny,
    lo1: east.header.lo1,
    la1: east.header.la1,
    dx: east.header.dx,
    dy: east.header.dy,
    region: WIND_REGION,
  };
  return {
    model: 'gfs',
    schemaVersion: 1,
    providerId: 'taiwan.cwa.gfs-wind',
    source: CWA_ATTRIBUTION,
    attribution: CWA_ATTRIBUTION,
    license: CWA_TERMS,
    geographicCoverage: 'Taiwan context and surrounding western Pacific grid',
    cycle: {
      date: runIso.slice(0, 10),
      hour: runIso.slice(11, 13),
      runIso,
      validIso,
      forecastHour: Number.isFinite(forecastHour) ? forecastHour : 0,
      sourceFile: safePath(fileName) ? fileName : null,
    },
    level: '1000 hPa',
    units: 'm/s',
    grid,
    stale: false,
    unavailable: false,
    reason: null,
    fetchedAt: nowMs,
    u: Float32Array.from(east.data),
    v: Float32Array.from(north.data),
  };
}

function xmlTag(block, name) {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return boundedText(match?.[1] || '');
}

function xmlCoordinates(block) {
  const raw = new RegExp('<coordinates>([\\s\\S]*?)</coordinates>', 'i').exec(
    block,
  )?.[1];
  if (!raw) return [];
  const result = [];
  for (const token of raw.trim().split(/\s+/).slice(0, 2_000)) {
    const [longitude, latitude] = token.split(',').map(Number);
    if (
      Number.isFinite(longitude) &&
      Number.isFinite(latitude) &&
      longitude >= -180 &&
      longitude <= 180 &&
      latitude >= -90 &&
      latitude <= 90
    )
      result.push([longitude, latitude]);
  }
  return result;
}

function parseCwaLocalTime(label, year) {
  const match = /^(\d{2})月(\d{2})日(\d{2})時$/.exec(label);
  if (!match) return null;
  const [, month, day, hour] = match;
  const value = Date.parse(`${year}-${month}-${day}T${hour}:00:00+08:00`);
  return Number.isFinite(value) ? value : null;
}

/** Normalize the CWA KML shape without copying its markup into the client. */
export function parseCwaTyphoonKml(text, nowMs = Date.now()) {
  if (typeof text !== 'string' || text.length > MAX_KML_BYTES)
    throw new Error('cwa_typhoon_payload_invalid');
  const issuedRaw =
    /<Document>[\s\S]*?<description>([^<]+)<\/description>/i.exec(text)?.[1];
  const issuedMs = Date.parse(issuedRaw || '');
  const issuedAt = Number.isFinite(issuedMs)
    ? new Date(issuedMs).toISOString()
    : new Date(nowMs).toISOString();
  const issuedBaseMs = Number.isFinite(issuedMs)
    ? issuedMs
    : Date.parse(issuedAt);
  const sourceYear = new Date(issuedBaseMs).getUTCFullYear();
  const folderName =
    /<Folder>\s*<name>[^<]*<\/name>\s*<description>[^<]*<\/description>\s*<Folder>\s*<name>([^<]+)/i.exec(
      text,
    )?.[1];
  const placemarks = [
    ...text.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/gi),
  ].map((match) => {
    const block = match[1];
    return {
      name: xmlTag(block, 'name'),
      style: xmlTag(block, 'styleUrl').replace(/^#/, ''),
      coordinates: xmlCoordinates(block),
    };
  });
  const past = placemarks.find(
    (item) => item.style === 'past-track' && item.coordinates.length >= 2,
  );
  const cone = placemarks.find(
    (item) => item.style === 'current' && item.coordinates.length >= 4,
  );
  const current = placemarks.find(
    (item) => item.style === 'current' && item.coordinates.length === 1,
  );
  const forecastSingles = placemarks
    .filter((item) => item.style === 'fcst' && item.coordinates.length === 1)
    .map((item) => ({
      item,
      at: parseCwaLocalTime(item.name, sourceYear),
    }))
    .filter((item) => item.at !== null)
    .sort((a, b) => a.at - b.at);
  const position = current?.coordinates[0] || past?.coordinates.at(-1);
  const forecastPoints = forecastSingles.map(({ item, at }) => ({
    position: {
      longitude: item.coordinates[0][0],
      latitude: item.coordinates[0][1],
    },
    tauHours: Math.max(0, Math.round((at - issuedBaseMs) / 3600_000)),
    windKt: null,
    gustKt: null,
  }));
  const validForecast = forecastPoints.filter(
    (point, index, all) =>
      all.findIndex((candidate) => candidate.tauHours === point.tauHours) ===
      index,
  );
  if (!position || !past || !cone || !validForecast.length)
    return {
      schemaVersion: 1,
      providerId: 'taiwan.cwa.typhoon',
      source: CWA_ATTRIBUTION,
      attribution: CWA_ATTRIBUTION,
      coverage: 'Taiwan and western North Pacific weather context',
      fetchedAt: nowMs,
      stale: false,
      unavailable: false,
      reason: 'CWA bulletin has no complete current geometry',
      storms: [],
    };
  const dayId = new Date(issuedAt).toISOString().slice(2, 10).replace(/-/g, '');
  const id = `tw${dayId}`;
  return {
    schemaVersion: 1,
    providerId: 'taiwan.cwa.typhoon',
    source: CWA_ATTRIBUTION,
    attribution: CWA_ATTRIBUTION,
    coverage: 'Taiwan and western North Pacific weather context',
    fetchedAt: nowMs,
    stale: false,
    unavailable: false,
    reason: null,
    storms: [
      {
        id,
        name: folderName || 'CWA typhoon bulletin',
        classification: 'CWA bulletin',
        basin: 'TW',
        position: { longitude: position[0], latitude: position[1] },
        positionAt: issuedAt,
        advisoryNumber: null,
        issuedAt,
        windKt: null,
        pressureHpa: null,
        movement: { directionDegrees: null, speedKt: null },
        advisoryUrl: null,
        outlookUrl: null,
        geometryStatus: 'current',
        geometryAdvisoryNumber: null,
        forecastPoints: validForecast,
        track: { type: 'LineString', coordinates: past.coordinates },
        cone: { type: 'Polygon', coordinates: [cone.coordinates] },
      },
    ],
  };
}

function json(res, status, value) {
  if (res.destroyed) return;
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    ...(status === 405 ? { Allow: 'GET' } : {}),
  });
  res.end(JSON.stringify(value));
}

function bytes(res, status, value, type = 'application/octet-stream') {
  if (res.destroyed) return;
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'public, max-age=60',
  });
  res.end(Buffer.from(value));
}

function upstreamSignal(timeoutMs) {
  return AbortSignal.timeout(timeoutMs);
}

/** Local/preview adapter for the three CWA-labelled runtime sources. */
export function cwaProxy({
  fetchImpl = fetch,
  now = () => Date.now(),
  timeoutMs = 15_000,
  radarTtlMs = 120_000,
  weatherTtlMs = 300_000,
} = {}) {
  const caches = new Map();
  const inFlight = new Map();

  async function fetchRadarManifest() {
    const signal = upstreamSignal(timeoutMs);
    const response = await fetchImpl(RADAR_URL, {
      method: 'HEAD',
      signal,
      redirect: 'error',
    });
    if (!response.ok) throw new Error('cwa_radar_unavailable');
    const lastModified = response.headers.get('last-modified');
    const latest = sourceTime(lastModified, new Date(now()).toISOString());
    return {
      schemaVersion: 1,
      product: 'radar',
      providerId: 'taiwan.cwa.radar',
      source: CWA_ATTRIBUTION,
      attribution: CWA_ATTRIBUTION,
      license: CWA_TERMS,
      coverage: 'Taiwan and surrounding waters',
      bounds: RADAR_REGION,
      times: [latest],
      latest,
      tileSize: 256,
      maxLevel: 6,
      tilingScheme: 'geographic',
      imageUrl: '/api/taiwan/cwa/radar/image',
      imageWidth: RADAR_IMAGE_WIDTH,
      imageHeight: RADAR_IMAGE_HEIGHT,
      stale: false,
      unavailable: false,
      reason: null,
      fetchedAt: now(),
    };
  }

  async function fetchWind() {
    const signal = upstreamSignal(timeoutMs);
    const listResponse = await fetchImpl(WIND_LIST_URL, {
      signal,
      redirect: 'error',
    });
    if (!listResponse.ok) throw new Error('cwa_wind_list_unavailable');
    const files = await readResponseJsonCapped(listResponse, 64 * 1024, signal);
    if (!Array.isArray(files) || !files.length || !safePath(files[0]))
      throw new Error('cwa_wind_list_invalid');
    const file = files[0];
    const response = await fetchImpl(`${WIND_ROOT}${file}`, {
      signal,
      redirect: 'error',
    });
    if (!response.ok) throw new Error('cwa_wind_unavailable');
    const payload = await readResponseJsonCapped(
      response,
      MAX_WIND_BYTES,
      signal,
    );
    const parsed = parseCwaWindPayload(payload, now(), file);
    const id = `gfs-${file.replace(/\.json$/i, '')}`;
    const manifest = {
      ...parsed,
      u: undefined,
      v: undefined,
      region: WIND_REGION,
      grid: { ...parsed.grid, region: WIND_REGION },
      gridUrl: `/api/taiwan/cwa/wind/grid/${id}.bin?model=gfs`,
    };
    delete manifest.u;
    delete manifest.v;
    return { id, parsed, manifest };
  }

  async function fetchTyphoon() {
    const signal = upstreamSignal(timeoutMs);
    const response = await fetchImpl(TYPHOON_URL, {
      signal,
      redirect: 'error',
      headers: { Accept: 'application/vnd.google-earth.kml+xml,text/xml' },
    });
    if (!response.ok) throw new Error('cwa_typhoon_unavailable');
    return parseCwaTyphoonKml(
      await readResponseTextCapped(response, MAX_KML_BYTES, signal),
      now(),
    );
  }

  async function acquire(key, ttl, load) {
    const previous = caches.get(key);
    if (previous && now() - previous.savedAt < ttl)
      return { value: previous.value, stale: false };
    const { promise } = coalesceProxyRequest(inFlight, key, async () => {
      const value = await load();
      caches.set(key, { value, savedAt: now() });
      return value;
    });
    try {
      return { value: await promise, stale: false };
    } catch (error) {
      if (previous)
        return {
          value: previous.value,
          stale: true,
          error,
        };
      throw error;
    }
  }

  async function handler(req, res) {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    if (req.method !== 'GET')
      return json(res, 405, { error: 'method_not_allowed' });
    try {
      if (pathname === '/radar/manifest') {
        const result = await acquire('radar', radarTtlMs, fetchRadarManifest);
        return json(res, 200, {
          ...result.value,
          stale: result.stale,
          reason: result.stale
            ? 'Cached CWA radar; upstream unavailable'
            : null,
        });
      }
      if (pathname === '/radar/image') {
        const signal = upstreamSignal(timeoutMs);
        const cached = caches.get('radar-image');
        if (cached && now() - cached.savedAt < radarTtlMs)
          return bytes(res, 200, cached.value, 'image/png');
        const response = await fetchImpl(RADAR_URL, {
          signal,
          redirect: 'error',
        });
        if (!response.ok)
          return json(res, 502, { error: 'cwa_radar_unavailable' });
        const value = await readResponseBytesCapped(response, MAX_IMAGE_BYTES);
        caches.set('radar-image', { value, savedAt: now() });
        return bytes(res, 200, value, 'image/png');
      }
      if (pathname === '/typhoon') {
        const result = await acquire('typhoon', weatherTtlMs, fetchTyphoon);
        return json(res, 200, {
          ...result.value,
          stale: result.stale,
          reason: result.stale
            ? 'Cached CWA typhoon bulletin; upstream unavailable'
            : result.value.reason,
        });
      }
      if (pathname === '/wind/manifest') {
        const result = await acquire('wind', weatherTtlMs, fetchWind);
        return json(res, 200, {
          ...result.value.manifest,
          stale: result.stale,
          reason: result.stale ? 'Cached CWA GFS; upstream unavailable' : null,
        });
      }
      const gridMatch = /^\/wind\/grid\/(gfs-[a-z0-9-]+)\.bin$/.exec(pathname);
      if (gridMatch) {
        const state = caches.get('wind')?.value;
        if (!state || state.id !== gridMatch[1])
          return json(res, 404, { error: 'unknown_grid' });
        const components = [state.parsed.u, state.parsed.v];
        const value = Buffer.concat(
          components.map((array) =>
            Buffer.from(array.buffer, array.byteOffset, array.byteLength),
          ),
        );
        return bytes(res, 200, value);
      }
      return json(res, 404, { error: 'not_found' });
    } catch (error) {
      return json(res, 200, {
        schemaVersion: 1,
        providerId: pathname.startsWith('/radar')
          ? 'taiwan.cwa.radar'
          : pathname.startsWith('/wind')
            ? 'taiwan.cwa.gfs-wind'
            : 'taiwan.cwa.typhoon',
        unavailable: true,
        stale: true,
        reason: boundedText(error?.message || 'CWA provider unavailable'),
      });
    }
  }

  return {
    name: 'taiwan-cwa',
    configureServer({ middlewares }) {
      middlewares.use('/api/taiwan/cwa', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/taiwan/cwa', handler);
    },
  };
}

export const cwaProviderEndpoints = Object.freeze({
  radar: RADAR_URL,
  typhoon: TYPHOON_URL,
  wind: WIND_LIST_URL,
});
