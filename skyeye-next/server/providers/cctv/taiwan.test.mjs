import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFreewayCctvXml,
  isTaiwanMetadataOnlySourceKind,
  parseNewTaipeiCctvJson,
  parseTaipeiCctvCsv,
} from './taiwan.js';

test('Taipei CCTV CSV normalizes official WGS84 metadata without media guesses', () => {
  const rows = parseTaipeiCctvCsv(
    '\uFEFF流水號,縣市別,攝影機編號位置,WGSX,WGSY\n1,臺北市,001-忠孝東路,121.5169,25.04855\n',
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'taipei-cctv-001');
  assert.equal(rows[0].lat, 25.04855);
  assert.equal(rows[0].lon, 121.5169);
  assert.equal(rows[0].url, '');
  assert.equal(rows[0].sourceKind, 'taipei-open-data-metadata');
  assert.match(rows[0].license, /application/);
});

test('New Taipei CCTV JSON normalizes official point metadata', () => {
  const rows = parseNewTaipeiCctvJson([
    {
      cctv_id: '1',
      areacode: 'C000002',
      district: '板橋區',
      address: '文化路1段、民生路',
      latitude: '25.022613',
      longitude: '121.467942',
    },
    { areacode: 'bad', latitude: 'not-a-coordinate', longitude: 121 },
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'new-taipei-cctv-C000002');
  assert.equal(rows[0].city, 'New Taipei');
  assert.equal(rows[0].url, '');
  assert.equal(rows[0].headingConfidence, 'unknown');
});

test('Freeway CCTV XML normalizes source URL and road direction', () => {
  const rows = parseFreewayCctvXml(`
    <CCTVList>
      <CCTVs>
        <CCTV>
          <CCTVID>CCTV-N1-S-0.000-M</CCTVID>
          <VideoStreamURL>https://cctvn.freeway.gov.tw/abs2mjpg/bmjpg?camera=10000</VideoStreamURL>
          <PositionLon>121.735695</PositionLon>
          <PositionLat>25.1229931</PositionLat>
          <RoadName>國道1號</RoadName>
          <RoadDirection>S</RoadDirection>
          <RoadSection><Start>基隆端</Start><End>基隆交流道</End></RoadSection>
          <LocationMile>0K+000</LocationMile>
        </CCTV>
      </CCTVs>
    </CCTVList>
  `);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, 'freeway-cctv-CCTV-N1-S-0-000-M');
  assert.match(rows[0].name, /國道1號/);
  assert.equal(rows[0].url, 'https://cctvn.freeway.gov.tw/abs2mjpg/bmjpg?camera=10000');
  assert.equal(rows[0].headingConfidence, 'source');
  assert.match(rows[0].license, /reuse/);
});

test('Taiwan CCTV parsers reject off-provider freeway URLs', () => {
  const rows = parseFreewayCctvXml(`
    <CCTV><CCTVID>bad</CCTVID><VideoStreamURL>https://example.invalid/cam</VideoStreamURL>
    <PositionLon>121</PositionLon><PositionLat>25</PositionLat></CCTV>
  `);
  assert.equal(rows[0].url, '');
});

test('metadata-only Taiwan source kinds are fail-closed for media', () => {
  assert.equal(isTaiwanMetadataOnlySourceKind('taipei-open-data-metadata'), true);
  assert.equal(
    isTaiwanMetadataOnlySourceKind('new-taipei-open-data-metadata'),
    true,
  );
  assert.equal(isTaiwanMetadataOnlySourceKind('freeway-open-data'), false);
  assert.equal(isTaiwanMetadataOnlySourceKind('snapshot'), false);
});
