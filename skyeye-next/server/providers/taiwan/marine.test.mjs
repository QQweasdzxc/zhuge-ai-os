import assert from 'node:assert/strict';
import test from 'node:test';
import {
  marineProxy,
  parseTaipeiPortMarineXml,
  TAIPEI_PORT_MARINE_URL,
} from './marine.js';

const XML = `<?xml version="1.0"?><TP_Station><Declare><Publisher>測試</Publisher></Declare><History><Date_Time>2026-09-28 08:00:00</Date_Time><HS>0.61</HS><TP>5.7</TP><MDIR>258</MDIR><Tmean>4.6</Tmean><Velocity>0.751</Velocity><Vmdir>239</Vmdir><Latitude>25.18055</Latitude><Longitude>121.37277</Longitude><Status>0</Status></History></TP_Station>`;

test('Taipei Port marine XML normalizes wave observation evidence', () => {
  const result = parseTaipeiPortMarineXml(XML, Date.parse('2026-09-28T00:00:00Z'));
  assert.equal(result.providerId, 'taiwan.marine.wave');
  assert.equal(result.entities[0].waveHeightM, 0.61);
  assert.equal(result.entities[0].peakPeriodSeconds, 5.7);
  assert.equal(result.entities[0].latitude, 25.18055);
  assert.equal(result.providerMetadata.rawResponseReturned, false);
  assert.equal(new URL(TAIPEI_PORT_MARINE_URL).hostname, 'isohe.ihmt.gov.tw');
});

test('Taipei Port marine adapter coalesces reads and returns sanitized output', async () => {
  let calls = 0;
  const response = {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-length': String(XML.length) }),
    async text() {
      calls += 1;
      return XML;
    },
  };
  const proxy = marineProxy({ fetchImpl: async () => response, now: () => 0 });
  const routes = new Map();
  proxy.configureServer({ middlewares: { use(path, handler) { routes.set(path, handler); } } });
  const makeOut = () => ({ destroyed: false, writeHead(status) { this.status = status; }, end(body) { this.body = body; } });
  const a = makeOut();
  const b = makeOut();
  await Promise.all([
    routes.get('/api/taiwan/marine/wave')({ method: 'GET' }, a),
    routes.get('/api/taiwan/marine/wave')({ method: 'GET' }, b),
  ]);
  assert.equal(calls, 1);
  assert.equal(JSON.parse(a.body).entities.length, 1);
  assert.equal(JSON.parse(a.body).providerMetadata.rawResponseReturned, false);
});
