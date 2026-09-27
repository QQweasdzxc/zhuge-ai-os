/**
 * Taiwan Provider Pack contract shared by the parity candidate and its
 * server-side adapters.
 *
 * This file contains metadata and pure normalization helpers only. It never
 * calls a provider, reads a secret, or knows about the Jimmy same-origin API.
 */

export const TAIWAN_MODES = Object.freeze(['global', 'taiwan-enhanced']);

export const TAIWAN_STATUS = Object.freeze([
  'available',
  'not_configured',
  'provider_unavailable',
  'blocked_provider_unknown',
  'license_review_required',
  'stale',
  'error',
]);

export const NLSC_LAYERS = Object.freeze({
  emap: Object.freeze({
    id: 'nlsc-emap',
    label: 'NLSC EMAP',
    shortLabel: 'EMAP',
    layer: 'EMAP',
    source: 'Taiwan National Land Surveying and Mapping Center WMTS',
    sourceUrl: 'https://wmts.nlsc.gov.tw/wmts/EMAP',
    tileTemplate:
      'https://wmts.nlsc.gov.tw/wmts/EMAP/default/GoogleMapsCompatible/{z}/{x}/{y}',
    attribution: '© Taiwan National Land Surveying and Mapping Center',
    license:
      'Public WMTS endpoint; verify current NLSC terms before production traffic',
    geographicCoverage: 'Taiwan',
  }),
  photo2: Object.freeze({
    id: 'nlsc-photo2',
    label: 'NLSC PHOTO2',
    shortLabel: 'PHOTO2',
    layer: 'PHOTO2',
    source: 'Taiwan National Land Surveying and Mapping Center WMTS',
    sourceUrl: 'https://wmts.nlsc.gov.tw/wmts/PHOTO2',
    tileTemplate:
      'https://wmts.nlsc.gov.tw/wmts/PHOTO2/default/GoogleMapsCompatible/{z}/{x}/{y}',
    attribution: '© Taiwan National Land Surveying and Mapping Center',
    license:
      'Public WMTS endpoint; verify current NLSC terms before production traffic',
    geographicCoverage: 'Taiwan',
  }),
});

/**
 * Registry is deliberately explicit. A reference-only route is not a source
 * merely because a browser observed it; productionUrl is absent until the
 * original provider and terms are identified.
 */
