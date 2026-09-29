import { createTaiwanProviderCache } from './cache.js';
import { nlscEvidence, probeNlscTile } from './nlsc.js';
import {
  TAIWAN_MODES,
  TAIWAN_PROVIDER_REGISTRY,
  normalizeTaiwanEvidence,
  providerRegistryEntry,
} from '../../../src/data/taiwanProviderContract.js';

/**
 * Server-side Taiwan Data Orchestrator foundation.
 *
 * It intentionally exposes only the confirmed NLSC spike. Other providers are
 * represented by registry evidence until their original endpoint and terms
 * are confirmed; unknown Jimmy proxy routes never enter this orchestrator.
 */
export function createTaiwanDataOrchestrator({
  fetchImpl = globalThis.fetch,
  now = () => Date.now(),
  cache = createTaiwanProviderCache({ now }),
} = {}) {
  const mode = TAIWAN_MODES.includes(process.env.SKYEYE_DATA_MODE)
    ? process.env.SKYEYE_DATA_MODE
    : 'global';

  async function readNlsc({ layer = 'emap', probe = false } = {}) {
    const cacheKey = `nlsc:${layer}:${probe ? 'probe' : 'metadata'}`;
    const result = await cache.getOrLoad(
      cacheKey,
      async () => {
        const fetchedAt = new Date(now()).toISOString();
        if (!probe) return nlscEvidence({ layer, fetchedAt });
        const checked = await probeNlscTile({
          fetchImpl,
          layer,
          z: 0,
          x: 0,
          y: 0,
        });
        return nlscEvidence({
          layer,
          fetchedAt,
          status: checked.ok ? 'available' : 'provider_unavailable',
          probe: { status: checked.status, contentType: checked.contentType },
        });
      },
      { ttlMs: probe ? 300_000 : 86_400_000, allowStale: true },
    );
    return normalizeTaiwanEvidence({
      ...result.value,
      providerMetadata: {
        ...result.value.providerMetadata,
        cache: result.cache,
      },
      status: result.cache === 'stale-fallback' ? 'stale' : result.value.status,
      stale: result.cache === 'stale-fallback' || result.value.stale,
    });
  }

  function describe(providerId) {
    return providerRegistryEntry(providerId);
  }

  function registry() {
    return TAIWAN_PROVIDER_REGISTRY.map((entry) => ({ ...entry }));
  }

  return Object.freeze({
    mode,
    registry,
    describe,
    readNlsc,
    cache,
  });
}
