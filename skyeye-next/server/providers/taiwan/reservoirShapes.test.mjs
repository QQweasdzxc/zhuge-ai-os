import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseWraReservoirShapesGeoJson,
  reservoirShapesProxy,
  WRA_RESERVOIR_SHAPES_URL,
} from './reservoirShapes.js';

const GEOJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'MultiPolygon',
        coordinates: [
          [
            [
              [121.2, 24.8],
              [121.21, 24.8],
              [121.21, 24.81],
              [121.2, 24.8],
            ],
          ],
        ],
      },
      properties: { GmlID: 'ressub.1', NAME: '石門水庫' },
    },
    {
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[[10, 10], [10.1, 10], [10.1, 10.1], [10, 10]]],
      },
      properties: { NAME: 'outside' },
    },
  ],
};

test('WRA WFS GeoJSON parser keeps official named Taiwan geometry and strips raw response', () => {
  const result = parseWraReservoirShapesGeoJson(
    GEOJSON,
    Date.parse('2026-09-28T00:00:00Z'),
  );
  assert.equal(result.providerId, 'taiwan.wra.reservoir-shapes');
  assert.equal(result.entities.length, 1);
  assert.equal(result.entities[0].name, '石門水庫');
  assert.deepEqual(result.entities[0].rings[0][0], [121.2, 24.8]);
  assert.equal(result.providerMetadata.rawResponseReturned, false);
  assert.equal(JSON.stringify(result).includes('FeatureCollection'), false);
});

test('WRA shape proxy coalesces and exposes sanitized geometry metadata', async () => {
  let calls = 0;
  const proxy = reservoirShapesProxy({
    fetchImpl: async (url) => {
      calls += 1;
      assert.equal(url, WRA_RESERVOIR_SHAPES_URL);
      return {
        ok: true,
        headers: new Headers({ 'content-length': '512' }),
        body: null,
        async text() {
          return JSON.stringify(GEOJSON);
        },
        async arrayBuffer() {
          return new TextEncoder().encode(JSON.stringify(GEOJSON)).buffer;
        },
      };
    },
  });
  const routes = new Map();
  proxy.configureServer({
    middlewares: { use: (route, handler) => routes.set(route, handler) },
  });
  const handler = routes.get('/api/taiwan/reservoirs/shapes');
  const responses = [];
  const makeResponse = () => ({
    destroyed: false,
    writeHead(_status, headers) {
      this.headers = headers;
    },
    end(body) {
      responses.push(JSON.parse(body));
    },
  });
  await Promise.all([
    handler({ method: 'GET' }, makeResponse()),
    handler({ method: 'GET' }, makeResponse()),
  ]);
  assert.equal(calls, 1);
  assert.equal(responses[0].status, 'available');
  assert.equal(responses[0].entities.length, 1);
  assert.equal(responses[0].providerMetadata.rawResponseReturned, false);
});
