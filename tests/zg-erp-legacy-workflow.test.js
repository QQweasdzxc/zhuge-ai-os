{
// ZG-ERP 舊帳比對契約（不觸網）：rowToLegacy 欄名對應、記錄鍵穩定、釐清標示守門、reconcile 整合
const test = require("node:test");
const assert = require("node:assert/strict");
const { rowToLegacy } = require("../ZG-ERP/erp-sheets-adapter.js");
const { reconcile, validateAnnotation, snapshotOf } = require("../ZG-ERP/erp-reconcile.js");

// 實際整合-主檔 23 欄（2026-11-04 經 google-sheets 整合讀回驗證）
const HEADER = ["記錄鍵", "來源工作表", "來源列", "資產編號", "名稱", "型號規格", "地點位置", "區域", "公司", "專案", "資產類別", "保管人", "使用人", "電腦名稱", "採購日期", "S/N", "現原值", "本位幣金額", "系統", "備註", "對應狀態", "對應候選", "其他原始欄位"];
const ROW = ["R-0001", "台北", "12", "CSPH107030182", "Yealink 話機", "T46U", "大門", "3F 工程部", "", "專案A", "", "陳小明", "", "", "", "YK-1", "", "", "", "", "在冊", "", ""];

test("rowToLegacy：依欄名對應，欄位順序打亂結果不變；記錄鍵逐字採用", () => {
  const a = rowToLegacy(HEADER, ROW, 0);
  const b = rowToLegacy([...HEADER].reverse(), [...ROW].reverse(), 99);
  assert.equal(a.recordKey, "R-0001");
  assert.equal(b.recordKey, "R-0001"); // 永不以列位置推導
  assert.equal(b.code, "CSPH107030182");
  assert.equal(b.provenance, "台北 第12列");
  assert.equal(a.__row, 2);
  assert.equal(b.__row, 101); // __row 僅供參考，不進比對鍵
  assert.equal(a.siteLead, "台北"); // 出處線索
  assert.equal(a.zone, "3F 工程部");
  assert.equal(a.place, "大門"); // 地點位置另列，不取代區域
  assert.equal(a.model, "T46U"); // 型號規格→model
});

test("釐清標示守門：已報廢/已遺失需原因＋證據＋確認人齊全才合法", () => {
  assert.equal(validateAnnotation({ recordKey: "R-1", conclusion: "已報廢" }).ok, false);
  assert.equal(validateAnnotation({ recordKey: "R-1", conclusion: "已遺失", reason: "x", evidence: "y", confirmer: "z" }).ok, true);
  assert.equal(validateAnnotation({ recordKey: "R-1", conclusion: "位置確認" }).ok, true);
  assert.equal(validateAnnotation({ recordKey: "R-1", conclusion: "亂寫" }).ok, false);
  assert.equal(validateAnnotation({ conclusion: "位置確認" }).ok, false); // 缺記錄鍵
});

test("reconcile：已盤到／尚未掃到（不輸出遺失）／同編號多筆並列／已釐清優先／快照失配留人工", () => {
  const legacy = [
    rowToLegacy(HEADER, ROW, 0),
    rowToLegacy(HEADER, ["R-0002", "台北", "13", "CSLT209000111", "筆電", "E14", "", "3F 工程部", "", "", "", "陳小明"], 1),
    rowToLegacy(HEADER, ["R-0003", "台北", "14", "CSLT209000111", "筆電", "E14", "", "倉庫", "", "", "", "陳小明"], 2),
    rowToLegacy(HEADER, ["R-0004", "高雄", "5", "CSMB300000222", "螢幕", "24", "", "1F 門市"], 3)
  ];
  const db = {
    assets: [{ code: "CSPH107030182", site: "台北", zone: "3F 工程部", project: "" }],
    sessions: [], records: [], annotations: []
  };
  const res = reconcile(legacy, db, {}, []);
  assert.equal(res.matched.length, 1);
  assert.equal(res.pending.length, 1);
  assert.equal(res.pending[0].verdict, "尚未掃到"); // 範圍未宣告盤完：永不輸出遺失
  assert.equal(res.ambiguous.length, 1); // 同編號多筆候選並列，不選 canonical
  assert.equal(res.counts.newInventory, 1); // 實際觀察照算

  // 人工結論優先
  const ann = { recordKey: "R-0004", code: "CSMB300000222", snapshot: snapshotOf(legacy[3]), conclusion: "已報廢", reason: "面板破裂", evidence: "照片", confirmer: "主管", at: "2026-11-04T00:00:00Z" };
  const res2 = reconcile(legacy, db, {}, [ann]);
  assert.equal(res2.clarified.length, 1);
  assert.equal(res2.pending.length, 0);

  // 快照失配 → 標示失配，不套用到別列
  const drifted = rowToLegacy(HEADER, ["R-0004", "高雄", "5", "CSMB300000222", "別的設備", "24", "", "1F 門市"], 3);
  const res3 = reconcile([legacy[0], legacy[1], legacy[2], drifted], db, {}, [ann]);
  assert.equal(res3.staleAnnotations.length, 1);
  assert.equal(res3.clarified.length, 0);
});

}
{
/* ZG-ERP 專案歸屬定案（使用者 14:30）與舊帳載入路徑契約（不觸網、不寫表）。
 * (1) 掃到原本未指定專案的既有設備 → 歸入本次場次專案；已屬其他專案 → 保留原歸屬、不覆寫；
 *     待修/維修/報廢例外不回沖；新掃到 → 以本次專案建立。
 * (2) init() 舊帳載入用 _readFull 保留實際標頭（欄名對應）；三個舊帳分頁各自失敗隔離。
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const ROOT = path.join(__dirname, "..");

function loadSheets() {
  delete require.cache[require.resolve(path.join(ROOT, "ZG-ERP/erp-sheets-adapter.js"))];
  require(path.join(ROOT, "ZG-ERP/erp-sheets-adapter.js"));
  return globalThis.ZgErpSheets;
}

// 實際整合-主檔 23 欄（2026-11-04 經 google-sheets 整合讀回驗證）
const LEGACY_HEADER = ["記錄鍵", "來源工作表", "來源列", "資產編號", "名稱", "型號規格", "地點位置", "區域", "公司", "專案", "資產類別", "保管人", "使用人", "電腦名稱", "採購日期", "S/N", "現原值", "本位幣金額", "系統", "備註", "對應狀態", "對應候選", "其他原始欄位"];
const FLOW_HEADER = ["關係鍵", "類型", "資產編號", "記錄鍵A", "記錄鍵B", "出處A", "出處B", "狀態", "說明"];
const Q_HEADER = ["項目鍵", "類別", "內容摘要", "相關記錄鍵/出處", "建議處理", "狀態"];

function assetRow(code, site, zone, project, status) {
  const row = new Array(21).fill("");
  row[0] = code; row[1] = "設備"; row[4] = site; row[5] = zone; row[6] = "保管人"; row[7] = project; row[8] = status;
  return row;
}

function makeStore(assetRows, opts) {
  const { SheetsStore, HEADERS } = loadSheets();
  const failTabs = (opts && opts.failTabs) || [];
  const fetchImpl = async (url) => {
    const u = new URL(url, "https://x.test");
    const action = u.searchParams.get("action");
    const tab = u.searchParams.get("tab");
    if (action === "read") {
      if (failTabs.includes(tab)) return { ok: false, status: 500, json: async () => ({}) };
      const known = { "資產": HEADERS.assets, "盤點場次": HEADERS.sessions, "盤點紀錄": HEADERS.records, "流轉紀錄": HEADERS.movements, "進貨批次": HEADERS.batches, "位置表": HEADERS.sites, "釐清標示": HEADERS.annotations };
      const h = tab === "整合-主檔" ? LEGACY_HEADER : tab === "整合-流轉對應" ? FLOW_HEADER : tab === "整合-待確認" ? Q_HEADER : known[tab];
      if (!h) return { ok: false, status: 400, json: async () => ({}) };
      const rows = tab === "資產" ? assetRows
        : tab === "整合-主檔" ? [["R003749", "4F", "2", "CSMN107060033", "螢幕", "ASUS VH228", "大門", "4F", "", "專案舊", "", "保管人", "", "", "", "SN-1", "", "", "", "", "在冊", "", ""]]
        : tab === "整合-流轉對應" ? [["M02773", "4F快照共用", "CSMN107060033", "R003749", "R004170", "4F!2", "4F (115.下)!2", "待確認", "兩快照頁同編號；差異為記錄差異，非移動證明"]]
        : tab === "整合-待確認" ? [["Q001", "跨地點同碼", "編號 CSMN107060033 出現在多處", "R003749 R004170", "人工確認是否同一資產；確認前不合併", "待確認"]]
        : [];
      return { ok: true, status: 200, json: async () => ({ header: h, rows }) };
    }
    return { ok: true, status: 200, json: async () => ({ ok: true, updatedRange: "資產!A2:U2" }) };
  };
  return new SheetsStore({ bridgeUrl: "https://b.test/fn", fetchImpl, tokenProvider: () => "tok", tokenRefresher: async () => null });
}

test("init 舊帳載入路徑：_readFull 保留實際標頭，主檔／流轉對應／待確認各自到位", async () => {
  const store = makeStore([]);
  await store.init();
  assert.equal(store.legacyError(), "", "主檔讀取不得誤報失敗（_read 只回 rows 的回歸）");
  assert.equal(store.legacyRows().length, 1);
  assert.equal(store.legacyRows()[0].recordKey, "R003749");
  assert.equal(store.legacyRows()[0].model, "ASUS VH228");
  assert.equal(store.legacyFlows().length, 1);
  assert.equal(store.legacyFlows()[0].relationKey, "M02773");
  assert.equal(store.legacyQuestions().length, 1);
  assert.equal(store.legacyQuestions()[0].itemKey, "Q001");
  assert.equal(store.legacyAuxError(), "");
});

test("舊帳輔助分頁失敗隔離：流轉對應 500 不拖垮主檔與待確認，據實標記", async () => {
  const store = makeStore([], { failTabs: ["整合-流轉對應"] });
  await store.init();
  assert.equal(store.legacyRows().length, 1);
  assert.equal(store.legacyFlows().length, 0);
  assert.equal(store.legacyQuestions().length, 1);
  assert.ok(store.legacyAuxError().length > 0);
});

test("observeAsset：原本未指定專案的既有設備 → 歸入本次專案（含空值與「未指定（待確認）」）", async () => {
  const store = makeStore([
    assetRow("CSAA000000001", "台北", "10F", "", "使用中"),
    assetRow("CSAA000000002", "台北", "10F", "未指定（待確認）", "使用中")
  ]);
  await store.init();
  const sess = { id: "S1", site: "台北", project: "專案新" };
  const r1 = store.observeAsset(sess, "CSAA000000001", "10F");
  assert.equal(r1.assignedProject, "專案新");
  assert.equal(store.db.assets.find((a) => a.code === "CSAA000000001").project, "專案新");
  const r2 = store.observeAsset(sess, "CSAA000000002", "10F");
  assert.equal(r2.assignedProject, "專案新");
  assert.equal(store.db.assets.find((a) => a.code === "CSAA000000002").project, "專案新");
});

test("observeAsset：已屬其他專案 → 保留原歸屬不覆寫；新掃到 → 以本次專案建立；待修例外不回沖", async () => {
  const store = makeStore([
    assetRow("CSAA000000003", "台北", "10F", "專案舊", "使用中"),
    assetRow("CSAA000000004", "台北", "10F", "", "待修")
  ]);
  await store.init();
  const sess = { id: "S1", site: "台北", project: "專案新" };
  const r1 = store.observeAsset(sess, "CSAA000000003", "10F");
  assert.equal(r1.assignedProject || "", "", "其他專案不得被指派");
  assert.equal(store.db.assets.find((a) => a.code === "CSAA000000003").project, "專案舊", "原歸屬保留");
  const r2 = store.observeAsset(sess, "CSNW107049999", "10F");
  assert.equal(r2.created, true);
  assert.equal(store.db.assets.find((a) => a.code === "CSNW107049999").project, "專案新");
  const r3 = store.observeAsset(sess, "CSAA000000004", "10F");
  assert.equal(r3.exception, true, "待修不回沖");
  assert.equal(store.db.assets.find((a) => a.code === "CSAA000000004").status, "待修");
  assert.equal(store.db.assets.find((a) => a.code === "CSAA000000004").project, "", "例外設備不順手改專案");
});

test('observeAsset: all/unspecified sentinels never assign a project to existing or new devices', async () => {
  for (const project of ['', '全部', '全部專案', '未指定', '未指定（待確認）', '未指定(待確認)', '  未指定（待確認）  ']) {
    const store = makeStore([assetRow('A', '台北', '10F', '', '使用中')]);
    await store.init();
    const sess = {id:'S1', site:'台北', project};
    assert.equal(store.observeAsset(sess,'A','10F').assignedProject || '', '');
    assert.equal(store.db.assets.find(a=>a.code==='A').project,'');
    store.observeAsset(sess,'B','10F');
    assert.equal(store.db.assets.find(a=>a.code==='B').project,'');
  }
});

test('actual scan function with SheetsStore session: assigned and blocked paths render, one write per scan', async () => {
  const fs=require('node:fs'), vm=require('node:vm');
  const app=fs.readFileSync(path.join(ROOT,'ZG-ERP/erp-app.js'),'utf8');
  const scanSource=app.slice(app.indexOf('  function scan(code) {'), app.indexOf('  function detectGps()'));
  const store=makeStore([assetRow('A','台北','10F','','使用中'), assetRow('B','台北','10F','','待修')]);
  await store.init();
  let appends=0, updates=0, renders=0;
  store._append=async()=>{appends++; return 2;};
  store._update=async()=>{updates++;};
  const S={sess:{id:'S1',site:'台北',project:'專案新'},site:'台北',zone:'10F'};
  assert.equal(S.sess.records,undefined,'real Sheets session has no records array');
  const ctx={S,store,D:{UNASSIGNED:'未指定（待確認）'},getA:code=>store.db.assets.find(a=>a.code===code), curRecs:()=>store.sessionRecords(S.sess),render:()=>{renders++;}};
  vm.createContext(ctx);vm.runInContext(scanSource+'\nthis.run=scan;',ctx);
  ctx.run('A');
  const assigned=store.sessionRecords(S.sess).find(r=>r.code==='A');
  assert.equal(assigned.projectAssigned,'專案新');
  assert.equal(assigned.projMismatch,false);
  assert.equal(renders,1);
  await Promise.all([assigned.__write, store.db.assets.find(a=>a.code==='A').__write]);
  assert.equal(appends,1);assert.equal(updates,1);
  ctx.run('B');
  const blocked=store.sessionRecords(S.sess).find(r=>r.code==='B');
  assert.match(blocked.stateException,/待修/);
  await blocked.__write;
  assert.equal(renders,2);assert.equal(appends,2);assert.equal(updates,1);
  assert.equal(store.db.assets.find(a=>a.code==='B').project,'');
  assert.equal(store.db.records.length,2);
});

}
{
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../ZG-ERP/erp-app.js'), 'utf8');
function pager() {
  const ctx = { S: {}, esc: (v) => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;') };
  vm.createContext(ctx);
  vm.runInContext(source.slice(source.indexOf('  const LEGACY_PAGE = 100;'), source.indexOf('  function legacyLine(')) + '\nthis.page = capList;', ctx);
  return ctx;
}
test('5400 rows: initial 100, every later row reachable, final-page range/count', () => {
  const ctx = pager(); const list = Array.from({length:5400}, (_,i)=>i+1);
  let html = ctx.page('pending', list, n=>'<row>'+n+'</row>');
  assert.equal((html.match(/<row>/g)||[]).length,100);
  assert.match(html,/1–100 筆／共 5400 筆/);
  assert.match(html,/data-page="53"/);
  const visited = new Set();
  for(let p=0;p<54;p++) {
    ctx.S.legPages.pending=p;
    html=ctx.page('pending',list,n=>{visited.add(n);return '<row>'+n+'</row>';});
    assert.equal((html.match(/<row>/g)||[]).length,100);
  }
  assert.equal(visited.size,5400);
  assert.match(html,/5301–5400 筆／共 5400 筆/);
});
test('independent group state, clamp after list shrinks, partial final page',()=>{
  const c=pager(); const list=Array.from({length:205},(_,i)=>i);
  c.S.legPages={a:2,b:1};
  assert.match(c.page('a',list,String),/201–205 筆／共 205 筆/);
  assert.match(c.page('b',list,String),/101–200 筆／共 205 筆/);
  assert.match(c.page('a',[1,2],String),/1–2 筆／共 2 筆/);
  assert.equal(c.S.legPages.a,0);
});
test('all legacy groups have distinct paging keys; filters reset; no zero completion',()=>{
  for(const key of ['舊帳待確認事項','標示失配','尚未掃到','位置不符','同編號候選','已釐清','已盤到','新有舊無','無編號']) assert.ok(source.includes('capList("'+key+'",'));
  assert.match(source,/S\.legLead = v; S\.legPages = \{\}/);
  assert.match(source,/S\.legProj = v; S\.legPages = \{\}/);
  assert.match(source,/res\.ambiguous\.flatMap/);
  assert.ok(source.includes('尚無設備基準，不能判定盤完'));
  assert.ok(!source.includes('全部盤完'));
});

}
