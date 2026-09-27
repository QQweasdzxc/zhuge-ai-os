import assert from 'node:assert/strict';
import test from 'node:test';
import { createTaiwanProviderCache } from '../../server/providers/taiwan/cache.js';
import {
  NLSC_WMTS_ENDPOINT,
  nlscEvidence,
  nlscTileUrl,
  probeNlscTile,
} from '../../server/providers/taiwan/nlsc.js';
import { createTaiwanDataOrchestrator } from '../../server/providers/taiwan/orchestrator.js';

test('NLSC adapter constructs only official WMTS URLs and rejects unsafe coordinates', () => {
  assert.equal(
    nlscTileUrl('emap', 7, 106, 53),
    `${NLSC_WMTS_ENDPOINT}/EMAP/default/GoogleMapsCompatible/7/106/53`,
  );
  assert.equal(
    nlscTileUrl('photo2', 3, 4, 5),
    `${NLSC_WMTS_ENDPOINT}/PHOTO2/default/GoogleMapsCompatible/3/4/5`,
  );
  assert.throws(
    () => nlscTileUrl('emap', -1, 0, 0),
    /NLSC_TILE_COORDINATE_INVALID/,
  );
  assert.throws(
    () => nlscTileUrl('emap', 1.5, 0, 0),
    /NLSC_TILE_COORDINATE_INVALID/,
  );
  assert.doesNotMatch(nlscTileUrl('emap', 1, 2, 3), /godeyes\.jimmy-dev\.win/);
});

test('NLSC probe returns sanitized network metadata only', async () => {
  const calls = [];
  const result = await probeNlscTile({
    layer: 'emap',
    z: 1,
    x: 2,
    y: 3,
    fetchImpl: async (url, options) => {
      calls.push({
        url,
        method: options.method,
        accept: options.headers.accept,
      });
      return {
        ok: true,
        status: 200,
        headers: {
          get: (name) => (name === 'content-type' ? 'image/jpeg' : ''),
        },
      };
    },
  });

  assert.deepEqual(calls, [
    {
      url: `${NLSC_WMTS_ENDPOINT}/EMAP/default/GoogleMapsCompatible/1/2/3`,
      method: 'GET',
      accept: 'image/jpeg,image/*',
    },
  ]);
  assert.deepEqual(result, {
    url: calls[0].url,
    status: 200,
    ok: true,
    contentType: 'image/jpeg',
  });
  assert.deepEqual(Object.keys(result).sort(), [
    'contentType',
    'ok',
    'status',
    'url',
  ]);
});

test('Taiwan cache coalesces concurrent reads and serves stale evidence after failure', async () => {
  let now = 0;
  const cache = createTaiwanProviderCache({ now: () => now });
  let loads = 0;
  let release;
  const first = cache.getOrLoad(
    'probe',
    async () => {
      loads++;
      await new Promise((resolve) => {
        release = resolve;
      });
      return 'value';
    },
    { ttlMs: 10 },
  );
  const second = cache.getOrLoad(
    'probe',
    async () => {
      loads++;
      return 'unexpected';
    },
    { ttlMs: 10 },
  );
  await Promise.resolve();
  assert.equal(loads, 1);
  release();
  assert.equal((await first).value, 'value');
  assert.equal((await second).value, 'value');
  now = 11;
  const stale = await cache.getOrLoad(
    'probe',
    async () => {
      throw new Error('provider unavailable');
    },
    { ttlMs: 10, allowStale: true },
  );
  assert.equal(stale.cache, 'stale-fallback');
  assert.equal(stale.value, 'value');
});

test('orchestrator exposes the confirmed NLSC spike without reading secrets', async () => {
  const previousMode = process.env.SKYEYE_DATA_MODE;
  process.env.SKYEYE_DATA_MODE = 'taiwan-enhanced';
  const calls = [];
  try {
    const orchestrator = createTaiwanDataOrchestrator({
      fetchImpl: async (url) => {
        calls.push(url);
        return {
          ok: true,
          status: 200,
          headers: { get: () => 'image/jpeg' },
        };
      },
      now: () => Date.parse('2026-09-28T00:00:00.000Z'),
    });
    const first = await orchestrator.readNlsc({ layer: 'emap', probe: true });
    const second = await orchestrator.readNlsc({ layer: 'emap', probe: true });
    assert.equal(orchestrator.mode, 'taiwan-enhanced');
    assert.equal(first.providerId, 'taiwan.nlsc.wmts');
    assert.equal(first.status, 'available');
    assert.equal(first.providerMetadata.probe.status, 200);
    assert.equal(second.providerMetadata.cache, 'fresh');
    assert.equal(calls.length, 1);
    assert.ok(calls[0].startsWith(NLSC_WMTS_ENDPOINT));
    assert.equal(
      orchestrator.describe('taiwan.nlsc.wmts').sourceUrl,
      'https://wmts.nlsc.gov.tw/wmts/EMAP',
    );
    assert.equal(
      nlscEvidence({ layer: 'emap' }).providerId,
      'taiwan.nlsc.wmts',
    );
  } finally {
    if (previousMode === undefined) delete process.env.SKYEYE_DATA_MODE;
    else process.env.SKYEYE_DATA_MODE = previousMode;
  }
});
