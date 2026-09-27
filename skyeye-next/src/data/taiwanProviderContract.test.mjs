import assert from 'node:assert/strict';
import test from 'node:test';
import {
  NLSC_LAYERS,
  TAIWAN_MODES,
  TAIWAN_PROVIDER_REGISTRY,
  isTaiwanMode,
  normalizeTaiwanEvidence,
  providerRegistryEntry,
} from './taiwanProviderContract.js';

test('Taiwan contract is provider-neutral and contains no Jimmy gateway dependency', () => {
  assert.deepEqual(TAIWAN_MODES, ['global', 'taiwan-enhanced']);
  assert.ok(TAIWAN_PROVIDER_REGISTRY.length >= 10);
  assert.equal(
    TAIWAN_PROVIDER_REGISTRY.some((entry) =>
      String(entry.sourceUrl || '').includes('godeyes.jimmy-dev.win/api/'),
    ),
    false,
  );
  assert.equal(providerRegistryEntry('taiwan.nlsc.wmts').status, 'available');
  assert.equal(
    providerRegistryEntry('taiwan.tdx.metro').status,
    'not_configured',
  );
  assert.equal(
    providerRegistryEntry('taiwan.port').status,
    'blocked_provider_unknown',
  );
});

test('NLSC layers preserve official source, attribution and coverage metadata', () => {
  for (const layer of Object.values(NLSC_LAYERS)) {
    assert.match(layer.tileTemplate, /^https:\/\/wmts\.nlsc\.gov\.tw\/wmts\//);
    assert.match(layer.attribution, /National Land Surveying/);
    assert.equal(layer.geographicCoverage, 'Taiwan');
  }
});

test('normalized evidence is bounded, explicit and keeps stale status truthful', () => {
  const evidence = normalizeTaiwanEvidence({
    providerId: 'taiwan.test',
    source: 'Test provider',
    fetchedAt: '2026-09-28T00:00:00.000Z',
    dataTimestamp: '2026-09-27T23:59:00.000Z',
    status: 'stale',
    stale: false,
    entities: [{ id: 1 }],
    features: [{ type: 'Feature' }],
    providerMetadata: { request: 'sanitized' },
  });

  assert.equal(evidence.providerId, 'taiwan.test');
  assert.equal(evidence.status, 'stale');
  assert.equal(evidence.stale, true);
  assert.equal(evidence.entities.length, 1);
  assert.equal(evidence.features.length, 1);
  assert.equal(evidence.providerMetadata.request, 'sanitized');
  assert.equal(isTaiwanMode('global'), true);
  assert.equal(isTaiwanMode('jimmy-proxy'), false);
});
