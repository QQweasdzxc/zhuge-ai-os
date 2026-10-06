const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { chromium } = require('playwright');
const { fixtureURL, fixturePath, resolveBrowserExecutable } = require('./browser-executable');
const ROOT = path.join(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'functional-tabs-visual-conformance.html');
const SURFACES = ['generic', 'gas', 'investment', 'worklog', 'ai-board', 'c-mother'];
const STYLE_FIELDS = [
  'fontFamily','fontSize','fontWeight','lineHeight','height','minHeight',
  'paddingTop','paddingRight','paddingBottom','paddingLeft',
  'marginTop','marginRight','marginBottom','marginLeft','columnGap',
  'borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','borderRadius','borderColor','borderBottomColor',
  'backgroundColor','color','textDecoration','whiteSpace','cursor'
];

function decodePng(buffer) {
  let offset = 8, width, height, colorType, bitDepth;
  const chunks = [];
  while (offset < buffer.length) {
    const size = buffer.readUInt32BE(offset); const type = buffer.toString('ascii', offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + size); offset += size + 12;
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); bitDepth = data[8]; colorType = data[9]; }
    if (type === 'IDAT') chunks.push(data);
    if (type === 'IEND') break;
  }
  assert.equal(bitDepth, 8, 'Chromium screenshot must be 8-bit PNG');
  assert.ok([2, 6].includes(colorType), 'Chromium screenshot must be RGB or RGBA');
  const bytesPerPixel = colorType === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(chunks)); const stride = width * bytesPerPixel; const decoded = Buffer.alloc(height * stride);
  let source = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[source++]; const row = y * stride; const prior = row - stride;
    for (let x = 0; x < stride; x++) {
      const value = raw[source++], left = x >= bytesPerPixel ? decoded[row + x - bytesPerPixel] : 0, up = y ? decoded[prior + x] : 0, upperLeft = y && x >= bytesPerPixel ? decoded[prior + x - bytesPerPixel] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = Math.floor((left + up) / 2);
      else if (filter === 4) {
        const p = left + up - upperLeft, pa = Math.abs(p - left), pb = Math.abs(p - up), pc = Math.abs(p - upperLeft);
        predictor = pa <= pb && pa <= pc ? left : pb <= pc ? up : upperLeft;
      } else assert.equal(filter, 0, 'PNG filter is supported');
      decoded[row + x] = (value + predictor) & 255;
    }
  }
  const pixels = Buffer.alloc(width * height * 4);
  for (let i = 0, j = 0; i < decoded.length; i += bytesPerPixel, j += 4) {
    pixels[j] = decoded[i]; pixels[j + 1] = decoded[i + 1]; pixels[j + 2] = decoded[i + 2]; pixels[j + 3] = bytesPerPixel === 4 ? decoded[i + 3] : 255;
  }
  return { width, height, pixels };
}
function pixelDiff(left, right) {
  assert.deepEqual([left.width, left.height], [right.width, right.height], 'screenshot crop dimensions');
  let changed = 0; const samples = [];
  for (let i = 0; i < left.pixels.length; i += 4) {
    if (left.pixels[i] !== right.pixels[i] || left.pixels[i + 1] !== right.pixels[i + 1] || left.pixels[i + 2] !== right.pixels[i + 2] || left.pixels[i + 3] !== right.pixels[i + 3]) { changed++; if(samples.length<8)samples.push({x:(i/4)%left.width,y:Math.floor(i/4/left.width),a:[...left.pixels.subarray(i,i+4)],b:[...right.pixels.subarray(i,i+4)]}); }
  }
  return { changed, samples };
}
async function launch() {
  return chromium.launch({ executablePath: resolveBrowserExecutable() || chromium.executablePath(), headless: true, args: ['--no-sandbox'] });
}

