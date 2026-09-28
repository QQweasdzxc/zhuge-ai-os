#!/usr/bin/env node
/**
 * Browser proof for the Taiwan WRA reservoir provider foundation.
 *
 * This records sanitized WRA provider and Taiwan reservoir-layer evidence;
 * neither the daily JSON nor the source KML is written to evidence.
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
  'candidate-taiwan-reservoir-browser-evidence.json',
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
  if (!url.pathname.startsWith('/api/taiwan/reservoirs')) return;
  const key = `${request.method()} ${url.pathname}`;
  if (seenRequests.has(key)) return;
  seenRequests.add(key);
  requests.push({ method: request.method(), host: url.host, path: url.pathname });
});
page.on('response', (response) => {
  const url = new URL(response.url());
  if (!url.pathname.startsWith('/api/taiwan/reservoirs')) return;
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

const evidence = {
  contract: 'skyeye-jimmy-taiwan-parity-wra-reservoir-provider-v1',
  runtime: { viewport: '1440x900', appUrl },
  rawResponseReturned: false,
  jimmyGatewayRequestCount: 0,
};

try {
  await page.goto(`${appUrl}/?welcome=0`, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  });
  await page.waitForFunction(
    () => window.__godsEyeView?.viewer && window.__godsEyeView?.dataManager,
    { timeout: 60_000 },
  );
  const result = await page.evaluate(async () => {
    const response = await fetch('/api/taiwan/reservoirs', {
      cache: 'no-store',
    });
    const body = await response.json();
    const shapesResponse = await fetch('/api/taiwan/reservoirs/shapes', {
      cache: 'no-store',
    });
    const shapes = await shapesResponse.json();
    return {
      daily: {
        httpStatus: response.status,
        providerId: body?.providerId || null,
        source: body?.source || null,
        status: body?.status || null,
        stale: Boolean(body?.stale),
        entityCount: Array.isArray(body?.entities) ? body.entities.length : 0,
        firstEntity: Array.isArray(body?.entities) && body.entities[0]
          ? {
              id: body.entities[0].id || null,
              name: body.entities[0].name || null,
              observedAt: body.entities[0].observedAt || null,
            }
          : null,
        dataTimestamp: body?.dataTimestamp || null,
        fetchedAt: body?.fetchedAt || null,
        attribution: body?.attribution || null,
        license: body?.license || null,
        geographicCoverage: body?.geographicCoverage || null,
        cache: body?.providerMetadata?.cache || null,
        rawResponseReturned: Boolean(body?.providerMetadata?.rawResponseReturned),
      },
      shapes: {
        httpStatus: shapesResponse.status,
        providerId: shapes?.providerId || null,
        status: shapes?.status || null,
        stale: Boolean(shapes?.stale),
        entityCount: Array.isArray(shapes?.entities) ? shapes.entities.length : 0,
        firstName: shapes?.entities?.[0]?.name || null,
        geometryCount: Array.isArray(shapes?.entities)
          ? shapes.entities.reduce((sum, entity) => sum + (entity.rings?.length || 0), 0)
          : 0,
        sourceUrl: shapes?.providerMetadata?.sourceUrl || null,
        license: shapes?.license || null,
        rawResponseReturned: Boolean(shapes?.providerMetadata?.rawResponseReturned),
      },
    };
  });
  await page.evaluate(() =>
    window.__godsEyeView.dataManager.setEnabled('taiwan-reservoirs', true, {
      source: 'qa',
    }),
  );
  await page.waitForFunction(
    () => {
      const entry = window.__godsEyeView.dataManager.layers.get('taiwan-reservoirs');
      const stats = entry?.module?.getStats?.();
      return Boolean(entry?.enabled && stats && !stats.loading && stats.status === 'available');
    },
    { timeout: 60_000 },
  );
  const layer = await page.evaluate(() => {
    const entry = window.__godsEyeView.dataManager.layers.get('taiwan-reservoirs');
    const dataSource = window.__godsEyeView.viewer.dataSources.getByName('taiwan-reservoirs')[0];
    return {
      stats: entry?.module?.getStats?.() || null,
      entityCount: dataSource?.entities?.values?.length || 0,
      analystCount: entry?.module?.getAnalystRecords?.().length || 0,
    };
  });
  await page.evaluate(async () => {
    const viewer = window.__godsEyeView.viewer;
    const dataSource = viewer.dataSources.getByName('taiwan-reservoirs')[0];
    if (dataSource) await viewer.flyTo(dataSource);
  });
  await new Promise((resolve) => setTimeout(resolve, 1_500));
  const screenshotPath = path.join(
    evidenceDir,
    'candidate-taiwan-reservoir-layer.png',
  );
  await page.screenshot({ path: screenshotPath, fullPage: false });
  evidence.result = result;
  evidence.layer = { ...layer, screenshot: path.relative(repoRoot, screenshotPath) };
  evidence.requests = requests;
  evidence.responses = responses;
  evidence.consoleErrors = consoleErrors;
  evidence.pageErrors = pageErrors;
  if (
    result.daily.httpStatus !== 200 ||
    result.daily.providerId !== 'taiwan.wra.reservoir' ||
    result.shapes.httpStatus !== 200 ||
    result.shapes.providerId !== 'taiwan.wra.reservoir-shapes' ||
    result.shapes.entityCount === 0 ||
    layer.entityCount === 0 ||
    layer.stats?.status !== 'available'
  )
    throw new Error(`WRA reservoir provider proof failed: ${JSON.stringify(result)}`);
  if (
    result.daily.rawResponseReturned ||
    result.shapes.rawResponseReturned ||
    consoleErrors.length ||
    pageErrors.length
  )
    throw new Error(`WRA reservoir evidence was not sanitized: ${JSON.stringify({ result, consoleErrors, pageErrors })}`);
} finally {
  await browser.close();
}

fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
