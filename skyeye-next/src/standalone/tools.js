import { createAssetDirectorySource } from '../director/packs/source.js';
import { createApplicationTools } from '../app/tools.js';
import { startStandaloneChrome } from './startupChrome.js';
export function createStandaloneTools(options) {
  const { skipProviderSettings = false, ...applicationOptions } = options || {};
  return createApplicationTools({
    startChrome: (chromeOptions) => startStandaloneChrome({
      ...chromeOptions,
      ...(skipProviderSettings ? { initializeSettings: () => null } : {}),
    }),
    sceneDataPacks: {
      sources: {
        assets: createAssetDirectorySource({
          baseUrl: new URL('/scene-assets/', window.location.href).href,
        }),
      },
    },
    ...applicationOptions,
  });
}
