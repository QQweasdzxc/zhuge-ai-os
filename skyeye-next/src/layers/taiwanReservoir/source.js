function json(fetchImpl, route, signal) {
  return (async () => {
    signal?.throwIfAborted();
    const response = await fetchImpl(route, { signal, cache: 'no-store' });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      /* Normalized provider status remains authoritative. */
    }
    signal?.throwIfAborted();
    if (!response.ok) throw new Error(`Taiwan WRA HTTP ${response.status}`);
    if (
      !payload ||
      typeof payload !== 'object' ||
      !Array.isArray(payload.entities)
    )
      throw new Error('Taiwan WRA provider response is malformed');
    return payload;
  })();
}

function nameKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[\s·・，,、()（）\-—_]/g, '')
    .replace(/水庫$/u, '')
    .toLowerCase();
}

/** Join official daily WRA operation facts to official KML storage outlines. */
export function createTaiwanReservoirSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      const [shapes, daily] = await Promise.all([
        json(fetchImpl, '/api/taiwan/reservoirs/shapes', signal),
        json(fetchImpl, '/api/taiwan/reservoirs', signal),
      ]);
      const dailyByName = new Map(
        daily.entities.map((record) => [nameKey(record.name), record]),
      );
      return {
        ...shapes,
        entities: shapes.entities.map((shape) => ({
          ...shape,
          operation: dailyByName.get(nameKey(shape.name)) || null,
        })),
        providerMetadata: {
          ...shapes.providerMetadata,
          operationProviderId: daily.providerId,
          operationStatus: daily.status,
          operationStale: daily.stale === true,
          operationDataTimestamp: daily.dataTimestamp,
          operationFetchedAt: daily.fetchedAt,
          rawResponseReturned: false,
        },
      };
    },
  };
}
