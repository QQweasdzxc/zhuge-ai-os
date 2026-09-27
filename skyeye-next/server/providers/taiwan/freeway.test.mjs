import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FREEWAY_CMS_LIVE_URL,
  FREEWAY_CMS_STATIC_URL,
  FREEWAY_LIVE_TRAFFIC_URL,
  FREEWAY_SECTION_SHAPE_URL,
  parseFreewayCmsStaticXml,
  parseFreewayCmsXml,
  parseFreewayLiveTrafficXml,
  parseFreewaySectionShapeXml,
} from './freeway.js';

test('Freeway adapters use the official MOTC/NFB XML feeds', () => {
  assert.equal(
    new URL(FREEWAY_LIVE_TRAFFIC_URL).hostname,
    'tisvcloud.freeway.gov.tw',
  );
  assert.equal(
    new URL(FREEWAY_CMS_LIVE_URL).pathname,
    '/history/motc20/CMSLive.xml',
  );
  assert.equal(
    new URL(FREEWAY_SECTION_SHAPE_URL).pathname,
    '/history/motc20/SectionShape.xml',
  );
  assert.equal(
    new URL(FREEWAY_CMS_STATIC_URL).pathname,
    '/history/motc20/CMS.xml',
  );
});

test('LiveTraffic XML normalizes bounded travel and congestion evidence', () => {
  const result = parseFreewayLiveTrafficXml(
    `<LiveTrafficList><UpdateTime>2026-09-28T07:08:00+08:00</UpdateTime><LiveTraffics>
      <LiveTraffic><SectionID>0001</SectionID><TravelTime>50</TravelTime><TravelSpeed>75</TravelSpeed><CongestionLevelID>A</CongestionLevelID><CongestionLevel>2</CongestionLevel><DataCollectTime>2026-09-28T07:08:00+08:00</DataCollectTime><DataSources><HasVD>1</HasVD></DataSources></LiveTraffic>
    </LiveTraffics></LiveTrafficList>`,
    Date.parse('2026-09-28T00:00:00Z'),
  );
  assert.equal(result.providerId, 'taiwan.freeway.live-traffic');
  assert.equal(result.status, 'available');
  assert.equal(result.entities[0].sectionId, '0001');
  assert.equal(result.entities[0].travelSpeedKph, 75);
  assert.equal(result.entities[0].dataSources.vd, 1);
  assert.equal(result.providerMetadata.rawResponseReturned, false);
});

test('CMS XML preserves sanitized sign messages and timestamps', () => {
  const result = parseFreewayCmsXml(
    `<CMSLiveList><UpdateTime>2026-09-28T07:06:00+08:00</UpdateTime><CMSLives>
      <CMSLive><CMSID>CMS-N1-S-0.000-M</CMSID><MessageStatus>1</MessageStatus><Messages><Message><Text>行前檢查</Text><Type>6</Type><Priority>10</Priority></Message></Messages><Status>0</Status><DataCollectTime>2026-09-28T07:05:00+08:00</DataCollectTime></CMSLive>
    </CMSLives></CMSLiveList>`,
    Date.parse('2026-09-28T00:00:00Z'),
  );
  assert.equal(result.providerId, 'taiwan.freeway.cms');
  assert.equal(result.entities[0].cmsId, 'CMS-N1-S-0.000-M');
  assert.deepEqual(result.entities[0].messages[0], {
    text: '行前檢查',
    type: 6,
    priority: 10,
  });
  assert.equal(result.providerMetadata.rawResponseReturned, false);
});

test('SectionShape XML normalizes official WKT geometry without raw XML', () => {
  const result = parseFreewaySectionShapeXml(
    `<SectionShapeList><UpdateTime>2026-09-28T07:18:00+08:00</UpdateTime><SectionShapes>
      <SectionShape><SectionID>0001</SectionID><Geometry>LINESTRING(121.1 25.1,121.2 25.2)</Geometry></SectionShape>
    </SectionShapes></SectionShapeList>`,
    Date.parse('2026-09-28T00:00:00Z'),
  );
  assert.equal(result.providerId, 'taiwan.freeway.section-shape');
  assert.deepEqual(result.entities[0].coordinates, [
    [121.1, 25.1],
    [121.2, 25.2],
  ]);
  assert.equal(result.providerMetadata.rawResponseReturned, false);
});

test('CMS static XML supplies safe point placement for live signs', () => {
  const result = parseFreewayCmsStaticXml(
    `<CMSList><UpdateTime>2026-09-28T07:05:00+08:00</UpdateTime><CMSs>
      <CMS><CMSID>CMS-N1-S-0.000-M</CMSID><PositionLon>121.7</PositionLon><PositionLat>25.1</PositionLat><RoadName>國道1號</RoadName><RoadDirection>S</RoadDirection><LocationMile>0K+000</LocationMile><RoadSection><Start>基隆端</Start><End>基隆交流道</End></RoadSection></CMS>
    </CMSs></CMSList>`,
    Date.parse('2026-09-28T00:00:00Z'),
  );
  assert.equal(result.providerId, 'taiwan.freeway.cms-static');
  assert.deepEqual(result.entities[0], {
    id: 'CMS-N1-S-0.000-M',
    cmsId: 'CMS-N1-S-0.000-M',
    lon: 121.7,
    lat: 25.1,
    roadId: null,
    roadName: '國道1號',
    direction: 'S',
    locationMile: '0K+000',
    section: { start: '基隆端', end: '基隆交流道' },
  });
});

test('malformed or empty XML fails closed instead of fabricating entities', () => {
  assert.throws(
    () => parseFreewayLiveTrafficXml('<LiveTrafficList/>'),
    /freeway_live_records_empty/,
  );
  assert.throws(
    () => parseFreewayCmsXml('<CMSLiveList/>'),
    /freeway_cms_records_empty/,
  );
  assert.throws(
    () => parseFreewaySectionShapeXml('<SectionShapeList/>'),
    /freeway_section_shapes_empty/,
  );
  assert.throws(
    () => parseFreewayCmsStaticXml('<CMSList/>'),
    /freeway_cms_static_empty/,
  );
});
