#!/usr/bin/env node
/**
 * Browser proof for the Taiwan WRA reservoir provider foundation.
 *
 * This is intentionally a provider-contract proof, not a Jimmy visual-parity
 * claim: the candidate has no reservoir layer consumer yet. Only sanitized
 * metadata is persisted; the WRA response body is never written to evidence.
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
    return {
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
    };
  });
  evidence.result = result;
  evidence.requests = requests;
  evidence.responses = responses;
  evidence.consoleErrors = consoleErrors;
  evidence.pageErrors = pageErrors;
  if (result.httpStatus !== 200 || result.providerId !== 'taiwan.wra.reservoir')
    throw new Error(`WRA reservoir provider proof failed: ${JSON.stringify(result)}`);
  if (result.rawResponseReturned || consoleErrors.length || pageErrors.length)
    throw new Error(`WRA reservoir evidence was not sanitized: ${JSON.stringify({ result, consoleErrors, pageErrors })}`);
} finally {
  await browser.close();
}

fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
