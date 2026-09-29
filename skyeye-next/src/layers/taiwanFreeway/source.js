const json = async (fetchImpl, route, signal) => {
  signal?.throwIfAborted();
  const response = await fetchImpl(route, { signal, cache: 'no-store' });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    /* The status and normalized provider state remain authoritative. */
  }
  signal?.throwIfAborted();
  if (!response.ok) throw new Error(`Taiwan Freeway HTTP ${response.status}`);
  if (
    !payload ||
    typeof payload !== 'object' ||
    !Array.isArray(payload.entities)
  )
    throw new Error('Taiwan Freeway provider response is malformed');
  return payload;
};

/**
 * Read the official section telemetry and daily shape catalog through the
 * candidate's server boundary. The client never calls the government XML
 * feeds directly and never receives raw XML.
 */
export function createTaiwanFreewayLiveSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      const [traffic, shapes] = await Promise.all([
        json(fetchImpl, '/api/taiwan/freeway/live', signal),
        json(fetchImpl, '/api/taiwan/freeway/shapes', signal),
      ]);
      const shapeById = new Map(
        shapes.entities.map((shape) => [shape.sectionId, shape.coordinates]),
      );
      return {
        ...traffic,
        entities: traffic.entities
          .map((row) => ({
            ...row,
            coordinates: shapeById.get(row.sectionId) || null,
          }))
          .filter((row) => Array.isArray(row.coordinates)),
        providerMetadata: {
          ...traffic.providerMetadata,
          shapeProviderId: shapes.providerId,
          shapeDataTimestamp: shapes.dataTimestamp,
          shapeFetchedAt: shapes.fetchedAt,
          rawResponseReturned: false,
        },
      };
    },
  };
}

/** Read CMS live messages and the official daily CMS location catalog. */
export function createTaiwanFreewayCmsSource({
  fetchImpl = (...args) => globalThis.fetch(...args),
} = {}) {
  return {
    async getSnapshot({ signal } = {}) {
      const [live, catalog] = await Promise.all([
        json(fetchImpl, '/api/taiwan/freeway/cms', signal),
        json(fetchImpl, '/api/taiwan/freeway/cms-static', signal),
      ]);
      const locationById = new Map(
        catalog.entities.map((row) => [row.cmsId, row]),
      );
      return {
        ...live,
        entities: live.entities
          .map((row) => {
            const location = locationById.get(row.cmsId);
            return location
              ? {
                  ...row,
                  lat: location.lat,
                  lon: location.lon,
                  roadName: location.roadName,
                  direction: location.direction,
                  locationMile: location.locationMile,
                  section: location.section,
                }
              : null;
          })
          .filter(Boolean),
        providerMetadata: {
          ...live.providerMetadata,
          locationProviderId: catalog.providerId,
          locationDataTimestamp: catalog.dataTimestamp,
          locationFetchedAt: catalog.fetchedAt,
          rawResponseReturned: false,
        },
      };
    },
  };
}
