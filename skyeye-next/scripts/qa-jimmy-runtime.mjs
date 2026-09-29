import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidenceDir = path.join(root, 'tests/evidence/skyeye-jimmy-full-runtime');
const localUrl = process.env.JIMMY_CANDIDATE_URL || 'http://127.0.0.1:4174/skyeye-next/jimmy/';
const referenceUrl = 'https://godeyes.jimmy-dev.win/';
const viewports = [
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
];
const referenceEvidencePath = path.join(evidenceDir, 'reference-capture.json');
const referenceEvidence = JSON.parse(await readFile(referenceEvidencePath, 'utf8'));

await mkdir(evidenceDir, { recursive: true });
const browser = await puppeteer.launch({
  headless: true,
  args: [
    '--no-sandbox',
    '--enable-webgl',
    '--use-gl=angle',
    '--use-angle=swiftshader-webgl',
    '--ignore-gpu-blocklist',
  ],
});
const result = {
  candidate: { url: new URL(localUrl).origin + new URL(localUrl).pathname, states: [], errors: [], failures: [], harnessWarnings: [] },
  reference: { url: referenceUrl, captures: [], errors: [] },
  screenshots: [],
  interactions: {},
};
let page;
try {
  page = await browser.newPage();
  page.setDefaultTimeout(10000);
  page.setDefaultNavigationTimeout(45000);
  page.on('pageerror', (error) => result.candidate.errors.push(String(error?.name || 'Error')));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      if (message.text().includes(`ws://${new URL(localUrl).host}/`)) result.candidate.harnessWarnings.push('dev_proxy_does_not_forward_vite_hmr_websocket');
      else result.candidate.errors.push(message.text()
        .replace(/([?&](?:token|key|api_key|secret)=)[^&\s]*/gi, '$1[redacted]')
        .slice(0, 240));
    }
  });
  page.on('requestfailed', (request) => {
    const url = new URL(request.url());
    result.candidate.failures.push({ host: url.host, path: url.pathname, kind: request.failure()?.errorText || 'failed' });
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    const url = new URL(response.url());
    result.candidate.failures.push({ host: url.host, path: url.pathname, status: response.status() });
  });

  const response = await page.goto(localUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });
  assert.equal(response?.status(), 200, 'Jimmy route must respond 200');
  console.log('JIMMY_QA: route responded 200; waiting for real runtime mount');
  await page.waitForFunction(() =>
    Boolean(document.body.classList.contains('jimmy-runtime-ready') && window.__skyeyeJimmyRuntime),
    { timeout: 45000 },
  );
  await page.waitForFunction(() => Boolean(window.__skyeyeJimmyInitialLayersReady), { timeout: 45000 });
  await page.evaluate(async () => {
    if (!window.__skyeyeJimmyInitialLayersReady) return;
    await Promise.race([
      window.__skyeyeJimmyInitialLayersReady,
      new Promise((resolve) => setTimeout(resolve, 45000)),
    ]);
  });
  await new Promise((resolve) => setTimeout(resolve, 5000));
  console.log('JIMMY_QA: runtime and initial provider attempts settled; capturing Desktop viewports');

  for (const viewport of viewports) {
    await page.setViewport(viewport);
    await page.waitForFunction(() => window.__skyeyeJimmyRuntime?.getState?.()?.globeTilesLoaded === true, { timeout: 10000 }).catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 700));
    const dimensions = await page.evaluate(() => ({
      innerWidth: window.innerWidth,
      innerHeight: window.innerHeight,
      map: (() => { const node = document.querySelector('#cesiumContainer'); const rect = node.getBoundingClientRect(); return { width: Math.round(rect.width), height: Math.round(rect.height) }; })(),
      runtimeReady: document.querySelector('#jfr-runtime')?.classList.contains('is-ready') || false,
      welcomeHidden: document.querySelector('#first-run-launcher')?.hidden ?? true,
      mapStack: document.querySelector('#jfr-map-source')?.textContent?.trim() || '',
      panels: {
        intelligenceOpen: !document.querySelector('#jfr-intelligence-panel')?.hidden,
        layerDrawerOpen: !document.querySelector('#jfr-layer-drawer')?.hidden,
      },
      nativeHudHidden: ['#intel-hud', '#cockpit-hud'].every((selector) => {
        const node = document.querySelector(selector);
        return !node || getComputedStyle(node).display === 'none';
      }),
      referenceEffectsIsolated: (() => {
        const node = document.querySelector('#scope-mask');
        return !node || getComputedStyle(node).display === 'none';
      })(),
      intelligenceContentContained: (() => {
        const host = document.querySelector('.jfr-intelligence-host');
        return Boolean(host && host.scrollWidth <= host.clientWidth + 1);
      })(),
      hudVisible: !document.querySelector('#jfr-hud-strip')?.hidden,
      nativeActionsContained: (() => {
        const row = document.querySelector('.jfr-operation-bar').getBoundingClientRect();
        const node = document.querySelector('.jfr-native-actions #top-center-actions').getBoundingClientRect();
        return node.left >= row.left && node.right <= row.right && node.top >= row.top && node.bottom <= row.bottom;
      })(),
      mapVisible: (() => {
        const node = document.querySelector('#cesiumContainer');
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && getComputedStyle(node).visibility !== 'hidden';
      })(),
      cctv: window.__skyeyeJimmyRuntime?.getState?.() ? document.querySelector('#jfr-camera-count')?.textContent : '0',
      layerCount: document.querySelector('#jfr-layer-count')?.textContent || '0',
      overflowX: document.documentElement.scrollWidth > window.innerWidth,
      state: window.__skyeyeJimmyRuntime?.getState?.() || null,
      initialLayerResults: window.__skyeyeJimmyInitialLayers || [],
    }));
    assert.equal(dimensions.innerWidth, viewport.width);
    assert.equal(dimensions.innerHeight, viewport.height);
    assert.deepEqual(dimensions.map, { width: viewport.width, height: viewport.height }, 'globe must occupy full viewport');
    assert.equal(dimensions.runtimeReady, true, 'candidate shell must be ready');
    assert.equal(dimensions.welcomeHidden, true, 'upstream onboarding must not replace the runtime');
    assert.match(dimensions.mapStack, /PHOTO2/i, 'Taiwan photo basemap must be active');
    assert.equal(dimensions.nativeHudHidden, true, 'unrelated upstream military HUD must be isolated from Jimmy clone');
    assert.equal(dimensions.referenceEffectsIsolated, true, 'Zhuge scope mask must not crop the Jimmy full-screen map');
    assert.equal(dimensions.intelligenceContentContained, true, 'intelligence rail content must fit without horizontal clipping');
    assert.equal(dimensions.hudVisible, true, 'clone factual HUD must be visible');
    assert.equal(dimensions.nativeActionsContained, true, 'native map controls must remain inside the operation bar');
    assert.equal(dimensions.mapVisible, true, 'the full-screen map must remain visible');
    result.candidate.states.push({ ...viewport, ...dimensions });
    const filename = `candidate-${viewport.width}x${viewport.height}.png`;
    const screenshot = await page.screenshot({ path: path.join(evidenceDir, filename), fullPage: false });
    result.screenshots.push({ file: filename, sha256: createHash('sha256').update(screenshot).digest('hex') });
    console.log(`JIMMY_QA: captured ${viewport.width}x${viewport.height}`);
  }

  await page.setViewport(viewports[0]);
  const click = async (selector) => {
    console.log(`JIMMY_QA: click ${selector}`);
    await page.$eval(selector, (node) => {
      if (node.disabled) throw new Error(`Disabled control: ${node.getAttribute('aria-label') || node.textContent}`);
      node.click();
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    console.log(`JIMMY_QA: click complete ${selector}`);
  };
  console.log('JIMMY_QA: exercising clone panels, HUD, and inputs');
  await click('[data-jimmy-action="layers"]');
  result.interactions.layerDrawerOpened = await page.$eval('#jfr-layer-drawer', (node) => !node.hidden);
  assert.equal(result.interactions.layerDrawerOpened, true);
  await click('[data-jimmy-action="close-layers"]');
  result.interactions.layerDrawerClosed = await page.$eval('#jfr-layer-drawer', (node) => node.hidden);
  assert.equal(result.interactions.layerDrawerClosed, true);
  await click('[data-jimmy-action="contacts"]');
  result.interactions.intelligenceClosed = await page.$eval('#jfr-intelligence-panel', (node) => node.hidden);
  assert.equal(result.interactions.intelligenceClosed, true);
  await click('[data-jimmy-action="contacts"]');
  result.interactions.intelligenceReopened = await page.$eval('#jfr-intelligence-panel', (node) => !node.hidden);
  assert.equal(result.interactions.intelligenceReopened, true);
  await click('[data-jimmy-action="display"]');
  result.interactions.displayControlsOpened = await page.$eval('.jfr-controls-host', (node) => node.classList.contains('is-open'));
  assert.equal(result.interactions.displayControlsOpened, true);
  await click('[data-jimmy-action="display"]');
  await click('[data-jimmy-action="hud"]');
  console.log('JIMMY_QA: inspect HUD toggle state');
  result.interactions.hudButtonPressed = await page.$eval('[data-jimmy-action="hud"]', (node) => node.getAttribute('aria-pressed'));
  result.interactions.hudHiddenAfterToggle = await page.$eval('#jfr-hud-strip', (node) => node.hidden);
  assert.equal(result.interactions.hudButtonPressed, 'false');
  assert.equal(result.interactions.hudHiddenAfterToggle, true);
  await click('[data-jimmy-action="hud"]');
  result.interactions.hudRestored = await page.$eval('#jfr-hud-strip', (node) => !node.hidden);
  assert.equal(result.interactions.hudRestored, true);
  await click('[data-jimmy-action="fullscreen"]');
  console.log('JIMMY_QA: inspect fullscreen');
  await new Promise((resolve) => setTimeout(resolve, 100));
  result.interactions.fullscreenEntered = await page.evaluate(() => Boolean(document.fullscreenElement));
  if (result.interactions.fullscreenEntered) await page.evaluate(() => document.exitFullscreen());
  result.interactions.returnedFromFullscreen = !(await page.evaluate(() => Boolean(document.fullscreenElement)));
  const search = await page.$('#location-search');
  console.log('JIMMY_QA: inspect location search');
  result.interactions.locationSearchAvailable = Boolean(search);
  assert.ok(search, 'native location search must be present in the clone shell');
  await page.$eval('#location-search', (node) => {
    node.value = '台北車站';
    node.dispatchEvent(new Event('input', { bubbles: true }));
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  result.interactions.locationSearchAcceptsInput = await search.evaluate((node) => node.value === '台北車站');
  assert.equal(result.interactions.locationSearchAcceptsInput, true);

  const candidate = await page.evaluate(() => ({
    runtime: window.__skyeyeJimmyRuntime?.getState?.() || null,
    initialLayerResults: window.__skyeyeJimmyInitialLayers || [],
    activeLayers: [...document.querySelectorAll('[data-jimmy-layer][aria-pressed="true"]')].map((node) => node.dataset.jimmyLayer),
  }));
  result.candidate.runtime = candidate;

  result.reference.captures = referenceEvidence.map(({ viewport, status, title, url, sha256 }) => ({
    file: `reference-${viewport.width}x${viewport.height}.png`,
    viewport,
    status,
    title,
    url,
    sha256,
    captureSource: 'previous authenticated-free direct browser capture; no fixture',
  }));
  await writeFile(path.join(evidenceDir, 'runtime-evidence.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser.close();
}
