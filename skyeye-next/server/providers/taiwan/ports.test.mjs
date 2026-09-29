import assert from 'node:assert/strict';
import test from 'node:test';
import {
  fishingPortsProxy,
  parseTaiwanFishingPortsPayload,
  TAIWAN_FISHING_PORTS_URL,
} from './ports.js';

const SAMPLE = [
  {
    編號: '1',
    漁港名稱: '南方澳漁港',
    分類: '第一類',
    縣市: '10002',
    經度: '121.870622',
    緯度: '24.581780',
    電話: '(03) 9777-000',
  },
];

test('fishing-port catalogue normalizes official point fields', () => {
  const result = parseTaiwanFishingPortsPayload(SAMPLE, Date.parse('2026-09-28T00:00:00Z'));
  assert.equal(result.providerId, 'taiwan.moa.fishing-ports');
  assert.equal(result.entities[0].name, '南方澳漁港');
  assert.equal(result.entities[0].longitude, 121.870622);
  assert.equal(result.entities[0].latitude, 24.58178);
  assert.equal(result.providerMetadata.rawResponseReturned, false);
  assert.equal(new URL(TAIWAN_FISHING_PORTS_URL).hostname, 'data.moa.gov.tw');
});

test('fishing-port adapter remains read-only and rejects non-GET without upstream', async () => {
  let calls = 0;
  const proxy = fishingPortsProxy({ fetchImpl: async () => { calls += 1; throw new Error('unexpected'); } });
  const routes = new Map();
  proxy.configureServer({ middlewares: { use(path, handler) { routes.set(path, handler); } } });
  const out = { destroyed: false, writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
  await routes.get('/api/taiwan/ports/fishing')({ method: 'POST' }, out);
  assert.equal(out.status, 405);
  assert.equal(calls, 0);
});
