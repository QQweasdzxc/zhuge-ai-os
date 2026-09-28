import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseTdxMetroLivePayload,
  parseTdxRailLivePayload,
  TDX_RAIL_LIVE_URL,
  TDX_TOKEN_URL,
  tdxProxy,
} from './tdx.js';

const RAIL_SAMPLE = [
  {
    TrainNo: '1234',
    StationID: '1000',
    StationName: { Zh_tw: '臺北' },
    Direction: 0,
    TrainClassificationName: { Zh_tw: '自強號' },
    EndingStationName: { Zh_tw: '高雄' },
    ScheduledArrivalTime: '08:00:00',
    ScheduledDepartureTime: '08:02:00',
    DelayTime: 3,
    Platform: '1A',
    SrcUpdateTime: '2026-09-28T08:00:00+08:00',
  },
];

test('TDX rail live payload normalizes official read-only fields', () => {
  const result = parseTdxRailLivePayload(
    RAIL_SAMPLE,
    Date.parse('2026-09-28T00:05:00Z'),
  );
  assert.equal(result.providerId, 'taiwan.tdx.rail-live');
  assert.equal(result.entities[0].trainNo, '1234');
  assert.equal(result.entities[0].stationName, '臺北');
  assert.equal(result.entities[0].delayMinutes, 3);
  assert.equal(result.providerMetadata.rawResponseReturned, false);
  assert.equal(new URL(TDX_RAIL_LIVE_URL).hostname, 'tdx.transportdata.tw');
});

test('TDX metro live board is explicit and not mislabeled as crowd data', () => {
  const result = parseTdxMetroLivePayload(
    [
      {
        StationID: 'R10',
        StationName: { Zh_tw: '臺北車站' },
        DestinationName: { Zh_tw: '淡水' },
        EstimateTime: 180,
        SrcUpdateTime: '2026-09-28T08:00:00+08:00',
      },
    ],
    'TRTC',
    Date.parse('2026-09-28T00:05:00Z'),
  );
  assert.equal(result.providerId, 'taiwan.tdx.metro-live-board');
  assert.equal(result.capability, 'metro-live-board');
  assert.equal(result.entities[0].estimateSeconds, 180);
  assert.match(result.providerMetadata.sourceUrl, /Rail\/Metro\/LiveBoard\/TRTC/);
});

test('TDX adapter fails closed without credentials and does not call token or data endpoints', async () => {
  let calls = 0;
  const proxy = tdxProxy({
    resolveClientId: () => '',
    resolveClientSecret: () => '',
    fetchImpl: async () => {
      calls += 1;
      throw new Error('unexpected upstream call');
    },
  });
  const routes = new Map();
  proxy.configureServer({
    middlewares: {
      use(path, handler) {
        routes.set(path, handler);
      },
    },
  });
  const out = {
    destroyed: false,
    writeHead(status) {
      this.status = status;
    },
    end(body) {
      this.body = body;
    },
  };
  await routes.get('/api/taiwan/tdx')({ method: 'GET', url: '/rail/live' }, out);
  const body = JSON.parse(out.body);
  assert.equal(out.status, 200);
  assert.equal(body.status, 'provider_not_configured');
  assert.equal(body.providerMetadata.errorCode, 'PROVIDER_NOT_CONFIGURED');
  assert.equal(body.providerMetadata.upstreamCalled, false);
  assert.deepEqual(body.providerMetadata.requiredSecrets, [
    'TDX_CLIENT_ID',
    'TDX_CLIENT_SECRET',
  ]);
  assert.equal(calls, 0);
  assert.equal(TDX_TOKEN_URL.includes('/auth/realms/TDXConnect/protocol/openid-connect/token'), true);
});

test('TDX adapter rejects unsupported operators before upstream access', async () => {
  let calls = 0;
  const proxy = tdxProxy({
    fetchImpl: async () => {
      calls += 1;
      throw new Error('unexpected upstream call');
    },
  });
  const routes = new Map();
  proxy.configureServer({
    middlewares: {
      use(path, handler) {
        routes.set(path, handler);
      },
    },
  });
  const out = {
    destroyed: false,
    writeHead(status) {
      this.status = status;
    },
    end(body) {
      this.body = body;
    },
  };
  await routes.get('/api/taiwan/tdx')(
    { method: 'GET', url: '/metro/live?operator=NOT_REAL' },
    out,
  );
  assert.equal(out.status, 400);
  assert.equal(JSON.parse(out.body).error_code, 'UNSUPPORTED_TDX_OPERATOR');
  assert.equal(calls, 0);
});