test('Functional Tabs pixel fixture has 0 changed pixels and exact computed/geometry parity at Desktop and Mobile', async () => {
  const browser = await launch();
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const page = await browser.newPage({ viewport, deviceScaleFactor: 1, colorScheme: 'dark', reducedMotion: 'reduce' });
      await page.goto(await fixtureURL(FIXTURE), { waitUntil: 'networkidle' });
      await page.waitForFunction(() => Array.from(document.querySelectorAll('.fixture-case .zhuge-functional-tab')).every(tab => tab.dataset.functionalTabNormalized === 'true'));
      const showSurface = async surface => page.evaluate(name => {
        const roots = Array.from(document.querySelectorAll('.fixture-case'));
        roots.forEach(node => { node.style.display = 'none'; });
        const root = roots.find(node => node.dataset.consumerWrapper === name);
        root.style.display = 'flex'; root.style.position = 'fixed'; root.style.left = '0'; root.style.top = '0'; root.style.zIndex = '9999'; root.style.margin = '0';
      }, surface);
      await showSurface('generic');
      const baselineStyles = await page.locator('[data-consumer-wrapper="generic"] .zhuge-functional-tab.active').evaluate((tab, fields) => Object.fromEntries(fields.map(key => [key, getComputedStyle(tab)[key]])), STYLE_FIELDS);
      const baselineInactive = await page.locator('[data-consumer-wrapper="generic"] .zhuge-functional-tab:not(.active)').first().evaluate((tab, fields) => Object.fromEntries(fields.map(key => [key, getComputedStyle(tab)[key]])), STYLE_FIELDS);
      const baselineGeometry = await page.locator('[data-consumer-wrapper="generic"]').evaluate(root => {
        const rect = selector => { const r = root.querySelector(selector).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; };
        const header = rect('.zhuge-functional-tabs-header'), row = rect('.zhuge-functional-tabs'), content = rect('[data-first-content]');
        const tab = root.querySelector('.zhuge-functional-tab'), icon = tab.querySelector('.zhuge-functional-tab-icon'), label = tab.querySelector('.zhuge-functional-tab-label'), actions = root.querySelector('.zhuge-functional-tabs-actions');
        const tr = tab.getBoundingClientRect(), ir = icon.getBoundingClientRect(), lr = label.getBoundingClientRect(), ar = actions.getBoundingClientRect();
        return {
          headerToTabs: row.top - header.bottom,
          rowHeight: row.height,
          tabsToContent: content.top - row.bottom,
          tabHeight: tr.height,
          iconWidth: ir.width, iconHeight: ir.height, iconCenterY: ir.top + ir.height / 2 - row.top,
          labelCenterY: lr.top + lr.height / 2 - row.top,
          dividerY: row.bottom - 1 - row.top,
          actionsCenterY: ar.top + ar.height / 2 - row.top
        };
      });
      assert.equal(baselineGeometry.headerToTabs, 0, `${viewport.width}: GAS measured header-to-tabs token`);
      assert.equal(baselineGeometry.rowHeight, 45);
      assert.equal(baselineGeometry.tabsToContent, 16, `${viewport.width}: GAS measured tabs-to-content token`);
      assert.equal(baselineGeometry.tabHeight, 44);

      const referencePng = decodePng(await page.locator('[data-consumer-wrapper="generic"]').screenshot({ animations: 'disabled' }));
      for (const surface of SURFACES) {
        await showSurface(surface);
        const root = page.locator(`[data-consumer-wrapper="${surface}"]`);
        const active = root.locator('.zhuge-functional-tab.active');
        const inactive = root.locator('.zhuge-functional-tab:not(.active)').first();
        const activeStyle = await active.evaluate((tab, fields) => Object.fromEntries(fields.map(key => [key, getComputedStyle(tab)[key]])), STYLE_FIELDS);
        const inactiveStyle = await inactive.evaluate((tab, fields) => Object.fromEntries(fields.map(key => [key, getComputedStyle(tab)[key]])), STYLE_FIELDS);
        assert.deepEqual(activeStyle, baselineStyles, `${surface} active tab computed style ${viewport.width}`);
        assert.deepEqual(inactiveStyle, baselineInactive, `${surface} inactive tab computed style ${viewport.width}`);
        const geometry = await root.evaluate(rootNode => {
          const rect = selector => { const r = rootNode.querySelector(selector).getBoundingClientRect(); return { top: r.top, bottom: r.bottom, height: r.height }; };
          const header = rect('.zhuge-functional-tabs-header'), row = rect('.zhuge-functional-tabs'), content = rect('[data-first-content]');
          const tab = rootNode.querySelector('.zhuge-functional-tab'), icon = tab.querySelector('.zhuge-functional-tab-icon'), label = tab.querySelector('.zhuge-functional-tab-label'), actions = rootNode.querySelector('.zhuge-functional-tabs-actions');
          const tr = tab.getBoundingClientRect(), ir = icon.getBoundingClientRect(), lr = label.getBoundingClientRect(), ar = actions.getBoundingClientRect();
          return {headerToTabs:row.top-header.bottom,rowHeight:row.height,tabsToContent:content.top-row.bottom,tabHeight:tr.height,iconWidth:ir.width,iconHeight:ir.height,iconCenterY:ir.top+ir.height/2-row.top,labelCenterY:lr.top+lr.height/2-row.top,dividerY:row.bottom-1-row.top,actionsCenterY:ar.top+ar.height/2-row.top};
        });
        assert.deepEqual(geometry, baselineGeometry, `${surface} geometry ${viewport.width}`);
        const screenshot = decodePng(await root.screenshot({ animations: 'disabled' }));
        const pixels = pixelDiff(referencePng, screenshot);
        assert.equal(pixels.changed, 0, `${surface} ${viewport.width} screenshot maxDiffPixels=0; sample=${JSON.stringify(pixels.samples)}`);
      }

      await showSurface('generic');
      const active = page.locator('[data-consumer-wrapper="generic"] .zhuge-functional-tab.active');
      await active.focus();
      assert.equal(await active.evaluate(tab => getComputedStyle(tab).outlineWidth), '2px');
      const hover = page.locator('[data-consumer-wrapper="generic"] .zhuge-functional-tab').nth(1);
      await page.mouse.move(-10, -10); await hover.hover();
      const hoverStyle = await hover.evaluate(tab => { const s = getComputedStyle(tab); return { backgroundColor:s.backgroundColor,borderColor:s.borderColor,borderBottomColor:s.borderBottomColor,color:s.color }; });
      const activeStyle = await active.evaluate(tab => { const s = getComputedStyle(tab); return { backgroundColor:s.backgroundColor,borderColor:s.borderColor,borderBottomColor:s.borderBottomColor,color:s.color }; });
      assert.deepEqual(hoverStyle, activeStyle, 'hover and active share the shared active presentation');
      assert.equal(await active.evaluate(tab => getComputedStyle(tab).cursor), 'pointer');
      const disabled = await page.locator('[data-consumer-wrapper="generic"] .zhuge-functional-tabs').evaluate(row => {
        const tab = document.createElement('button'); tab.type = 'button'; tab.disabled = true; tab.className = 'zhuge-functional-tab'; tab.textContent = 'Disabled'; row.appendChild(tab); window.ZhugeFunctionalTabs.refresh();
        const style = getComputedStyle(tab), rect = tab.getBoundingClientRect(); return { cursor:style.cursor,opacity:style.opacity,height:rect.height,disabled:tab.disabled };
      });
      assert.deepEqual(disabled, { cursor:'not-allowed',opacity:'0.5',height:44,disabled:true });
      const actionlessGeometry = await page.locator('[data-consumer-wrapper="generic"] .zhuge-functional-tabs').evaluate(row => { const r=row.getBoundingClientRect(),t=row.querySelector('.zhuge-functional-tab').getBoundingClientRect();return {rowHeight:r.height,tabTop:t.top-row.top,tabHeight:t.height}; });
      await page.locator('[data-consumer-wrapper="generic"] .zhuge-functional-tabs-actions').evaluate(node => node.remove());
      const noActionGeometry = await page.locator('[data-consumer-wrapper="generic"] .zhuge-functional-tabs').evaluate(row => { const r=row.getBoundingClientRect(),t=row.querySelector('.zhuge-functional-tab').getBoundingClientRect();return {rowHeight:r.height,tabTop:t.top-row.top,tabHeight:t.height}; });
      assert.deepEqual(noActionGeometry, actionlessGeometry, 'action presence cannot change row geometry');
      await page.close();
    }
  } finally { await browser.close(); }
});
