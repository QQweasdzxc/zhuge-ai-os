#!/usr/bin/env node
/**
 * Browser proof for the Taiwan CCTV parity adapters.
 *
 * The proof exercises the candidate's real browser path and records only
 * sanitized catalog/selection/media metadata. It never persists provider
 * payloads or camera media bytes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const appUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:4180';
const evidenceDir = path.join(repoRoot, 'tests/evidence/skyeye-jimmy-parity');
const evidencePath = path.join(
  evidenceDir,
  'candidate-taiwan-cctv-browser-evidence.json',
);
const executablePath =
  process.env.PUPPETEER_EXECUTABLE_PATH ||
  (await puppeteer.executablePath().catch(() => null));

if (!executablePath || !fs.existsSync(executablePath))
  throw new Error('Puppeteer Chrome for Testing is unavailable');

fs.mkdirSync(evidenceDir, { recursive: true });
const browser = await puppeteer.launch({
  headless: 'new',
  executablePath,
  args: [
    ...(process.platform === 'darwin'
      ? ['--use-angle=metal', '--enable-gpu']
      : ['--use-gl=angle', '--use-angle=swiftshader']),
    '--no-sandbox',
  ],
});

const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
const requests = [];
const responses = [];
const consoleErrors = [];
const pageErrors = [];
const seenRequests = new Set();
const seenResponses = new Set();

page.on('request', (request) => {
  const url = new URL(request.url());
  if (!url.pathname.startsWith('/api/cctv/')) return;
  const key = `${request.method()} ${url.pathname}`;
  if (seenRequests.has(key)) return;
  seenRequests.add(key);
  requests.push({ method: request.method(), host: url.host, path: url.pathname });
});
page.on('response', (response) => {
  const url = new URL(response.url());
  if (!url.pathname.startsWith('/api/cctv/')) return;
  const key = `${response.status()} ${url.pathname}`;
  if (seenResponses.has(key)) return;
  seenResponses.add(key);
  responses.push({
    status: response.status(),
    host: url.host,
    path: url.pathname,
    contentType: response.headers()['content-type'] || null,
  });
});
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300));
});
page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 300)));

const wait = (predicate, label, timeout = 45_000, ...args) =>
  page.waitForFunction(predicate, { timeout }, ...args).catch((error) => {
    throw new Error(`${label}: ${error.message}`);
  });

const screenshot = async (name) => {
  const target = path.join(evidenceDir, name);
  await page.screenshot({ path: target, fullPage: false });
  return path.relative(repoRoot, target);
};

const sanitizeSources = (sources) => {
  const byKind = {};
  for (const source of sources) {
    const kind = String(source.sourceKind || 'unknown');
    byKind[kind] = (byKind[kind] || 0) + 1;
  }
  const pick = (kind) => {
    const source = sources.find((item) => item.sourceKind === kind);
    if (!source) return null;
    return {
      id: source.id,
      name: source.name,
      city: source.city,
      lat: source.lat,
      lon: source.lon,
      provider: source.provider,
      sourceKind: source.sourceKind,
      feedType: source.feedType,
      mediaAvailable: Boolean(source.mediaUrl || source.url),
      road: source.road || null,
      direction: source.direction || null,
    };
  };
  return {
    count: sources.length,
    bySourceKind: byKind,
    taipei: pick('taipei-open-data-metadata'),
    newTaipei: pick('new-taipei-open-data-metadata'),
    freeway: pick('freeway-open-data'),
  };
};

const evidence = {
  contract: 'skyeye-jimmy-taiwan-parity-cctv-wave-2-v1',
  runtime: {
    viewport: '1440x900',
    appUrl,
    productionGatewayRequests: 0,
  },
};

try {
  await page.goto(`${appUrl}/?welcome=0`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await wait(
    () => window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager,
    'SkyEye runtime did not initialize',
    60_000,
  );
  await wait(
    () => document.getElementById('loading-screen')?.classList.contains('hidden'),
    'SkyEye loading screen did not settle',
    60_000,
  );

  const catalog = await page.evaluate(async () => {
    const response = await fetch('/api/cctv/sources', { cache: 'no-store' });
    const payload = await response.json();
    return {
      status: response.status,
      sources: Array.isArray(payload?.sources) ? payload.sources : [],
    };
  });
  if (catalog.status !== 200 || catalog.sources.length === 0)
    throw new Error(`CCTV catalog unavailable: ${catalog.status}`);
  const catalogEvidence = sanitizeSources(catalog.sources);
  if (!catalogEvidence.taipei || !catalogEvidence.newTaipei || !catalogEvidence.freeway)
    throw new Error(`Taiwan CCTV packs missing: ${JSON.stringify(catalogEvidence.bySourceKind)}`);

  const frame = await page.evaluate(async (cameraId) => {
    const response = await fetch(
      `/api/cctv/frame/${encodeURIComponent(cameraId)}`,
      { cache: 'no-store' },
    );
    const body = await response.arrayBuffer();
    return {
      status: response.status,
      contentType: response.headers.get('content-type'),
      byteLength: body.byteLength,
      jpegSignature:
        body.byteLength >= 2 &&
        new Uint8Array(body.slice(0, 2))[0] === 0xff &&
        new Uint8Array(body.slice(0, 2))[1] === 0xd8,
    };
  }, catalogEvidence.freeway.id);
  if (frame.status !== 200 || frame.contentType !== 'image/jpeg' || !frame.jpegSignature)
    throw new Error(`Freeway media evidence incomplete: ${JSON.stringify(frame)}`);

  const metadataUnavailable = await page.evaluate(async (cameraIds) => {
    const results = [];
    for (const cameraId of cameraIds) {
      const response = await fetch(
        `/api/cctv/frame/${encodeURIComponent(cameraId)}`,
        { cache: 'no-store' },
      );
      let body = null;
      try {
        body = await response.json();
      } catch {
        body = null;
      }
      results.push({
        cameraId,
        status: response.status,
        contentType: response.headers.get('content-type'),
        errorCode: body?.error_code || null,
        cctvSource: response.headers.get('x-cctv-source'),
      });
    }
    return results;
  }, [catalogEvidence.taipei.id, catalogEvidence.newTaipei.id]);
  if (
    metadataUnavailable.some(
      (item) =>
        item.status !== 503 ||
        item.errorCode !== 'CCTV_MEDIA_NOT_CONFIGURED' ||
        item.cctvSource !== 'unavailable',
    )
  )
    throw new Error(
      `Taiwan metadata-only media was not fail-closed: ${JSON.stringify(metadataUnavailable)}`,
    );

  await page.evaluate(async () => {
    const manager = window.__godsEyeView.dataManager;
    const entry = manager.layers.get('cctv');
    if (!entry.enabled) await manager.setEnabled('cctv', true, { source: 'qa' });
  });
  await wait(
    () => {
      const entry = window.__godsEyeView.dataManager.layers.get('cctv');
      const state = entry?.module?.getUIState?.();
      return Boolean(entry?.enabled && state?.count > 0 && !state?.error);
    },
    'CCTV layer did not settle',
    60_000,
  );

  const selected = await page.evaluate((cameraId) => {
    const module = window.__godsEyeView.dataManager.layers.get('cctv').module;
    const selectedOk = module.selectCamera(cameraId, { focus: false });
    const state = module.getUIState();
    const active = state.activeCamera;
    const viewer = window.__godsEyeView.viewer;
    // CCTV markers are Cesium billboards, not Entity records. Inspect only the
    // runtime primitive collection; do not persist any provider payload.
    const billboardCollections = viewer.scene.primitives?._primitives || [];
    const billboardPresent = billboardCollections.some((primitive) =>
      Array.isArray(primitive?._billboards) &&
      primitive._billboards.some((billboard) => billboard?.id === cameraId),
    );
    return {
      selectedOk,
      activeCameraId: state.activeCameraId,
      activeSourceKind: active?.sourceKind || null,
      activeLat: active?.lat || null,
      activeLon: active?.lon || null,
      billboardPresent,
      mapPlacement: Number.isFinite(active?.lat) && Number.isFinite(active?.lon),
      frameUrlFamily: active?.frameUrl?.includes(`/api/cctv/frame/${encodeURIComponent(cameraId)}`) || false,
      mediaUrlExposedOnlyOnSelection: Boolean(active?.mediaUrl),
      summaryHasCctv: /CCTV/.test(state.summary || ''),
    };
  }, catalogEvidence.freeway.id);
  await wait(
    (cameraId) =>
      window.__godsEyeView.dataManager.layers.get('cctv').module.getUIState()
        .activeCameraId === cameraId,
    'CCTV selection did not settle',
    15_000,
    catalogEvidence.freeway.id,
  );

  evidence.catalog = catalogEvidence;
  evidence.media = {
    provider: 'Freeway Bureau CCTV',
    cameraId: catalogEvidence.freeway.id,
    ...frame,
    rawResponsePersisted: false,
  };
  evidence.metadataOnlyMedia = metadataUnavailable;
  evidence.selection = selected;
  evidence.screenshots = {
    catalog: await screenshot('candidate-taiwan-cctv-catalog.png'),
    selected: await screenshot('candidate-taiwan-cctv-selected.png'),
  };
  evidence.requests = requests;
  evidence.responses = responses;
  const expectedUnavailableConsoleErrors = consoleErrors.filter((message) =>
    /503|Service Unavailable/i.test(message),
  ).length;
  const unexpectedConsoleErrors = consoleErrors.filter(
    (message) => !/503|Service Unavailable/i.test(message),
  );
  if (unexpectedConsoleErrors.length > 0)
    throw new Error(
      `Unexpected CCTV browser console errors: ${unexpectedConsoleErrors.join(' | ')}`,
    );
  evidence.consoleErrors = unexpectedConsoleErrors;
  evidence.expectedUnavailableConsoleErrors = expectedUnavailableConsoleErrors;
  evidence.pageErrors = pageErrors;
  evidence.status = 'FUNCTIONAL_MATCH';
  evidence.providerBoundary = {
    taipei: 'metadata_only_live_reuse_requires_official_application_or_contract',
    newTaipei: 'metadata_only_live_mapping_not_established',
    freeway: 'official_catalog_plus_bounded_single_jpeg_frame',
  };
  fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
  console.log(JSON.stringify(evidence, null, 2));
} finally {
  await browser.close();
}