export const TAIWAN_PROVIDER_REGISTRY = Object.freeze([
  Object.freeze({
    providerId: 'taiwan.nlsc.wmts',
    tier: 1,
    capability: 'basemap',
    status: 'available',
    source: NLSC_LAYERS.emap.source,
    sourceUrl: NLSC_LAYERS.emap.sourceUrl,
    attribution: NLSC_LAYERS.emap.attribution,
    license: NLSC_LAYERS.emap.license,
    geographicCoverage: NLSC_LAYERS.emap.geographicCoverage,
    auth: 'none',
    browserDirect: true,
    cache: 'immutable-tile-cache-by-zxy',
  }),
  Object.freeze({
    providerId: 'taiwan.cwa.radar',
    tier: 1,
    capability: 'radar',
    status: 'license_review_required',
    source: 'Central Weather Administration official radar/open-data asset',
    sourceUrl:
      'https://cwaopendata.s3.ap-northeast-1.amazonaws.com/Observation/O-A0058-003.png',
    attribution: 'Central Weather Administration, Taiwan',
    license: 'Verify current CWA open-data terms before production activation',
    geographicCoverage: 'Taiwan and surrounding waters',
    auth: 'none_observed',
    browserDirect: false,
    cache: 'server-read-through-ttl',
  }),
  Object.freeze({
    providerId: 'taiwan.cwa.typhoon',
    tier: 1,
    capability: 'typhoon',
    status: 'license_review_required',
    source: 'CWA-labelled typhoon KML distribution observed in runtime recon',
    sourceUrl:
      'https://c01.twipcam.com/data/live/cwa/W-C0034-002/fifows_typhoon.kml',
    attribution:
      'CWA attribution required; hosting/redistribution terms unresolved',
    license: 'License and original provider boundary unresolved',
    geographicCoverage: 'Taiwan weather context',
    auth: 'none_observed',
    browserDirect: false,
    cache: 'server-read-through-ttl',
  }),
  Object.freeze({
    providerId: 'taiwan.cwa.gfs-wind',
    tier: 1,
    capability: 'wind',
    status: 'license_review_required',
    source: 'CWA-labelled GFS distribution observed in runtime recon',
    sourceUrl: 'https://c01.twipcam.com/data/live/cwa/GFS/1000hPa/list.json',
    attribution:
      'CWA attribution required; hosting/redistribution terms unresolved',
    license: 'License and original provider boundary unresolved',
    geographicCoverage: 'Taiwan weather context',
    auth: 'none_observed',
    browserDirect: false,
    cache: 'server-read-through-ttl',
  }),
  Object.freeze({
    providerId: 'taiwan.taipei.cctv',
    tier: 1,
    capability: 'cctv',
    status: 'license_review_required',
    source: 'Taipei traffic camera media hosts observed in runtime recon',
    sourceUrl: 'https://jtmctrafficcctv2.gov.taipei/',
    attribution: 'Taipei City Government attribution and media terms required',
    license: 'Public reachability is not reuse permission',
    geographicCoverage: 'Taipei',
    auth: 'none_observed',
    browserDirect: true,
    cache: 'catalog-cache-media-direct',
  }),
  Object.freeze({
    providerId: 'taiwan.new-taipei.cctv',
    tier: 1,
    capability: 'cctv',
    status: 'license_review_required',
    source: 'New Taipei traffic camera media hosts observed in runtime recon',
    sourceUrl: 'https://cctvatis3.ntpc.gov.tw/',
    attribution:
      'New Taipei City Government attribution and media terms required',
    license: 'Public reachability is not reuse permission',
    geographicCoverage: 'New Taipei',
    auth: 'none_observed',
    browserDirect: true,
    cache: 'catalog-cache-media-direct',
  }),
  Object.freeze({
    providerId: 'taiwan.freeway.cctv',
    tier: 1,
    capability: 'cctv',
    status: 'license_review_required',
    source: 'Taiwan Freeway Bureau camera media host observed in runtime recon',
    sourceUrl: 'https://cctvn.freeway.gov.tw/',
    attribution: 'Freeway Bureau attribution and media terms required',
    license: 'Public reachability is not reuse permission',
    geographicCoverage: 'Taiwan freeways',
    auth: 'none_observed',
    browserDirect: true,
    cache: 'catalog-cache-media-direct',
  }),
  Object.freeze({
    providerId: 'taiwan.freeway.live',
    tier: 2,
    capability: 'traffic',
    status: 'blocked_provider_unknown',
    source: '',
    sourceUrl: '',
    attribution: '',
    license: 'Unknown',
    geographicCoverage: 'Taiwan freeways',
    auth: 'unknown',
    browserDirect: false,
    cache: 'server-required',
  }),
  Object.freeze({
    providerId: 'taiwan.cms',
    tier: 2,
    capability: 'cms',
    status: 'blocked_provider_unknown',
    source: '',
    sourceUrl: '',
    attribution: '',
    license: 'Unknown',
    geographicCoverage: 'Taiwan',
    auth: 'unknown',
    browserDirect: false,
    cache: 'server-required',
  }),
  Object.freeze({
    providerId: 'taiwan.rail',
    tier: 2,
    capability: 'rail',
    status: 'blocked_provider_unknown',
    source: '',
    sourceUrl: '',
    attribution: '',
    license: 'Unknown',
    geographicCoverage: 'Taiwan',
    auth: 'unknown',
    browserDirect: false,
    cache: 'server-required',
  }),
  Object.freeze({
    providerId: 'taiwan.tdx.metro',
    tier: 2,
    capability: 'metro',
    status: 'not_configured',
    source: 'TDX official API family',
    sourceUrl: 'https://tdx.transportdata.tw/',
    attribution: 'TDX attribution required',
    license: 'TDX API registration and rate terms required',
    geographicCoverage: 'Taiwan metro systems',
    auth: 'server_secret',
    browserDirect: false,
    cache: 'server-cache-coalesced-backoff-stale',
  }),
  Object.freeze({
    providerId: 'taiwan.reservoir',
    tier: 2,
    capability: 'reservoir',
    status: 'license_review_required',
    source: 'Water Resources Agency, Ministry of Economic Affairs',
    sourceUrl:
      'https://opendata.wra.gov.tw/api/v2/51023e88-4c76-4dbc-bbb9-470da690d539?format=JSON&sort=_importdate+asc',
    attribution: 'Water Resources Agency, Ministry of Economic Affairs',
    license: 'Open Government Data License, version 1.0',
    geographicCoverage: 'Taiwan',
    auth: 'none_observed',
    browserDirect: false,
    cache: 'server-required',
  }),
  Object.freeze({
    providerId: 'taiwan.moenv.aqi',
    tier: 2,
    capability: 'aqi',
    status: 'not_configured',
    source: 'Taiwan Ministry of Environment Open Data',
    sourceUrl: 'https://data.moenv.gov.tw/api/v2/aqx_p_432',
    attribution: 'Taiwan Ministry of Environment attribution required',
    license:
      'Open Government Data License, version 1.0; verify current API terms before activation',
    geographicCoverage: 'Taiwan monitoring stations',
    auth: 'server_secret',
    browserDirect: false,
    cache: 'server-read-through-ttl-stale',
  }),
  Object.freeze({
    providerId: 'taiwan.port',
    tier: 2,
    capability: 'port',
    status: 'blocked_provider_unknown',
    source: '',
    sourceUrl: '',
    attribution: '',
    license: 'Unknown',
    geographicCoverage: 'Taiwan ports',
    auth: 'unknown',
    browserDirect: false,
    cache: 'server-required',
  }),
  Object.freeze({
    providerId: 'taiwan.wave',
    tier: 2,
    capability: 'wave',
    status: 'blocked_provider_unknown',
    source: '',
    sourceUrl: '',
    attribution: '',
    license: 'Unknown',
    geographicCoverage: 'Taiwan waters',
    auth: 'unknown',
    browserDirect: false,
    cache: 'server-required',
  }),
  Object.freeze({
    providerId: 'taiwan.geocoder.unknown',
    tier: 2,
    capability: 'geocode',
    status: 'blocked_provider_unknown',
    source: '',
    sourceUrl: '',
    attribution: '',
    license: 'Unknown',
    geographicCoverage: 'Taiwan',
    auth: 'unknown',
    browserDirect: false,
    cache: 'server-required',
  }),
  Object.freeze({
    providerId: 'taiwan.traffic.unknown',
    tier: 2,
    capability: 'traffic',
    status: 'blocked_provider_unknown',
    source: '',
    sourceUrl: '',
    attribution: '',
    license: 'Unknown',
    geographicCoverage: 'Taiwan',
    auth: 'unknown',
    browserDirect: false,
    cache: 'server-required',
  }),
  Object.freeze({
    providerId: 'taiwan.flightaware',
    tier: 2,
    capability: 'flight-tracking',
    status: 'blocked_provider_unknown',
    source: '',
    sourceUrl: '',
    attribution: '',
    license: 'Unknown; do not reuse observed proxy',
    geographicCoverage: 'Taiwan flight context',
    auth: 'unknown',
    browserDirect: false,
    cache: 'server-required',
  }),
]);

