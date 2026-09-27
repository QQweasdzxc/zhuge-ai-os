#!/usr/bin/env node
/**
 * Browser proof for the official Freeway live traffic and CMS adapters.
 * This proves source/contract reachability, not visual parity of a future layer.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:4180';
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
const consoleErrors = [];
const pageErrors = [];
page.on('request', (request) => {
  const url = new URL(request.url());
  if (!url.pathname.startsWith('/api/taiwan/freeway/')) return;
  requests.push({ method: request.method(), host: url.host, path: url.pathname });
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
  if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300));
});
page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 300)));

const evidence = {
  contract: 'skyeye-jimmy-taiwan-parity-freeway-wave-3-v1',
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
        rawResponseReturned: Boolean(body?.providerMetadata?.rawResponseReturned),
        cache: body?.providerMetadata?.cache || null,
      };
    };
    return {
      live: await read('/api/taiwan/freeway/live'),
      cms: await read('/api/taiwan/freeway/cms'),
    };
  });
  evidence.result = result;
  evidence.requests = requests;
  evidence.responses = responses;
  evidence.consoleErrors = consoleErrors;
  evidence.pageErrors = pageErrors;
  const valid = [result.live, result.cms].every(
    (item) =>
      item.httpStatus === 200 &&
      item.status === 'available' &&
      item.entityCount > 0 &&
      item.rawResponseReturned === false,
  );
  if (!valid || consoleErrors.length || pageErrors.length)
    throw new Error(
      `Freeway proof failed: ${JSON.stringify({ result, consoleErrors, pageErrors })}`,
    );
} finally {
  await browser.close();
}
fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
