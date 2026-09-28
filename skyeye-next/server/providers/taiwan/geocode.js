import {
  coalesceProxyRequest,
  readResponseTextCapped,
} from '../common/http.js';

/** Official NLSC address text-query contract. */
export const NLSC_GEOCODE_URL = 'https://api.nlsc.gov.tw/idc/TextQueryAddress/';

const PROVIDER_ID = 'taiwan.geocoder.nlsc';
const SOURCE = 'Taiwan National Land Surveying and Mapping Center';
const ATTRIBUTION = SOURCE;
const LICENSE = 'NLSC API terms and access policy apply';
const COVERAGE = 'Taiwan addresses';
const MAX_BYTES = 256 * 1024;
const MAX_QUERY = 160;

function text(value, max = 240) {
  return String(value ?? '')
    .replace(/[\u0000-\u001f<>]/g, '')
    .trim()
    .slice(0, max);
}

function empty(now, status, errorCode, query, cache = 'empty') {
  return {
    schemaVersion: 1,
    providerId: PROVIDER_ID,
    source: SOURCE,
    fetchedAt: new Date(now()).toISOString(),
    dataTimestamp: '',
    status,
    stale: false,
    attribution: ATTRIBUTION,
    license: LICENSE,
    geographicCoverage: COVERAGE,
    entities: [],
    features: [],
    providerMetadata: {
      sourceUrl: NLSC_GEOCODE_URL,
      query,
      errorCode: text(errorCode || '', 120) || null,
      cache,
      rawResponseReturned: false,
      providerAccessRequired: true,
    },
  };
}

function extractTextValue(xml, names) {
  for (const name of names) {
    const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i').exec(xml);
    if (match?.[1]) return text(match[1], 180);
  }
  return '';
}

function parseResultPayload(payload, nowMs, query) {
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (!trimmed || /PERMISSION DENIED|NOT FOUND/i.test(trimmed))
      return empty(
        () => nowMs,
        'provider_unavailable',
        'NLSC_ACCESS_DENIED',
        query,
      );
    const latitude = Number(
      extractTextValue(trimmed, ['Y', 'Lat', 'Latitude']),
    );
    const longitude = Number(
      extractTextValue(trimmed, ['X', 'Lon', 'Longitude']),
    );
    const address = extractTextValue(trimmed, [
      'FULL_ADDR',
      'Address',
      'address',
    ]);
    if (latitude && longitude)
      return {
        ...empty(() => nowMs, 'available', null, query),
        dataTimestamp: new Date(nowMs).toISOString(),
        entities: [
          {
            id: `${PROVIDER_ID}:${query}`,
            query,
            address: address || query,
            latitude,
            longitude,
          },
        ],
      };
    return empty(
      () => nowMs,
      'provider_unavailable',
      'NLSC_PAYLOAD_INVALID',
      query,
    );
  }
  if (!payload || typeof payload !== 'object')
    return empty(
      () => nowMs,
      'provider_unavailable',
      'NLSC_PAYLOAD_INVALID',
      query,
    );
  const rows = Array.isArray(payload.results)
    ? payload.results
    : Array.isArray(payload.data)
      ? payload.data
      : [];
  const entities = rows
    .slice(0, 20)
    .map((row, index) => {
      const latitude = Number(row?.lat ?? row?.latitude ?? row?.Y);
      const longitude = Number(row?.lon ?? row?.longitude ?? row?.X);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude))
        return null;
      return {
        id: `${PROVIDER_ID}:${index}`,
        query,
        address: text(
          row?.address ?? row?.fullAddress ?? row?.FULL_ADDR ?? query,
          180,
        ),
        latitude,
        longitude,
      };
    })
    .filter(Boolean);
  return {
    ...empty(
      () => nowMs,
      entities.length ? 'available' : 'provider_unavailable',
      entities.length ? null : 'NLSC_PAYLOAD_EMPTY',
      query,
    ),
    dataTimestamp: entities.length ? new Date(nowMs).toISOString() : '',
    entities,
  };
}

/** Read-only NLSC text geocoder; provider access failures are explicit. */
export function nlscGeocodeProxy({
  fetchImpl = fetch,
  now = () => Date.now(),
  timeoutMs = 15_000,
  ttlMs = 15 * 60_000,
} = {}) {
  const cache = new Map();
  const inFlight = new Map();

  async function load(query) {
    const route = `${NLSC_GEOCODE_URL}${encodeURIComponent(query)}/5/B`;
    const response = await fetchImpl(route, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(timeoutMs),
      headers: { Accept: 'application/xml,text/plain,application/json' },
    });
    const textBody = await readResponseTextCapped(response, MAX_BYTES);
    if (!response.ok)
      return empty(
        now,
        'provider_unavailable',
        `NLSC_HTTP_${response.status}`,
        query,
      );
    let payload = textBody;
    if (response.headers.get('content-type')?.includes('json')) {
      try {
        payload = JSON.parse(textBody);
      } catch {
        payload = textBody;
      }
    }
    return parseResultPayload(payload, now(), query);
  }

  async function handler(req, res) {
    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET', 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error_code: 'METHOD_NOT_ALLOWED' }));
      return;
    }
    const query = text(
      new URL(req.url, 'http://localhost').searchParams.get('q'),
      MAX_QUERY,
    );
    if (!query) {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      res.end(
        JSON.stringify(
          empty(now, 'provider_unavailable', 'NLSC_QUERY_REQUIRED', ''),
        ),
      );
      return;
    }
    const key = query.normalize('NFKC').toLowerCase();
    const cached = cache.get(key);
    let result =
      cached && now() - cached.at <= ttlMs
        ? { value: cached.value, cache: 'fresh' }
        : null;
    if (!result) {
      const { promise } = coalesceProxyRequest(inFlight, key, () =>
        load(query),
      );
      try {
        result = { value: await promise, cache: 'miss' };
        cache.set(key, { value: result.value, at: now() });
      } catch (error) {
        result = {
          value: empty(now, 'provider_unavailable', error?.message, query),
          cache: 'empty',
        };
      }
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    res.end(
      JSON.stringify({
        ...result.value,
        providerMetadata: {
          ...result.value.providerMetadata,
          cache: result.cache,
          rawResponseReturned: false,
        },
      }),
    );
  }

  return {
    name: 'taiwan-nlsc-geocoder',
    configureServer({ middlewares }) {
      middlewares.use('/api/taiwan/geocode', handler);
    },
    configurePreviewServer({ middlewares }) {
      middlewares.use('/api/taiwan/geocode', handler);
    },
  };
}
