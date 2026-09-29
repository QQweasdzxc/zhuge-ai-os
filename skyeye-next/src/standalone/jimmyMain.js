import { createStandaloneApplication } from './application.js';
import { describeError } from './errors.js';
import { mountJimmyRuntime } from '../jimmyRuntime.js';
import * as Cesium from 'cesium';
import '../../jimmy-runtime.css';

// The clone opens directly into the Taiwan operational view; do not surface
// the upstream first-run chooser on this dedicated experience route.
const url = new URL(window.location.href);
if (!url.searchParams.has('welcome')) {
  url.searchParams.set('welcome', '0');
  window.history.replaceState(window.history.state, '', url);
}

const application = createStandaloneApplication({
  // The Jimmy desktop experience uses its Taiwan PHOTO2 map authority rather
  // than upstream's optional Google photoreal tiles or Cesium ion terrain.
  taiwanEnhanced: true,
  disableStartupFlight: true,
  skipProviderSettings: true,
  allowQaRegistration: import.meta.env.DEV,
});

application
  .start()
  .then(async (components) => {
    components.scene.viewer.camera.cancelFlight();
    await components.scene.mapStackController.setStack('nlsc-photo2', { silent: true });
    components.scene.viewer.scene.morphTo2D(0);
    components.scene.viewer.camera.setView({
      // Match the reference's neighborhood-scale opening view (its readout is
      // centered on New Taipei rather than a regional/world overview).
      destination: Cesium.Rectangle.fromDegrees(121.497, 24.948, 121.501, 24.952),
    });
    components.scene.viewer.scene.requestRender();
    const runtime = mountJimmyRuntime(components);
    window.__skyeyeJimmyRuntime = runtime;
    // The reference opens with its operational map populated. Use only the
    // already-wired Taiwan/global adapters. Provider initialization must not
    // block the full-screen experience; each adapter reports its real state
    // as activation settles.
    const startupLayers = ['cctv', 'taiwan-freeway-live', 'taiwan-freeway-cms'];
    const layerResults = new Map(startupLayers.map((layerId) => [layerId, {
      layerId,
      status: components.data.dataManager.isEnabled(layerId) ? 'available' : 'loading',
      enabled: components.data.dataManager.isEnabled(layerId),
    }]));
    const publishLayerResults = () => {
      window.__skyeyeJimmyInitialLayers = Object.freeze(
        startupLayers.map((layerId) => Object.freeze({ ...layerResults.get(layerId) })),
      );
      runtime.refreshReadout?.();
    };
    window.__skyeyeJimmyInitialLayers = Object.freeze([]);
    const center = { latitude: 24.95, longitude: 121.499 };
    const activationTasks = startupLayers.map(async (layerId) => {
      if (components.data.dataManager.isEnabled(layerId)) {
        layerResults.set(layerId, { layerId, status: 'available', enabled: true, activated: false });
        publishLayerResults();
        return layerResults.get(layerId);
      }
      try {
        const activated = await components.data.dataManager.toggle(layerId, { origin: 'jimmy-default' });
        const enabled = components.data.dataManager.isEnabled(layerId);
        layerResults.set(layerId, {
          layerId,
          status: enabled ? 'available' : 'unavailable',
          enabled,
          activated: Boolean(activated),
        });
        if (layerId === 'cctv' && enabled) {
          const cctv = components.data.dataManager.layers.get('cctv')?.module;
          const cameras = cctv?.getUIState?.()?.cameras || [];
          const nearest = cameras
            .filter((camera) => Number.isFinite(camera.lat) && Number.isFinite(camera.lon))
            .map((camera) => ({
              camera,
              distanceKm: Math.hypot(
                (camera.lat - center.latitude) * 111.32,
                (camera.lon - center.longitude) * 111.32 * Math.cos(center.latitude * Math.PI / 180),
              ),
            }))
            .sort((a, b) => a.distanceKm - b.distanceKm)[0];
          if (nearest && nearest.distanceKm <= 40) {
            cctv.selectCamera?.(nearest.camera.id);
            layerResults.set(layerId, {
              ...layerResults.get(layerId),
              selectedCameraId: nearest.camera.id,
              selectedCameraDistanceKm: Math.round(nearest.distanceKm * 10) / 10,
            });
          }
        }
      } catch (error) {
        layerResults.set(layerId, {
          layerId,
          status: error?.name === 'AbortError' ? 'aborted' : 'error',
          enabled: components.data.dataManager.isEnabled(layerId),
          errorCategory: error?.name === 'AbortError' ? 'aborted' : 'provider_or_runtime_error',
        });
      }
      publishLayerResults();
      return layerResults.get(layerId);
    });
    window.__skyeyeJimmyInitialLayersReady = Promise.all(activationTasks).then((results) => {
      runtime.expandReferencePanels?.();
      return Object.freeze(results.map((item) => Object.freeze({ ...item })));
    });
    publishLayerResults();
  })
  .catch((error) => {
    console.error('SkyEye Jimmy runtime initialization failed:', error);
    const status = document.querySelector('#loading-screen .loader-status');
    if (status) {
      status.textContent = `Runtime unavailable: ${describeError(error)}`;
      status.style.color = '#ff4444';
    }
  });
