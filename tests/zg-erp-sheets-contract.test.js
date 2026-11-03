/* ZG-ERP Sheets 轉接器契約測試：不觸網、不寫表。
 * 證明 (1) SheetsStore 與 MockStore 方法面一致（未來可切換 DATA_BACKEND）；
 *     (2) 讀取路徑把 bridge 列映射為與 MockStore.state() 相同的資料形狀；
 *     (3) 寫入路徑在接入前一律拒絕（防止寫錯表）。
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function loadData() {
  const storeMock = {};
  const g = globalThis;
  g.localStorage = {
    getItem: (k) => (k in storeMock ? storeMock[k] : null),
    setItem: (k, v) => { storeMock[k] = String(v); },
    removeItem: (k) => { delete storeMock[k]; }
  };
  g.window = g;
  require(path.join(ROOT, "ZG-ERP/erp-data.js"));
  return g.ZgErpData;
}

function loadSheets() {
  require(path.join(ROOT, "ZG-ERP/erp-sheets-adapter.js"));
  return globalThis.ZgErpSheets;
}

const STORE_METHODS = ["state", "saveAsset", "addZone", "startSession", "addRecord", "decide", "closeSession", "sessionRecords"];

test("SheetsStore 與 MockStore 方法面一致", () => {
  const D = loadData();
  const { SheetsStore } = loadSheets();
  const mock = D.store;
  const sheets = Object.create(SheetsStore.prototype);
  for (const m of STORE_METHODS) {
    assert.equal(typeof mock[m], "function", "MockStore 缺 " + m);
    assert.equal(typeof sheets[m], "function", "SheetsStore 缺 " + m);
  }
});

test("SheetsStore 建構需要 bridgeUrl", () => {
  const { SheetsStore } = loadSheets();
  assert.throws(() => new SheetsStore({}), /bridgeUrl/);
});

test("讀取路徑把 bridge 列映射為 MockStore.state() 同形", async () => {
  const { SheetsStore, DEFAULT_COLUMNS } = loadSheets();
  const A = DEFAULT_COLUMNS.assets, S = DEFAULT_COLUMNS.sites, R = DEFAULT_COLUMNS.records;
  const fake = {
    assets: { header: Object.values(A), rows: [["CSPH107030182", "Yealink 話機", "T46U", "YK-1", "陳小明", "台北", "3F 工程部", "使用中", "總部資訊設備更新", "2024-01-18", "2024-01-22", "2027-01-21", "Yealink", "中國", "話機", "2023", "PO-TEST-001"]] },
    sites: { header: Object.values(S), rows: [["台北", "25.047", "121.517", "1F 櫃台、3F 工程部"]] },
    records: { header: Object.values(R), rows: [["s1", "CSPH107030182", "ok", "3F 工程部", "2026-11-04T00:00:00Z", "2", "維持登記"]] }
  };
  const fetchImpl = async (url) => {
    const tab = new URL(url, "https://x.test").searchParams.get("tab");
    return { ok: true, json: async () => fake[tab] };
  };
  const s = new SheetsStore({ fetchImpl, bridgeUrl: "https://x.test/fn" });
  const st = await s.state();
  const D = loadData();
  const mockState = D.store.state();
  for (const k of ["assets", "sites", "projects", "sessions", "records"]) assert.ok(Array.isArray(st[k]), "state 缺 " + k);
  assert.deepEqual(Object.keys(st.assets[0]).sort(), Object.keys(mockState.assets[0]).filter((k) => k !== "__edited").sort());
  assert.equal(st.assets[0].code, "CSPH107030182");
  assert.equal(st.assets[0].zone, "3F 工程部");
  assert.deepEqual(st.sites[0].zones, ["1F 櫃台", "3F 工程部"]);
  assert.equal(st.records[0].n, 2);
  assert.equal(st.records[0].decision, "維持登記");
});

test("寫入路徑在接入前一律拒絕", async () => {
  const { SheetsStore, NOT_CONNECTED } = loadSheets();
  const s = new SheetsStore({ fetchImpl: async () => ({ ok: true, json: async () => ({ header: [], rows: [] }) }), bridgeUrl: "https://x.test/fn" });
  for (const m of ["saveAsset", "addZone", "startSession", "addRecord", "decide", "closeSession"]) {
    await assert.rejects(() => s[m]({}), new RegExp(NOT_CONNECTED.slice(0, 8)));
  }
});

test("bridge 回應格式不符時讀取失敗（不靜默當空表）", async () => {
  const { SheetsStore } = loadSheets();
  const s = new SheetsStore({ fetchImpl: async () => ({ ok: true, json: async () => ({ nope: 1 }) }), bridgeUrl: "https://x.test/fn" });
  await assert.rejects(() => s.state(), /格式不符/);
});
