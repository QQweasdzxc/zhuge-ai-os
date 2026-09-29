import test from 'node:test';
import assert from 'node:assert/strict';
import {
  cwaProviderEndpoints,
  parseCwaTyphoonKml,
  parseCwaWindPayload,
} from './cwa.js';

test('CWA provider endpoints stay on the reconfirmed public source hosts', () => {
  assert.equal(
    new URL(cwaProviderEndpoints.radar).hostname,
    'cwaopendata.s3.ap-northeast-1.amazonaws.com',
  );
  assert.equal(
    new URL(cwaProviderEndpoints.typhoon).hostname,
    'c01.twipcam.com',
  );
  assert.equal(new URL(cwaProviderEndpoints.wind).hostname, 'c01.twipcam.com');
});

test('CWA wind JSON normalizes both components into a bounded regional grid', () => {
  const header = {
    nx: 3,
    ny: 2,
    lo1: 120,
    la1: 26,
    lo2: 121,
    la2: 25.5,
    dx: 0.5,
    dy: 0.5,
    refTime: '2026-09-27 12:00:00',
    forecastTime: 0,
  };
  const payload = {
    data: [
      {
        header: { ...header, parameterNumberName: 'eastward_wind' },
        data: [1, 2, 3, 4, 5, 6],
      },
      {
        header: { ...header, parameterNumberName: 'northward_wind' },
        data: [-1, -2, -3, -4, -5, -6],
      },
    ],
  };
  const result = parseCwaWindPayload(
    payload,
    Date.parse('2026-09-27T12:00:00Z'),
  );
  assert.equal(result.providerId, 'taiwan.cwa.gfs-wind');
  assert.deepEqual(result.grid.region, {
    west: 81,
    south: 3.5,
    east: 161,
    north: 38.5,
  });
  assert.deepEqual([...result.u], [1, 2, 3, 4, 5, 6]);
  assert.deepEqual([...result.v], [-1, -2, -3, -4, -5, -6]);
  assert.equal(result.cycle.validIso, '2026-09-27T12:00:00.000Z');
});

test('CWA KML normalizes current geometry and forecast point evidence', () => {
  const kml = `<?xml version="1.0"?><kml><Document>
    <description>2026-09-28T02:00+08:00</description>
    <Folder><name>颱風消息</name><description>2026-09-28T02:00+08:00</description><Folder>
      <name>測試颱風</name>
      <Placemark><name>過去路徑</name><styleUrl>#past-track</styleUrl><LineString><coordinates>120,20,0 121,21,0 122,22,0</coordinates></LineString></Placemark>
      <Placemark><name>風暴圈</name><styleUrl>#current</styleUrl><Polygon><outerBoundaryIs><LinearRing><coordinates>122,22,0 123,22,0 123,23,0 122,22,0</coordinates></LinearRing></outerBoundaryIs></Polygon></Placemark>
      <Placemark><name>颱風中心 - 09月28日02時</name><styleUrl>#current</styleUrl><Point><coordinates>122,22,0</coordinates></Point></Placemark>
      <Placemark><name>09月28日08時</name><styleUrl>#fcst</styleUrl><Point><coordinates>122.5,22.5,0</coordinates></Point></Placemark>
    </Folder></Folder>
  </Document></kml>`;
  const result = parseCwaTyphoonKml(kml, Date.parse('2026-09-28T00:00:00Z'));
  assert.equal(result.providerId, 'taiwan.cwa.typhoon');
  assert.equal(result.storms.length, 1);
  assert.equal(result.storms[0].basin, 'TW');
  assert.equal(result.storms[0].advisoryNumber, null);
  assert.equal(result.storms[0].geometryStatus, 'current');
  assert.equal(result.storms[0].forecastPoints[0].tauHours, 6);
  assert.deepEqual(result.storms[0].track.coordinates[0], [120, 20]);
});
