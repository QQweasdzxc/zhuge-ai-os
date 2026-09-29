import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createTaiwanFreewayCmsLayer,
  createTaiwanFreewayLiveLayer,
} from './index.js';
import {
  createTaiwanFreewayCmsSource,
  createTaiwanFreewayLiveSource,
} from './source.js';

function viewerHarness() {
  const sources = [];
  return {
    sources,
    dataSources: {
      add(value) {
        sources.push(value);
        return value;
      },
      remove(value) {
        const index = sources.indexOf(value);
        if (index >= 0) sources.splice(index, 1);
        return true;
      },
    },
  };
}

test('live source joins sanitized telemetry to official section geometry', async () => {
  const source = createTaiwanFreewayLiveSource({
    fetchImpl: async (route) => ({
      ok: true,
      async json() {
        if (route.endsWith('/live'))
          return {
            providerId: 'taiwan.freeway.live-traffic',
            entities: [{ sectionId: '0001', congestionLevel: 2 }],
            fetchedAt: '2026-09-28T00:00:00.000Z',
            dataTimestamp: '2026-09-28T00:00:00.000Z',
            providerMetadata: {},
          };
        return {
          providerId: 'taiwan.freeway.section-shape',
          entities: [
            {
              sectionId: '0001',
              coordinates: [
                [121, 25],
                [121.1, 25.1],
              ],
            },
          ],
          fetchedAt: '2026-09-27T00:00:00.000Z',
          dataTimestamp: '2026-09-27T00:00:00.000Z',
        };
      },
    }),
  });
  const snapshot = await source.getSnapshot();
  assert.deepEqual(snapshot.entities[0].coordinates, [
    [121, 25],
    [121.1, 25.1],
  ]);
  assert.equal(snapshot.providerMetadata.rawResponseReturned, false);
});

test('CMS source joins messages to official catalog coordinates', async () => {
  const source = createTaiwanFreewayCmsSource({
    fetchImpl: async (route) => ({
      ok: true,
      async json() {
        if (route.endsWith('/cms'))
          return {
            providerId: 'taiwan.freeway.cms',
            entities: [{ cmsId: 'CMS-1', messages: [{ text: '注意' }] }],
            providerMetadata: {},
          };
        return {
          providerId: 'taiwan.freeway.cms-static',
          entities: [
            { cmsId: 'CMS-1', lat: 25, lon: 121, roadName: '國道1號' },
          ],
        };
      },
    }),
  });
  const snapshot = await source.getSnapshot();
  assert.equal(snapshot.entities[0].lat, 25);
  assert.equal(snapshot.entities[0].roadName, '國道1號');
});

test('Taiwan freeway layers render real normalized records and clear on disable', async () => {
  const viewer = viewerHarness();
  const live = createTaiwanFreewayLiveLayer({
    source: {
      getSnapshot: async () => ({
        status: 'available',
        stale: false,
        source: 'Freeway Bureau',
        fetchedAt: '2026-09-28T00:00:00.000Z',
        entities: [
          {
            sectionId: '0001',
            congestionLevel: 4,
            coordinates: [
              [121, 25],
              [121.1, 25.1],
            ],
          },
        ],
      }),
    },
  });
  live.init(viewer);
  live.enable(viewer);
  assert.equal(await live.update(viewer), true);
  assert.equal(live.getStats().count, 1);
  assert.equal(viewer.sources[0].entities.values.length, 1);
  live.disable(viewer);
  assert.equal(viewer.sources[0].entities.values.length, 0);
  live.destroy(viewer);
  assert.equal(viewer.sources.length, 0);

  const cmsViewer = viewerHarness();
  const cms = createTaiwanFreewayCmsLayer({
    source: {
      getSnapshot: async () => ({
        status: 'available',
        stale: false,
        source: 'Freeway Bureau',
        fetchedAt: '2026-09-28T00:00:00.000Z',
        entities: [
          {
            cmsId: 'CMS-1',
            lat: 25,
            lon: 121,
            status: 0,
            messages: [{ text: '注意' }],
          },
        ],
      }),
    },
  });
  cms.init(cmsViewer);
  cms.enable(cmsViewer);
  assert.equal(await cms.update(cmsViewer), true);
  assert.equal(cms.getStats().count, 1);
  assert.equal(cmsViewer.sources[0].entities.values.length, 1);
});
