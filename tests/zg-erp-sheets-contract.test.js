/* ZG-ERP Sheets 轉接器契約測試：不觸網、不寫表。
 * 11/4 cutover（DATA_BACKEND="sheets"）後的實際契約：
 *  (1) index.html 載入序為 adapter → erp-data；erp-data 在 sheets 模式下需要 ZgErpSheets 已存在；
 *  (2) buildStore() 產出 SheetsStore，方法面涵蓋 erp-app 實際使用的方法；
 *  (3) 讀取路徑把 bridge 列（中文分頁名、HEADERS 欄序）映射為 state() 的資料形狀；
 *  (4) 任何寫入在 init() 完成前一律拒絕（同步丟「請先 await init()」，防寫錯表）；
 *  (5) bridge 回應格式不符時 init() 拒絕（不靜默當空表）。
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function loadSheets() {
  require(path.join(ROOT, "ZG-ERP/erp-sheets-adapter.js"));
  return globalThis.ZgErpSheets;
}

function loadData() {
  const storeMock = {};
  const g = globalThis;
  g.localStorage = {
    getItem: (k) => (k in storeMock ? storeMock[k] : null),
    setItem: (k, v) => { storeMock[k] = String(v); },
    removeItem: (k) => { delete storeMock[k]; }
  };
  g.window = g;
  loadSheets(); // cutover 後 erp-data 需要 adapter 先載入（與 index.html script 序一致）
  require(path.join(ROOT, "ZG-ERP/erp-data.js"));
  return g.ZgErpData;
}

const APP_METHODS = ["state", "saveAsset", "addZone", "addSite", "startSession", "addRecord", "decide", "closeSession", "sessionRecords", "observeAsset"];

test("buildStore 產出 SheetsStore 且方法面涵蓋 app 所需", () => {
  const D = loadData();
  const { SheetsStore } = loadSheets();
  assert.ok(D.store instanceof SheetsStore, "sheets 模式下 buildStore 應產出 SheetsStore");
  for (const m of APP_METHODS) {
    assert.equal(typeof D.store[m], "function", "SheetsStore 缺 " + m);
  }
});

test("SheetsStore 建構需要 bridgeUrl", () => {
  const { SheetsStore } = loadSheets();
  assert.throws(() => new SheetsStore({}), /bridgeUrl/);
});

test("讀取路徑把 bridge 列映射為 state() 同形", async () => {
  const { SheetsStore, HEADERS } = loadSheets();
  const fake = {
    "資產": { header: HEADERS.assets, rows: [["CSPH107030182", "Yealink 話機", "T46U", "YK-1", "台北", "3F 工程部", "陳小明", "總部資訊設備更新", "使用中", "Yealink", "中國", "話機", "2023", "PO-TEST-001", "2024-01-18", "2024-01-22", "2027-01-21", "補登", "2024-01-22T09:00:00Z", "建檔人", ""]] },
    "位置表": { header: HEADERS.sites, rows: [["台北", "1F 櫃台", "", "25.047", "121.517"], ["台北", "3F 工程部", "", "", ""]] },
    "盤點紀錄": { header: HEADERS.records, rows: [["s1", "CSPH107030182", "ok", "台北", "3F 工程部", "2026-11-04T00:00:00Z", "2", "維持登記"]] }
  };
  const fetchImpl = async (url) => {
    const tab = new URL(url, "https://x.test").searchParams.get("tab");
    return { ok: true, json: async () => fake[tab] || { header: [], rows: [] } };
  };
  const s = new SheetsStore({ fetchImpl, bridgeUrl: "https://x.test/fn" });
  await s.init();
  const st = s.state();
  for (const k of ["assets", "sites", "projects", "sessions", "records"]) assert.ok(Array.isArray(st[k]), "state 缺 " + k);
  assert.equal(st.assets[0].code, "CSPH107030182");
  assert.equal(st.assets[0].zone, "3F 工程部");
  assert.equal(st.assets[0].site, "台北");
  assert.deepEqual(st.sites[0].zones, ["1F 櫃台", "3F 工程部"]);
  assert.equal(st.records[0].n, 2);
  assert.equal(st.records[0].decision, "維持登記");
});

test("寫入路徑在 init 完成前一律拒絕", async () => {
  const { SheetsStore } = loadSheets();
  const s = new SheetsStore({ fetchImpl: async () => ({ ok: true, json: async () => ({ header: [], rows: [] }) }), bridgeUrl: "https://x.test/fn" });
  for (const m of ["saveAsset", "addZone", "addSite", "startSession", "addRecord", "decide", "closeSession"]) {
    assert.throws(() => s[m]({}), /請先 await init/);
  }
});

test("bridge 回應格式不符時 init 失敗（不靜默當空表）", async () => {
  const { SheetsStore } = loadSheets();
  const s = new SheetsStore({ fetchImpl: async () => ({ ok: true, json: async () => ({ nope: 1 }) }), bridgeUrl: "https://x.test/fn" });
  await assert.rejects(() => s.init(), /格式不符/);
});
