import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FREEWAY_CMS_LIVE_URL,
  FREEWAY_LIVE_TRAFFIC_URL,
  parseFreewayCmsXml,
  parseFreewayLiveTrafficXml,
} from './freeway.js';

test('Freeway adapters use the official MOTC/NFB XML feeds', () => {
  assert.equal(new URL(FREEWAY_LIVE_TRAFFIC_URL).hostname, 'tisvcloud.freeway.gov.tw');
  assert.equal(new URL(FREEWAY_CMS_LIVE_URL).pathname, '/history/motc20/CMSLive.xml');
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
  assert.deepEqual(result.entities[0].messages[0], { text: '行前檢查', type: 6, priority: 10 });
  assert.equal(result.providerMetadata.rawResponseReturned, false);
});

test('malformed or empty XML fails closed instead of fabricating entities', () => {
  assert.throws(() => parseFreewayLiveTrafficXml('<LiveTrafficList/>'), /freeway_live_records_empty/);
  assert.throws(() => parseFreewayCmsXml('<CMSLiveList/>'), /freeway_cms_records_empty/);
});
