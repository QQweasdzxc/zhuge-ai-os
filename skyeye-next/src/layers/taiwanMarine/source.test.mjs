import assert from 'node:assert/strict';
import test from 'node:test';
import { createTaiwanMarineSource } from './source.js';

test('Taiwan marine source joins official wave and port contracts', async () => {
  const source = createTaiwanMarineSource({
    fetchImpl: async (route) => ({
      ok: true,
      async json() {
        if (route.endsWith('/wave'))
          return {
            providerId: 'taiwan.marine.wave',
            source: 'MOTC',
            status: 'available',
            stale: false,
            fetchedAt: '2026-09-28T00:00:00.000Z',
            dataTimestamp: '2026-09-28T00:00:00.000Z',
            entities: [{ id: 'wave-1' }],
            providerMetadata: { rawResponseReturned: false },
          };
        return {
          providerId: 'taiwan.moa.fishing-ports',
          source: 'MOA',
          status: 'available',
          stale: false,
          fetchedAt: '2026-09-28T00:00:01.000Z',
          dataTimestamp: '2026-09-28T00:00:01.000Z',
          entities: [{ id: 'port-1' }],
          providerMetadata: { rawResponseReturned: false },
        };
      },
    }),
  });
  const snapshot = await source.getSnapshot();
  assert.equal(snapshot.status, 'available');
  assert.equal(snapshot.providerMetadata.waveProviderId, 'taiwan.marine.wave');
  assert.equal(
    snapshot.providerMetadata.portProviderId,
    'taiwan.moa.fishing-ports',
  );
  assert.equal(snapshot.providerMetadata.rawResponseReturned, false);
});

test('Taiwan marine source rejects a malformed provider payload', async () => {
  const source = createTaiwanMarineSource({
    fetchImpl: async () => ({
      ok: true,
      async json() {
        return { status: 'available' };
      },
    }),
  });
  await assert.rejects(source.getSnapshot(), /malformed/);
});
