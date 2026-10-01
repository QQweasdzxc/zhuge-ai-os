/** Small in-memory cache shared by Taiwan server adapters. */
export function createTaiwanProviderCache({ now = () => Date.now() } = {}) {
  const entries = new Map();
  const inflight = new Map();

  function get(key) {
    const entry = entries.get(key);
    if (!entry) return null;
    return { ...entry, ageMs: Math.max(0, now() - entry.storedAt) };
  }

  function set(key, value, ttlMs) {
    entries.set(key, {
      value,
      storedAt: now(),
      ttlMs: Math.max(0, Number(ttlMs) || 0),
    });
    return value;
  }

  async function getOrLoad(
    key,
    loader,
    { ttlMs = 60_000, allowStale = true } = {},
  ) {
    const cached = get(key);
    if (cached && cached.ageMs <= cached.ttlMs)
      return { value: cached.value, cache: 'fresh' };
    if (inflight.has(key))
      return { value: await inflight.get(key), cache: 'coalesced' };
    const request = Promise.resolve().then(loader);
    inflight.set(key, request);
    try {
      const value = await request;
      set(key, value, ttlMs);
      return { value, cache: 'miss' };
    } catch (error) {
      if (allowStale && cached)
        return { value: cached.value, cache: 'stale-fallback', error };
      throw error;
    } finally {
      if (inflight.get(key) === request) inflight.delete(key);
    }
  }

  return Object.freeze({
    get,
    set,
    getOrLoad,
    clear: () => {
      entries.clear();
      inflight.clear();
    },
  });
}
