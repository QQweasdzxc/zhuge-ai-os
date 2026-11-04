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

  const DATA_BACKEND = "sheets"; // "mock" | "sheets"（2026-11-04 12:20 切換：bridge 已部署、讀寫正向路徑已驗）
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
    const BRANDS = ["Yealink", "Lenovo", "DELL", "Cisco", "HP", "Yealink"];
    const MFGY = ["2021", "2022", "2023", "2020", "", "2024"]; // 虛構製造年份；空白 = 年限未確認
    const TYPES = { "Yealink 話機": "話機", "筆記型電腦": "NB", "螢幕": "其他", "網路交換器": "其他", "事務機": "其他" }; // 虛構產品類型分類，可新增
    const ORIGINS = ["中國", "台灣", "越南", "馬來西亞", "未確認", "中國"]; // 虛構測試值；產地逐台記，不由品牌推斷
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
          warranty: (i + si) % 5 === 4 ? "" : `202${6 + ((i + si) % 3)}-${String((i + si * 2) % 12 + 1).padStart(2, "0")}-19`,
          brand: BRANDS[i], origin: ORIGINS[(i + si) % ORIGINS.length], mfgYear: MFGY[(i + si * 2) % MFGY.length], type: TYPES[k[1]] || "其他", po: ""
        });
      });
    });
    // 用戶貼紙上的實際編號（僅編號本身，非公司資料）：放在台北當範例
    out[0] = { code: "CSPH107030182", name: "Yealink 話機", model: "T46U", owner: "陳小明", site: "台北", zone: "3F 工程部", status: "使用中", project: PROJECT_SEED[0], serial: "YK-T46U-107030182", purchase: "2024-01-18", activate: "2024-01-22", warranty: "2027-01-21", brand: "Yealink", origin: "中國", mfgYear: "2023", type: "話機", po: "" };
    return out;
  }

  function seed() {
    return {
      __v: 2,
      sites: Object.entries(SITE_SEED).map(([name, v]) => ({ name, lat: v.lat, lon: v.lon, zones: v.zones.slice() })),
      projects: PROJECT_SEED.slice(),
      assets: seedAssets(),
      sessions: [],   // {id, site, lat, lon, at, closed}
      records: [],    // {sessionId, code, status, zone, at, n, decision}
      batches: [],    // 進貨批次 {id, vendor, brand, model, origin, note, at, items:[{serial,state,receivedAt,code}], unexpected:[{serial,at,n}]}
      movements: [],  // 設備流轉 {code, type, at, note}  type: inbound / outbound-sale / outbound-use / outbound-transfer / repair-start / repair-end
      meta: { codeSeq: 1, codePrefix: "CSNW" } // codePrefix 為測試用編碼，不是公司正式編碼規則；正式規則待公司提供後改這裡
    };
  }

  class MockStore {
    constructor() {
      let raw = null;
      try { raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null"); } catch { raw = null; }
      this.db = raw && raw.__v === 2 ? raw : seed();
      this.db.batches = this.db.batches || [];
      this.db.movements = this.db.movements || [];
      this.db.meta = this.db.meta || { codeSeq: 1, codePrefix: "CSNW" };
      this.db.meta.codePrefix = this.db.meta.codePrefix || "CSNW";
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
    /* ---- 進貨批次（待入庫）：序號清單只是預計到貨，確認入庫前不影響設備總數與應盤 ---- */
    listBatches() { return this.db.batches; }
    batch(id) { return this.db.batches.find((b) => b.id === id); }
    addBatch(info) {
      const serials = (info.serials || []).map((s) => String(s).trim()).filter(Boolean);
      const seen = new Set(); const items = [];
      serials.forEach((s) => { if (!seen.has(s)) { seen.add(s); items.push({ serial: s, state: "pending", receivedAt: "", code: "" }); } });
      const b = { id: "b" + Date.now(), po: info.po || "", vendor: info.vendor || "", brand: info.brand || "", model: info.model || "", origin: info.origin || "未確認", mfgYear: info.mfgYear || "", type: info.type || "",
        note: info.note || "", at: new Date().toISOString(), items, unexpected: [], closed: false };
      this.db.batches.push(b); this.persist(); return b;
    }
    /* 到貨核對一筆序號：ok 清單內新到 / dup 重複 / unexpected 清單外 / exists 已在設備清冊 */
    receiveSerial(id, serial) {
      const b = this.batch(id); if (!b) return { result: "nobatch" };
      const s = String(serial || "").trim(); if (!s) return { result: "empty" };
      const it = b.items.find((x) => x.serial === s);
      if (it && it.state === "pending") {
        /* 掃描當下就擋：清單內但序號已在清冊（含別批先入庫），不標到貨 */
        const ex = this.db.assets.find((a) => a.serial === s);
        if (ex) return { result: "exists", asset: ex };
        it.state = "received"; it.receivedAt = new Date().toISOString(); this.persist(); return { result: "ok", item: it };
      }
      if (it) return { result: "dup", item: it };
      if (this.db.assets.some((a) => a.serial === s)) return { result: "exists", asset: this.db.assets.find((a) => a.serial === s) };
      const u = b.unexpected.find((x) => x.serial === s);
      if (u) { u.n += 1; this.persist(); return { result: "dup" }; }
      b.unexpected.push({ serial: s, at: new Date().toISOString(), n: 1 }); this.persist(); return { result: "unexpected" };
    }
    /* 確認入庫：把已核對收到的序號建成正式設備（內部登記編號此時才產生），逐台保留批次的品牌/產地 */
    confirmInbound(id, dest) {
      const b = this.batch(id); if (!b) return [];
      const made = [];
      b.items.filter((x) => x.state === "received").forEach((x) => {
        /* 防撞：同序號已在清冊（含別批先入庫）就不重複建機，標 conflict 保留人工處理 */
        if (this.db.assets.some((a) => a.serial && a.serial === x.serial)) { x.state = "conflict"; return; }
        const code = (this.db.meta.codePrefix || "CSNW") + String(107040000 + this.db.meta.codeSeq++).padStart(9, "0");
        const a = { code, name: b.model || b.brand || "未命名設備", model: b.model || "", brand: b.brand || "", origin: b.origin || "未確認",
          owner: dest.owner || "公用", site: dest.site, zone: dest.zone, status: "備用", project: dest.project || UNASSIGNED,
          serial: x.serial, purchase: b.at.slice(0, 10), activate: "", warranty: "", mfgYear: b.mfgYear || "", type: b.type || "", po: b.po || "" };
        this.db.assets.push(a);
        x.state = "inbound"; x.code = code;
        this.db.movements.push({ code, type: "inbound", at: new Date().toISOString(), note: "進貨入庫（" + (b.vendor || "未填廠商") + "）→ " + dest.site + " " + dest.zone });
        made.push(a);
      });
      if (b.items.every((x) => x.state === "inbound")) b.closed = true;
      this.persist(); return made;
    }
    addMovement(code, type, note) {
      const m = { code, type, at: new Date().toISOString(), note: note || "" };
      this.db.movements.push(m); this.persist(); return m;
    }
    movementsOf(code) { return this.db.movements.filter((m) => m.code === code); }
    sessionRecords(sess) { return this.db.records.filter((r) => r.sessionId === sess.id); }
  }

  /* 正式「現存資料庫」轉接器（erp-sheets-adapter.js，zg-ledger-bridge 模式）。
   * 啟用條件：bridge 部署完成＋新試算表建立 → DATA_BACKEND 改為 "sheets"。
   * 舊帳（59 整合工作簿）唯讀比對，不是寫入目標。 */
  const BRIDGE_URL = "https://lenpbbhwxyyfwgvjcozf.supabase.co/functions/v1/zg-ledger-bridge";
  function zhugeSession() {
    for (const key of ["zhuge_ai_os_google_auth_session_v1", "zhuge_ai_os_session_v1"]) {
      try {
        const sess = JSON.parse(localStorage.getItem(key) || "null");
        if (sess) return sess;
      } catch { /* 下一個 key */ }
    }
    return null;
  }
  function zhugeAccessToken() {
    const s = zhugeSession();
    if (!s) return null;
    return s.access_token || (s.session && s.session.access_token) || (s.data && s.data.access_token) || null;
  }
  function currentActor() {
    const sess = zhugeSession() || {};
    const u = sess.user || {};
    return sess.name || sess.email || u.email || u.name || "";
  }
  function buildStore() {
    if (DATA_BACKEND !== "sheets") return new MockStore();
    if (!global.ZgErpSheets) throw new Error("erp-sheets-adapter.js 未載入");
    return new global.ZgErpSheets.SheetsStore({ bridgeUrl: BRIDGE_URL, actor: currentActor(),
      tokenProvider: zhugeAccessToken });
  }

  global.ZgErpData = Object.freeze({
    backend: DATA_BACKEND,
    isMock: DATA_BACKEND === "mock",
    store: buildStore(),
    STATUSES, UNASSIGNED
  });
})(window);
