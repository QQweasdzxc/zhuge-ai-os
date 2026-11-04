/* ZG-ERP token 換發測試：不觸網、不寫表。
 * 情境：使用者 session 還在（已登入），但 access_token 過期 → bridge 回 401。
 * 契約：
 *  (1) 只有 401 才觸發換發＋原樣重試一次；網路錯誤／5xx／其他 4xx 一律不重試（寫入不可模糊重送）；
 *  (2) 換發單機單次：init() 的 7 路並行讀取共用同一個換發 Promise（refresh token 會輪替）；
 *  (3) 重試帶新 token；換發失敗（回 null）維持原錯誤，不假裝成功；
 *  (4) zhugeRefreshToken 把輪替後的 token 對寫回同一個 localStorage key，其他欄位（user 等）保留。
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

function loadData(storeMock) {
  const g = globalThis;
  g.localStorage = {
    getItem: (k) => (k in storeMock ? storeMock[k] : null),
    setItem: (k, v) => { storeMock[k] = String(v); },
    removeItem: (k) => { delete storeMock[k]; }
  };
  g.window = g;
  loadSheets();
  delete require.cache[require.resolve(path.join(ROOT, "ZG-ERP/erp-data.js"))];
  require(path.join(ROOT, "ZG-ERP/erp-data.js"));
  return g.ZgErpData;
}

const SEVEN = ["資產", "盤點場次", "盤點紀錄", "流轉紀錄", "進貨批次", "位置表", "釐清標示"];

test("401 → 換發成功 → 帶新 token 原樣重試一次", async () => {
  const { SheetsStore, HEADERS } = loadSheets();
  const calls = [];
  let wave = 0;
  const fetchImpl = async (url, init) => {
    calls.push({ url, auth: (init && init.headers && init.headers.Authorization) || "" });
    wave += 1;
    if (wave <= 7) return { ok: false, status: 401, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ header: HEADERS.sites, rows: [] }) };
  };
  let refreshCalls = 0;
  const refresher = async () => { refreshCalls += 1; await new Promise((r) => setTimeout(r, 20)); return "newTok"; };
  const store = new SheetsStore({ bridgeUrl: "https://b.test/fn", fetchImpl, tokenProvider: () => (refreshCalls ? "newTok" : "oldTok"), tokenRefresher: refresher });
  // 直接驗證單支 _read 的重試行為
  await store.init().catch(() => {});
  const firstWave = calls.slice(0, 7);
  assert.ok(firstWave.every((c) => c.auth === "Bearer oldTok"), "第一波應帶舊 token");
  assert.equal(refreshCalls, 1, "7 路並行 401 只能觸發一次換發（單機單次）");
  const retries = calls.slice(7);
  assert.ok(retries.length > 0 && retries.every((c) => c.auth === "Bearer newTok"), "重試應帶新 token");
});

test("換發回 null → 不重試，原錯誤維持", async () => {
  const { SheetsStore } = loadSheets();
  let fetchCount = 0;
  const fetchImpl = async () => { fetchCount += 1; return { ok: false, status: 401, json: async () => ({}) }; };
  const store = new SheetsStore({ bridgeUrl: "https://b.test/fn", fetchImpl, tokenProvider: () => "oldTok", tokenRefresher: async () => null });
  await assert.rejects(store.init(), /讀取失敗/);
  assert.equal(fetchCount, 7, "換發失敗不得重試（每路各一次）");
});

test("500 與網路錯誤一律不觸發換發、不重試", async () => {
  const { SheetsStore } = loadSheets();
  let fetchCount = 0, refreshCalls = 0;
  const fetchImpl = async () => { fetchCount += 1; return { ok: false, status: 500, json: async () => ({}) }; };
  const store = new SheetsStore({ bridgeUrl: "https://b.test/fn", fetchImpl, tokenProvider: () => "tok", tokenRefresher: async () => { refreshCalls += 1; return "x"; } });
  await assert.rejects(store.init(), /讀取失敗/);
  assert.equal(fetchCount, 7);
  assert.equal(refreshCalls, 0, "非 401 不得換發");
});

test("寫入路徑：401 可換發重試一次；重試仍 401 則表面化，不多送", async () => {
  const { SheetsStore, HEADERS } = loadSheets();
  let fetchCount = 0;
  const fetchImpl = async (url, init) => {
    fetchCount += 1;
    const u = new URL(url, "https://x.test");
    if (u.searchParams.get("action") === "read") return { ok: true, status: 200, json: async () => ({ header: HEADERS.assets, rows: [["CSPH107030182", "Yealink 話機", "T46U", "YK-1", "台北", "3F", "保管人", "專案", "使用中", "", "", "", "", "", "", "", "", "補登", "", "建檔人", ""]] }) };
    return { ok: false, status: 401, json: async () => ({}) };
  };
  let refreshCalls = 0;
  const store = new SheetsStore({ bridgeUrl: "https://b.test/fn", fetchImpl, tokenProvider: () => "tok", tokenRefresher: async () => { refreshCalls += 1; return "tok2"; } });
  await store.init();
  const saved = store.saveAsset("CSPH107030182", { name: "話機（改）" });
  await saved.__write; // 鏡像寫入失敗以 __unsynced 呈現（契約：不假裝成功）
  assert.equal(saved.__unsynced, true, "重試仍 401 → 標未同步，不假裝成功");
  const updates = fetchCount - 7;
  assert.equal(updates, 2, "寫入 401：換發後僅原樣重試一次");
  assert.equal(refreshCalls, 1);
});

test("zhugeRefreshToken 寫回同一 key、保留 user 等欄位、單機單次", async () => {
  const storeMock = {
    "zhuge_ai_os_google_auth_session_v1": JSON.stringify({
      access_token: "expiredTok", refresh_token: "rt1",
      user: { email: "boss@example.com" }, custom: "keep-me"
    })
  };
  const g = globalThis;
  const realFetch = g.fetch;
  let refreshHttpCalls = 0;
  g.fetch = async (url, init) => {
    if (String(url).includes("/auth/v1/token")) {
      refreshHttpCalls += 1;
      assert.equal(JSON.parse(init.body).refresh_token, "rt1");
      assert.equal(init.headers.apikey.length > 20, true);
      await new Promise((r) => setTimeout(r, 20));
      return { ok: true, json: async () => ({ access_token: "freshTok", refresh_token: "rt2", expires_in: 3600 }) };
    }
    return { ok: true, json: async () => ({ header: [], rows: [] }) };
  };
  try {
    const D = loadData(storeMock);
    // 直接驅動：兩路並行換發 → 只送一次 HTTP
    const r = await Promise.all([D.refreshToken(), D.refreshToken()]);
    assert.deepEqual(r, ["freshTok", "freshTok"]);
    assert.equal(refreshHttpCalls, 1, "並行換發只能送一次（refresh token 會輪替）");
    const saved = JSON.parse(storeMock["zhuge_ai_os_google_auth_session_v1"]);
    assert.equal(saved.access_token, "freshTok");
    assert.equal(saved.refresh_token, "rt2", "輪替後的新 refresh token 要寫回");
    assert.equal(saved.custom, "keep-me", "其他欄位保留");
    assert.equal(saved.user.email, "boss@example.com", "user 欄位保留");
    assert.ok(saved.expires_at > Date.now(), "expires_at 更新為未來");
  } finally {
    g.fetch = realFetch;
  }
});
