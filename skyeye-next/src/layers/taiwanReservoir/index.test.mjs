import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createTaiwanReservoirLayer,
} from './index.js';

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

test('Taiwan reservoir layer renders official outline and operation metadata', async () => {
  const viewer = viewerHarness();
  const layer = createTaiwanReservoirLayer({
    source: {
      getSnapshot: async () => ({
        status: 'available',
        stale: false,
        source: 'WRA',
        fetchedAt: '2026-09-28T00:00:00.000Z',
        dataTimestamp: '2026-09-28T00:00:00.000Z',
        providerMetadata: { operationStatus: 'available' },
        entities: [
          {
            id: 'shape-1',
            name: '石門水庫',
            rings: [
              [
                [121, 25],
                [121.01, 25],
                [121.01, 25.01],
              ],
            ],
            operation: {
              observedAt: '2026-09-28T00:00:00.000Z',
              capacityTenThousandM3: 123,
            },
          },
        ],
      }),
    },
  });
  layer.init(viewer);
  layer.enable();
  assert.equal(await layer.update(), true);
  assert.equal(layer.getStats().count, 1);
  assert.equal(viewer.sources[0].entities.values.length, 2);
  assert.equal(layer.getAnalystRecords()[0].name, '石門水庫');
  layer.disable();
  assert.equal(viewer.sources[0].entities.values.length, 0);
});
