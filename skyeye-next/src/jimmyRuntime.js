import * as Cesium from 'cesium';

const QUICK_LAYER_IDS = Object.freeze([
  'flights',
  'ais-live-vessels',
  'weather-radar',
  'wind',
  'weather-cyclones',
  'earthquakes',
  'traffic',
  'taiwan-freeway-live',
  'taiwan-freeway-cms',
  'transit',
  'taiwan-reservoirs',
  'taiwan-marine',
  'cctv',
]);

const EVIDENCE_GROUPS = Object.freeze({
  weather: Object.freeze(['weather-radar', 'wind', 'weather-cyclones']),
  traffic: Object.freeze(['taiwan-freeway-live', 'taiwan-freeway-cms', 'traffic', 'transit', 'earthquakes']),
});

function move(documentRef, selector, target) {
  const node = documentRef.querySelector(selector);
  if (node && target) target.append(node);
  return node;
}

function setExpanded(button, expanded) {
  button?.setAttribute('aria-expanded', String(expanded));
}

function cameraLocation(viewer) {
  const point = new Cesium.Cartesian2(
    Math.max(0, Math.round(viewer.canvas.clientWidth / 2)),
    Math.max(0, Math.round(viewer.canvas.clientHeight / 2)),
  );
  const world = viewer.camera.pickEllipsoid(point, viewer.scene.globe.ellipsoid);
  if (!world) return null;
  const cartographic = Cesium.Cartographic.fromCartesian(world);
  return {
    latitude: Cesium.Math.toDegrees(cartographic.latitude),
    longitude: Cesium.Math.toDegrees(cartographic.longitude),
    altitude: viewer.camera.positionCartographic.height,
  };
}

function formatCoordinate(value, positive, negative) {
  if (!Number.isFinite(value)) return '—';
  return `${Math.abs(value).toFixed(4)}°${value >= 0 ? positive : negative}`;
}

