import assert from 'node:assert/strict';
import test from 'node:test';
import { parseWraReservoirPayload, reservoirProxy, WRA_RESERVOIR_URL } from './reservoir.js';

const SAMPLE = [
  {
    reservoiridentifier: '10203',
    reservoirname: '西勢水庫',
    datetime: '2026-09-26T00:00:00',
    basinrainfall: '0.0',
    capacity: '39.6',
    inflow: '1.17',
    nwlmax: '72.08',
    outflow: '1.02',
    outflowtotal: '1.02',
  },
  { reservoiridentifier: 'bad', reservoirname: '', datetime: '' },
];

test('WRA reservoir payload normalizes official fields and keeps blanks null', () => {
  const result = parseWraReservoirPayload(SAMPLE, Date.parse('2026-09-28T00:00:00Z'));
  assert.equal(result.providerId, 'taiwan.wra.reservoir');
  assert.equal(result.entities.length, 1);
  assert.equal(result.entities[0].name, '西勢水庫');
  assert.equal(result.entities[0].capacityTenThousandM3, 39.6);
  assert.equal(result.entities[0].deadWaterLevel, null);
  assert.equal(result.dataTimestamp, '2026-09-25T16:00:00.000Z');
  assert.equal(result.providerMetadata.rawResponseReturned, false);
  assert.match(WRA_RESERVOIR_URL, /^https:\/\/opendata\.wra\.gov\.tw\/api\/v2\//);
});

test('WRA adapter returns sanitized stale evidence and coalesces a read', async () => {
  let calls = 0;
  const response = {
    ok: true,
    status: 200,
    headers: new Headers({ 'content-length': '200' }),
    async text() {
      calls += 1;
      return JSON.stringify(SAMPLE);
    },
  };
  const proxy = reservoirProxy({
    fetchImpl: async () => response,
    now: () => Date.parse('2026-09-28T00:00:00Z'),
  });
  const routes = new Map();
  proxy.configureServer({ middlewares: { use(path, handler) { routes.set(path, handler); } } });
  const handler = routes.get('/api/taiwan/reservoirs');
  const responseBody = () => {
    const chunks = [];
    return {
      destroyed: false,
      writeHead(status, headers) { this.status = status; this.headers = headers; },
      end(value) { chunks.push(value); this.body = chunks.join(''); },
    };
  };
  const a = responseBody();
  const b = responseBody();
  await Promise.all([
    handler({ method: 'GET' }, a),
    handler({ method: 'GET' }, b),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(calls, 1);
  const body = JSON.parse(a.body);
  assert.equal(body.providerId, 'taiwan.wra.reservoir');
  assert.equal(body.entities.length, 1);
  assert.equal(body.providerMetadata.rawResponseReturned, false);
});

test('WRA adapter rejects non-GET without touching upstream', async () => {
  let calls = 0;
  const proxy = reservoirProxy({ fetchImpl: async () => { calls += 1; throw new Error('unexpected'); } });
  const routes = new Map();
  proxy.configureServer({ middlewares: { use(path, handler) { routes.set(path, handler); } } });
  const out = { destroyed: false, writeHead(status) { this.status = status; }, end(body) { this.body = body; } };
  await routes.get('/api/taiwan/reservoirs')({ method: 'POST' }, out);
  assert.equal(out.status, 405);
  assert.equal(calls, 0);
});
