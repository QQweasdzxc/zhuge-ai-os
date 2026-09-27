import {
  coalesceProxyRequest,
  readResponseTextCapped,
} from '../common/http.js';

/** Official Taiwan Freeway Bureau live XML feeds used by the parity adapter. */
export const FREEWAY_LIVE_TRAFFIC_URL =
  'https://tisvcloud.freeway.gov.tw/history/motc20/LiveTraffic.xml';
export const FREEWAY_CMS_LIVE_URL =
  'https://tisvcloud.freeway.gov.tw/history/motc20/CMSLive.xml';
export const FREEWAY_SECTION_SHAPE_URL =
  'https://tisvcloud.freeway.gov.tw/history/motc20/SectionShape.xml';
export const FREEWAY_CMS_STATIC_URL =
  'https://tisvcloud.freeway.gov.tw/history/motc20/CMS.xml';

const SOURCE = 'Taiwan Freeway Bureau Open Data';
const ATTRIBUTION =
  'Taiwan Freeway Bureau, Ministry of Transportation and Communications';
const LICENSE = 'Open Government Data License, version 1.0';
const COVERAGE = 'Taiwan national freeways';
const MAX_BYTES = 2 * 1024 * 1024;
const LIVE_TRAFFIC_ID = 'taiwan.freeway.live-traffic';
const CMS_ID = 'taiwan.freeway.cms';
const SECTION_SHAPE_ID = 'taiwan.freeway.section-shape';
const CMS_STATIC_ID = 'taiwan.freeway.cms-static';

function text(value, max = 240) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, max);
}

function tagValue(xml, tag, max = 240) {
  const match = String(xml || '').match(
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'),
  );
  return match ? text(match[1], max) : '';
}

function tagNumber(xml, tag) {
  const value = Number(tagValue(xml, tag));
  return Number.isFinite(value) ? value : null;
}

function isoOrNull(value) {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function blocks(xml, tag) {
  const expression = new RegExp(
    `<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`,
    'gi',
  );
  return [...String(xml || '').matchAll(expression)].map((match) => match[1]);
}

function baseContract(
  providerId,
  dataTimestamp,
  fetchedAt,
  entities,
  sourceUrl,
) {
  return {
    schemaVersion: 1,
    providerId,
    source: SOURCE,
    fetchedAt,
    dataTimestamp,
    status: 'available',
    stale: false,
    attribution: ATTRIBUTION,
    license: LICENSE,
    geographicCoverage: COVERAGE,
    entities,
    features: [],
    providerMetadata: {
      sourceUrl: sourceUrl,
      updateCadence: 'every 1 minute',
      browserDirect: false,
      rawResponseReturned: false,
    },
  };
}

/** Normalize the official LiveTraffic XML without treating XML as UI data. */
export function parseFreewayLiveTrafficXml(xml, nowMs = Date.now()) {
  const fetchedAt = new Date(nowMs).toISOString();
  const updateTime = isoOrNull(tagValue(xml, 'UpdateTime')) || fetchedAt;
  const entities = blocks(xml, 'LiveTraffic')
    .slice(0, 10_000)
    .map((block) => {
      const id = text(tagValue(block, 'SectionID'), 60);
      if (!id) return null;
      return {
        id,
        sectionId: id,
        travelTimeSeconds: tagNumber(block, 'TravelTime'),
        travelSpeedKph: tagNumber(block, 'TravelSpeed'),
        congestionLevelId:
          text(tagValue(block, 'CongestionLevelID'), 20) || null,
        congestionLevel: tagNumber(block, 'CongestionLevel'),
        dataCollectTime: isoOrNull(tagValue(block, 'DataCollectTime')),
        dataSources: {
          historical: tagNumber(block, 'HasHistorical'),
          vd: tagNumber(block, 'HasVD'),
          avi: tagNumber(block, 'HasAVI'),
          etag: tagNumber(block, 'HasETAG'),
          gvp: tagNumber(block, 'HasGVP'),
          cvp: tagNumber(block, 'HasCVP'),
          others: tagNumber(block, 'HasOthers'),
        },
      };
    })
    .filter(Boolean);
  if (!entities.length) throw new Error('freeway_live_records_empty');
  return baseContract(
    LIVE_TRAFFIC_ID,
    updateTime,
    fetchedAt,
    entities,
    FREEWAY_LIVE_TRAFFIC_URL,
  );
}

/** Normalize the official CMSLive XML and retain message evidence as text. */
export function parseFreewayCmsXml(xml, nowMs = Date.now()) {
  const fetchedAt = new Date(nowMs).toISOString();
  const updateTime = isoOrNull(tagValue(xml, 'UpdateTime')) || fetchedAt;
  const entities = blocks(xml, 'CMSLive')
    .slice(0, 10_000)
    .map((block) => {
      const id = text(tagValue(block, 'CMSID'), 80);
      if (!id) return null;
      const messages = blocks(block, 'Message')
        .slice(0, 8)
        .map((message) => ({
          text: text(tagValue(message, 'Text'), 240),
          type: tagNumber(message, 'Type'),
          priority: tagNumber(message, 'Priority'),
        }))
        .filter((message) => message.text);
      return {
        id,
        cmsId: id,
        messageStatus: tagNumber(block, 'MessageStatus'),
        status: tagNumber(block, 'Status'),
        messages,
        dataCollectTime: isoOrNull(tagValue(block, 'DataCollectTime')),
      };
    })
    .filter(Boolean);
  if (!entities.length) throw new Error('freeway_cms_records_empty');
  return baseContract(
    CMS_ID,
    updateTime,
    fetchedAt,
    entities,
    FREEWAY_CMS_LIVE_URL,
  );
}

function parseWktLineString(value) {
  const match = String(value || '').match(/^LINESTRING\s*\((.+)\)$/i);
  if (!match) return [];
  return match[1]
    .split(',')
    .map((pair) => pair.trim().split(/\s+/).map(Number))
    .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat))
    .slice(0, 10_000)
    .map(([lon, lat]) => [lon, lat]);
}

