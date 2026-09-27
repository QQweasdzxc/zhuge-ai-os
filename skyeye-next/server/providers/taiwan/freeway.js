import {
  coalesceProxyRequest,
  readResponseTextCapped,
} from '../common/http.js';

/** Official Taiwan Freeway Bureau live XML feeds used by the parity adapter. */
export const FREEWAY_LIVE_TRAFFIC_URL =
  'https://tisvcloud.freeway.gov.tw/history/motc20/LiveTraffic.xml';
export const FREEWAY_CMS_LIVE_URL =
  'https://tisvcloud.freeway.gov.tw/history/motc20/CMSLive.xml';

const SOURCE = 'Taiwan Freeway Bureau Open Data';
const ATTRIBUTION =
  'Taiwan Freeway Bureau, Ministry of Transportation and Communications';
const LICENSE = 'Open Government Data License, version 1.0';
const COVERAGE = 'Taiwan national freeways';
const MAX_BYTES = 2 * 1024 * 1024;
const LIVE_TRAFFIC_ID = 'taiwan.freeway.live-traffic';
const CMS_ID = 'taiwan.freeway.cms';

function text(value, max = 240) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, max);
}

function tagValue(xml, tag) {
  const match = String(xml || '').match(
    new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i'),
  );
  return match ? text(match[1]) : '';
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

function baseContract(providerId, dataTimestamp, fetchedAt, entities) {
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
      sourceUrl:
        providerId === CMS_ID ? FREEWAY_CMS_LIVE_URL : FREEWAY_LIVE_TRAFFIC_URL,
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
  return baseContract(LIVE_TRAFFIC_ID, updateTime, fetchedAt, entities);
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
  return baseContract(CMS_ID, updateTime, fetchedAt, entities);
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
  ];
}
