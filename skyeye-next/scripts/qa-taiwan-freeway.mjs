#!/usr/bin/env node
/**
 * Browser proof for the official Freeway live traffic and CMS adapters plus
 * their Taiwan-specific map consumers. It records sanitized layer state and
 * screenshots; provider XML is never persisted.
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
const taiwanRuntimeHash =
  '#v=2&lat=24.9522&lon=121.4950&alt=1300&heading=0&pitch=-90&roll=0&map=nlsc-emap';
const evidenceDir = path.join(repoRoot, 'tests/evidence/skyeye-jimmy-parity');
const evidencePath = path.join(
  evidenceDir,
  'candidate-taiwan-freeway-browser-evidence.json',
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
page.on('request', (request) => {
  const url = new URL(request.url());
  if (url.hostname === 'godeyes.jimmy-dev.win')
    jimmyGatewayRequests.push(url.pathname);
  if (!url.pathname.startsWith('/api/taiwan/freeway/')) return;
  requests.push({
    method: request.method(),
    host: url.host,
    path: url.pathname,
  });
});
page.on('response', (response) => {
  const url = new URL(response.url());
  if (!url.pathname.startsWith('/api/taiwan/freeway/')) return;
  responses.push({
    status: response.status(),
    host: url.host,
    path: url.pathname,
  });
});
page.on('console', (message) => {
  if (message.type() === 'error')
    consoleErrors.push(message.text().slice(0, 300));
});
page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 300)));

const evidence = {
  contract: 'skyeye-jimmy-taiwan-parity-freeway-wave-3-layer-v1',
  runtime: { viewport: '1440x900', appUrl },
  rawResponseReturned: false,
  jimmyGatewayRequestCount: 0,
};
try {
  await page.goto(`${appUrl}/?welcome=0${taiwanRuntimeHash}`, {
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
  await new Promise((resolve) => setTimeout(resolve, 2500));
  const result = await page.evaluate(async () => {
    const read = async (path) => {
      const response = await fetch(path, { cache: 'no-store' });
      const body = await response.json();
      return {
        httpStatus: response.status,
        providerId: body?.providerId || null,
        source: body?.source || null,
        status: body?.status || null,
        stale: Boolean(body?.stale),
        entityCount: Array.isArray(body?.entities) ? body.entities.length : 0,
        dataTimestamp: body?.dataTimestamp || null,
        fetchedAt: body?.fetchedAt || null,
        rawResponseReturned: Boolean(
          body?.providerMetadata?.rawResponseReturned,
        ),
        cache: body?.providerMetadata?.cache || null,
      };
    };
    return {
      live: await read('/api/taiwan/freeway/live'),
      cms: await read('/api/taiwan/freeway/cms'),
      shapes: await read('/api/taiwan/freeway/shapes'),
      cmsStatic: await read('/api/taiwan/freeway/cms-static'),
    };
  });
  const wait = (predicate, label, timeout = 60_000, ...args) =>
    page.waitForFunction(predicate, { timeout }, ...args).catch((error) => {
      throw new Error(`${label}: ${error.message}`);
    });
  const layerProof = {};
  for (const [id, label] of [
    ['taiwan-freeway-live', 'Taiwan freeway traffic'],
    ['taiwan-freeway-cms', 'Taiwan CMS boards'],
  ]) {
    await page.evaluate(
      (layerId) =>
        window.__godsEyeView.dataManager.setEnabled(layerId, true, {
          source: 'qa',
        }),
      id,
    );
    await wait(
      (layerId) => {
        const entry = window.__godsEyeView.dataManager.layers.get(layerId);
        const stats = entry?.module?.getStats?.();
        return Boolean(
          entry?.enabled &&
          stats &&
          !stats.loading &&
          stats.status === 'available',
        );
      },
      `${label} did not settle`,
      60_000,
      id,
    );
    layerProof[id] = await page.evaluate((layerId) => {
      const entry = window.__godsEyeView.dataManager.layers.get(layerId);
      const dataSource =
        window.__godsEyeView.viewer.dataSources.getByName(layerId)[0];
      return {
        stats: entry?.module?.getStats?.() || null,
        entityCount: dataSource?.entities?.values?.length || 0,
      };
    }, id);
    await page.evaluate(async (layerId) => {
      const viewer = window.__godsEyeView.viewer;
      const dataSource = viewer.dataSources.getByName(layerId)[0];
      if (dataSource) await viewer.flyTo(dataSource);
    }, id);
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const shot = path.join(
      evidenceDir,
      id === 'taiwan-freeway-live'
        ? 'candidate-taiwan-freeway-live-layer.png'
        : 'candidate-taiwan-freeway-cms-layer.png',
    );
    await page.screenshot({ path: shot, fullPage: false });
    layerProof[id].screenshot = path.relative(repoRoot, shot);
    await page.evaluate(
      (layerId) =>
        window.__godsEyeView.dataManager.setEnabled(layerId, false, {
          source: 'qa',
        }),
      id,
    );
  }
  evidence.result = result;
  evidence.layerProof = layerProof;
  evidence.requests = requests;
  evidence.responses = responses;
  evidence.jimmyGatewayRequestCount = jimmyGatewayRequests.length;
  evidence.consoleErrors = consoleErrors;
  evidence.pageErrors = pageErrors;
  const valid =
    [result.live, result.cms].every(
      (item) =>
        item.httpStatus === 200 &&
        item.status === 'available' &&
        item.entityCount > 0 &&
        item.rawResponseReturned === false,
    ) &&
    [result.shapes, result.cmsStatic].every(
      (item) =>
        item.httpStatus === 200 &&
        item.status === 'available' &&
        item.entityCount > 0,
    ) &&
    Object.values(layerProof).every(
      (proof) => proof.entityCount > 0 && proof.stats?.status === 'available',
    );
  if (
    !valid ||
    jimmyGatewayRequests.length ||
    consoleErrors.length ||
    pageErrors.length
  )
    throw new Error(
      `Freeway proof failed: ${JSON.stringify({ result, consoleErrors, pageErrors })}`,
    );
} finally {
  await browser.close();
}
fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
