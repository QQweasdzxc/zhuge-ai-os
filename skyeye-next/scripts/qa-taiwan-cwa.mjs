#!/usr/bin/env node
/**
 * Browser proof for the Taiwan CWA Wave 1 layers.
 *
 * The proof exercises the real candidate runtime and the real CWA adapter
 * paths. It records only sanitized layer state, request metadata, and
 * screenshots; provider response bodies are never persisted.
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
  'candidate-cwa-browser-evidence.json',
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
const cwaRequests = [];
const cwaResponses = [];
const jimmyGatewayRequests = [];
const consoleErrors = [];
const pageErrors = [];
const requestSeen = new Set();
const responseSeen = new Set();
page.on('request', (request) => {
  const url = new URL(request.url());
  if (url.hostname === 'godeyes.jimmy-dev.win')
    jimmyGatewayRequests.push(url.pathname);
  if (
    url.pathname.startsWith('/api/taiwan/cwa/') ||
    url.hostname === 'cwaopendata.s3.ap-northeast-1.amazonaws.com' ||
    url.hostname === 'c01.twipcam.com'
  ) {
    const key = `${request.method()} ${url.origin}${url.pathname}${url.search}`;
    if (!requestSeen.has(key)) {
      requestSeen.add(key);
      cwaRequests.push({
        method: request.method(),
        host: url.host,
        path: url.pathname,
        search: url.search,
      });
    }
  }
});
page.on('response', (response) => {
  const url = new URL(response.url());
  if (
    url.pathname.startsWith('/api/taiwan/cwa/') ||
    url.hostname === 'cwaopendata.s3.ap-northeast-1.amazonaws.com' ||
    url.hostname === 'c01.twipcam.com'
  ) {
    const key = `${response.status()} ${url.origin}${url.pathname}${url.search}`;
    if (!responseSeen.has(key)) {
      responseSeen.add(key);
      cwaResponses.push({
        status: response.status(),
        host: url.host,
        path: url.pathname,
        search: url.search,
        contentType: response.headers()['content-type'] || null,
      });
    }
  }
});
page.on('console', (message) => {
  if (message.type() === 'error')
    consoleErrors.push(message.text().slice(0, 300));
});
page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 300)));

const hash =
  '#v=2&lat=24.9522&lon=121.4950&alt=1300&heading=0&pitch=-90&roll=0&map=nlsc-emap';
await page.goto(`${appUrl}/?welcome=0${hash}`, {
  waitUntil: 'domcontentloaded',
  timeout: 60_000,
});
await page.waitForFunction(
  () => window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager,
  { timeout: 60_000 },
);
await page.waitForFunction(
  () => document.getElementById('loading-screen')?.classList.contains('hidden'),
  { timeout: 60_000 },
);

const wait = (predicate, label, timeout = 45_000, ...args) =>
  page.waitForFunction(predicate, { timeout }, ...args).catch((error) => {
    throw new Error(`${label}: ${error.message}`);
  });

const clearLayers = async () => {
  await page.evaluate(async () => {
    const manager = window.__godsEyeView.dataManager;
    for (const entry of manager.getAll()) {
      if (entry.enabled)
        await manager.setEnabled(entry.id, false, { source: 'qa' });
    }
  });
};

const readLayer = (id) =>
  page.evaluate((id) => {
    const entry = window.__godsEyeView.dataManager.layers.get(id);
    const module = entry?.module;
    return {
      id,
      enabled: Boolean(entry?.enabled),
      stats: module?.getStats?.() || null,
      diagnostics: module?.getDiagnostics?.() || null,
      params: window.__godsEyeView.dataManager.getLayerParams?.(id) || null,
    };
  }, id);

const enableLayer = async (id, label) => {
  await page.evaluate(
    (id) =>
      window.__godsEyeView.dataManager.setEnabled(id, true, { source: 'qa' }),
    id,
  );
  await wait(
    (id) => {
      const entry = window.__godsEyeView.dataManager.layers.get(id);
      const stats = entry?.module?.getStats?.();
      return Boolean(entry?.enabled && stats && !stats.loading && !stats.error);
    },
    `${label} did not settle`,
    60_000,
    id,
  );
};

const disableLayer = async (id, label) => {
  await page.evaluate(
    (id) =>
      window.__godsEyeView.dataManager.setEnabled(id, false, { source: 'qa' }),
    id,
  );
  await wait(
    (id) => !window.__godsEyeView.dataManager.layers.get(id)?.enabled,
    `${label} did not disable`,
    15_000,
    id,
  );
};

const screenshot = async (name) => {
  const target = path.join(evidenceDir, name);
  await page.screenshot({ path: target, fullPage: false });
  return path.relative(repoRoot, target);
};

const results = {};
try {
  await clearLayers();

  await enableLayer('weather-radar', 'CWA radar');
  const radar = await readLayer('weather-radar');
  if (
    !radar.stats ||
    radar.stats.count < 1 ||
    radar.stats.error ||
    radar.diagnostics?.imageryCount < 1
  )
    throw new Error(`CWA radar evidence incomplete: ${JSON.stringify(radar)}`);
  const radarScreenshot = await screenshot('candidate-cwa-radar.png');
  await disableLayer('weather-radar', 'CWA radar');
  results.radar = {
    status: 'FUNCTIONAL_MATCH',
    state: radar,
    screenshot: radarScreenshot,
  };

  await enableLayer('weather-cyclones', 'CWA typhoon');
  const typhoon = await readLayer('weather-cyclones');
  const typhoonSelection = await page.evaluate(() => {
    const layer =
      window.__godsEyeView.dataManager.layers.get('weather-cyclones').module;
    const stats = layer.getStats?.() || {};
    const diagnostics = layer.getDiagnostics?.() || {};
    const storms = layer.getRowControls?.().list?.items || [];
    const first = storms[0]?.id || null;
    if (first) layer.setParams({ stormId: first, focus: true });
    return { firstStormId: first, stats, diagnostics };
  });
  await wait(
    () =>
      window.__godsEyeView.dataManager.layers
        .get('weather-cyclones')
        .module.getDiagnostics?.().selectedId,
    'CWA typhoon selection did not settle',
    20_000,
  );
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  const typhoonFocused = await readLayer('weather-cyclones');
  if (
    !typhoon.stats ||
    typhoon.stats.count < 1 ||
    typhoon.stats.error ||
    !typhoonSelection.firstStormId
  )
    throw new Error(
      `CWA typhoon evidence incomplete: ${JSON.stringify({ typhoon, typhoonSelection })}`,
    );
  const typhoonScreenshot = await screenshot(
    'candidate-cwa-typhoon-focused.png',
  );
  await disableLayer('weather-cyclones', 'CWA typhoon');
  results.typhoon = {
    status: 'FUNCTIONAL_MATCH',
    state: typhoon,
    focusedState: typhoonFocused,
    selection: typhoonSelection,
    screenshot: typhoonScreenshot,
  };

  await enableLayer('wind', 'CWA wind');
  await page.evaluate(() =>
    window.__godsEyeView.dataManager.layers
      .get('wind')
      .module.setParams({ overlay: 'speed' }),
  );
  const wind = await readLayer('wind');
  if (!wind.stats || wind.stats.count < 1 || wind.stats.error)
    throw new Error(`CWA wind evidence incomplete: ${JSON.stringify(wind)}`);
  const windScreenshot = await screenshot('candidate-cwa-wind.png');
  await disableLayer('wind', 'CWA wind');
  results.wind = {
    status: 'FUNCTIONAL_MATCH',
    state: wind,
    screenshot: windScreenshot,
  };
} finally {
  await browser.close();
}

const evidence = {
  contract: 'skyeye-jimmy-taiwan-parity-cwa-wave-1-v1',
  runtime: 'desktop-1440x900',
  appUrl,
  results,
  cwaRequests,
  cwaResponses,
  jimmyGatewayRequestCount: jimmyGatewayRequests.length,
  consoleErrors,
  pageErrors,
  rawResponseReturned: false,
};

const allLayersPassed = Object.values(results).every(
  (item) => item.status === 'FUNCTIONAL_MATCH',
);
const cwaHttpFailures = cwaResponses.filter(
  ({ status }) => status < 200 || status >= 400,
);
evidence.cwaHttpFailures = cwaHttpFailures;
fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
if (
  !allLayersPassed ||
  jimmyGatewayRequests.length !== 0 ||
  consoleErrors.length ||
  pageErrors.length ||
  cwaHttpFailures.length
) {
  console.error(JSON.stringify(evidence, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(evidence, null, 2));
}
