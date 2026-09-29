import { directionToHeading } from '../../../src/data/directionText.js';
import { toFiniteNumber } from './normalize.js';
import { CCTV_SOURCE_FETCH_TIMEOUT_MS } from './constants.js';

export const TAIPEI_CCTV_CSV_URL =
  'https://data.taipei/api/dataset/50a5c4ec-9515-4c30-b83f-30b66e37053d/resource/d317a3c4-ff08-48af-894e-31dfb5155de3/download';
export const NEW_TAIPEI_CCTV_JSON_URL =
  'https://data.ntpc.gov.tw/api/datasets/157501bf-f1cd-4838-92a7-612770351e43/json';
export const FREEWAY_CCTV_XML_URL =
  'https://tisvcloud.freeway.gov.tw/history/motc20/CCTV.xml';

const TAIPEI_LICENSE =
  'Open metadata; Taipei live traffic image reuse requires the official application/contract';
const NEW_TAIPEI_LICENSE =
  'Government Open Data License 1.0 for point metadata; live media reuse terms require verification';
const FREEWAY_LICENSE =
  'Government open-data catalog; live CCTV media reuse and access notice must be verified';

const TAIWAN_METADATA_ONLY_SOURCE_KINDS = new Set([
  'taipei-open-data-metadata',
  'new-taipei-open-data-metadata',
]);

/**
 * Metadata-only Taiwan catalogs must never fall through to a synthetic frame or
 * an unrelated Street View image. A future authorized live adapter should use
 * a distinct source kind (or explicitly update this boundary).
 */
export function isTaiwanMetadataOnlySourceKind(sourceKind) {
  return TAIWAN_METADATA_ONLY_SOURCE_KINDS.has(String(sourceKind || ''));
}

function decodeXml(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .trim();
}

function xmlTag(block, name) {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return decodeXml(match?.[1]);
}

function splitCsvLine(line) {
  const cells = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === ',' && !quoted) {
      cells.push(cell.trim());
      cell = '';
    } else {
      cell += char;
    }
  }
  cells.push(cell.trim());
  return cells;
}

function parseCsv(text) {
  const lines = String(text || '')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    return Object.fromEntries(
      headers.map((header, index) => [header, values[index] || '']),
    );
  });
}

function taipeiCameraName(row, fallback) {
  return String(
    row['攝影機編號'] ||
      row['攝影機編號位置'] ||
      row.camera ||
      row.name ||
      fallback,
  ).trim();
}

function safeIdPart(value) {
  return String(value || '')
    .replace(/[^a-z0-9_-]+/gi, '-')
    .replace(/^-+|-+$/g, '');
}

