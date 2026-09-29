import assert from 'node:assert/strict';
import test from 'node:test';
import { NLSC_GEOCODE_URL, nlscGeocodeProxy } from './geocode.js';

test('NLSC geocoder exposes explicit access failure without raw response', async () => {
  let calls = 0;
  const proxy = nlscGeocodeProxy({
    fetchImpl: async () => {
      calls += 1;
      return {
        ok: false,
        status: 404,
        headers: new Headers({ 'content-type': 'text/plain' }),
        async text() { return 'PERMISSION DENIED'; },
      };
    },
  });
  const routes = new Map();
  proxy.configureServer({ middlewares: { use(path, handler) { routes.set(path, handler); } } });
  const out = { destroyed: false, writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
  await routes.get('/api/taiwan/geocode')({ method: 'GET', url: '/?q=台北車站' }, out);
  const body = JSON.parse(out.body);
  assert.equal(out.status, 200);
  assert.equal(body.providerId, 'taiwan.geocoder.nlsc');
  assert.equal(body.status, 'provider_unavailable');
  assert.equal(body.providerMetadata.errorCode, 'NLSC_HTTP_404');
  assert.equal(body.entities.length, 0);
  assert.equal(body.providerMetadata.rawResponseReturned, false);
  assert.equal(calls, 1);
  assert.equal(NLSC_GEOCODE_URL, 'https://api.nlsc.gov.tw/idc/TextQueryAddress/');
});