/** Mount the Jimmy-authority desktop shell over the existing upstream runtime. */
export function mountJimmyRuntime(components, documentRef = document) {
  const shell = documentRef.getElementById('jfr-runtime');
  if (!shell) throw new Error('Jimmy runtime shell is missing');
  const { viewer, mapStackController } = components.scene;
  const manager = components.data.dataManager;
  const removeListeners = [];
  let destroyed = false;
  let refreshBusy = false;
  let hudVisible = true;
  let dismissedCameraId = null;

  move(documentRef, '#location-bar', shell.querySelector('.jfr-search-host'));
  move(documentRef, '#top-center-actions', shell.querySelector('.jfr-native-actions'));
  move(documentRef, '#left-panel-stack', shell.querySelector('.jfr-layer-host'));
  move(documentRef, '#right-context-rail', shell.querySelector('.jfr-intelligence-host'));
  move(documentRef, '#pp-toggles', shell.querySelector('.jfr-controls-host'));
  move(documentRef, '#style-indicator', shell.querySelector('.jfr-style-indicator-host'));
  move(documentRef, '#map-stack-chips', shell.querySelector('.jfr-map-source-host'));

  const layerPane = shell.querySelector('#jfr-layer-drawer');
  const intelligencePane = shell.querySelector('#jfr-intelligence-panel');
  const globalContextPanel = documentRef.getElementById('global-context-panel');
  const cctvFrameWrap = documentRef.getElementById('cctv-frame-wrap');
  const cameraWindow = shell.querySelector('#jfr-camera-window');
  if (cctvFrameWrap) shell.querySelector('.jfr-camera-feed-host').append(cctvFrameWrap);
  move(documentRef, '#cctv-source-badge', cameraWindow);

  const title = documentRef.getElementById('title-bar');
  title?.setAttribute('aria-hidden', 'true');
  if (globalContextPanel) globalContextPanel.hidden = true;
  documentRef.body.classList.add('jimmy-runtime-ready');

  const on = (target, type, handler, options) => {
    target?.addEventListener(type, handler, options);
    if (target) removeListeners.push(() => target.removeEventListener(type, handler, options));
  };
  const clickNative = (selector) => documentRef.querySelector(selector)?.click();
  const layerRow = (id) => documentRef.querySelector(`.data-toggle-row[data-layer-id="${CSS.escape(id)}"]`);
  const toggleLayer = (id) => layerRow(id)?.querySelector('.data-toggle-btn')?.click();
  const openLayerDrawer = (open) => {
    layerPane.hidden = !open;
    const nativePanel = documentRef.getElementById('data-panel');
    if (open) nativePanel?.classList.remove('collapsed');
    shell.querySelectorAll('[data-jimmy-action="layers"]').forEach((button) => setExpanded(button, open));
  };
  const openIntelligence = (open) => {
    intelligencePane.hidden = !open;
    shell.querySelector('[data-jimmy-action="contacts"]')?.setAttribute('aria-expanded', String(open));
  };
  const expandNativePanel = (id) => {
    const panel = documentRef.getElementById(id);
    if (!panel || panel.hidden || !panel.classList.contains('collapsed')) return;
    panel.querySelector('.panel-collapse-btn')?.click();
  };

  const syncQuickLayers = () => {
    for (const button of shell.querySelectorAll('[data-jimmy-layer]')) {
      const native = layerRow(button.dataset.jimmyLayer)?.querySelector('.data-toggle-btn');
      button.disabled = !native;
      const active = native?.classList.contains('active') === true;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('is-active', active);
      button.title = native ? `Toggle ${button.textContent.trim()}` : 'This layer is unavailable in this runtime';
    }
  };

  for (const button of shell.querySelectorAll('[data-jimmy-layer]')) {
    const sync = () => {
      const native = layerRow(button.dataset.jimmyLayer)?.querySelector('.data-toggle-btn');
      const active = native?.classList.contains('active') === true;
      button.setAttribute('aria-pressed', String(active));
      button.classList.toggle('is-active', active);
    };
    on(button, 'click', () => toggleLayer(button.dataset.jimmyLayer));
    on(documentRef, 'click', (event) => {
      if (event.target.closest?.(`.data-toggle-row[data-layer-id="${CSS.escape(button.dataset.jimmyLayer)}"]`)) sync();
    });
    sync();
  }

  const actions = {
    return() {
      if (history.length > 1) history.back();
      else location.assign('/');
    },
    layers() { openLayerDrawer(layerPane.hidden); },
    'close-layers'() { openLayerDrawer(false); },
    contacts() { openIntelligence(intelligencePane.hidden); },
    'close-context'() { openIntelligence(false); },
    hud() {
      hudVisible = !hudVisible;
      const hud = shell.querySelector('#jfr-hud-strip');
      if (hud) hud.hidden = !hudVisible;
      shell.querySelector('[data-jimmy-action="hud"]')?.setAttribute('aria-pressed', String(hudVisible));
    },
    fullscreen() {
      if (documentRef.fullscreenElement) void documentRef.exitFullscreen?.();
      else void documentRef.documentElement.requestFullscreen?.();
    },
    'close-camera'() {
      dismissedCameraId = cctv?.getUIState?.()?.activeCamera?.id || null;
      cctv?.deactivateActiveCamera?.();
      cameraWindow.hidden = true;
      updateCameraLink(null);
    },
    async 'open-camera'() {
      dismissedCameraId = null;
      if (!manager.isEnabled('cctv')) await manager.toggle('cctv', { origin: 'jimmy-camera-open' });
      updateCounts();
    },
    display() {
      const open = displayControls?.classList.toggle('is-open') === true;
      shell.querySelector('[data-jimmy-action="display"]')?.setAttribute('aria-expanded', String(open));
    },
    refresh() {
      if (refreshBusy) return;
      refreshBusy = true;
      const state = documentRef.getElementById('jfr-refresh-state');
      state.textContent = 'REFRESH · RUNNING';
      const enabled = [...manager.layers.entries()].filter(([, entry]) => entry.enabled).map(([id]) => id);
      void (async () => {
        const results = [];
        for (const id of enabled) {
          try { results.push(await manager.refreshLayer(id)); }
          catch { results.push(false); }
        }
        state.textContent = `REFRESH · ${results.filter(Boolean).length}/${results.length} OK`;
      })().catch(() => { state.textContent = 'REFRESH · PARTIAL'; }).finally(() => { refreshBusy = false; });
    },
  };

  on(shell, 'click', (event) => {
    const button = event.target.closest?.('[data-jimmy-action]');
    if (button) actions[button.dataset.jimmyAction]?.();
  });

  const locationSearch = documentRef.getElementById('location-search');
  const searchToggle = documentRef.getElementById('search-toggle');
  if (locationSearch) {
    locationSearch.placeholder = '輸入地點或座標搜尋';
    locationSearch.setAttribute('aria-label', '搜尋地點或座標');
  }
  on(searchToggle, 'click', () => locationSearch?.focus());
  on(locationSearch, 'keydown', (event) => {
    if (event.key === 'Enter') locationSearch.classList.add('searching');
  });

  const displayControls = documentRef.querySelector('.jfr-controls-host');

  const panelTargets = {
    weather: '#weather-panel',
    traffic: '#data-panel',
    context: '#global-context-panel',
  };
  for (const tab of shell.querySelectorAll('[data-jimmy-panel]')) {
    on(tab, 'click', () => {
      for (const peer of shell.querySelectorAll('[data-jimmy-panel]')) peer.setAttribute('aria-selected', String(peer === tab));
      const panel = documentRef.querySelector(panelTargets[tab.dataset.jimmyPanel]);
      if (tab.dataset.jimmyPanel === 'traffic') openLayerDrawer(true);
      else {
        openIntelligence(true);
        if (tab.dataset.jimmyPanel === 'context') {
          if (globalContextPanel) globalContextPanel.hidden = false;
          const contacts = documentRef.getElementById('global-context-flights-btn');
          if (contacts?.getAttribute('aria-selected') !== 'true') contacts?.click();
          expandNativePanel('global-context-panel');
        } else {
          if (globalContextPanel) globalContextPanel.hidden = true;
          if (!manager.isEnabled('weather-radar')) void manager.toggle('weather-radar', { origin: 'jimmy-weather-tab' });
          if (panel && !panel.hidden) expandNativePanel('weather-panel');
        }
      }
    });
  }

  const cctv = manager.layers.get('cctv')?.module;
  const cameraLinks = shell.querySelector('#jfr-camera-links');
  const cameraLink = cameraLinks?.querySelector('line');
  const updateCameraLink = (camera) => {
    if (!camera || cameraWindow.hidden || !Number.isFinite(camera.lat) || !Number.isFinite(camera.lon)) {
      cameraLinks?.classList.remove('is-visible');
      return;
    }
    const canvasPoint = viewer.scene.cartesianToCanvasCoordinates(
      Cesium.Cartesian3.fromDegrees(camera.lon, camera.lat, Number(camera.elevationM) || 0),
    );
    if (!canvasPoint || !Number.isFinite(canvasPoint.x) || !Number.isFinite(canvasPoint.y)) {
      cameraLinks?.classList.remove('is-visible');
      return;
    }
    const bounds = cameraWindow.getBoundingClientRect();
    const startX = bounds.left + bounds.width / 2;
    const startY = bounds.bottom;
    cameraLink?.setAttribute('x1', String(startX));
    cameraLink?.setAttribute('y1', String(startY));
    cameraLink?.setAttribute('x2', String(canvasPoint.x));
    cameraLink?.setAttribute('y2', String(canvasPoint.y));
    cameraLinks?.classList.add('is-visible');
  };
  const updateCounts = () => {
    if (destroyed) return;
    const enabled = [...manager.layers.values()].filter((entry) => entry.enabled).length;
    const cctvState = cctv?.getUIState?.();
    const location = cameraLocation(viewer);
    shell.querySelector('#jfr-layer-count').textContent = String(enabled);
    shell.querySelector('#jfr-camera-count').textContent = String(Number(cctvState?.count) || 0);
    shell.querySelector('#jfr-hud-layers').textContent = String(enabled);
    shell.querySelector('#jfr-hud-cameras').textContent = String(Number(cctvState?.count) || 0);
    const layerSnapshots = new Map(manager.getAll().map((entry) => [entry.id, entry]));
    const evidenceState = (ids) => {
      const entries = ids.map((id) => layerSnapshots.get(id)).filter(Boolean);
      if (!entries.length) return '此功能不可用';
      const active = entries.filter((entry) => entry.enabled);
      const loading = entries.some((entry) => entry.stats?.loading || entry.lifecycleState === 'enabling');
      const failed = entries.some((entry) => entry.stats?.error || entry.stats?.managerRefreshError);
      const count = entries.reduce((sum, entry) => sum + (Number(entry.stats?.count) || 0), 0);
      const lastUpdate = entries.reduce((latest, entry) => {
        const value = Number(entry.stats?.lastUpdate);
        return Number.isFinite(value) && value > latest ? value : latest;
      }, 0);
      let label = '尚未載入';
      if (loading && count === 0) label = '載入中';
      else if (failed) label = '部分來源讀取失敗';
      else if (active.length && count > 0) label = `${count.toLocaleString()} 筆資料`;
      else if (active.length) label = `${active.length} 項已啟用・尚無資料`;
      if (lastUpdate > 0 && active.length) {
        label += ` · 更新 ${new Date(lastUpdate).toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' })}`;
      }
      return label;
    };
    const weatherSummary = shell.querySelector('[data-jimmy-summary="weather"]');
    const trafficSummary = shell.querySelector('[data-jimmy-summary="traffic"]');
    const cctvSummary = shell.querySelector('[data-jimmy-summary="cctv"]');
    if (weatherSummary) weatherSummary.textContent = evidenceState(EVIDENCE_GROUPS.weather);
    if (trafficSummary) trafficSummary.textContent = evidenceState(EVIDENCE_GROUPS.traffic);
    if (cctvSummary) {
      const cameraCount = Number(cctvState?.count) || 0;
      const cctvLifecycle = manager.getLayerLifecycleState('cctv');
      cctvSummary.textContent = cctvState?.loading && cameraCount === 0
        ? '載入中'
        : cctvState?.loading
          ? `${cameraCount.toLocaleString()} 個點位・標記載入中`
        : cctvState?.error
          ? '攝影機目錄讀取失敗'
          : cameraCount > 0
            ? `${cameraCount.toLocaleString()} 個點位`
            : cctvLifecycle?.enabled
              ? '已啟用・此區域無點位'
              : '尚未載入';
    }
    shell.querySelector('#jfr-runtime-state').textContent = 'RUNTIME READY';
    const source = mapStackController?.getActiveStack?.();
    shell.querySelector('#jfr-map-source').textContent = `MAP SOURCE · ${String(source?.label || 'NLSC PHOTO').toUpperCase()}`;
    shell.querySelector('#jfr-hud-source').textContent = String(source?.label || 'NLSC PHOTO2').toUpperCase();
    shell.querySelector('#jfr-hud-view').textContent = location
      ? `${location.latitude >= 24 && location.latitude <= 26 ? '台灣・' : ''}${location.latitude.toFixed(2)}°N ${location.longitude.toFixed(2)}°E`
      : '視角定位中';
    if (cctvState?.activeCamera?.id && cctvState.activeCamera.id !== dismissedCameraId) {
      dismissedCameraId = null;
    }
    cameraWindow.hidden = !manager.isEnabled('cctv') || !cctvState?.activeCamera || cctvState.activeCamera.id === dismissedCameraId;
    if (cctvState?.activeCamera) {
      shell.querySelector('#jfr-camera-title').textContent = cctvState.activeCamera.name || 'CAMERA SELECTED';
      shell.querySelector('#jfr-camera-source').textContent = `SOURCE · ${String(cctvState.activeCamera.sourceLabel || cctvState.activeCamera.sourceKind || 'UNAVAILABLE').toUpperCase()}`;
      shell.querySelector('#jfr-camera-updated').textContent = cctvState.lastUpdate ? new Date(cctvState.lastUpdate).toLocaleTimeString() : 'WAITING FOR FRAME';
    }
    updateCameraLink(cctvState?.activeCamera || null);
    syncQuickLayers();
    shell.querySelector('#jfr-coordinate-readout').textContent = location
      ? `LAT ${formatCoordinate(location.latitude, 'N', 'S')} · LON ${formatCoordinate(location.longitude, 'E', 'W')}`
      : 'LAT — · LON —';
    shell.querySelector('#jfr-altitude-readout').textContent = location
      ? `ALT ${Math.round(location.altitude).toLocaleString()} M`
      : 'ALT —';
    const clockLabel = new Date().toLocaleString('zh-TW', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    });
    shell.querySelector('#jfr-clock').textContent = clockLabel;
    return Object.freeze({
      activeMapId: mapStackController?.getActiveId?.() || null,
      activeMapLabel: source?.label || null,
      layerCount: enabled,
      enabledLayerIds: Object.freeze([...manager.layers.entries()].filter(([, entry]) => entry.enabled).map(([id]) => id)),
      cctvCount: Number(cctvState?.count) || 0,
      selectedCameraId: cctvState?.activeCamera?.id || null,
      cameraWindowVisible: !cameraWindow.hidden,
      selectedCameraLinkVisible: cameraLinks?.classList.contains('is-visible') === true,
      hudVisible,
      sceneMode: viewer.scene.mode,
      globeTilesLoaded: viewer.scene.globe.tilesLoaded === true,
      imageryLayerCount: viewer.imageryLayers.length,
      center: location ? Object.freeze({ latitude: location.latitude, longitude: location.longitude, altitude: location.altitude }) : null,
    });
  };
  const interval = window.setInterval(updateCounts, 1000);
  const moveEnd = viewer.camera.moveEnd.addEventListener(updateCounts);
  on(window, 'resize', updateCounts);
  const cameraPointer = { active: false, pointerId: null, dx: 0, dy: 0 };
  const cameraHeader = cameraWindow.querySelector('[data-jimmy-drag-handle]');
  on(cameraHeader, 'pointerdown', (event) => {
    if (event.target.closest('button')) return;
    const rect = cameraWindow.getBoundingClientRect();
    cameraPointer.active = true;
    cameraPointer.pointerId = event.pointerId;
    cameraPointer.dx = event.clientX - rect.left;
    cameraPointer.dy = event.clientY - rect.top;
    cameraHeader.setPointerCapture?.(event.pointerId);
    cameraWindow.classList.add('is-dragging');
  });
  on(cameraHeader, 'pointermove', (event) => {
    if (!cameraPointer.active || event.pointerId !== cameraPointer.pointerId) return;
    const margin = 8;
    const maxLeft = Math.max(margin, window.innerWidth - cameraWindow.offsetWidth - margin);
    const maxTop = Math.max(88, window.innerHeight - cameraWindow.offsetHeight - 100);
    cameraWindow.style.left = `${Math.min(maxLeft, Math.max(margin, event.clientX - cameraPointer.dx))}px`;
    cameraWindow.style.top = `${Math.min(maxTop, Math.max(88, event.clientY - cameraPointer.dy))}px`;
    cameraWindow.style.right = 'auto';
    cameraWindow.style.bottom = 'auto';
    updateCameraLink(cctv?.getUIState?.()?.activeCamera || null);
  });
  const stopCameraDrag = (event) => {
    if (!cameraPointer.active || (event && event.pointerId !== cameraPointer.pointerId)) return;
    cameraPointer.active = false;
    cameraPointer.pointerId = null;
    cameraWindow.classList.remove('is-dragging');
  };
  on(cameraHeader, 'pointerup', stopCameraDrag);
  on(cameraHeader, 'pointercancel', stopCameraDrag);
  const destroy = () => {
    destroyed = true;
    window.clearInterval(interval);
    moveEnd?.();
    for (const remove of removeListeners.splice(0)) remove();
    documentRef.body.classList.remove('jimmy-runtime-ready');
  };
  updateCounts();
  syncQuickLayers();
  shell.querySelector('[data-jimmy-action="hud"]')?.setAttribute('aria-pressed', 'true');
  openIntelligence(true);
  expandNativePanel('weather-panel');
  shell.querySelector('#loading-screen')?.classList.add('jfr-loading-ready');
  documentRef.querySelector('#loading-screen')?.classList.add('fade-out');
  shell.classList.add('is-ready');
  return Object.freeze({
    destroy,
    refresh: actions.refresh,
    getState: updateCounts,
    refreshReadout: updateCounts,
    expandReferencePanels: () => expandNativePanel('weather-panel'),
  });
}

export { QUICK_LAYER_IDS };