/** Normalize the official daily SectionShape feed for map-layer placement. */
export function parseFreewaySectionShapeXml(xml, nowMs = Date.now()) {
  const fetchedAt = new Date(nowMs).toISOString();
  const updateTime = isoOrNull(tagValue(xml, 'UpdateTime')) || fetchedAt;
  const entities = blocks(xml, 'SectionShape')
    .slice(0, 10_000)
    .map((block) => {
      const id = text(tagValue(block, 'SectionID'), 60);
      const coordinates = parseWktLineString(
        tagValue(block, 'Geometry', MAX_BYTES),
      );
      if (!id || coordinates.length < 2) return null;
      return { id, sectionId: id, coordinates };
    })
    .filter(Boolean);
  if (!entities.length) throw new Error('freeway_section_shapes_empty');
  return baseContract(
    SECTION_SHAPE_ID,
    updateTime,
    fetchedAt,
    entities,
    FREEWAY_SECTION_SHAPE_URL,
  );
}

/** Normalize the official daily CMS catalog with safe map coordinates. */
export function parseFreewayCmsStaticXml(xml, nowMs = Date.now()) {
  const fetchedAt = new Date(nowMs).toISOString();
  const updateTime = isoOrNull(tagValue(xml, 'UpdateTime')) || fetchedAt;
  const entities = blocks(xml, 'CMS')
    .slice(0, 10_000)
    .map((block) => {
      const id = text(tagValue(block, 'CMSID'), 100);
      const lon = tagNumber(block, 'PositionLon');
      const lat = tagNumber(block, 'PositionLat');
      if (!id || !Number.isFinite(lon) || !Number.isFinite(lat)) return null;
      return {
        id,
        cmsId: id,
        lon,
        lat,
        roadId: text(tagValue(block, 'RoadID'), 40) || null,
        roadName: text(tagValue(block, 'RoadName'), 120) || null,
        direction: text(tagValue(block, 'RoadDirection'), 24) || null,
        locationMile: text(tagValue(block, 'LocationMile'), 40) || null,
        section: {
          start: text(tagValue(block, 'Start'), 120) || null,
          end: text(tagValue(block, 'End'), 120) || null,
        },
      };
    })
    .filter(Boolean);
  if (!entities.length) throw new Error('freeway_cms_static_empty');
  return baseContract(
    CMS_STATIC_ID,
    updateTime,
    fetchedAt,
    entities,
    FREEWAY_CMS_STATIC_URL,
  );
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

function unavailable(now, providerId, sourceUrl, errorCode) {
  return {
    schemaVersion: 1,
    providerId,
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
      sourceUrl,
      errorCode: text(errorCode || 'PROVIDER_UNAVAILABLE', 120),
      rawResponseReturned: false,
    },
  };
}

function createFeed({
  providerId,
  sourceUrl,
  route,
  parse,
  fetchImpl = fetch,
  now = () => Date.now(),
  timeoutMs = 15_000,
  ttlMs = 45_000,
}) {
  let cached = null;
  let cachedAt = 0;
  const inFlight = new Map();

  async function load() {
    const response = await fetchImpl(sourceUrl, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/xml,text/xml' },
    });
    if (!response.ok) throw new Error(`freeway_http_${response.status}`);
    const xml = await readResponseTextCapped(response, MAX_BYTES);
    return parse(xml, now());
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
          rawResponseReturned: false,
        },
      });
    } catch (error) {
      const state = unavailable(now, providerId, sourceUrl, error?.message);
      return writeJson(res, 200, {
        ...state,
        providerMetadata: { ...state.providerMetadata, cache: 'empty' },
      });
    }
  }

  return {
    name: `taiwan-freeway-${providerId === CMS_ID ? 'cms' : 'live'}`,
    configureServer({ middlewares }) {
      middlewares.use(route, handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use(route, handler);
    },
  };
}

/** Official, read-only, bounded Freeway live traffic and CMS adapters. */
export function freewayProxy(options = {}) {
  return [
    createFeed({
      providerId: LIVE_TRAFFIC_ID,
      sourceUrl: FREEWAY_LIVE_TRAFFIC_URL,
      route: '/api/taiwan/freeway/live',
      parse: parseFreewayLiveTrafficXml,
      ...options,
    }),
    createFeed({
      providerId: CMS_ID,
      sourceUrl: FREEWAY_CMS_LIVE_URL,
      route: '/api/taiwan/freeway/cms',
      parse: parseFreewayCmsXml,
      ...options,
    }),
    createFeed({
      providerId: SECTION_SHAPE_ID,
      sourceUrl: FREEWAY_SECTION_SHAPE_URL,
      route: '/api/taiwan/freeway/shapes',
      parse: parseFreewaySectionShapeXml,
      ttlMs: 6 * 60 * 60 * 1000,
      ...options,
    }),
    createFeed({
      providerId: CMS_STATIC_ID,
      sourceUrl: FREEWAY_CMS_STATIC_URL,
      route: '/api/taiwan/freeway/cms-static',
      parse: parseFreewayCmsStaticXml,
      ttlMs: 6 * 60 * 60 * 1000,
      ...options,
    }),
  ];
}
