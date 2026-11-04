/* ZG-ERP 首據點建立驗收測試。
 * 背景（11/4 12:48 產品阻斷）：真實試算表「位置表」只有表頭 → sites 為空 →
 * 掃描頁據點 chips 空、開始連續掃描鍵 disabled；管理「位置表」只能幫既有據點
 * 加區域，沒有「建立第一個據點」的入口。11/4 產品方向：所有作業都要能在 ERP 前台完成。
 *
 * 本測試約束 store 層驗收行為（對應 11/4 12:49 實作的 addSite UI，區域為建立必填）：
 *  1. SheetsStore 提供 addSite(name, zone, lat, lon)；
 *  2. 位置表 header-only（零資料列）→ state().sites 為空（重現阻斷起點）；
 *  3. addSite 透過 bridge append 一列 [據點, 區域, "", 緯度, 經度]，鏡像即刻可見、區域已掛；
 *  4. 重複據點名拒絕（回 false）且不重複寫列；
 *  5. 讀取路徑可回讀首據點列（據點＋第一個區域）；
 *  6. 建立據點後 addZone 可掛第二個區域（手機「目前區域」選項的資料前提）。
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

function loadSheets() {
  require(path.join(ROOT, "ZG-ERP/erp-sheets-adapter.js"));
  return globalThis.ZgErpSheets;
}

/* 假 bridge：GET 回各 tab 空表（或可指定的 sites 列），POST 只記錄不寫庫 */
function makeBridge(opts) {
  const calls = [];
  const sitesRows = (opts && opts.sitesRows) || [];
  const fetchImpl = async (url, init) => {
    const u = new URL(url, "https://x.test");
    const action = u.searchParams.get("action");
    const tab = u.searchParams.get("tab");
    calls.push({ action, tab, body: init && init.body ? JSON.parse(init.body) : null });
    if (action === "read") {
      return { ok: true, json: async () => ({ header: [], rows: tab === "位置表" ? sitesRows : [] }) };
    }
    if (action === "append") {
      return { ok: true, json: async () => ({ ok: true, updatedRange: tab + "!A2:E2" }) };
    }
    return { ok: true, json: async () => ({ ok: true }) };
  };
  return { calls, fetchImpl };
}

async function untilOk(fn) {
  for (let i = 0; i < 100; i++) { if (fn()) return; await new Promise((r) => setImmediate(r)); }
  assert.ok(fn(), "背景寫回未完成");
}

test("位置表 header-only：sites 為空（重現阻斷起點）", async () => {
  const { SheetsStore } = loadSheets();
  const b = makeBridge();
  const s = new SheetsStore({ fetchImpl: b.fetchImpl, bridgeUrl: "https://x.test/fn" });
  await s.init();
  assert.equal(s.state().sites.length, 0, "header-only 的位置表不該憑空生出據點");
});

test("addSite 建立第一個據點（含首區域）：append 正確列、鏡像即刻可見", async () => {
  const { SheetsStore } = loadSheets();
  const b = makeBridge();
  const s = new SheetsStore({ fetchImpl: b.fetchImpl, bridgeUrl: "https://x.test/fn" });
  await s.init();
  assert.equal(typeof s.addSite, "function", "SheetsStore 缺 addSite（首據點建立 API）");
  const ok = s.addSite("總部", "1F 辦公區", 25.05, 121.55);
  assert.equal(ok, true, "首次 addSite 應成功");
  const site = s.state().sites.find((x) => x.name === "總部");
  assert.ok(site, "鏡像應即刻可見新據點（不等重新整理）");
  assert.deepEqual(site.zones, ["1F 辦公區"], "新據點已掛第一個區域");
  await untilOk(() => b.calls.some((c) => c.action === "append" && c.tab === "位置表"));
  const row = b.calls.find((c) => c.action === "append" && c.tab === "位置表").body.row;
  assert.equal(row[0], "總部");
  assert.equal(row[1], "1F 辦公區", "首據點列帶第一個區域");
  assert.equal(row[2], "", "首據點列的 QR 欄留空");
  assert.equal(String(row[3]), "25.05");
  assert.equal(String(row[4]), "121.55");
});

test("重複據點名拒絕且不重複寫列", async () => {
  const { SheetsStore } = loadSheets();
  const b = makeBridge();
  const s = new SheetsStore({ fetchImpl: b.fetchImpl, bridgeUrl: "https://x.test/fn" });
  await s.init();
  s.addSite("總部", "1F 辦公區", 25.05, 121.55);
  await untilOk(() => b.calls.filter((c) => c.action === "append").length === 1);
  assert.equal(s.addSite("總部", "2F", 0, 0), false, "同名據點應拒絕");
  await untilOk(() => true);
  assert.equal(b.calls.filter((c) => c.action === "append").length, 1, "重複據點不得再寫列");
});

test("讀取路徑可回讀首據點列（含區域）", async () => {
  const { SheetsStore } = loadSheets();
  const b = makeBridge({ sitesRows: [["總部", "1F 辦公區", "", "25.05", "121.55"]] });
  const s = new SheetsStore({ fetchImpl: b.fetchImpl, bridgeUrl: "https://x.test/fn" });
  await s.init();
  const site = s.state().sites.find((x) => x.name === "總部");
  assert.ok(site, "首據點列應還原為據點");
  assert.equal(site.lat, 25.05);
  assert.equal(site.lon, 121.55);
  assert.deepEqual(site.zones, ["1F 辦公區"]);
});

test("首據點建立後可掛第二個區域（addZone 整合）", async () => {
  const { SheetsStore } = loadSheets();
  const b = makeBridge();
  const s = new SheetsStore({ fetchImpl: b.fetchImpl, bridgeUrl: "https://x.test/fn" });
  await s.init();
  s.addSite("總部", "1F 辦公區", 25.05, 121.55);
  await untilOk(() => b.calls.filter((c) => c.action === "append").length === 1);
  assert.equal(s.addZone("總部", "3F 工程部"), true, "既有 addZone 應能掛第二個區域");
  const site = s.state().sites.find((x) => x.name === "總部");
  assert.deepEqual(site.zones, ["1F 辦公區", "3F 工程部"]);
  await untilOk(() => b.calls.filter((c) => c.action === "append").length === 2);
});
