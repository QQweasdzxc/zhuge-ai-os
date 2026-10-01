import * as Cesium from 'cesium';

const ID = 'taiwan-reservoirs';
const SOURCE = 'Water Resources Agency, Ministry of Economic Affairs';

function errorText(error) {
  return String(error?.message || error || 'provider_unavailable')
    .replace(/[\u0000-\u001f<>]/g, '')
    .slice(0, 160);
}

function centroid(ring) {
  if (!Array.isArray(ring) || !ring.length) return null;
  const totals = ring.reduce(
    (sum, [longitude, latitude]) => [
      sum[0] + Number(longitude || 0),
      sum[1] + Number(latitude || 0),
    ],
    [0, 0],
  );
  return Cesium.Cartesian3.fromDegrees(
    totals[0] / ring.length,
    totals[1] / ring.length,
  );
}

function operationText(operation) {
  if (!operation) return 'Daily operation data unavailable';
  const storage = Number(operation.capacityTenThousandM3);
  const inflow = Number(operation.inflowTenThousandM3);
  const parts = [];
  if (Number.isFinite(storage)) parts.push(`capacity ${storage}×10k m³`);
  if (Number.isFinite(inflow)) parts.push(`inflow ${inflow}×10k m³`);
  return parts.join(' · ') || 'Daily operation record available';
}

export function createTaiwanReservoirLayer({ source } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Taiwan reservoirs require a snapshot source');
  let viewer = null;
  let dataSource = null;
  let request = null;
  let enabled = false;
  let count = 0;
  let lastUpdate = null;
  let lastError = null;
  let stale = false;
  let status = 'not_requested';
  let operationStatus = 'not_requested';

  const layer = {
    id: ID,
    name: 'Taiwan reservoirs',
    icon: '💧',
    source: SOURCE,
    updateInterval: 24 * 60 * 60_000,
    showInTogglePanel: true,

    init(nextViewer) {
      viewer = nextViewer;
      dataSource = new Cesium.CustomDataSource(ID);
      dataSource.show = false;
      viewer.dataSources.add(dataSource);
      count = 0;
      lastUpdate = null;
      lastError = null;
      stale = false;
      status = 'not_requested';
      operationStatus = 'not_requested';
    },

    enable() {
      enabled = true;
      if (dataSource) dataSource.show = true;
    },

    disable() {
      request?.abort();
      request = null;
      enabled = false;
      if (dataSource) dataSource.show = false;
      dataSource?.entities.removeAll();
      count = 0;
      lastError = null;
      stale = false;
      status = 'not_requested';
      operationStatus = 'not_requested';
    },

    async update() {
      if (!enabled || !dataSource) return false;
      request?.abort();
      const nextRequest = new AbortController();
      request = nextRequest;
      try {
        const snapshot = await source.getSnapshot({
          signal: nextRequest.signal,
        });
        if (nextRequest.signal.aborted || request !== nextRequest || !enabled)
          return false;
        const entities = [];
        for (const row of snapshot.entities) {
          if (!Array.isArray(row.rings)) continue;
          const operation = row.operation;
          row.rings.forEach((ring, ringIndex) => {
            if (!Array.isArray(ring) || ring.length < 3) return;
            entities.push(
              new Cesium.Entity({
                id: `${ID}:${row.id}:${ringIndex}`,
                polyline: {
                  positions: Cesium.Cartesian3.fromDegreesArray(ring.flat()),
                  width: 2,
                  material: new Cesium.ColorMaterialProperty(
                    Cesium.Color.DEEPSKYBLUE.withAlpha(0.72),
                  ),
                  clampToGround: true,
                },
                properties: {
                  reservoirId: row.id,
                  name: row.name,
                  operation: operationText(operation),
                  observedAt: operation?.observedAt || null,
                  source: snapshot.source,
                  dataTimestamp:
                    operation?.observedAt || snapshot.dataTimestamp,
                },
              }),
            );
          });
          const position = centroid(row.rings[0]);
          if (position) {
            entities.push(
              new Cesium.Entity({
                id: `${ID}:${row.id}:point`,
                position,
                point: {
                  pixelSize: 7,
                  color: Cesium.Color.AQUA,
                  outlineColor: Cesium.Color.WHITE,
                  outlineWidth: 1,
                  heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                },
                properties: {
                  reservoirId: row.id,
                  name: row.name,
                  operation: operationText(operation),
                  observedAt: operation?.observedAt || null,
                  source: snapshot.source,
                  dataTimestamp:
                    operation?.observedAt || snapshot.dataTimestamp,
                },
              }),
            );
          }
        }
        dataSource.entities.removeAll();
        for (const entity of entities) dataSource.entities.add(entity);
        count = snapshot.entities.length;
        lastUpdate = snapshot.fetchedAt || new Date().toISOString();
        stale = snapshot.stale === true;
        status = snapshot.status || (stale ? 'stale' : 'available');
        operationStatus =
          snapshot.providerMetadata?.operationStatus || 'unknown';
        lastError = snapshot.providerMetadata?.errorCode || null;
        return true;
      } catch (error) {
        if (nextRequest.signal.aborted || request !== nextRequest || !enabled)
          return false;
        count = 0;
        status = 'provider_unavailable';
        operationStatus = 'provider_unavailable';
        lastError = errorText(error);
        stale = false;
        dataSource.entities.removeAll();
        return false;
      } finally {
        if (request === nextRequest) request = null;
      }
    },

    destroy(nextViewer = viewer) {
      request?.abort();
      request = null;
      enabled = false;
      if (dataSource && nextViewer)
        nextViewer.dataSources.remove(dataSource, true);
      viewer = null;
      dataSource = null;
    },

    getStats() {
      return {
        count,
        countLabel: count ? String(count) : '—',
        lastUpdate,
        loading: Boolean(request),
        stale,
        status,
        operationStatus,
        error: lastError,
        source: SOURCE,
      };
    },

    getAnalystRecords(maxCount = 500) {
      if (!dataSource?.show) return [];
      return dataSource.entities.values
        .filter((entity) => String(entity.id).endsWith(':point'))
        .slice(0, maxCount)
        .map((entity) => ({
          id: entity.id,
          source: SOURCE,
          type: 'taiwan-reservoir',
          name: entity.properties?.name?.getValue?.() || null,
          operation: entity.properties?.operation?.getValue?.() || null,
          observedAt: entity.properties?.observedAt?.getValue?.() || null,
        }));
    },
  };
  return layer;
}
