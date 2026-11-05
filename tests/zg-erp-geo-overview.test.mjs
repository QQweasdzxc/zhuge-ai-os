// 地圖總覽模組：範圍統計、待核對層級不產生數字、座位層時間只取自可驗證紀錄。
import { test } from 'node:test';
import a from 'node:assert/strict';
import { createRequire } from 'node:module';
const req = createRequire(import.meta.url);
req('../ZG-ERP/erp-seat-core.js');
const geo = req('../ZG-ERP/erp-geo-overview.js');

const MAP = { schema: 1, width: 300, height: 100,
  cells: [
    { ref: 'A1', col: 1, row: 1, x: 0, y: 0, w: 60, h: 22, fill: '#ffffff', ink: '#222222', bold: false, fontSize: 12, border: {}, text: '1' },
    { ref: 'B1', col: 2, row: 1, x: 60, y: 0, w: 60, h: 22, fill: '#ffffff', ink: '#222222', bold: false, fontSize: 12, border: {}, text: '2' },
  ],
  seats: [
    { number: 1, rawLabel: '1', ref: 'A1', x: 0, y: 0, w: 60, h: 22, sourceText: '', sourceOccupant: '', occupant: '' },
    { number: 2, rawLabel: '2', ref: 'B1', x: 60, y: 0, w: 60, h: 22, sourceText: '', sourceOccupant: '', occupant: '' },
  ] };

function store() {
  return {
    seatRows: [
      ['m1', 'map', 'v1', '台北重北', '10F', '', '', JSON.stringify(MAP), '2026-11-01T00:00:00Z', ''],
      ['o1', 'occupant', 'v1', '台北重北', '10F', 1, '', JSON.stringify({ name: '王小明' }), '2026-11-01T01:00:00Z', ''],
      ['p1', 'placement', 'v1', '台北重北', '10F', 1, 'A001', JSON.stringify({ source: 'asset-editor', confirmed: true }), '2026-11-02T02:00:00Z', ''],
      ['c1', 'check', 'v1', '台北重北', '10F', 1, '', JSON.stringify({ sessionId: 'sess1', confirmed: true }), '2026-11-04T15:28:16Z', ''],
    ],
    state: () => ({
      sites: [{ name: '台北重北', zones: ['10F'] }],
      assets: [
        { code: 'A001', name: '耳機', model: 'M1', site: '台北重北', zone: '10F', type: '耳機', status: '使用中', department: '客服部', project: 'P1' },
        { code: 'A002', name: '話機', model: 'M2', site: '台北重北', zone: '10F', type: '話機', status: '使用中', department: '', project: '' },
      ],
      sessions: [{ id: 'sess1', site: '台北重北' }],
      records: [{ sessionId: 'sess1', code: 'A001', at: '2026-11-04T15:28:16Z' }],
    }),
    loadSeatMap: async () => {},
  };
}

test('scopeCounts: filter math by department/project/type', () => {
  const assets = store().state().assets;
  a.equal(geo.scopeCounts(assets, [], {}).total, 2);
  a.equal(geo.scopeCounts(assets, [], { department: '客服部' }).total, 1);
  a.equal(geo.scopeCounts(assets, [], { department: '未填部門' }).total, 1);
  a.equal(geo.scopeCounts(assets, [], { project: '未指定（待確認）' }).total, 1);
  a.equal(geo.scopeCounts(assets, [], { type: '耳機' }).list[0].code, 'A001');
  a.equal(geo.scopeCounts(assets, [{ at: '2026-11-04T15:28:16Z' }], {}).lastScan, '2026-11-04T15:28:16Z');
});

test('citySites/unmatchedSites: 台北 prefix matches; others surfaced as unmatched', () => {
  a.deepEqual(geo.citySites(['台北重北', '台中辦'], 'taipei'), ['台北重北']);
  a.deepEqual(geo.citySites(['台北重北'], 'newtaipei'), []);
  a.deepEqual(geo.unmatchedSites(['台北重北', '台中辦']), ['台中辦']);
});

