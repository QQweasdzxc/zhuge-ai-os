/* ZG-ERP 正式 Google 試算表轉接器（設計版 v2，尚未連線）。
 * 架構（2026-11-04 使用者定案）：舊帳（59 整合工作簿）唯讀比對；
 * 新帳「現存資料庫」（另創試算表，PRIVATE）是 ERP 唯一讀寫目標。
 * 路徑：前端 → zg-ledger-bridge（Supabase Edge，登入＋已放行 fail-closed）→ Google Sheets。
 * 寫入紀律：每筆異動先寫 bridge，成功才更新本機狀態；失敗一律丟出「未同步」錯誤，
 * 不假裝成功、不靜默保留本機幻覺（使用者 11:54 要求：寫入失敗要明確顯示）。
 * 值一律 RAW 寫入，保留前導零與原文。
 */
(function (global) {
  "use strict";

  const NOT_CONNECTED = "現存資料庫尚未接入（等待新試算表建立與部署）";
  const UNSYNCED = "寫入失敗，資料未同步";

  /* 新帳六分頁與欄位順序（RAW 寫入，順序即契約） */
  const TABS = {
    assets: "資產",
    sessions: "盤點場次",
    records: "盤點紀錄",
    movements: "流轉紀錄",
    batches: "進貨批次",
    sites: "位置表",
    annotations: "釐清標示"
  };
  const HEADERS = {
    assets: ["資產編號", "名稱", "型號", "序號", "據點", "區域", "保管人", "專案", "狀態", "品牌", "產地", "類型", "製造年份", "PO編號", "採購日期", "啟用日期", "保固到期", "來源", "建立時間", "建立人", "最後異動時間"],
    sessions: ["場次鍵", "據點", "區域", "定位方式", "緯度", "經度", "定位精度", "專案範圍", "經手人", "開始時間", "狀態", "結束時間"],
    records: ["場次鍵", "資產編號", "判定", "現場據點", "現場區域", "時間", "次數", "處置"],
    movements: ["事件鍵", "日期", "事件類型", "資產編號", "來自地點", "至地點", "數量", "經手人", "備註", "出處"],
    batches: ["行別", "批次鍵", "PO", "廠商", "品牌", "型號", "產地", "類型", "製造年份", "備註", "建立時間", "狀態", "序號", "到貨時間", "登記編號"],
    sites: ["據點", "區域", "QR內容", "緯度", "經度"],
    annotations: ["記錄鍵", "資產編號", "出處", "快照", "進度", "結論", "原因", "證據", "確認人", "時間", "新帳資產編號", "備註"]
  };

  const MOVEMENT_TYPE = { "inbound": "入庫", "outbound-transfer": "調撥", "outbound-sale": "出庫", "outbound-use": "出庫", "repair-start": "維修", "repair-end": "維修" };

  function assetToRow(a, actor) {
    return [a.code, a.name || "", a.model || "", a.serial || "", a.site || "", a.zone || "", a.owner || "", a.project || "",
      a.status || "未確認", a.brand || "", a.origin || "未確認", a.type || "", a.mfgYear || "", a.po || "",
      a.purchase || "", a.activate || "", a.warranty || "", a.source || "補登", a.createdAt || "", a.createdBy || actor || "", a.updatedAt || ""];
  }
  function rowToAsset(row, i) {
    return { __row: i + 2, code: String(row[0] || "").trim(), name: row[1] || "", model: row[2] || "", serial: row[3] || "",
      site: row[4] || "", zone: row[5] || "", owner: row[6] || "", project: row[7] || "", status: row[8] || "未確認",
      brand: row[9] || "", origin: row[10] || "未確認", type: row[11] || "", mfgYear: row[12] || "", po: row[13] || "",
      purchase: row[14] || "", activate: row[15] || "", warranty: row[16] || "", source: row[17] || "",
      createdAt: row[18] || "", createdBy: row[19] || "", updatedAt: row[20] || "" };
  }
  function sessionToRow(s, actor) {
    return [s.id, s.site || "", s.zone || "", s.fixType || "", s.lat == null ? "" : s.lat, s.lon == null ? "" : s.lon,
      s.acc == null ? "" : s.acc, s.project || "", actor || "", s.at, s.closed ? "已結束" : "進行中", s.closedAt || ""];
  }
  function rowToSession(row, i) {
    return { __row: i + 2, id: String(row[0] || ""), site: row[1] || "", zone: row[2] || "", fixType: row[3] || "",
      lat: row[4] === "" ? null : Number(row[4]), lon: row[5] === "" ? null : Number(row[5]),
      acc: row[6] === "" ? null : Number(row[6]), project: row[7] || "", operator: row[8] || "",
      at: row[9] || "", closed: row[10] === "已結束", closedAt: row[11] || "" };
  }
  function recordToRow(r, sess) {
    return [r.sessionId, r.code, r.status || "", (sess && sess.site) || r.site || "", r.zone || "", r.at, r.n || 1, r.decision || ""];
  }
  function rowToRecord(row, i) {
    return { __row: i + 2, sessionId: String(row[0] || ""), code: String(row[1] || "").trim(), status: row[2] || "",
      site: row[3] || "", zone: row[4] || "", at: row[5] || "", n: Number(row[6]) || 1, decision: row[7] || "" };
  }
  function movementToRow(m, actor) {
    return [m.id || "", m.at, MOVEMENT_TYPE[m.type] || m.type, m.code, m.from || "", m.to || "", m.qty == null ? 1 : m.qty, actor || "", m.note || "", m.source || "ERP 前台"];
  }
  function rowToMovement(row, i) {
    const rev = Object.keys(MOVEMENT_TYPE).find((k) => MOVEMENT_TYPE[k] === row[2]);
    return { __row: i + 2, id: String(row[0] || ""), at: row[1] || "", type: rev || String(row[2] || ""), code: String(row[3] || "").trim(),
      from: row[4] || "", to: row[5] || "", qty: Number(row[6]) || 1, operator: row[7] || "", note: row[8] || "", source: row[9] || "" };
  }

  function annotationToRow(a) {
    return [a.recordKey, a.code || "", a.provenance || "", JSON.stringify(a.snapshot || {}), a.progress || "",
      a.conclusion || "", a.reason || "", a.evidence || "", a.confirmer || "", a.at || "", a.newAssetCode || "", a.note || ""];
  }
  function rowToAnnotation(row, i) {
    let snap = null;
    try { snap = JSON.parse(row[3] || "null"); } catch { snap = null; }
    return { __row: i + 2, recordKey: String(row[0] || ""), code: row[1] || "", provenance: row[2] || "", snapshot: snap,
      progress: row[4] || "", conclusion: row[5] || "", reason: row[6] || "", evidence: row[7] || "",
      confirmer: row[8] || "", at: row[9] || "", newAssetCode: row[10] || "", note: row[11] || "" };
  }

  class SheetsStore {
    /* opts: { fetchImpl, bridgeUrl, actor, tokenProvider } — actor 為目前登入者顯示名（寫入建立人/經手人欄）；
       tokenProvider 回傳諸葛登入 session 的 access_token，每次呼叫即時取（可隨登入狀態改變）。 */
    constructor(opts) {
      if (!opts || !opts.bridgeUrl) throw new Error("SheetsStore 需要 bridgeUrl（zg-ledger-bridge 位址）");
      this.fetch = opts.fetchImpl || global.fetch.bind(global);
      this._token = typeof opts.tokenProvider === "function" ? opts.tokenProvider : null;
      this._refresher = typeof opts.tokenRefresher === "function" ? opts.tokenRefresher : null;
      this.bridgeUrl = opts.bridgeUrl;
      this.actor = opts.actor || "";
      this.db = null;
      this._seq = 0;
    }
    _authHeaders(base) {
      const h = Object.assign({}, base || {});
      const t = this._token ? this._token() : null;
      if (t) h.Authorization = "Bearer " + t;
      return h;
    }
    /* 只在「驗證被拒」(401) 且換發到新 token 時，帶新 token 原樣重試一次。
     * 網路錯誤、5xx、其他 4xx 一律不重試——寫入尤其不可模糊重送（冪等性不明）。
     * 換發由 tokenRefresher 負責單機單次（並行讀取共用同一 Promise，refresh token 會輪替）。 */
    /* 單機單次：並行的多路 401 共用同一次換發（refresh token 會輪替，不可同時多送） */
    async _refreshOnce() {
      if (!this._refreshPromise) {
        this._refreshPromise = Promise.resolve()
          .then(() => this._refresher())
          .finally(() => { this._refreshPromise = null; });
      }
      return this._refreshPromise;
    }
    async _fetchAuth(url, init) {
      let res = await this.fetch(url, init);
      if (res && res.status === 401 && this._refresher) {
        const fresh = await this._refreshOnce();
        if (fresh) {
          res = await this.fetch(url, Object.assign({}, init, { headers: this._authHeaders(init && init.headers) }));
        }
      }
      return res;
    }
    _url(action, tab) {
      return this.bridgeUrl + "?action=" + action + "&tab=" + encodeURIComponent(TABS[tab] || tab);
    }
    async _read(tab) {
      const res = await this._fetchAuth(this._url("read", tab), { method: "GET", headers: this._authHeaders() });
      if (res && res.status === 401) {
        // 已走過換發仍被拒（或無 token 可換）：這是登入問題，不是資料庫問題，要給可行動的錯誤。
        const err = new Error("登入驗證被拒（" + TABS[tab] + "）");
        err.authRefused = true;
        throw err;
      }
      if (!res || !res.ok) throw new Error("現存資料庫讀取失敗（" + TABS[tab] + "）");
      const body = await res.json();
      if (!body || !Array.isArray(body.header) || !Array.isArray(body.rows)) throw new Error("bridge 回應格式不符（" + TABS[tab] + "）");
      return body.rows;
    }
    async _append(tab, row) {
      const res = await this._fetchAuth(this._url("append", tab), {
        method: "POST", headers: this._authHeaders({ "content-type": "application/json" }), body: JSON.stringify({ row })
      });
      if (!res || !res.ok) throw new Error(UNSYNCED + "（新增 " + TABS[tab] + "）");
      const body = await res.json();
      if (!body || body.ok !== true || !body.updatedRange) throw new Error(UNSYNCED + "（寫回驗證失敗 " + TABS[tab] + "）");
      const m = /!A(\d+):/.exec(body.updatedRange);
      return m ? Number(m[1]) : -1; // 讀回驗證的實際列號
    }
    async _update(tab, rowNum, row) {
      const range = TABS[tab] + "!A" + rowNum + ":" + String.fromCharCode(64 + row.length) + rowNum;
      const res = await this._fetchAuth(this._url("update", tab), {
        method: "POST", headers: this._authHeaders({ "content-type": "application/json" }), body: JSON.stringify({ range, row })
      });
      if (!res || !res.ok) throw new Error(UNSYNCED + "（更新 " + TABS[tab] + " 第 " + rowNum + " 列）");
      const body = await res.json();
      if (!body || body.ok !== true) throw new Error(UNSYNCED + "（寫回驗證失敗 " + TABS[tab] + " 第 " + rowNum + " 列）");
    }

    /* 讀回整份狀態（與 MockStore.state() 同形、同步；需先 await init()） */
    state() { return this._db(); }
    /* 開機載入鏡像（唯一 async 入口） */
    async init() {
      if (this.db) return this.db;
      const [assetRows, sessionRows, recordRows, movementRows, batchRows, siteRows, annotationRows] = await Promise.all(
        ["assets", "sessions", "records", "movements", "batches", "sites", "annotations"].map((t) => this._read(t)));
      const assets = assetRows.map(rowToAsset).filter((a) => a.code);
      const sites = [];
      this._siteQrRows = [];
      siteRows.forEach((row, i) => {
        const name = String(row[0] || ""); if (!name) return;
        let s = sites.find((x) => x.name === name);
        if (!s) { s = { name, lat: Number(row[3]) || 0, lon: Number(row[4]) || 0, zones: [], qr: row[2] || "" }; sites.push(s); }
        const zone = String(row[1] || ""); if (zone && !s.zones.includes(zone)) s.zones.push(zone);
        if (row[2]) this._siteQrRows.push({ qr: String(row[2]), site: name, zone: String(row[1] || "") });
      });
      /* 批次：行別=批次 為主列，行別=明細 掛到同批次鍵 */
      const batches = [];
      batchRows.forEach((row) => {
        const kind = String(row[0] || "");
        if (kind === "批次") {
          batches.push({ id: String(row[1] || ""), po: row[2] || "", vendor: row[3] || "", brand: row[4] || "", model: row[5] || "",
            origin: row[6] || "未確認", type: row[7] || "", mfgYear: row[8] || "", note: row[9] || "", at: row[10] || "",
            closed: row[11] === "已結案", items: [], unexpected: [] });
        } else if (kind === "明細") {
          const b = batches.find((x) => x.id === String(row[1] || ""));
          if (b) b.items.push({ serial: String(row[12] || ""), state: row[11] || "pending", receivedAt: row[13] || "", code: row[14] || "" });
        }
      });
      const sessionList = sessionRows.map(rowToSession).filter((s) => s.id);
      this.db = {
        __v: 2,
        assets, sites,
        projects: [...new Set(assets.map((a) => a.project).concat(sessionList.map((s) => s.project)).filter(Boolean))],
        sessions: sessionList,
        records: recordRows.map(rowToRecord).filter((r) => r.code),
        movements: movementRows.map(rowToMovement).filter((m) => m.code),
        batches,
        annotations: annotationRows.map(rowToAnnotation).filter((a) => a.recordKey),
        meta: { codePrefix: "CSNW", codeSeq: 1 } // codePrefix 待公司正式編碼規則；codeSeq 由現有資產推導
      };
      let maxSeq = 0;
      this.db.assets.forEach((a) => {
        const m = /^CSNW10704(\d{4,})$/.exec(a.code);
        if (m) maxSeq = Math.max(maxSeq, Number(m[1]));
      });
      this.db.meta.codeSeq = maxSeq + 1;
      return this.db;
    }
    _db() { if (!this.db) throw new Error("請先 await init()"); return this.db; }

    /* ---- 鏡像寫入：即時反映＋背景寫回＋誠實標記 ---- */
    onSyncChange(cb) { (this._listeners = this._listeners || []).push(cb); }
    syncStatus() {
      const u = this._unsynced || [];
      return { pending: this._pendingCount || 0, unsynced: u.length };
    }
    _notify() { (this._listeners || []).forEach((cb) => { try { cb(this.syncStatus()); } catch (e) { /* 聽眾錯誤不影響寫入 */ } }); }
    /* entity 先進鏡像並標 __pending；writeFn 背景執行；失敗標 __unsynced 並可重試。
     * 同一 entity 的寫入依序執行（__chain），避免「新增尚未完成就更新」的競態。 */
    _mirror(entity, writeFn) {
      this._pendingCount = (this._pendingCount || 0) + 1;
      if (entity) entity.__pending = true;
      this._notify();
      const prior = entity && entity.__chain;
      const run = () => Promise.resolve(prior).catch(() => {}).then(writeFn);
      const task = run().then(() => {
        if (entity) delete entity.__pending;
      }).catch((err) => {
        if (entity) { delete entity.__pending; entity.__unsynced = true; }
        (this._unsynced = this._unsynced || []).push({ entity, error: String(err && err.message || err), redo: () => {
          return writeFn().then(() => {
            if (entity) delete entity.__unsynced;
            this._unsynced = this._unsynced.filter((x) => x.entity !== entity);
            this._notify();
          });
        } });
      }).finally(() => {
        this._pendingCount -= 1;
        this._notify();
      });
      if (entity) entity.__chain = task.catch(() => {});
      return task; // 呼叫端可 await 確認寫回完成（測試用），前台則靠 syncStatus 呈現
    }
    /* 等待所有鏡像寫回完成（測試與關閉前用）；個別失敗不中断，回傳 syncStatus */
    async flush() {
      const db = this._db();
      const grab = (e) => e && e.__chain;
      const chains = [
        ...db.assets, ...db.sessions, ...db.records, ...db.movements, ...db.batches, ...db.annotations,
        ...db.batches.flatMap((b) => b.items || [])
      ].map(grab).filter(Boolean);
      await Promise.all(chains.map((c) => c.catch(() => {})));
      return this.syncStatus();
    }
    /* 重試所有未同步寫入；回傳 {ok, failed} */
    async retryUnsynced() {
      const u = (this._unsynced || []).slice();
      let failed = 0;
      for (const item of u) {
        try { await item.redo(); } catch (e) { failed += 1; }
      }
      return { ok: failed === 0, failed };
    }

    saveAsset(code, patch) {
      const db = this._db();
      const a = db.assets.find((x) => x.code === code);
      if (!a) throw new Error("找不到設備 " + code);
      Object.assign(a, patch, { updatedAt: new Date().toISOString(), __edited: true });
      return Object.assign(a, { __write: this._mirror(a, () => this._update("assets", a.__row, assetToRow(a, this.actor))) });
    }
    addZone(site, zone) {
      const db = this._db();
      const s = db.sites.find((x) => x.name === site);
      if (!s || s.zones.includes(zone)) return false;
      s.zones.push(zone);
      this._mirror(null, () => this._append("sites", [site, zone, "", s.lat || "", s.lon || ""]));
      return true;
    }
    addSite(name, zone, lat, lon) {
      const db = this._db();
      if (db.sites.find((x) => x.name === name)) return false;
      const s = { name, lat: lat || 0, lon: lon || 0, zones: [zone], qr: "" };
      db.sites.push(s);
      this._mirror(null, () => this._append("sites", [name, zone, "", lat == null ? "" : lat, lon == null ? "" : lon]));
      return true;
    }
    startSession(site, lat, lon, acc, project, fixType) {
      const db = this._db();
      const sess = { id: "s" + Date.now() + "-" + (++this._seq), site, lat, lon, acc: acc == null ? null : acc, project: project || "",
        fixType: fixType || "", at: new Date().toISOString(), closed: false, closedAt: "" };
      db.sessions.push(sess);
      sess.__write = this._mirror(sess, async () => {
        const rowNum = await this._append("sessions", sessionToRow(sess, this.actor));
        sess.__row = rowNum;
      });
      return sess;
    }
    /* 同場次同編號：次數 +1（更新原列），不重複列（比照 MockStore 語意） */
    addRecord(sess, rec) {
      const db = this._db();
      const prev = db.records.find((r) => r.sessionId === sess.id && r.code === rec.code);
      if (prev) {
        prev.n += 1;
        prev.__write = this._mirror(prev, () => this._update("records", prev.__row, recordToRow(prev, sess)));
        return prev;
      }
      const r = Object.assign({ sessionId: sess.id, n: 1, decision: "", at: new Date().toISOString() }, rec);
      db.records.push(r);
      r.__write = this._mirror(r, async () => {
        const rowNum = await this._append("records", recordToRow(r, sess));
        r.__row = rowNum;
      });
      return r;
    }
    decide(sessionId, code, decision) {
      const db = this._db();
      const r = db.records.find((x) => x.sessionId === sessionId && x.code === code);
      if (!r) return;
      const sess = db.sessions.find((s) => s.id === sessionId);
      r.decision = decision;
      r.__write = this._mirror(r, () => this._update("records", r.__row, recordToRow(r, sess)));
    }
    closeSession(sess) {
      const db = this._db();
      const cur = db.sessions.find((x) => x.id === (sess && sess.id));
      if (!cur) throw new Error("找不到盤點場次");
      cur.closed = true; cur.closedAt = new Date().toISOString();
      cur.__write = this._mirror(cur, () => this._update("sessions", cur.__row, sessionToRow(cur, this.actor)));
    }
    /* ---- 進貨批次 ---- */
    listBatches() { return this._db().batches; }
    batch(id) { return this._db().batches.find((b) => b.id === id); }
    addBatch(info) {
      const db = this._db();
      const serials = (info.serials || []).map((s) => String(s).trim()).filter(Boolean);
      const seen = new Set(); const items = [];
      serials.forEach((s) => { if (!seen.has(s)) { seen.add(s); items.push({ serial: s, state: "pending", receivedAt: "", code: "" }); } });
      const b = { id: "b" + Date.now() + "-" + (++this._seq), po: info.po || "", vendor: info.vendor || "", brand: info.brand || "", model: info.model || "",
        origin: info.origin || "未確認", mfgYear: info.mfgYear || "", type: info.type || "", note: info.note || "",
        at: new Date().toISOString(), items, unexpected: [], closed: false };
      db.batches.push(b);
      b.__write = this._mirror(b, async () => {
        await this._append("batches", ["批次", b.id, b.po, b.vendor, b.brand, b.model, b.origin, b.type, b.mfgYear, b.note, b.at, "進行中", "", "", ""]);
        for (const it of items) {
          await this._append("batches", ["明細", b.id, "", "", "", "", "", "", "", "", "", "pending", it.serial, "", ""]);
        }
      });
      return b;
    }
    receiveSerial(id, serial) {
      const db = this._db();
      const b = this.batch(id); if (!b) return { result: "nobatch" };
      const s = String(serial || "").trim(); if (!s) return { result: "empty" };
      const it = b.items.find((x) => x.serial === s);
      if (it && it.state === "pending") {
        const ex = db.assets.find((a) => a.serial === s);
        if (ex) return { result: "exists", asset: ex };
        it.state = "received"; it.receivedAt = new Date().toISOString();
        this._mirror(it, () => this._append("batches", ["明細", b.id, "", "", "", "", "", "", "", "", "", "received", s, it.receivedAt, ""]));
        return { result: "ok", item: it };
      }
      if (it) return { result: "dup", item: it };
      if (db.assets.some((a) => a.serial === s)) return { result: "exists", asset: db.assets.find((a) => a.serial === s) };
      const u = b.unexpected.find((x) => x.serial === s);
      if (u) { u.n += 1; return { result: "dup" }; }
      b.unexpected.push({ serial: s, at: new Date().toISOString(), n: 1 });
      return { result: "unexpected" };
    }
    /* 確認入庫：逐台建資產＋入庫事件；同序號防撞標 conflict 保留人工處理（背景寫回，失敗標未同步） */
    confirmInbound(id, dest) {
      const db = this._db();
      const b = this.batch(id); if (!b) return [];
      const made = [];
      for (const x of b.items.filter((it) => it.state === "received")) {
        if (db.assets.some((a) => a.serial && a.serial === x.serial)) { x.state = "conflict"; continue; }
        const code = (db.meta.codePrefix || "CSNW") + String(107040000 + db.meta.codeSeq++).padStart(9, "0");
        const now = new Date().toISOString();
        const a = { code, name: b.model || b.brand || "未命名設備", model: b.model || "", brand: b.brand || "", origin: b.origin || "未確認",
          owner: dest.owner || "公用", site: dest.site, zone: dest.zone, status: "備用", project: dest.project || "", // 入庫＝可調度備用；部署使用後才轉使用中
          serial: x.serial, purchase: b.at.slice(0, 10), activate: "", warranty: "", mfgYear: b.mfgYear || "", type: b.type || "", po: b.po || "",
          source: "入庫", createdAt: now, createdBy: this.actor, updatedAt: now };
        db.assets.push(a);
        x.state = "inbound"; x.code = code;
        a.__write = this._mirror(a, async () => {
          const rowNum = await this._append("assets", assetToRow(a, this.actor));
          a.__row = rowNum;
          await this._append("batches", ["明細", b.id, "", "", "", "", "", "", "", "", "", "inbound", x.serial, x.receivedAt, code]);
        });
        const mv = this.addMovement(code, "inbound", "進貨入庫（" + (b.vendor || "未填廠商") + "）→ " + dest.site + " " + dest.zone, { to: dest.site + " " + dest.zone });
        made.push(a); made.__lastMovement = mv;
      }
      if (b.items.length && b.items.every((x) => x.state === "inbound")) b.closed = true;
      return made;
    }
    addMovement(code, type, note, extra) {
      const db = this._db();
      const m = Object.assign({ id: "m" + Date.now() + "-" + (++this._seq), code, type, at: new Date().toISOString(), note: note || "" }, extra || {});
      db.movements.push(m);
      m.__write = this._mirror(m, async () => {
        const rowNum = await this._append("movements", movementToRow(m, this.actor));
        m.__row = rowNum;
      });
      return m;
    }
    /* 現場觀察（使用者 12:07 商業規則）：現場在用的設備按「使用中」記，不逐台再問；
     * 已有 待修/維修中/已報廢 的，不因再掃到自動改回可用——回 exception 給管理端提示。
     * 備用（入庫新建）不因掃描被猜成使用中；位置以最新現場觀察更新。 */
    observeAsset(sess, code, zone) {
      const db = this._db();
      const BLOCK = ["待修", "維修中", "已報廢"];
      const existing = db.assets.find((a) => a.code === code);
      if (existing) {
        if (BLOCK.includes(existing.status)) {
          return { exception: true, reason: "既有狀態「" + existing.status + "」，不因掃描自動改回可用", asset: existing };
        }
        if (existing.site !== sess.site || (zone && existing.zone !== zone)) {
          this.saveAsset(existing.code, { site: sess.site, zone: zone || existing.zone });
          return { exception: false, moved: true, asset: existing };
        }
        return { exception: false, moved: false, asset: existing };
      }
      const now = new Date().toISOString();
      const a = { code, name: "", model: "", serial: "", owner: "公用", site: sess.site, zone: zone || "",
        status: "使用中", project: sess.project || "", brand: "", origin: "未確認", type: "", mfgYear: "", po: "",
        purchase: "", activate: "", warranty: "", source: "盤點", createdAt: now, createdBy: this.actor, updatedAt: now };
      db.assets.push(a);
      a.__write = this._mirror(a, async () => {
        const rowNum = await this._append("assets", assetToRow(a, this.actor));
        a.__row = rowNum;
      });
      return { exception: false, created: true, asset: a };
    }
    /* 釐清標示：寫入前由呼叫端過 validateAnnotation；快照由呼叫端以 snapshotOf(舊帳列) 提供 */
    addAnnotation(ann) {
      const db = this._db();
      const full = Object.assign({ at: new Date().toISOString(), confirmer: this.actor }, ann);
      db.annotations.push(full);
      full.__write = this._mirror(full, async () => {
        const rowNum = await this._append("annotations", annotationToRow(full));
        full.__row = rowNum;
      });
      return full;
    }
    annotationsOf(recordKey) { return this._db().annotations.filter((a) => a.recordKey === recordKey); }
    /* 地點 QR：掃到位置表登錄的 QR 內容 → 回傳 {site, zone}；未登錄回傳 null（不自動猜） */
    findSiteByQr(qrContent) {
      const q = String(qrContent || "").trim();
      if (!q) return null;
      const rows = this._siteQrRows || [];
      const hit = rows.find((r) => r.qr && r.qr === q);
      return hit ? { site: hit.site, zone: hit.zone } : null;
    }
    movementsOf(code) { return this._db().movements.filter((m) => m.code === code); }
    sessionRecords(sess) { return this._db().records.filter((r) => r.sessionId === sess.id); }
  }

  global.ZgErpSheets = Object.freeze({ SheetsStore, TABS, HEADERS, MOVEMENT_TYPE, NOT_CONNECTED, UNSYNCED });
  if (typeof module !== "undefined" && module.exports) module.exports = { SheetsStore, TABS, HEADERS, MOVEMENT_TYPE, NOT_CONNECTED, UNSYNCED, annotationToRow, rowToAnnotation };
})(typeof window !== "undefined" ? window : globalThis);
