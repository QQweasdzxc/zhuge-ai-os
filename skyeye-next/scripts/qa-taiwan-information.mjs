#!/usr/bin/env node
/**
 * Desktop browser proof for the Taiwan information-layer reconstruction.
 *
 * This exercises the official Taiwan adapters added in this checkpoint. The
 * proof records only normalized metadata, layer statistics, request paths and
 * screenshots; upstream response bodies and credentials are never persisted.
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
  'candidate-taiwan-information-browser-evidence.json',
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
const jimmyGatewayRequests = [];
const consoleErrors = [];
const pageErrors = [];
const seenRequests = new Set();
const seenResponses = new Set();
const trackedPaths = [
  '/api/taiwan/marine/wave',
  '/api/taiwan/ports/fishing',
  '/api/taiwan/tdx/highway/live',
  '/api/taiwan/geocode',
];

function isTracked(pathname) {
  return trackedPaths.some((path) => pathname.startsWith(path));
}

page.on('request', (request) => {
  const url = new URL(request.url());
  if (url.hostname === 'godeyes.jimmy-dev.win')
    jimmyGatewayRequests.push(url.pathname);
  if (!isTracked(url.pathname)) return;
  const key = `${request.method()} ${url.pathname}${url.search}`;
  if (seenRequests.has(key)) return;
  seenRequests.add(key);
  requests.push({
    method: request.method(),
    host: url.host,
    path: url.pathname,
    search: url.search,
  });
});

page.on('response', (response) => {
  const url = new URL(response.url());
  if (!isTracked(url.pathname)) return;
  const key = `${response.status()} ${url.pathname}${url.search}`;
  if (seenResponses.has(key)) return;
  seenResponses.add(key);
  responses.push({
    status: response.status(),
    host: url.host,
    path: url.pathname,
    search: url.search,
    contentType: response.headers()['content-type'] || null,
  });
});

page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300));
});
page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 300)));

const evidence = {
  contract: 'skyeye-jimmy-taiwan-information-layers-v1',
  runtime: { viewport: '1440x900', appUrl },
  rawResponseReturned: false,
  jimmyGatewayRequestCount: 0,
};

async function read(pathname) {
  return page.evaluate(async (route) => {
    const response = await fetch(route, { cache: 'no-store' });
    const body = await response.json();
    return {
      path: route,
      httpStatus: response.status,
      providerId: body?.providerId || null,
      source: body?.source || null,
      status: body?.status || null,
      stale: Boolean(body?.stale),
      entityCount: Array.isArray(body?.entities) ? body.entities.length : 0,
      dataTimestamp: body?.dataTimestamp || null,
      fetchedAt: body?.fetchedAt || null,
      errorCode: body?.providerMetadata?.errorCode || null,
      cache: body?.providerMetadata?.cache || null,
      upstreamCalled: body?.providerMetadata?.upstreamCalled ?? null,
      rawResponseReturned: Boolean(body?.providerMetadata?.rawResponseReturned),
    };
  }, pathname);
}

async function waitFor(predicate, label, timeout = 60_000) {
  await page.waitForFunction(predicate, { timeout }).catch((error) => {
    throw new Error(`${label}: ${error.message}`);
  });
}

try {
  await page.goto(`${appUrl}/?welcome=0#v=2&lat=24.9522&lon=121.4950&alt=1300&heading=0&pitch=-90&roll=0&map=nlsc-emap`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await waitFor(
    () => window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager,
    'SkyEye runtime did not initialize',
  );
  await waitFor(
    () => document.getElementById('loading-screen')?.classList.contains('hidden'),
    'SkyEye loading screen did not settle',
  );

  evidence.providers = {
    marine: await read('/api/taiwan/marine/wave'),
    fishingPorts: await read('/api/taiwan/ports/fishing'),
    highwayLive: await read('/api/taiwan/tdx/highway/live'),
    geocode: await read('/api/taiwan/geocode?q=%E5%8F%B0%E5%8C%97%E8%BB%8A%E7%AB%99'),
  };

  await page.evaluate(() =>
    window.__godsEyeView.dataManager.setEnabled('taiwan-marine', true, {
      source: 'qa',
    }),
  );
  await waitFor(
    () => {
      const entry = window.__godsEyeView.dataManager.layers.get('taiwan-marine');
      const stats = entry?.module?.getStats?.();
      return Boolean(
        entry?.enabled &&
          stats &&
          !stats.loading &&
          stats.status === 'available' &&
          stats.portCount > 0 &&
          stats.waveAvailable,
      );
    },
    'Taiwan marine layer did not settle with official evidence',
  );

  const layer = await page.evaluate(() => {
    const entry = window.__godsEyeView.dataManager.layers.get('taiwan-marine');
    const dataSource = window.__godsEyeView.viewer.dataSources.getByName(
      'taiwan-marine',
    )[0];
    return {
      stats: entry?.module?.getStats?.() || null,
      entityCount: dataSource?.entities?.values?.length || 0,
      analystCount: entry?.module?.getAnalystRecords?.().length || 0,
    };
  });
  const screenshotPath = path.join(
    evidenceDir,
    'candidate-taiwan-marine-layer.png',
  );
  await page.screenshot({ path: screenshotPath, fullPage: false });
  evidence.layer = {
    ...layer,
    screenshot: path.relative(repoRoot, screenshotPath),
  };

  const { marine, fishingPorts, highwayLive, geocode } = evidence.providers;
  if (
    marine.httpStatus !== 200 ||
    marine.providerId !== 'taiwan.marine.wave' ||
    marine.status !== 'available' ||
    marine.entityCount < 1 ||
    fishingPorts.httpStatus !== 200 ||
    fishingPorts.providerId !== 'taiwan.moa.fishing-ports' ||
    fishingPorts.status !== 'available' ||
    fishingPorts.entityCount < 1 ||
    highwayLive.httpStatus !== 200 ||
    highwayLive.providerId !== 'taiwan.tdx.highway-live' ||
    highwayLive.status !== 'provider_not_configured' ||
    highwayLive.entityCount !== 0 ||
    highwayLive.upstreamCalled !== false ||
    geocode.httpStatus !== 200 ||
    geocode.providerId !== 'taiwan.geocoder.nlsc' ||
    geocode.status !== 'provider_unavailable' ||
    geocode.entityCount !== 0 ||
    !geocode.errorCode ||
    layer.entityCount < 1 ||
    layer.stats?.status !== 'available' ||
    layer.stats?.portCount < 1 ||
    !layer.stats?.waveAvailable
  )
    throw new Error(`Taiwan information proof failed: ${JSON.stringify(evidence)}`);
} finally {
  evidence.requests = requests;
  evidence.responses = responses;
  evidence.jimmyGatewayRequestCount = jimmyGatewayRequests.length;
  evidence.consoleErrors = consoleErrors;
  evidence.pageErrors = pageErrors;
  await browser.close();
}

fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
if (
  evidence.jimmyGatewayRequestCount ||
  evidence.consoleErrors.length ||
  evidence.pageErrors.length
) {
  console.error(JSON.stringify(evidence, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(evidence, null, 2));
}
