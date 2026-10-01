import assert from 'node:assert/strict';
import test from 'node:test';
import { createTaiwanReservoirSource } from './source.js';

test('reservoir source joins daily operation facts to official WFS shapes by name', async () => {
  const source = createTaiwanReservoirSource({
    fetchImpl: async (route) => ({
      ok: true,
      async json() {
        if (route.endsWith('/shapes'))
          return {
            providerId: 'taiwan.wra.reservoir-shapes',
            status: 'available',
            stale: false,
            entities: [{ id: 'shape-1', name: '石門水庫', rings: [[[121, 25]]] }],
            providerMetadata: {},
          };
        return {
          providerId: 'taiwan.wra.reservoir',
          status: 'available',
          stale: false,
          dataTimestamp: '2026-09-28T00:00:00.000Z',
          fetchedAt: '2026-09-28T00:00:01.000Z',
          entities: [
            {
              id: 'r1',
              name: '石門水庫',
              observedAt: '2026-09-28T00:00:00.000Z',
              capacityTenThousandM3: 123,
            },
          ],
          providerMetadata: {},
        };
      },
    }),
  });
  const snapshot = await source.getSnapshot();
  assert.equal(snapshot.entities[0].operation.capacityTenThousandM3, 123);
  assert.equal(snapshot.providerMetadata.operationProviderId, 'taiwan.wra.reservoir');
  assert.equal(snapshot.providerMetadata.rawResponseReturned, false);
});