function text(value, max = 512) {
  return String(value ?? '')
    .trim()
    .slice(0, max);
}

function finiteNumber(value) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

export function normalizeTaiwanEvidence(
  input = {},
  now = new Date().toISOString(),
) {
  const raw = input && typeof input === 'object' ? input : {};
  const status = TAIWAN_STATUS.includes(raw.status) ? raw.status : 'error';
  const fetchedAt = text(raw.fetchedAt || raw.fetched_at || now, 80);
  const dataTimestamp = text(raw.dataTimestamp || raw.data_timestamp, 80);
  return Object.freeze({
    providerId: text(raw.providerId || raw.provider_id, 120),
    source: text(raw.source, 240),
    fetchedAt,
    dataTimestamp,
    status,
    stale: raw.stale === true || status === 'stale',
    attribution: text(raw.attribution, 240),
    license: text(raw.license, 400),
    geographicCoverage: text(
      raw.geographicCoverage || raw.geographic_coverage,
      240,
    ),
    entities: Object.freeze(
      Array.isArray(raw.entities) ? raw.entities.slice(0, 2000) : [],
    ),
    features: Object.freeze(
      Array.isArray(raw.features) ? raw.features.slice(0, 2000) : [],
    ),
    providerMetadata: Object.freeze(
      raw.providerMetadata && typeof raw.providerMetadata === 'object'
        ? { ...raw.providerMetadata }
        : {},
    ),
  });
}

export function providerRegistryEntry(providerId) {
  return (
    TAIWAN_PROVIDER_REGISTRY.find((entry) => entry.providerId === providerId) ||
    null
  );
}

export function isTaiwanMode(value) {
  return TAIWAN_MODES.includes(value);
}
