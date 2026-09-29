import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { expandApplicationHtml, APPLICATION_TEMPLATES } from '../../build/application-html.js';

test('the standalone document expands every component once and preserves unique element ids', () => {
  const source = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const html = expandApplicationHtml(source);
  const requestedTemplates = [...source.matchAll(/gev:template ([^\s]+) -->/g)].map((match) => match[1]);
  assert.ok(requestedTemplates.length > 0);
  assert.ok(requestedTemplates.every((name) => APPLICATION_TEMPLATES.includes(name)));
  assert.doesNotMatch(html, /gev:template/);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.match(html, /id="cesiumContainer"/);
  assert.match(html, /type="module" src="\/src\/main.js"/);
});

test('Jimmy full-runtime document assembles as a separate experience without duplicate IDs', () => {
  const source = readFileSync(new URL('../../jimmy-runtime.html', import.meta.url), 'utf8');
  const html = expandApplicationHtml(source);
  assert.doesNotMatch(html, /gev:template/);
  assert.match(html, /id="jfr-runtime"/);
  assert.match(html, /id="cesiumContainer"/);
  assert.match(html, /src="\/src\/standalone\/jimmyMain.js"/);
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
});

test('component selection includes only requested markup and refuses filesystem traversal', () => {
  const html = expandApplicationHtml('<!-- gev:template welcome -->\n');
  assert.match(html, /id="first-run-launcher"/);
  assert.doesNotMatch(html, /id="cesiumContainer"/);
  assert.throws(() => expandApplicationHtml('<!-- gev:template ../../.env -->'), /Unknown application template/);
});
