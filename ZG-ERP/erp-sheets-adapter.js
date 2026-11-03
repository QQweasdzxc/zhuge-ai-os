/* ZG-ERP 正式 Google 試算表轉接器（設計版，尚未連線）。
 * 模式比照 app/Board/procurement/vendor-sheet-service.js + gas-vendor-bridge：
 * 前端 → Supabase Edge Function（Google 服務帳號）→ Google Sheets，寫入後讀回驗證。
 * 啟用前需要：使用者提供實際試算表 ID 與分頁/欄位 → 部署對應 bridge（基礎設施變更需另行同意）。
 * 目前：讀取路徑可對任何相容 bridge 端點運作（測試用注入 fetch）；
 *       寫入路徑一律拒絕，直到實際試算表與欄位對照確認（避免寫錯表）。
 */
(function (global) {
  "use strict";

  const NOT_CONNECTED = "正式試算表尚未接入（等待實際表格與欄位對照）";

  /* 欄位對照（預設草擬，待實際表格確認後調整） */
  const DEFAULT_COLUMNS = {
    assets: { code: "登記編號", name: "名稱", model: "型號", serial: "序號", owner: "保管人", site: "據點", zone: "區域", status: "狀態", project: "歸屬專案", purchase: "購入日期", activate: "啟用日期", warranty: "保固到期", brand: "品牌", origin: "產地", type: "產品類型", mfgYear: "製造年份" },
    sites: { name: "據點", lat: "緯度", lon: "經度", zones: "區域清單" },
    records: { sessionId: "場次", code: "登記編號", status: "判定", zone: "現場區域", at: "時間", n: "次數", decision: "處置" }
  };

  function rowsToObjects(header, rows) {
    return rows.map((r) => {
      const o = {};
      header.forEach((h, i) => { o[String(h).trim()] = r[i] == null ? "" : r[i]; });
      return o;
    });
  }

  class SheetsStore {
    /* opts: { fetchImpl, bridgeUrl, columns } — bridgeUrl 為 edge function 位址；測試時注入 fetchImpl */
    constructor(opts) {
      if (!opts || !opts.bridgeUrl) throw new Error("SheetsStore 需要 bridgeUrl（edge function 位址）");
      this.fetch = opts.fetchImpl || global.fetch.bind(global);
      this.bridgeUrl = opts.bridgeUrl;
      this.columns = opts.columns || DEFAULT_COLUMNS;
      this.db = null;
    }
    async _get(tab) {
      const res = await this.fetch(this.bridgeUrl + "?tab=" + encodeURIComponent(tab), { method: "GET" });
      if (!res || !res.ok) throw new Error("試算表讀取失敗（" + tab + "）");
      const body = await res.json();
      if (!body || !Array.isArray(body.header) || !Array.isArray(body.rows)) throw new Error("bridge 回應格式不符（" + tab + "）");
      return rowsToObjects(body.header, body.rows);
    }
    /* 讀回整份狀態（與 MockStore.state() 同形） */
    async state() {
      const [assetRows, siteRows, recordRows] = await Promise.all([this._get("assets"), this._get("sites"), this._get("records")]);
      const A = this.columns.assets, S = this.columns.sites, R = this.columns.records;
      this.db = {
        __v: 2,
        assets: assetRows.map((o) => ({
          code: String(o[A.code] || "").trim(), name: o[A.name] || "", model: o[A.model] || "",
          serial: o[A.serial] || "", owner: o[A.owner] || "", site: o[A.site] || "", zone: o[A.zone] || "",
          status: o[A.status] || "使用中", project: o[A.project] || "",
          purchase: o[A.purchase] || "", activate: o[A.activate] || "", warranty: o[A.warranty] || "",
          brand: o[A.brand] || "", origin: o[A.origin] || "", type: o[A.type] || "", mfgYear: o[A.mfgYear] || ""
        })).filter((a) => a.code),
        sites: siteRows.map((o) => ({
          name: o[S.name] || "", lat: Number(o[S.lat]) || 0, lon: Number(o[S.lon]) || 0,
          zones: String(o[S.zones] || "").split(/[、,，]/).map((z) => z.trim()).filter(Boolean)
        })).filter((s) => s.name),
        projects: [...new Set(assetRows.map((o) => o[A.project]).filter(Boolean))],
        sessions: [],
        records: recordRows.map((o) => ({
          sessionId: o[R.sessionId] || "", code: String(o[R.code] || "").trim(), status: o[R.status] || "",
          zone: o[R.zone] || "", at: o[R.at] || "", n: Number(o[R.n]) || 1, decision: o[R.decision] || ""
        })).filter((r) => r.code)
      };
      return this.db;
    }
    /* 寫入路徑：一律拒絕，直到實際試算表與欄位對照確認（防止寫錯表） */
    saveAsset() { return Promise.reject(new Error(NOT_CONNECTED)); }
    addZone() { return Promise.reject(new Error(NOT_CONNECTED)); }
    startSession() { return Promise.reject(new Error(NOT_CONNECTED)); }
    addRecord() { return Promise.reject(new Error(NOT_CONNECTED)); }
    decide() { return Promise.reject(new Error(NOT_CONNECTED)); }
    closeSession() { return Promise.reject(new Error(NOT_CONNECTED)); }
    sessionRecords(sess) { return (this.db ? this.db.records : []).filter((r) => r.sessionId === sess.id); }
  }

  global.ZgErpSheets = Object.freeze({ SheetsStore, DEFAULT_COLUMNS, NOT_CONNECTED });
})(typeof window !== "undefined" ? window : globalThis);
