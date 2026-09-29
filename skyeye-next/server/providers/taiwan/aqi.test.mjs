import assert from 'node:assert/strict';
import test from 'node:test';
import { aqiProxy, MOENV_AQI_URL, parseMoenvAqiPayload } from './aqi.js';

const SAMPLE = {
  records: [
    {
      siteid: 'TW001',
      sitename: '測試站',
      county: '臺北市',
      latitude: '25.0478',
      longitude: '121.5319',
      aqi: '42',
      pollutant: '細懸浮微粒',
      status: '良好',
      publishtime: '2026-09-28 07:00',
      pm25: '12',
    },
  ],
};

test('MOENV AQI payload normalizes published station fields', () => {
  const result = parseMoenvAqiPayload(SAMPLE, Date.parse('2026-09-28T00:00:00Z'));
  assert.equal(result.providerId, 'taiwan.moenv.aqi');
  assert.equal(result.entities.length, 1);
  assert.equal(result.entities[0].latitude, 25.0478);
  assert.equal(result.entities[0].aqi, 42);
  assert.equal(result.entities[0].pm25, 12);
  assert.equal(result.providerMetadata.rawResponseReturned, false);
  assert.equal(MOENV_AQI_URL, 'https://data.moenv.gov.tw/api/v2/aqx_p_432');
});

test('MOENV adapter fails closed without an API key and never calls upstream', async () => {
  let calls = 0;
  const proxy = aqiProxy({
    resolveApiKey: () => '',
    fetchImpl: async () => {
      calls += 1;
      throw new Error('unexpected');
    },
  });
  const routes = new Map();
  proxy.configureServer({ middlewares: { use(path, handler) { routes.set(path, handler); } } });
  const out = {
    destroyed: false,
    writeHead(status) { this.status = status; },
    end(body) { this.body = body; },
  };
  await routes.get('/api/taiwan/aqi')({ method: 'GET' }, out);
  const body = JSON.parse(out.body);
  assert.equal(out.status, 200);
  assert.equal(body.status, 'provider_not_configured');
  assert.equal(body.providerMetadata.errorCode, 'PROVIDER_NOT_CONFIGURED');
  assert.equal(body.providerMetadata.rawResponseReturned, false);
  assert.equal(calls, 0);
});

test('MOENV adapter rejects non-GET without touching upstream', async () => {
  let calls = 0;
  const proxy = aqiProxy({ resolveApiKey: () => 'configured', fetchImpl: async () => { calls += 1; throw new Error('unexpected'); } });
  const routes = new Map();
  proxy.configureServer({ middlewares: { use(path, handler) { routes.set(path, handler); } } });
  const out = { destroyed: false, writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
  await routes.get('/api/taiwan/aqi')({ method: 'POST' }, out);
  assert.equal(out.status, 405);
  assert.equal(calls, 0);
});
