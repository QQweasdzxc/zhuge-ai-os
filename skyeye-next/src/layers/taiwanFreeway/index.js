import * as Cesium from 'cesium';

const LIVE_ID = 'taiwan-freeway-live';
const CMS_ID = 'taiwan-freeway-cms';

function trafficColor(level) {
  if (Number(level) >= 4) return Cesium.Color.RED;
  if (Number(level) === 3) return Cesium.Color.ORANGE;
  if (Number(level) === 2) return Cesium.Color.YELLOW;
  return Cesium.Color.LIME;
}

function cmsColor(status) {
  return Number(status) === 0 ? Cesium.Color.CYAN : Cesium.Color.ORANGE;
}

function errorText(error) {
  return String(error?.message || error || 'provider_unavailable')
    .replace(/[\u0000-\u001f<>]/g, '')
    .slice(0, 160);
}

function createLayer({ source, mode }) {
  const isLive = mode === 'live';
  const id = isLive ? LIVE_ID : CMS_ID;
  const name = isLive ? 'Taiwan freeway traffic' : 'Taiwan CMS boards';
  const icon = isLive ? '🚗' : '🪧';
  let viewer = null;
  let dataSource = null;
  let request = null;
  let enabled = false;
  let count = 0;
  let lastUpdate = null;
  let lastError = null;
  let stale = false;
  let status = 'not_requested';

  const layer = {
    id,
    name,
    icon,
    source: 'Taiwan Freeway Bureau Open Data',
    updateInterval: 60_000,
    showInTogglePanel: true,

    init(nextViewer) {
      viewer = nextViewer;
      dataSource = new Cesium.CustomDataSource(id);
      dataSource.show = false;
      viewer.dataSources.add(dataSource);
      count = 0;
      lastUpdate = null;
      lastError = null;
      stale = false;
      status = 'not_requested';
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
      status = 'not_requested';
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
          if (isLive) {
            if (!Array.isArray(row.coordinates) || row.coordinates.length < 2)
              continue;
            entities.push(
              new Cesium.Entity({
                id: `${id}:${row.sectionId}`,
                polyline: {
                  positions: Cesium.Cartesian3.fromDegreesArray(
                    row.coordinates.flat(),
                  ),
                  width: 4,
                  material: new Cesium.ColorMaterialProperty(
                    trafficColor(row.congestionLevel),
                  ),
                  clampToGround: true,
                },
                properties: {
                  sectionId: row.sectionId,
                  travelSpeedKph: row.travelSpeedKph,
                  travelTimeSeconds: row.travelTimeSeconds,
                  congestionLevel: row.congestionLevel,
                  dataTimestamp: row.dataCollectTime || snapshot.dataTimestamp,
                  source: snapshot.source,
                },
              }),
            );
          } else {
            if (!Number.isFinite(row.lat) || !Number.isFinite(row.lon))
              continue;
            const message = row.messages?.[0]?.text || 'CMS message available';
            entities.push(
              new Cesium.Entity({
                id: `${id}:${row.cmsId}`,
                position: Cesium.Cartesian3.fromDegrees(row.lon, row.lat),
                point: {
                  pixelSize: 10,
                  color: cmsColor(row.status),
                  outlineColor: Cesium.Color.BLACK,
                  outlineWidth: 1,
                  heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                },
                label: {
                  text: message.slice(0, 48),
                  show: false,
                  font: '12px sans-serif',
                  fillColor: Cesium.Color.WHITE,
                  showBackground: true,
                  backgroundColor: Cesium.Color.BLACK.withAlpha(0.75),
                  pixelOffset: new Cesium.Cartesian2(0, -18),
                  heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
                },
                properties: {
                  cmsId: row.cmsId,
                  roadName: row.roadName,
                  direction: row.direction,
                  locationMile: row.locationMile,
                  message,
                  dataTimestamp: row.dataCollectTime || snapshot.dataTimestamp,
                  source: snapshot.source,
                },
              }),
            );
          }
        }
        dataSource.entities.removeAll();
        for (const entity of entities) dataSource.entities.add(entity);
        count = entities.length;
        lastUpdate = snapshot.fetchedAt || new Date().toISOString();
        stale = snapshot.stale === true;
        status = snapshot.status || (stale ? 'stale' : 'available');
        lastError = snapshot.providerMetadata?.errorCode || null;
        return true;
      } catch (error) {
        if (nextRequest.signal.aborted || request !== nextRequest || !enabled)
          return false;
        count = 0;
        status = 'provider_unavailable';
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
        error: lastError,
        source: 'Taiwan Freeway Bureau Open Data',
      };
    },

    getAnalystRecords(maxCount = 2000) {
      if (!dataSource?.show) return [];
      const values = dataSource.entities.values.slice(0, maxCount);
      return values.map((entity) => {
        const props = entity.properties;
        return {
          id: entity.id,
          source: 'Taiwan Freeway Bureau Open Data',
          type: isLive ? 'freeway-traffic' : 'freeway-cms',
          sectionId: props?.sectionId?.getValue?.() || null,
          cmsId: props?.cmsId?.getValue?.() || null,
          message: props?.message?.getValue?.() || null,
          travelSpeedKph: props?.travelSpeedKph?.getValue?.() || null,
        };
      });
    },
  };
  return layer;
}

export function createTaiwanFreewayLiveLayer({ source } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Taiwan freeway traffic requires a snapshot source');
  return createLayer({ source, mode: 'live' });
}

export function createTaiwanFreewayCmsLayer({ source } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Taiwan CMS requires a snapshot source');
  return createLayer({ source, mode: 'cms' });
}
