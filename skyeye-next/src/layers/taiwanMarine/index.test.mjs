import assert from 'node:assert/strict';
import test from 'node:test';
import { createTaiwanMarineLayer } from './index.js';

function viewerHarness() {
  const sources = [];
  return {
    sources,
    dataSources: {
      add(value) {
        sources.push(value);
        return value;
      },
      remove(value) {
        const index = sources.indexOf(value);
        if (index >= 0) sources.splice(index, 1);
        return true;
      },
    },
  };
}

test('Taiwan marine layer renders sanitized wave and port entities', async () => {
  const viewer = viewerHarness();
  const layer = createTaiwanMarineLayer({
    source: {
      getSnapshot: async () => ({
        status: 'available',
        stale: false,
        source: 'Taiwan official marine and fishing-port open data',
        fetchedAt: '2026-09-28T00:00:00.000Z',
        dataTimestamp: '2026-09-28T00:00:00.000Z',
        wave: {
          status: 'available',
          source: 'MOTC',
          entities: [
            {
              id: 'wave-1',
              latitude: 25,
              longitude: 121,
              observedAt: '2026-09-28T00:00:00.000Z',
              waveHeightM: 0.9,
            },
          ],
        },
        ports: {
          status: 'available',
          source: 'MOA',
          entities: [
            {
              id: 'port-1',
              name: '測試漁港',
              latitude: 25.01,
              longitude: 121.01,
              address: '不應進入 raw payload',
            },
          ],
        },
      }),
    },
  });
  layer.init(viewer);
  layer.enable();
  assert.equal(await layer.update(), true);
  assert.equal(layer.getStats().status, 'available');
  assert.equal(layer.getStats().portCount, 1);
  assert.equal(layer.getStats().waveAvailable, true);
  assert.equal(viewer.sources[0].entities.values.length, 2);
  assert.equal(layer.getAnalystRecords().length, 2);
  layer.disable();
  assert.equal(viewer.sources[0].entities.values.length, 0);
});