export function parseTaipeiCctvCsv(text) {
  return parseCsv(text)
    .map((row, index) => {
      const code = String(
        row['攝影機編號'] ||
          row['攝影機編號位置'] ||
          row.camera ||
          row.id ||
          '',
      ).trim();
      const lat = toFiniteNumber(row.WGSY || row.latitude || row.lat);
      const lon = toFiniteNumber(row.WGSX || row.longitude || row.lon);
      if (!code || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return {
        id: `taipei-cctv-${safeIdPart(code) || index}`,
        name: taipeiCameraName(row, `Taipei CCTV ${code}`),
        city: 'Taipei',
        cityId: 'taipei',
        provider: 'Taipei City Government Open Data',
        lat,
        lon,
        headingDeg: 0,
        headingConfidence: 'unknown',
        pitchDeg: -17,
        fovDeg: 74,
        rangeM: 700,
        mountHeightM: 24,
        feedType: 'image',
        sourceKind: 'taipei-open-data-metadata',
        url: '',
        license: TAIPEI_LICENSE,
        credit: 'Taipei City Government',
        code,
      };
    })
    .filter(Boolean);
}

export function parseNewTaipeiCctvJson(payload) {
  const rows = Array.isArray(payload) ? payload : [];
  return rows
    .map((row, index) => {
      const code = String(row?.areacode || '').trim();
      const lat = toFiniteNumber(row?.latitude);
      const lon = toFiniteNumber(row?.longitude);
      if (!code || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      return {
        id: `new-taipei-cctv-${code}`,
        name: String(
          row.address || `${row.district || 'New Taipei'} CCTV ${code}`,
        ).trim(),
        city: 'New Taipei',
        cityId: 'new-taipei',
        provider: 'New Taipei City Government Open Data',
        lat,
        lon,
        headingDeg: 0,
        headingConfidence: 'unknown',
        pitchDeg: -17,
        fovDeg: 74,
        rangeM: 700,
        mountHeightM: 24,
        feedType: 'image',
        sourceKind: 'new-taipei-open-data-metadata',
        url: '',
        license: NEW_TAIPEI_LICENSE,
        credit: 'New Taipei City Government',
        code,
        sourceIndex: index,
      };
    })
    .filter(Boolean);
}

function freewayFeedUrl(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (
      url.protocol !== 'https:' ||
      !/^cctv[ns]?\.freeway\.gov\.tw$/i.test(url.hostname)
    )
      return '';
    return url.toString();
  } catch {
    return '';
  }
}

export function parseFreewayCctvXml(xml) {
  const blocks = String(xml || '').match(/<CCTV>[\s\S]*?<\/CCTV>/gi) || [];
  return blocks
    .map((block, index) => {
      const id = xmlTag(block, 'CCTVID');
      const lat = toFiniteNumber(xmlTag(block, 'PositionLat'));
      const lon = toFiniteNumber(xmlTag(block, 'PositionLon'));
      const stream = freewayFeedUrl(xmlTag(block, 'VideoStreamURL'));
      if (!id || !Number.isFinite(lat) || !Number.isFinite(lon)) return null;
      const road = xmlTag(block, 'RoadName');
      const direction = xmlTag(block, 'RoadDirection');
      const sectionStart = xmlTag(block, 'Start');
      const sectionEnd = xmlTag(block, 'End');
      const mile = xmlTag(block, 'LocationMile');
      const label = [
        road,
        mile,
        direction,
        sectionStart && sectionEnd ? `${sectionStart} → ${sectionEnd}` : '',
      ]
        .filter(Boolean)
        .join(' ');
      const heading = directionToHeading(
        { N: 'NORTH', S: 'SOUTH', E: 'EAST', W: 'WEST' }[direction] ||
          direction,
        true,
      );
      return {
        id: `freeway-cctv-${safeIdPart(id) || index}`,
        name: label || id,
        city: 'Taiwan Freeways',
        cityId: 'taiwan-freeway',
        provider: 'Taiwan Freeway Bureau Open Data',
        lat,
        lon,
        headingDeg: Number.isFinite(heading) ? heading : 0,
        headingConfidence: Number.isFinite(heading) ? 'source' : 'unknown',
        pitchDeg: -17,
        fovDeg: 74,
        rangeM: 700,
        mountHeightM: 24,
        feedType: 'image',
        sourceKind: 'freeway-open-data',
        url: stream,
        snapshotUrl: stream,
        license: FREEWAY_LICENSE,
        credit: 'Taiwan Freeway Bureau',
        code: id,
      };
    })
    .filter(Boolean);
}

async function readResponseBody(response, maxBytes = 12 * 1024 * 1024) {
  if (!response?.ok || !response.body) return null;
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) return null;
  const reader = response.body.getReader?.();
  if (!reader) return null;
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) return null;
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks, total);
  } finally {
    reader.releaseLock();
  }
}

async function fetchText(
  url,
  { fetchImpl = fetch, timeoutMs = CCTV_SOURCE_FETCH_TIMEOUT_MS } = {},
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: 'application/json,text/csv,application/xml' },
      signal: controller.signal,
    });
    const bytes = await readResponseBody(response);
    if (!bytes) return null;
    const contentType = response.headers.get('content-type') || '';
    const encoding = /big-?5/i.test(contentType) ? 'big5' : 'utf-8';
    return { text: new TextDecoder(encoding).decode(bytes), contentType };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export async function loadTaipeiSourcesFromOpenData(options) {
  const response = await fetchText(TAIPEI_CCTV_CSV_URL, options);
  return response ? parseTaipeiCctvCsv(response.text) : [];
}

export async function loadNewTaipeiSourcesFromOpenData({
  fetchImpl = fetch,
  timeoutMs = CCTV_SOURCE_FETCH_TIMEOUT_MS,
} = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(NEW_TAIPEI_CCTV_JSON_URL, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return [];
    return parseNewTaipeiCctvJson(await response.json());
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}

export async function loadFreewaySourcesFromOpenData(options) {
  const response = await fetchText(FREEWAY_CCTV_XML_URL, options);
  return response ? parseFreewayCctvXml(response.text) : [];
}
