/* ZG-ERP 資料層（庫存／設備管理）。
 * 架構（使用者 11/4 00:03 指定）：Google 試算表是唯一正式資料來源，
 * 資產、專案歸屬、位置表、盤點紀錄都在試算表，不另建第二套資料。
 * 讀寫比照 app/Board/procurement/vendor-sheet-service.js：
 * 前端 → Supabase Edge Function（gas-vendor-bridge 模式，服務帳號）→ Google Sheets。
 * 實際表格 11/4 提供後才建立對應 bridge 與欄位對照；目前一律使用 MockStore：
 * 測試資料只存在這個瀏覽器的 localStorage，重新整理會保留、清除瀏覽資料會消失，
 * 不會寫入任何正式系統，也不是公司實際資料。
 */
(function (global) {
  "use strict";

  const DATA_BACKEND = "mock"; // "mock" | "sheets"（待實際試算表接入後切換）
  const STORAGE_KEY = "zg_erp_demo_v2";

  const STATUSES = ["使用中", "備用", "待修", "維修中", "已報廢"];
  const PROJECT_SEED = ["總部資訊設備更新（測試）", "門市據點擴充（測試）", "雲端客服導入（測試）", "倉儲物流升級（測試）"];
  const UNASSIGNED = "未指定（待確認）";
  const SITE_SEED = {
    台北: { lat: 25.047, lon: 121.517, zones: ["1F 櫃台", "2F 業務部", "3F 工程部", "3F 會議室"] },
    新北: { lat: 25.012, lon: 121.465, zones: ["1F 倉庫", "2F 辦公區", "2F 會議室"] },
    桃園: { lat: 24.994, lon: 121.301, zones: ["A 棟倉庫", "B 棟機房", "辦公室"] },
    台中: { lat: 24.137, lon: 120.687, zones: ["1F 展示間", "2F 辦公區", "倉庫"] },
    高雄: { lat: 22.627, lon: 120.301, zones: ["1F 門市", "2F 辦公區", "機房"] }
  };

  function seedAssets() {
    const KINDS = [
      ["CSPH", "Yealink 話機", "T46U"], ["CSNB", "筆記型電腦", "ThinkPad E14"],
      ["CSMN", "螢幕", "24 吋"], ["CSSW", "網路交換器", "24 埠"],
      ["CSPR", "事務機", "A3 彩色"], ["CSPH", "Yealink 話機", "T54W"]
    ];
    const OWNERS = ["陳小明", "林小華", "王小美", "張小強", "公用"];
    const PROJ = [...PROJECT_SEED, UNASSIGNED];
    const ST = ["使用中", "使用中", "維修中", "備用", "待修", "使用中"];
    const out = [];
    Object.keys(SITE_SEED).forEach((site, si) => {
      KINDS.forEach((k, i) => {
        out.push({
          code: `${k[0]}10703${String(si * 60 + i * 7 + 11).padStart(4, "0")}`,
          name: k[1], model: k[2], owner: OWNERS[(i + si) % OWNERS.length],
          site, zone: SITE_SEED[site].zones[(i + si) % SITE_SEED[site].zones.length],
          status: ST[(i + si) % ST.length], project: PROJ[(i + si * 2) % PROJ.length],
          serial: `${k[0].slice(2)}-${String(20230000 + si * 420 + i * 37).padStart(8, "0")}`,
          purchase: (i + si) % 5 === 4 ? "" : `202${3 + ((i + si) % 3)}-${String((i + si * 2) % 12 + 1).padStart(2, "0")}-15`,
          activate: (i + si) % 5 === 4 ? "" : `202${3 + ((i + si) % 3)}-${String((i + si * 2) % 12 + 1).padStart(2, "0")}-20`,
          warranty: (i + si) % 5 === 4 ? "" : `202${6 + ((i + si) % 3)}-${String((i + si * 2) % 12 + 1).padStart(2, "0")}-19`
        });
      });
    });
    // 用戶貼紙上的實際編號（僅編號本身，非公司資料）：放在台北當範例
    out[0] = { code: "CSPH107030182", name: "Yealink 話機", model: "T46U", owner: "陳小明", site: "台北", zone: "3F 工程部", status: "使用中", project: PROJECT_SEED[0], serial: "YK-T46U-107030182", purchase: "2024-01-18", activate: "2024-01-22", warranty: "2027-01-21" };
    return out;
  }

  function seed() {
    return {
      __v: 2,
      sites: Object.entries(SITE_SEED).map(([name, v]) => ({ name, lat: v.lat, lon: v.lon, zones: v.zones.slice() })),
      projects: PROJECT_SEED.slice(),
      assets: seedAssets(),
      sessions: [],   // {id, site, lat, lon, at, closed}
      records: []     // {sessionId, code, status, zone, at, n, decision}
    };
  }

  class MockStore {
    constructor() {
      let raw = null;
      try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch { raw = null; }
      this.db = raw && raw.__v === 2 ? raw : seed();
      this.persist();
    }
    persist() { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.db)); } catch { /* 空間不足時維持記憶體狀態 */ } }
    state() { return this.db; }
    saveAsset(code, patch) {
      const a = this.db.assets.find((x) => x.code === code);
      if (!a) throw new Error("找不到設備 " + code);
      Object.assign(a, patch); a.__edited = true; this.persist(); return a;
    }
    addZone(site, zone) {
      const s = this.db.sites.find((x) => x.name === site);
      if (!s || s.zones.includes(zone)) return false;
      s.zones.push(zone); this.persist(); return true;
    }
    startSession(site, lat, lon, acc, project) {
      const sess = { id: "s" + Date.now(), site, lat, lon, acc: acc == null ? null : acc, project: project || "", at: new Date().toISOString(), closed: false };
      this.db.sessions.push(sess); this.persist(); return sess;
    }
    addRecord(sess, rec) {
      const prev = this.db.records.find((r) => r.sessionId === sess.id && r.code === rec.code);
      if (prev) { prev.n += 1; this.persist(); return prev; }
      const r = Object.assign({ sessionId: sess.id, n: 1, decision: "" }, rec);
      this.db.records.push(r); this.persist(); return r;
    }
    decide(sessionId, code, decision) {
      const r = this.db.records.find((x) => x.sessionId === sessionId && x.code === code);
      if (r) { r.decision = decision; this.persist(); }
    }
    closeSession(sess) { sess.closed = true; this.persist(); }
    sessionRecords(sess) { return this.db.records.filter((r) => r.sessionId === sess.id); }
  }

  /* 預留：正式 Google 試算表轉接器（vendor-sheet-service / gas-vendor-bridge 模式）。
   * 啟用前需：使用者提供實際試算表與欄位 → 建立對應 edge function bridge
   * （服務帳號分享該表）→ DATA_BACKEND 改為 "sheets" 並實作同名方法。 */
  class SheetsStore { constructor() { throw new Error("正式試算表尚未接入（等待實際表格）"); } }

  global.ZgErpData = Object.freeze({
    backend: DATA_BACKEND,
    isMock: DATA_BACKEND === "mock",
    store: DATA_BACKEND === "sheets" ? new SheetsStore() : new MockStore(),
    STATUSES, UNASSIGNED
  });
})(window);
