import {
  NLSC_LAYERS,
  normalizeTaiwanEvidence,
} from '../../../src/data/taiwanProviderContract.js';

export const NLSC_WMTS_ENDPOINT = 'https://wmts.nlsc.gov.tw/wmts';

export function nlscTileUrl(layer = 'emap', z = 0, x = 0, y = 0) {
  const key = String(layer).toLowerCase() === 'photo2' ? 'photo2' : 'emap';
  const descriptor = NLSC_LAYERS[key];
  const safe = (value, min, max) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < min || parsed > max)
      throw new Error('NLSC_TILE_COORDINATE_INVALID');
    return parsed;
  };
  return descriptor.tileTemplate
    .replace('{z}', String(safe(z, 0, 22)))
    .replace('{x}', String(safe(x, 0, 8_388_607)))
    .replace('{y}', String(safe(y, 0, 8_388_607)));
}

export function nlscEvidence({
  layer = 'emap',
  fetchedAt = new Date().toISOString(),
  status = 'available',
  stale = false,
  probe = null,
} = {}) {
  const key = String(layer).toLowerCase() === 'photo2' ? 'photo2' : 'emap';
  const descriptor = NLSC_LAYERS[key];
  return normalizeTaiwanEvidence({
    providerId: 'taiwan.nlsc.wmts',
    source: descriptor.source,
    fetchedAt,
    dataTimestamp: fetchedAt,
    status,
    stale,
    attribution: descriptor.attribution,
    license: descriptor.license,
    geographicCoverage: descriptor.geographicCoverage,
    entities: [],
    features: [],
    providerMetadata: {
      layer: descriptor.layer,
      tileTemplate: descriptor.tileTemplate,
      probe,
      protocol: 'WMTS-compatible URL template',
      browserDirect: true,
    },
  });
}

export async function probeNlscTile({
  fetchImpl = globalThis.fetch,
  layer = 'emap',
  z = 0,
  x = 0,
  y = 0,
  signal,
} = {}) {
  if (typeof fetchImpl !== 'function')
    throw new TypeError('fetchImpl is required');
  const url = nlscTileUrl(layer, z, x, y);
  const response = await fetchImpl(url, {
    method: 'GET',
    signal,
    headers: { accept: 'image/jpeg,image/*' },
  });
  return {
    url,
    status: response.status,
    ok: response.ok,
    contentType: String(response.headers?.get?.('content-type') || ''),
  };
}
