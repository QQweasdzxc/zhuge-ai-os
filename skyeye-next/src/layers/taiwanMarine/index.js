import * as Cesium from 'cesium';

const ID = 'taiwan-marine';
const SOURCE = 'Taiwan official marine and fishing-port open data';

function errorText(error) {
  return String(error?.message || error || 'provider_unavailable')
    .replace(/[\u0000-\u001f<>]/g, '')
    .slice(0, 160);
}

function latestWave(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort((a, b) =>
    String(b?.observedAt || '').localeCompare(String(a?.observedAt || '')),
  )[0];
}

export function createTaiwanMarineLayer({ source } = {}) {
  if (typeof source?.getSnapshot !== 'function')
    throw new TypeError('Taiwan marine requires a snapshot source');
  let viewer = null;
  let dataSource = null;
  let request = null;
  let enabled = false;
  let portCount = 0;
  let waveAvailable = false;
  let lastUpdate = null;
  let status = 'not_requested';
  let stale = false;
  let lastError = null;

  return {
    id: ID,
    name: 'Taiwan marine & ports',
    icon: '⚓',
    source: SOURCE,
    updateInterval: 5 * 60_000,
    showInTogglePanel: true,

    init(nextViewer) {
      viewer = nextViewer;
      dataSource = new Cesium.CustomDataSource(ID);
      dataSource.show = false;
      viewer.dataSources.add(dataSource);
      portCount = 0;
      waveAvailable = false;
      lastUpdate = null;
      status = 'not_requested';
      stale = false;
      lastError = null;
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
      portCount = 0;
      waveAvailable = false;
      status = 'not_requested';
      stale = false;
      lastError = null;
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
        const wave = latestWave(snapshot.wave?.entities);
        if (wave && snapshot.wave?.status === 'available') {
          const position = Cesium.Cartesian3.fromDegrees(
            wave.longitude,
            wave.latitude,
          );
          entities.push(
            new Cesium.Entity({
              id: `${ID}:wave-station`,
              position,
              point: {
                pixelSize: 12,
                color: Cesium.Color.DEEPSKYBLUE,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 2,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              },
              properties: {
                type: 'marine-observation',
                waveHeightM: wave.waveHeightM,
                peakPeriodSeconds: wave.peakPeriodSeconds,
                waveDirectionDegrees: wave.waveDirectionDegrees,
                observedAt: wave.observedAt,
                source: snapshot.wave.source,
              },
            }),
          );
          waveAvailable = true;
        } else waveAvailable = false;
        for (const port of snapshot.ports?.entities || []) {
          if (
            !Number.isFinite(port.latitude) ||
            !Number.isFinite(port.longitude)
          )
            continue;
          entities.push(
            new Cesium.Entity({
              id: `${ID}:port:${port.id}`,
              position: Cesium.Cartesian3.fromDegrees(
                port.longitude,
                port.latitude,
              ),
              point: {
                pixelSize: 7,
                color: Cesium.Color.ORANGE,
                outlineColor: Cesium.Color.WHITE,
                outlineWidth: 1,
                heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
              },
              label: {
                text: port.name,
                show: false,
                font: '12px sans-serif',
                fillColor: Cesium.Color.WHITE,
                showBackground: true,
                backgroundColor: Cesium.Color.BLACK.withAlpha(0.75),
                pixelOffset: new Cesium.Cartesian2(0, -16),
              },
              properties: {
                type: 'fishing-port',
                name: port.name,
                category: port.category,
                address: port.address,
                source: snapshot.ports.source,
                dataTimestamp: snapshot.ports.dataTimestamp,
              },
            }),
          );
        }
        dataSource.entities.removeAll();
        for (const entity of entities) dataSource.entities.add(entity);
        portCount = entities.filter((entity) =>
          String(entity.id).startsWith(`${ID}:port:`),
        ).length;
        lastUpdate = snapshot.fetchedAt || new Date().toISOString();
        stale = snapshot.stale === true;
        status = snapshot.status || (stale ? 'stale' : 'available');
        lastError =
          snapshot.wave?.providerMetadata?.errorCode ||
          snapshot.ports?.providerMetadata?.errorCode ||
          null;
        return true;
      } catch (error) {
        if (nextRequest.signal.aborted || request !== nextRequest || !enabled)
          return false;
        dataSource.entities.removeAll();
        portCount = 0;
        waveAvailable = false;
        status = 'provider_unavailable';
        stale = false;
        lastError = errorText(error);
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
        portCount,
        count: portCount + (waveAvailable ? 1 : 0),
        countLabel: portCount ? String(portCount) : '—',
        waveAvailable,
        lastUpdate,
        loading: Boolean(request),
        stale,
        status,
        error: lastError,
        source: SOURCE,
      };
    },

    getAnalystRecords(maxCount = 500) {
      if (!dataSource?.show) return [];
      return dataSource.entities.values.slice(0, maxCount).map((entity) => ({
        id: entity.id,
        source: SOURCE,
        type: entity.properties?.type?.getValue?.() || null,
        name: entity.properties?.name?.getValue?.() || null,
        waveHeightM: entity.properties?.waveHeightM?.getValue?.() || null,
        observedAt: entity.properties?.observedAt?.getValue?.() || null,
      }));
    },
  };
}
