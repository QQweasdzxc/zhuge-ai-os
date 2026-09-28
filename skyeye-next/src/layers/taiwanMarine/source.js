function json(fetchImpl, route, signal) {
  return (async () => {
    signal?.throwIfAborted();
    const response = await fetchImpl(route, { signal, cache: 'no-store' });
    const payload = await response.json().catch(() => null);
    signal?.throwIfAborted();
    if (!response.ok || !payload || typeof payload !== 'object')
      throw new Error(`Taiwan marine provider HTTP ${response.status}`);
    if (!Array.isArray(payload.entities))
      throw new Error('Taiwan marine provider response is malformed');
    return payload;
  })();
}

/** Read official port observation and fishing-port data through server adapters. */
export function createTaiwanMarineSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      const [wave, ports] = await Promise.all([
        json(fetchImpl, '/api/taiwan/marine/wave', signal),
        json(fetchImpl, '/api/taiwan/ports/fishing', signal),
      ]);
      return {
        wave,
        ports,
        status:
          wave.status === 'available' || ports.status === 'available'
            ? 'available'
            : 'provider_unavailable',
        stale: wave.stale === true || ports.stale === true,
        fetchedAt: wave.fetchedAt || ports.fetchedAt,
        dataTimestamp: wave.dataTimestamp || ports.dataTimestamp,
        source: 'Taiwan official marine and fishing-port open data',
        providerMetadata: {
          waveProviderId: wave.providerId,
          waveStatus: wave.status,
          waveDataTimestamp: wave.dataTimestamp,
          portProviderId: ports.providerId,
          portStatus: ports.status,
          portDataTimestamp: ports.dataTimestamp,
          rawResponseReturned: false,
        },
      };
    },
  };
}