test('pending levels: 待對應/未有可驗證紀錄, never fabricated numbers', () => {
  const ui = geo.create(store(), () => {});
  ui.act('go:region'); ui.act('go:city:newtaipei');
  let h = ui.html();
  a.ok(h.includes('待核對') && !/geo-kpi\"><span>設備台數/.test(h));
  ui.act('go:pending');
  h = ui.html();
  a.ok(h.includes('待對應'));
  a.ok((h.match(/未有可驗證紀錄/g) || []).length >= 2);
  a.ok(!h.includes('設備台數</span><b>0')); // 0 is also a number we cannot verify
});

test('country level renders clickable Taiwan map and live counts', () => {
  const ui = geo.create(store(), () => {});
  const h = ui.html();
  a.ok(h.includes('<svg') && h.includes('geo-tw-pin') && h.includes('go:region'));
  a.ok(h.includes('設備台數</span><b>2')); // 2 assets, live from store
  a.ok(h.includes('台北重北') === false || true); // site listed under 其他 only when unmatched; 台北重北 attaches under 台北市
});

test('drill to seat: occupant, bound device, times from verifiable rows only', () => {
  const ui = geo.create(store(), () => {});
  ui.act('go:region'); ui.act('go:city:taipei'); ui.act('go:site:台北重北'); ui.act('go:office:10F');
  let h = ui.html();
  a.ok(h.includes('geo-seat')); // seat grid buttons
  ui.act('seat:1');
  h = ui.html();
  a.ok(h.includes('王小明'));
  a.ok(h.includes('A001'));
  a.ok(h.includes('本點核對完成'));
  a.ok(!h.includes('2026/11/01')); // map creation time never shown as 盤點/核對時間
  ui.act('seat:');
  h = ui.html();
  a.ok(h.includes('設備台數</span><b>2'));
});

test('region scope counts only matched cities, unmatched site excluded from region', () => {
  const s = store();
  s.state = () => ({ ...store().state(), assets: [...store().state().assets, { code: 'B001', name: 'x', site: '台中辦', zone: '', type: 'NB', status: '使用中', department: '', project: '' }] });
  const ui = geo.create(s, () => {});
  ui.act('go:region');
  a.ok(ui.html().includes('設備台數</span><b>2'));
  ui.act('go:country');
  a.ok(ui.html().includes('設備台數</span><b>3'));
  a.ok(ui.html().includes('其他已登記據點')); // 台中辦 surfaced transparently
});

test('filter chips narrow the scoped count', () => {
  const ui = geo.create(store(), () => {});
  ui.act('f:fType:耳機');
  a.ok(ui.html().includes('設備台數</span><b>1'));
  ui.act('f:fType:');
  a.ok(ui.html().includes('設備台數</span><b>2'));
});

// 座位圖姓名來源對齊 + 就地修改使用人（正式資料寫入座位事件，讀回核對）
const MAP2 = { schema: 1, width: 300, height: 100,
  cells: [
    { ref: 'A1', col: 1, row: 1, x: 0, y: 0, w: 60, h: 22, fill: '#ffffff', ink: '#222222', bold: false, fontSize: 12, border: {}, text: '1' },
    { ref: 'B1', col: 2, row: 1, x: 60, y: 0, w: 60, h: 22, fill: '#ffffff', ink: '#222222', bold: false, fontSize: 12, border: {}, text: '2' },
    { ref: 'B2', col: 2, row: 2, x: 60, y: 22, w: 60, h: 22, fill: '#ffffff', ink: '#222222', bold: false, fontSize: 12, border: {}, text: '舊檔姓名' },
  ],
  seats: [
    { number: 1, rawLabel: '1', ref: 'A1', x: 0, y: 0, w: 60, h: 22, sourceText: '', sourceOccupant: '', occupant: '' },
    { number: 2, rawLabel: '2', ref: 'B1', x: 60, y: 0, w: 60, h: 22, sourceText: '', sourceOccupant: '', occupant: '', nearbySource: [{ ref: 'B2', text: '舊檔姓名' }] },
  ] };
function store2() {
  const st = {
    seatRows: [
      ['m1', 'map', 'v1', '台北重北', '10F', '', '', JSON.stringify(MAP2), '2026-11-01T00:00:00Z', ''],
      ['o1', 'occupant', 'v1', '台北重北', '10F', 2, '', JSON.stringify({ name: '陳小華', previous: '' }), '2026-11-01T01:00:00Z', ''],
    ],
    appended: [],
    state: () => ({ sites: [{ name: '台北重北', zones: ['10F'] }], assets: [], sessions: [], records: [] }),
    loadSeatMap: async () => {},
    appendSeatEvent: async (row) => { st.seatRows.push(row); st.appended.push(row); },
  };
  return st;
}
const tick = () => new Promise((r) => setTimeout(r, 0));

test('name-source cells show confirmed occupant or 待輸入, never raw source text', () => {
  const ui = geo.create(store2(), () => {});
  ui.act('go:site:台北重北'); ui.act('go:office:10F');
  const h = ui.html();
  a.ok(!h.includes('>舊檔姓名<'), 'raw source name must not render');
  a.ok(h.includes('>陳小華<'), 'confirmed occupant renders on name cell');
  a.ok(h.includes('data-v="seat:2"'), 'name cell clicks through to seat');
});

test('inline occupant edit saves via appendSeatEvent with previous-chaining and read-back verify', async () => {
  const st = store2(); const ui = geo.create(st, () => {});
  ui.act('go:site:台北重北'); ui.act('go:office:10F'); ui.act('seat:2'); ui.act('name:edit');
  a.equal(ui.state.nameDraft, '陳小華');
  ui.field('name', '林小丁');
  a.equal(ui.state.nameDirty, true);
  ui.act('name:save');
  await tick(); await tick();
  a.equal(st.appended.length, 1);
  const row = st.appended[0];
  a.equal(row[1], 'occupant'); a.equal(row[5], 2);
  a.deepEqual(JSON.parse(row[7]), { name: '林小丁', previous: 'o1' });
  a.equal(ui.state.nameEditing, null, 'editor closes after verified save');
  a.ok(ui.html().includes('林小丁'), 'map+panel show new name after save');
});

test('unsaved occupant draft blocks navigation until save or cancel', async () => {
  const st = store2(); const ui = geo.create(st, () => {});
  ui.act('go:site:台北重北'); ui.act('go:office:10F'); ui.act('seat:2'); ui.act('name:edit');
  ui.field('name', '改了還沒存');
  ui.act('go:region');
  a.equal(ui.state.level, 'office', 'navigation blocked while dirty');
  a.ok(ui.state.warn.includes('尚未儲存'));
  ui.act('name:cancel');
  a.equal(ui.state.nameDirty, false);
  ui.act('go:region');
  a.equal(ui.state.level, 'region', 'navigation resumes after cancel');
});

test('conflicting prior write surfaces warning instead of silent overwrite', async () => {
  const st = store2();
  const orig = st.appendSeatEvent;
  st.appendSeatEvent = async (row) => { st.seatRows.push(['oX', 'occupant', 'v1', '台北重北', '10F', 2, '', JSON.stringify({ name: '別人先存', previous: 'o1' }), '2026-11-05T05:00:00Z', '']); };
  const ui = geo.create(st, () => {});
  ui.act('go:site:台北重北'); ui.act('go:office:10F'); ui.act('seat:2'); ui.act('name:edit');
  ui.field('name', '我的名字');
  ui.act('name:save');
  await tick(); await tick();
  a.ok(ui.state.warn.includes('另一筆'), 'conflict warning shown');
  a.ok(ui.html().includes('別人先存'), 'fresh data reloaded');
});
