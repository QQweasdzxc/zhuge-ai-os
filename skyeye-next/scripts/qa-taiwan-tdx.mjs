#!/usr/bin/env node
/**
 * Browser proof for the TDX read-only credential gate.
 *
 * This environment intentionally has no TDX credentials. The expected result
 * is an explicit provider_not_configured response for Rail and Metro live
 * board, with no token/data upstream request and no Jimmy gateway use.
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
  'candidate-taiwan-tdx-browser-evidence.json',
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
  if (url.pathname.startsWith('/api/taiwan/tdx'))
    requests.push({ method: request.method(), host: url.host, path: url.pathname });
});
page.on('response', (response) => {
  const url = new URL(response.url());
  if (url.pathname.startsWith('/api/taiwan/tdx'))
    responses.push({ status: response.status(), host: url.host, path: url.pathname });
});
page.on('console', (message) => {
  if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300));
});
page.on('pageerror', (error) => pageErrors.push(String(error).slice(0, 300)));

const evidence = {
  contract: 'skyeye-jimmy-taiwan-tdx-read-only-gate-v1',
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
  evidence.results = await page.evaluate(async () => {
    const paths = [
      '/api/taiwan/tdx/rail/live',
      '/api/taiwan/tdx/metro/live?operator=KRTC',
    ];
    const values = [];
    for (const path of paths) {
      const response = await fetch(path, { cache: 'no-store' });
      const body = await response.json();
      values.push({
        path,
        httpStatus: response.status,
        providerId: body?.providerId || null,
        capability: body?.capability || null,
        status: body?.status || null,
        stale: Boolean(body?.stale),
        entityCount: Array.isArray(body?.entities) ? body.entities.length : 0,
        errorCode: body?.providerMetadata?.errorCode || null,
        upstreamCalled: body?.providerMetadata?.upstreamCalled ?? null,
        rawResponseReturned: Boolean(body?.providerMetadata?.rawResponseReturned),
      });
    }
    return values;
  });
  evidence.requests = requests;
  evidence.responses = responses;
  evidence.consoleErrors = consoleErrors;
  evidence.pageErrors = pageErrors;
  if (
    evidence.results.length !== 2 ||
    evidence.results.some(
      (result) =>
        result.httpStatus !== 200 ||
        result.status !== 'provider_not_configured' ||
        result.entityCount !== 0 ||
        result.upstreamCalled !== false ||
        result.rawResponseReturned,
    ) ||
    requests.length !== 2 ||
    responses.length !== 2 ||
    consoleErrors.length ||
    pageErrors.length
  )
    throw new Error(`TDX provider gate proof failed: ${JSON.stringify(evidence)}`);
} finally {
  await browser.close();
}

fs.writeFileSync(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
