#!/usr/bin/env node
/**
 * Browser proof for the Taiwan parity map-source path.
 *
 * This deliberately exercises only the official NLSC WMTS layer. The Jimmy
 * same-origin gateway is never requested and no provider response body is
 * persisted.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const appUrl = process.env.QA_BASE_URL || 'http://127.0.0.1:4174';
const evidenceDir = path.join(repoRoot, 'tests/evidence/skyeye-jimmy-parity');
const screenshotPath = path.join(evidenceDir, 'candidate-taiwan-runtime.png');
const executablePath = process.env.PUPPETEER_EXECUTABLE_PATH
  || await puppeteer.executablePath().catch(() => null);

if (!executablePath || !fs.existsSync(executablePath)) {
  throw new Error('Puppeteer Chrome for Testing is unavailable');
}

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
const nlscResponses = [];
const jimmyRequests = [];
page.on('response', (response) => {
  const url = new URL(response.url());
  if (url.hostname === 'wmts.nlsc.gov.tw') {
    nlscResponses.push({ status: response.status(), path: url.pathname });
  }
  if (url.hostname === 'godeyes.jimmy-dev.win') jimmyRequests.push(url.pathname);
});

const hash = '#v=2&lat=24.9522&lon=121.4950&alt=1300&heading=0&pitch=-90&roll=0&map=nlsc-emap';
await page.goto(`${appUrl}/?welcome=0${hash}`, {
  waitUntil: 'domcontentloaded',
  timeout: 60_000,
});
await page.waitForFunction(() => window.__godsEyeView?.styleManager, {
  timeout: 60_000,
});
await page.waitForFunction(
  () => document.getElementById('loading-screen')?.classList.contains('hidden'),
  { timeout: 60_000 },
);
await page.waitForFunction(
  () => window.__godsEyeView.styleManager.mapStackController.getActiveId() === 'nlsc-emap',
  { timeout: 20_000 },
);
await new Promise((resolve) => setTimeout(resolve, 1_000));

const evidence = await page.evaluate(() => ({
  activeMap: window.__godsEyeView.styleManager.mapStackController.getActiveId(),
  mapSources: [...document.querySelectorAll('.map-stack-chip')].map((chip) => chip.dataset.stackId),
  attributionVisible: /nlsc\.gov\.tw|Taiwan National Land Surveying and Mapping Center/i.test(
    document.body.innerText,
  ),
  retiredJimmyGatewayReference: document.body.innerText.includes('godeyes.jimmy-dev.win'),
}));

await page.screenshot({ path: screenshotPath, fullPage: false });
await browser.close();

const result = {
  url: `${appUrl}/?welcome=0${hash}`,
  ...evidence,
  nlscResponseCount: nlscResponses.length,
  nlscHttp200Count: nlscResponses.filter(({ status }) => status === 200).length,
  jimmyGatewayRequestCount: jimmyRequests.length,
  screenshot: path.relative(repoRoot, screenshotPath),
  rawResponseReturned: false,
};

if (
  result.activeMap !== 'nlsc-emap'
  || !result.mapSources.includes('nlsc-emap')
  || !result.mapSources.includes('nlsc-photo2')
  || !result.attributionVisible
  || result.retiredJimmyGatewayReference
  || result.nlscHttp200Count === 0
  || result.jimmyGatewayRequestCount !== 0
) {
  console.error(JSON.stringify(result, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify(result, null, 2));
}
