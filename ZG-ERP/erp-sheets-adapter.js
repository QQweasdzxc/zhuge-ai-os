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
    assets: ["資產編號", "名稱", "型號", "序號", "據點", "區域", "保管人", "專案", "狀態", "品牌", "產地", "類型", "製造年份", "PO編號", "採購日期", "啟用日期", "保固到期", "來源", "建立時間", "建立人", "最後異動時間", "使用部門", "舊帳記錄鍵", "舊帳出處", "舊帳快照", "資料補入時間"],
    sessions: ["場次鍵", "據點", "區域", "定位方式", "緯度", "經度", "定位精度", "專案範圍", "經手人", "開始時間", "狀態", "結束時間", "使用部門"],
    records: ["場次鍵", "資產編號", "判定", "現場據點", "現場區域", "時間", "次數", "處置", "使用部門", "本次專案", "經手人"],
    movements: ["事件鍵", "日期", "事件類型", "資產編號", "來自地點", "至地點", "數量", "經手人", "備註", "出處"],
    batches: ["行別", "批次鍵", "PO", "廠商", "品牌", "型號", "產地", "類型", "製造年份", "備註", "建立時間", "狀態", "序號", "到貨時間", "登記編號"],
    sites: ["據點", "區域", "QR內容", "緯度", "經度"],
    annotations: ["記錄鍵", "資產編號", "出處", "快照", "進度", "結論", "原因", "證據", "確認人", "時間", "新帳資產編號", "備註"]
  };

  function operationId(){const r=crypto.randomUUID().replace(/-/g,''),time=Date.now().toString(16).padStart(12,'0');return time.slice(0,8)+'-'+time.slice(8)+'-7'+r.slice(13,16)+'-'+r.slice(16,20)+'-'+r.slice(20);}
  const MOVEMENT_TYPE = { "inbound": "入庫", "outbound-transfer": "調撥", "outbound-sale": "出庫", "outbound-use": "出庫", "repair-send": "送修", "repair-start": "維修中", "repair-end": "修畢回庫" };

  function assetToRow(a, actor) {
    return [a.code, a.name || "", a.model || "", a.serial || "", a.site || "", a.zone || "", a.owner || "", a.project || "",
      a.status || "未確認", a.brand || "", a.origin || "未確認", a.type || "", a.mfgYear || "", a.po || "",
      a.purchase || "", a.activate || "", a.warranty || "", a.source || "補登", a.createdAt || "", a.__row ? (a.createdBy || "") : (a.createdBy || actor || ""), a.updatedAt || "", a.department || "", a.legacyKey || "", a.legacyProvenance || "", a.legacySnapshot || "", a.legacyImportedAt || ""];
  }
  function rowToAsset(row, i) {
    return { __row: i + 2, code: String(row[0] || "").trim(), name: row[1] || "", model: row[2] || "", serial: row[3] || "",
      site: row[4] || "", zone: row[5] || "", owner: row[6] || "", project: row[7] || "", status: row[8] || "未確認",
      brand: row[9] || "", origin: row[10] || "未確認", type: row[11] || "", mfgYear: row[12] || "", po: row[13] || "",
      purchase: row[14] || "", activate: row[15] || "", warranty: row[16] || "", source: row[17] || "",
      createdAt: row[18] || "", createdBy: row[19] || "", updatedAt: row[20] || "", department: row[21] || "", legacyKey: row[22] || "", legacyProvenance: row[23] || "", legacySnapshot: row[24] || "", legacyImportedAt: row[25] || "" };
  }
  function sessionToRow(s, actor) {
    return [s.id, s.site || "", s.zone || "", s.fixType || "", s.lat == null ? "" : s.lat, s.lon == null ? "" : s.lon,
      s.acc == null ? "" : s.acc, s.project || "", s.__row ? (s.operator || "") : (actor || ""), s.at, s.closed ? "已結束" : "進行中", s.closedAt || "", s.department || ""];
  }
  function rowToSession(row, i) {
    return { __row: i + 2, id: String(row[0] || ""), site: row[1] || "", zone: row[2] || "", fixType: row[3] || "",
      lat: row[4] === "" ? null : Number(row[4]), lon: row[5] === "" ? null : Number(row[5]),
      acc: row[6] === "" ? null : Number(row[6]), project: row[7] || "", operator: row[8] || "",
      at: row[9] || "", closed: row[10] === "已結束", closedAt: row[11] || "", department: row[12] || "" };
  }
  function recordToRow(r, sess) {
    return [r.sessionId, r.code, r.status || "", (sess && sess.site) || r.site || "", r.zone || "", r.at, r.n || 1, r.decision || "", r.department || "", r.sessProject || "", r.operator || ""];
  }
  function rowToRecord(row, i) {
    return { __row: i + 2, sessionId: String(row[0] || ""), code: String(row[1] || "").trim(), status: row[2] || "",
      site: row[3] || "", zone: row[4] || "", at: row[5] || "", n: Number(row[6]) || 1, decision: row[7] || "", department: row[8] || "", sessProject: row[9] || "", operator: row[10] || "" };
  }
  function movementToRow(m, actor) {
    return [m.id || "", m.at, MOVEMENT_TYPE[m.type] || m.type, m.code, m.from || "", m.to || "", m.qty == null ? 1 : m.qty, actor || "", m.note || "", m.source || "ERP 前台"];
  }
  function rowToMovement(row, i) {
    const rev = Object.keys(MOVEMENT_TYPE).find((k) => MOVEMENT_TYPE[k] === row[2]);
    return { __row: i + 2, id: String(row[0] || ""), at: row[1] || "", type: row[2]==="維修"?"repair-legacy":rev || String(row[2] || ""), code: String(row[3] || "").trim(),
      from: row[4] || "", to: row[5] || "", qty: Number(row[6]) || 1, operator: row[7] || "", note: row[8] || "", source: row[9] || "" };
  }

  function annotationToRow(a) {
    return [a.recordKey, a.code || "", a.provenance || "", JSON.stringify(a.snapshot || {}), a.progress || "",
      a.conclusion || "", a.reason || "", a.evidence || "", a.confirmer || "", a.at || "", a.newAssetCode || "", a.note || ""];
  }
  /* 舊帳（59 整合工作簿，唯讀比對）：依「欄名」對應，不倚賴欄位順序；
   * 記錄鍵逐字採用（永不以列位置推導）；出處＝來源工作表＋來源列；髒值欄不作篩選維度 */
  function rowToNote(row) {
    return { key: String((row && row[0]) || ""), at: String((row && row[1]) || ""), recordKey: String((row && row[2]) || ""), source: String((row && row[3]) || ""), code: String((row && row[4]) || ""), condition: String((row && row[5]) || ""), disposition: String((row && row[6]) || ""), note: String((row && row[7]) || ""), actor: String((row && row[8]) || ""), status: String((row && row[9]) || "") };
  }
  function rowToLegacy(header, row, i) {
    const ix = {};
    (header || []).forEach((h, n) => { const k = String(h == null ? "" : h).trim(); if (k && ix[k] == null) ix[k] = n; });
    const g = (...names) => {
      for (const nm of names) { const n = ix[nm]; if (n != null) return String(row[n] == null ? "" : row[n]).trim(); }
      return "";
    };
    const src = g("來源工作表"), srcRow = g("來源列");
    /* 來源工作表原始值（不 trim）：「10F機房 」等頁名尾空白是實際頁名，trim 會對不上白名單 */
    const srcTabRaw = (() => { const n = ix["來源工作表"]; return n != null ? String(row[n] == null ? "" : row[n]) : ""; })();
    return {
      __row: i + 2,
      recordKey: g("記錄鍵"),
      code: g("資產編號"),
      purchase: g("採購日期"),
      name: g("名稱"), model: g("型號規格", "型號"),
      siteLead: src,
      sourceTab: srcTabRaw,
      srcRow,
      zone: g("區域", "地點位置", "位置"),
      place: g("地點位置"),
      owner: g("保管人", "使用人"),
      serial: g("S-N", "S/N", "序號"),
      project: g("專案"),
      scopeStatus: g("對應狀態"),
      provenance: src + (srcRow ? " 第" + srcRow + "列" : ""),
      /* 通用全欄帶入：保留完整表頭與原始列（僅記憶體；不進 snapshot 以外的寫入） */
      header: (header || []).map((h) => String(h == null ? "" : h).trim()),
      raw: (row || []).map((c) => String(c == null ? "" : c))
    };
  }

  /* 舊帳整合-流轉對應（唯讀）：記錄間關係線索（同編號快照、可能移轉等）；非移動證明 */
  function rowToFlow(header, row, i) {
    const ix = {};
    (header || []).forEach((h, n) => { const k = String(h == null ? "" : h).trim(); if (k && ix[k] == null) ix[k] = n; });
    const g = (...names) => {
      for (const nm of names) { const n = ix[nm]; if (n != null) return String(row[n] == null ? "" : row[n]).trim(); }
      return "";
    };
    return { __row: i + 2, relationKey: g("關係鍵"), type: g("類型"), code: g("資產編號"),
      rkeyA: g("記錄鍵A"), rkeyB: g("記錄鍵B"), originA: g("出處A"), originB: g("出處B"),
      status: g("狀態"), note: g("說明") };
  }
  /* 舊帳整合-待確認（唯讀）：舊帳人工整理的待確認事項 */
  function rowToQuestion(header, row, i) {
    const ix = {};
    (header || []).forEach((h, n) => { const k = String(h == null ? "" : h).trim(); if (k && ix[k] == null) ix[k] = n; });
    const g = (...names) => {
      for (const nm of names) { const n = ix[nm]; if (n != null) return String(row[n] == null ? "" : row[n]).trim(); }
      return "";
    };
    return { __row: i + 2, itemKey: g("項目鍵"), category: g("類別"), summary: g("內容摘要"),
      related: g("相關記錄鍵/出處"), suggestion: g("建議處理"), status: g("狀態") };
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
      if(init?.method==='POST'){
        const payload=JSON.parse(init.body||'{}');
        payload.operationId=payload.operationId||operationId();
        payload.reservationToken=payload.reservationToken||crypto.randomUUID();
        init={...init,body:JSON.stringify(payload)};
      }
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
    async _read(tab) { return (await this._readFull(tab)).rows; }
    /* 讀取完整回應（含 header）：舊帳依欄名對應，必須拿到實際標頭 */
    async _readFull(tab) {
      const res = await this._fetchAuth(this._url("read", tab), { method: "GET", headers: this._authHeaders() });
      const label = TABS[tab] || tab;
      if (res && res.status === 401) {
        // 已走過換發仍被拒（或無 token 可換）：這是登入問題，不是資料庫問題，要給可行動的錯誤。
        const err = new Error("登入驗證被拒（" + label + "）");
        err.authRefused = true;
        throw err;
      }
      if (!res || !res.ok) throw new Error("現存資料庫讀取失敗（" + label + "）");
      const body = await res.json();
      if (!body || !Array.isArray(body.header) || !Array.isArray(body.rows)) throw new Error("bridge 回應格式不符（" + label + "）");
      if (body.actor) this.actor = String(body.actor);
      return { header: body.header, rows: body.rows };
    }
    async _append(tab, row) {
      const res = await this._fetchAuth(this._url("append", tab), {
        method: "POST", headers: this._authHeaders({ "content-type": "application/json" }), body: JSON.stringify({ row })
      });
      if (!res || !res.ok) throw new Error(UNSYNCED + "（新增 " + TABS[tab] + "）");
      const body = await res.json();
      if (!body || body.ok !== true || !body.updatedRange) throw new Error(UNSYNCED + "（寫回驗證失敗 " + TABS[tab] + "）");
      const m = /!A(\d+):/.exec(body.updatedRange);
      if(m){this._originalRows=this._originalRows||{};this._originalRows[tab]=this._originalRows[tab]||[];const actual=[...row],actorCol={assets:19,sessions:8,records:10,movements:7,annotations:8}[tab];if(actorCol!==undefined)actual[actorCol]=body.actor||actual[actorCol]||'';this._originalRows[tab][Number(m[1])-2]=actual;}
      return m ? Number(m[1]) : -1; // 讀回驗證的實際列號
    }
    async _update(tab, rowNum, row) {
      const range = TABS[tab] + "!A" + rowNum + ":" + String.fromCharCode(64 + row.length) + rowNum;
      const prior=this._originalRows?.[tab]?.[rowNum-2];
      if(!prior)throw Error('原始資料不存在，未寫入');
      const res = await this._fetchAuth(this._url("update", tab), {
        method: "POST", headers: this._authHeaders({ "content-type": "application/json" }), body: JSON.stringify({ range, row,expected:prior })
      });
      if (!res || !res.ok) throw new Error(UNSYNCED + "（更新 " + TABS[tab] + " 第 " + rowNum + " 列）");
      const body = await res.json();
      if (!body || body.ok !== true) throw new Error(UNSYNCED + "（寫回驗證失敗 " + TABS[tab] + " 第 " + rowNum + " 列）");
      this._originalRows[tab][rowNum-2]=[...row];
    }

    /* 讀回整份狀態（與 MockStore.state() 同形、同步；需先 await init()） */
    state() { return this._db(); }
    /* 開機載入鏡像（唯一 async 入口） */
    async init() {
      if (this.db) return this.db;
      const [assetRows, sessionRows, recordRows, movementRows, batchRows, siteRows, annotationRows] = await Promise.all(
        ["assets", "sessions", "records", "movements", "batches", "sites", "annotations"].map(async (t) => { const body = await this._readFull(t); this._headers = this._headers || {}; this._headers[t] = body.header; return body.rows; }));
      this._originalRows=Object.fromEntries(['assets','sessions','records','movements','batches','sites','annotations'].map((k,i)=>[k,JSON.parse(JSON.stringify([assetRows,sessionRows,recordRows,movementRows,batchRows,siteRows,annotationRows][i]))]));
      this.departmentReady = ["assets", "sessions", "records"].every((t) => HEADERS[t].every((h, i) => this._headers[t][i] === h));
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
      this._legacyRows = [];
      this._legacyError = "";
      this._legacyFlows = [];
      this._legacyQuestions = [];
      this._legacyAuxError = "";
      this._legacyNotes = [];
      this._legacyNotesError = "";
      try {
        const lm = await this._readFull("\u6574\u5408-\u4e3b\u6a94");
        this._legacyRows = lm.rows.map((row, i) => rowToLegacy(lm.header, row, i)).filter((r) => r.recordKey);
      } catch (e) {
        this._legacyError = String((e && e.message) || e); // 舊帳讀取失敗不拖垮新帳；UI 據實顯示
      }
      /* 舊帳關係與待確認事項：各自失敗隔離，缺了只少線索區塊 */
      try {
        const lf = await this._readFull("\u6574\u5408-\u6d41\u8f49\u5c0d\u61c9");
        this._legacyFlows = lf.rows.map((row, i) => rowToFlow(lf.header, row, i)).filter((f) => f.relationKey || f.code || f.rkeyA || f.rkeyB);
      } catch (e) {
        this._legacyAuxError = String((e && e.message) || e);
      }
      try {
        const lq = await this._readFull("\u6574\u5408-\u5f85\u78ba\u8a8d");
        this._legacyQuestions = lq.rows.map((row, i) => rowToQuestion(lq.header, row, i)).filter((q) => q.itemKey || q.summary);
      } catch (e) {
        this._legacyAuxError = this._legacyAuxError || String((e && e.message) || e);
      }
      /* \u73fe\u5834\u8a3b\u8a18\uff1a\u820a\u5e33 append-only \u5206\u9801\uff1b\u5c1a\u672a\u5efa\u7acb\u6216\u8b80\u53d6\u5931\u6557\u6642\u9694\u96e2\u6210\u7a7a\u6e05\u55ae\uff0c\u4e0d\u62d6\u57ae\u5176\u4ed6\u5340\u584a */
      try {
        await this._reloadLegacyNotes();
      } catch (e) {
        this._legacyNotes = [];
        this._legacyNotesError = String((e && e.message) || e);
      }
      let maxSeq = 0;
      this.db.assets.forEach((a) => {
        const m = /^CSNW10704(\d{4,})$/.exec(a.code);
        if (m) maxSeq = Math.max(maxSeq, Number(m[1]));
      });
      this.db.meta.codeSeq = maxSeq + 1;
      this.lastSharedReadAt=new Date().toISOString();
      return this.db;
    }
    _db() { if (!this.db) throw new Error("請先 await init()"); return this.db; }

    /* ---- 鏡像寫入：即時反映＋背景寫回＋誠實標記 ---- */
    onSyncChange(cb) { (this._listeners = this._listeners || []).push(cb); }
    syncStatus() {
      const u = this._unsynced || [];
      return { pending: this._pendingCount || 0, unsynced: u.length, lastSync: this.lastSharedReadAt || null };
    }
    _notify() { (this._listeners || []).forEach((cb) => { try { cb(this.syncStatus()); } catch (e) { /* 聽眾錯誤不影響寫入 */ } }); }
    /* Explicit shared read refresh. Never replace pending/failed local work or a snapshot
       if a local write started while the read was in flight. No polling timer. */
    async refreshShared(canApply) {
      const safe=()=>!(this._seatAttempts?.size)&&!(this._intakeAttempts?.size)&&!(this._scanIntents?.size)&&!(this._repairAttempts?.size)&&!(this._pendingCount||0)&&!(this._unsynced||[]).length&&(!canApply||canApply());
      if(!safe())throw new Error("請先完成或取消編輯，並處理未同步資料，再更新共同盤點結果");
      const generation=this._writeGeneration||0;
      const fresh=new SheetsStore({fetchImpl:this.fetch,bridgeUrl:this.bridgeUrl,actor:this.actor,tokenProvider:this._token,tokenRefresher:this._refresher});
      await fresh.init();await fresh.loadSeatMap();if(!fresh.seatReady)throw Error('共同座位資料未能讀取，保留目前畫面');
      if(!safe()||generation!==(this._writeGeneration||0))throw new Error("更新期間有本機操作，保留目前輸入；請稍後再更新");
      this.db=fresh.db;this.seatRows=fresh.seatRows;this.seatReady=fresh.seatReady;this.seatError=fresh.seatError;
      for(const k of ['_originalRows','_headers','departmentReady','_siteQrRows','_legacyRows','_legacyError','_legacyFlows','_legacyQuestions','_legacyAuxError','_legacyNotes','_legacyNotesError'])this[k]=fresh[k];
      this.lastSharedReadAt=new Date().toISOString();
      return this.db;
    }
    /* entity 先進鏡像並標 __pending；writeFn 背景執行；失敗標 __unsynced 並可重試。
     * 同一 entity 的寫入依序執行（__chain），避免「新增尚未完成就更新」的競態。 */
    _mirror(entity, writeFn,options) {
      this._writeGeneration=(this._writeGeneration||0)+1;
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
          return Promise.reject(new Error("寫入結果未確定，不可重送；保留畫面並核對"));
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

    async editControl(action,code){
      this._editReservations=this._editReservations||new Map();
      let held=this._editReservations.get(code);
      if(action==='reserve'){if(held)throw new Error('請先完成或取消原本的編輯');held={token:crypto.randomUUID(),expiresAt:0,lastRenewAt:0};}
      if(!held)throw new Error('編輯權限已失效，輸入已保留；請重新讀取後核對');
      const res=await this._fetchAuth(this._url(action,'assets'),{method:'POST',headers:this._authHeaders({'content-type':'application/json'}),body:JSON.stringify({code,reservationToken:held.token,operationId:operationId()})});
      const body=await res.json();
      if(!res.ok||body.ok!==true)throw new Error(body.error?.message||'正由其他人編輯，尚未保存，請稍後重試');
      if(action==='release'){this._editReservations.delete(code);return;}
      held.expiresAt=Date.now()+300000;held.lastRenewAt=Date.now();this._editReservations.set(code,held);
      return held;
    }
    async reserveAssetEdit(code){return this.editControl('reserve',code);}
    async readAssetForEdit(code){const data=await this._readFull('assets'),hits=data.rows.map((r,i)=>({r,i})).filter(x=>x.r[0]===code);if(hits.length!==1)throw new Error('設備編號不唯一，沒有取得可編輯資料');const fresh=rowToAsset(hits[0].r,hits[0].i);Object.assign(this._db().assets.find(a=>a.code===code),fresh);return fresh;}
    async releaseAssetEdit(code){if(this._editReservations?.has(code))return this.editControl('release',code);}
    async noteEditActivity(code){const h=this._editReservations?.get(code);if(!h||h.expiresAt<=Date.now())throw new Error('編輯權限已到期，輸入保留；請重新讀取後核對');if(Date.now()-h.lastRenewAt>=60000){if(!h.renewing)h.renewing=this.editControl('renew',code).finally(()=>{h.renewing=null});return h.renewing;}}
    async saveAssetVerified(code, draft, base, opId) {
      const a = this._db().assets.find(x => x.code === code);
      if (!a) throw new Error("找不到設備 " + code);
      const held=this._editReservations?.get(code);if(held?.attempted)throw new Error('上次儲存結果未確定，不可重送；輸入保留請先核對');if(!held||held.expiresAt<=Date.now())throw new Error('編輯權限已到期，輸入保留；請重新讀取後核對');
      const patch = {}, expected = {};
      const normalized = { ...draft }; if (["未指定（待確認）", "未指定(待確認)", "未指定"].includes(normalized.project)) normalized.project = "";
      for (const k of Object.keys(normalized)) if (String(normalized[k] ?? "") !== String(base[k] ?? "")) { patch[k] = String(normalized[k] ?? ""); expected[k] = String(base[k] ?? ""); }
      held.attempted=true;
      const res = await this._fetchAuth(this._url("asset-edit", "assets"), { method: "POST", headers: this._authHeaders({ "content-type": "application/json" }), body: JSON.stringify({ code, patch, expected,reservationToken:held.token,operationId:opId||operationId() }) });
      const b = res ? await res.json() : null;
      if (!res || !res.ok || !b?.ok || !Array.isArray(b.row) || !Number.isInteger(b.rowNum) || b.row[0] !== code) throw new Error(b?.error?.message || "儲存未確認，請保留輸入後重試");
      Object.assign(a, rowToAsset(b.row, b.rowNum - 2));this._originalRows=this._originalRows||{};this._originalRows.assets=this._originalRows.assets||[];this._originalRows.assets[b.rowNum-2]=[...b.row];this._editReservations.delete(code);
      return a;
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
    startSession(site, lat, lon, acc, project, fixType, department) {
      const db = this._db();
      if (department && !this.departmentReady) throw new Error("使用部門欄位尚未就緒，請重新整理或聯絡管理端");
      const sess = { id: "s" + Date.now() + "-" + (++this._seq), site, lat, lon, acc: acc == null ? null : acc, project: project || "",
        operator: this.actor || "", department: String(department || "").trim(), fixType: fixType || "", at: new Date().toISOString(), closed: false, closedAt: "" };
      db.sessions.push(sess);
      sess.__write = this._mirror(sess, async () => {
        const rowNum = await this._append("sessions", sessionToRow(sess, this.actor));
        sess.__row = rowNum;
      });
      return sess;
    }
    async scanIntentVerified(intent){
      this._scanIntents=this._scanIntents||new Map();const key=intent.sessionId+':'+intent.code;
      if(this._scanIntents.has(key))throw new Error('此筆掃描結果待查，輸入已保留，不可重送');
      const operation=operationId();this._scanIntents.set(key,{...intent,operation});
      this._writeGeneration=(this._writeGeneration||0)+1;this._pendingCount=(this._pendingCount||0)+1;
      try{
        const res=await this._fetchAuth(this._url('scan-intent','assets'),{method:'POST',headers:this._authHeaders({'content-type':'application/json'}),body:JSON.stringify({...intent,operationId:operation})});
        const body=await res.json();
        if(!res.ok||body.ok!==true){const error=new Error(body.error?.message||'掃描尚未保存，保留輸入');error.safeToRetry=body.error?.code==='RECORD_BUSY';if(error.safeToRetry)this._scanIntents.delete(key);throw error;}
        if(!Array.isArray(body.asset)||!Array.isArray(body.record)||body.asset[0]!==intent.code||body.record[0]!==intent.sessionId||body.record[1]!==intent.code||!Number.isInteger(body.assetRow)||!Number.isInteger(body.recordRow))throw Error('掃描保存結果待查，保留輸入且不可重送');
        const db=this._db(),asset=rowToAsset(body.asset,body.assetRow-2),record=rowToRecord(body.record,body.recordRow-2),oldAsset=db.assets.find(x=>x.code===intent.code),oldRecord=db.records.find(x=>x.sessionId===intent.sessionId&&x.code===intent.code);
        if(oldAsset)Object.assign(oldAsset,asset);else db.assets.push(asset);this._originalRows=this._originalRows||{};for(const [tab,row,num]of [['assets',body.asset,body.assetRow],['records',body.record,body.recordRow]]){this._originalRows[tab]=this._originalRows[tab]||[];this._originalRows[tab][num-2]=[...row];}
        if(body.exception)record.stateException=body.exception;if(body.metadataIssue)record.metadataIssue=body.metadataIssue;if(body.assignedProject)record.projectAssigned=body.assignedProject;if(body.departmentMismatch)record.departmentMismatch=true;if(body.bindingConflict)record.bindingConflict=body.bindingConflict;
        const rawProject=String(record.sessProject||'').trim();
        const sessionProject=['','全部','全部專案','未指定','未指定（待確認）','未指定(待確認)'].includes(rawProject)?'':rawProject;
        const assetProject=String(asset.project||'').trim();
        record.projMismatch=!!(sessionProject&&assetProject&&!['未指定','未指定（待確認）','未指定(待確認)'].includes(assetProject)&&assetProject!==sessionProject);
        if(oldRecord)Object.assign(oldRecord,record);else db.records.push(record);
        if(body.binding&&!this.seatRows.some(r=>r[0]===body.binding[0]))this.seatRows.push(body.binding);
        this._scanIntents.delete(key);return oldRecord||record;
      }finally{this._pendingCount-=1;}
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
      const r = Object.assign({ sessionId: sess.id, department: sess.department || "", sessProject: sess.project || "", operator: this.actor || "", n: 1, decision: "", at: new Date().toISOString() }, rec);
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
    async importIntakeVerified(id, groups) {
      this._intakeAttempts=this._intakeAttempts||new Set();if(this._intakeAttempts.has(id))throw Error('上次匯入結果待查，不可重送；請先核對批次');this._intakeAttempts.add(id);this._writeGeneration=(this._writeGeneration||0)+1;
      const res=await this._fetchAuth(this._url("intake-import","batches"),{method:"POST",headers:this._authHeaders({"content-type":"application/json"}),body:JSON.stringify({id,groups})});
      const body=res?await res.json():null;
      if(!res||!res.ok||!body?.ok||!Array.isArray(body.rows)||!Array.isArray(body.ids))throw new Error(body?.error?.message||"匯入未確認，請保留畫面重試");
      const made=[];for(let i=0;i<groups.length;i++){const b=groups[i],bid=id+"-"+i,rows=body.rows.filter(r=>r[1]===bid),head=rows.find(r=>r[0]==="批次");
        if(!head||head[11]!=="進行中"||["po","vendor","brand","model","origin","type","mfgYear","note"].some((k,i)=>String(head[i+2]??"")!==b[k])||rows.length!==b.serials.length+1||!b.serials.every(serial=>rows.some(r=>r[0]==="明細"&&r[12]===serial&&r[11]==="pending")))throw Error("讀回批次不完整，請保留畫面重試");
        made.push({...b,id:bid,at:head[10],closed:false,items:b.serials.map(serial=>({serial,state:"pending",receivedAt:"",code:""})),unexpected:[]});
      }
      const db=this._db();for(const b of made){const i=db.batches.findIndex(x=>x.id===b.id);if(i<0)db.batches.push(b);else db.batches[i]=b;}this._intakeAttempts.delete(id);return made;
    }
    _batchWrite(batch, entity, writeFn, onFailure) {
      const prior=batch.__batchChain;
      const task=this._mirror(entity,async()=>{
        try {
          await prior;
          if(batch.__batchUncertain)throw Error("此批次保存結果待查，後續未送出；不可重送");
          await writeFn();
        } catch(error){batch.__batchUncertain=true;if(onFailure)onFailure();throw error;}
      });
      batch.__batchChain=task;return task;
    }
    addBatch(info) {
      const db = this._db();
      const serials = (info.serials || []).map((s) => String(s).trim()).filter(Boolean);
      const seen = new Set(); const items = [];
      serials.forEach((s) => { if (!seen.has(s)) { seen.add(s); items.push({ serial: s, state: "pending", receivedAt: "", code: "" }); } });
      const b = { id: "b" + Date.now() + "-" + (++this._seq), po: info.po || "", vendor: info.vendor || "", brand: info.brand || "", model: info.model || "",
        origin: info.origin || "未確認", mfgYear: info.mfgYear || "", type: info.type || "", note: info.note || "",
        at: new Date().toISOString(), items, unexpected: [], closed: false };
      db.batches.push(b);
      b.__write = this._batchWrite(b, b, async () => {
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
        this._batchWrite(b, it, () => this._append("batches", ["明細", b.id, "", "", "", "", "", "", "", "", "", "received", s, it.receivedAt, ""]));
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
        const mv = { id: "m" + Date.now() + "-" + (++this._seq), code, type: "inbound", at: now,
          note: "進貨入庫（" + (b.vendor || "未填廠商") + "）→ " + dest.site + " " + dest.zone, to: dest.site + " " + dest.zone };
        db.movements.push(mv);
        a.__write = this._batchWrite(b, a, async () => {
          try {
            await x.__chain;
            if (b.__inboundUncertain || x.__unsynced) throw new Error("前一筆入庫結果待查，後續未送出；不可重送");
            const rowNum = await this._append("assets", assetToRow(a, this.actor));
            a.__row = rowNum;
            await this._append("batches", ["明細", b.id, "", "", "", "", "", "", "", "", "", "inbound", x.serial, x.receivedAt, code]);
            mv.__row = await this._append("movements", movementToRow(mv, this.actor));
          } catch (error) { b.__inboundUncertain = true; mv.__unsynced = true; throw error; }
        }, () => { mv.__unsynced = true; });
        mv.__chain = a.__write;
        made.push(a); made.__lastMovement = mv;
      }
      if (b.items.length && b.items.every((x) => x.state === "inbound")) b.closed = true;
      return made;
    }
    async saveRepairVerified(plan){
      if(!plan?.code||!plan?.event)throw new Error('維修資料不完整');
      this._repairAttempts=this._repairAttempts||new Set();
      if(this._repairAttempts.has(plan.code))throw new Error('此筆維修寫入結果待查，不可重送');
      this._repairAttempts.add(plan.code);this._writeGeneration=(this._writeGeneration||0)+1;this._pendingCount=(this._pendingCount||0)+1;
      try{
        const res=await this._fetchAuth(this._url('repair-stage','assets'),{method:'POST',headers:this._authHeaders({'content-type':'application/json'}),body:JSON.stringify({code:plan.code,stage:plan.stage,note:plan.event.note,site:plan.patch.site||'',zone:plan.patch.zone||'',expected:plan.expected,operationId:operationId(),...(this._editReservations?.has(plan.code)?{editorCode:plan.code,reservationToken:this._editReservations.get(plan.code).token}: {})})});
        const body=await res.json();if(!res.ok||body?.ok!==true||!Array.isArray(body.asset)||!Array.isArray(body.movement)||body.asset[0]!==plan.code||body.movement[3]!==plan.code)throw new Error(body.error?.message||'維修寫入結果待查，保留畫面且不可重送');
        const asset=this._db().assets.find(a=>a.code===plan.code);Object.assign(asset,rowToAsset(body.asset,body.assetRow-2));this._originalRows=this._originalRows||{};this._originalRows.assets=this._originalRows.assets||[];this._originalRows.assets[body.assetRow-2]=[...body.asset];this._db().movements.push(rowToMovement(body.movement,body.movementRow-2));this._repairAttempts.delete(plan.code);this._editReservations?.delete(plan.code);return asset;
      }finally{this._pendingCount-=1;}
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
    /* 通用全欄帶入（使用者 11/6 要求：已掃設備完整舊資料帶入新庫，非全庫遷移）：
     * 唯一完整編號命中時，空白欄位自舊帳主檔補齊；既有新帳值永不覆寫，衝突列出保留新帳待查。
     * 不帶入：保管人、使用部門、專案、據點區域、狀態（現場與盤點規則）。
     * 總表_0331 依用戶 11/4 排除，不在來源內（主檔本不含總表）。 */
    legacyMetadata(code) {
      const LEGACY_FIELD_MAP = [
        ["name", ["名稱"]], ["model", ["型號規格", "型號"]], ["serial", ["S-N", "S/N", "序號"]],
        ["purchase", ["採購日期"]], ["brand", ["品牌"]], ["type", ["類型"]],
        ["mfgYear", ["製造年份"]], ["po", ["PO編號", "PO"]], ["activate", ["啟用日期"]],
        ["warranty", ["保固到期"]], ["origin", ["產地"]]
      ];
      const matches = this.legacyRows().filter((r) => r.code === code);
      if (matches.length !== 1) return { patch: {}, issue: matches.length > 1 ? "舊帳同編號多筆，未自動帶入" : "" };
      const r = matches[0], a = this._db().assets.find((x) => x.code === code) || {};
      const header = Array.isArray(r.header) ? r.header : [];
      const raw = Array.isArray(r.raw) ? r.raw : [];
      const col = (names) => {
        for (const nm of names) { const n = header.indexOf(nm); if (n !== -1 && String(raw[n] || "").trim()) return String(raw[n]).trim(); }
        return "";
      };
      const patch = {}, conflicts = [];
      for (const [k, names] of LEGACY_FIELD_MAP) {
        const v = col(names);
        if (!v) continue;
        const cur = String(a[k] || "").trim();
        if (!cur || (k === "origin" && cur === "未確認")) patch[k] = v;
        else if (cur !== v) conflicts.push(k);
      }
      const srcRow = {};
      header.forEach((h, n) => { if (h && String(raw[n] || "").trim()) srcRow[h] = String(raw[n]).trim(); });
      /* 快照增量整併：唯一對碼下，舊 9-key 形狀升級、同來源缺欄補存；
       * 已保存的其他來源與既有欄值一律保留（不覆蓋較完整的已存內容），齊全則不重寫。 */
      let snap = null;
      try { snap = a.legacySnapshot ? JSON.parse(a.legacySnapshot) : null; } catch (e) { snap = null; }
      const linked = a.legacyKey === r.recordKey;
      let snapNeedsWrite = !linked || !snap || !snap.sources || typeof snap.sources !== "object";
      if (!snapNeedsWrite) {
        const cur = snap.sources["整合-主檔"] || {};
        const merged = Object.assign({ "列": r.__row }, srcRow);
        snapNeedsWrite = Object.keys(merged).some((k) => !(k in cur));
      }
      /* 無欄位需補且快照齊全：不重複寫入（避免每次掃描都產生一次儲存） */
      if (!Object.keys(patch).length && !snapNeedsWrite) {
        return { patch, issue: conflicts.length ? "舊帳與新帳欄位不同（" + conflicts.join("、") + "），保留新帳待查" : "" };
      }
      const nextSnap = snap && typeof snap === "object" && !Array.isArray(snap) ? Object.assign({}, snap) : {};
      nextSnap.code = r.code; nextSnap.recordKey = r.recordKey; nextSnap.provenance = r.provenance;
      nextSnap.sources = nextSnap.sources && typeof nextSnap.sources === "object" ? Object.assign({}, nextSnap.sources) : {};
      const curSrc = nextSnap.sources["整合-主檔"] && typeof nextSnap.sources["整合-主檔"] === "object" ? nextSnap.sources["整合-主檔"] : {};
      const addSrc = Object.assign({ "列": r.__row }, srcRow);
      const mergedSrc = Object.assign({}, curSrc);
      Object.keys(addSrc).forEach((k) => { if (!(k in mergedSrc) || !String(mergedSrc[k] || "").trim()) mergedSrc[k] = addSrc[k]; });
      nextSnap.sources["整合-主檔"] = mergedSrc;
      if (!nextSnap["補入說明"]) nextSnap["補入說明"] = "掃描／帶入時自動補齊空白欄位，既有新帳值不覆寫；衝突保留新帳待查。總表_0331 依 11/4 決定不作來源。";
      Object.assign(patch, {
        legacyKey: r.recordKey, legacyProvenance: r.provenance,
        legacySnapshot: JSON.stringify(nextSnap),
        legacyImportedAt: new Date().toISOString()
      });
      return { patch, issue: conflicts.length ? "舊帳與新帳欄位不同（" + conflicts.join("、") + "），保留新帳待查" : "" };
    }
    importLegacyMetadata(code) {
      if (!this.departmentReady) throw new Error("新帳來源欄位尚未就緒");
      const a = this._db().assets.find((x) => x.code === code);
      if (!a) throw new Error("新帳無此完整編號");
      const result = this.legacyMetadata(code);
      if (Object.keys(result.patch).length) this.saveAsset(code, result.patch);
      return { asset: a, issue: result.issue, changed: Object.keys(result.patch).length > 0 };
    }
    /* 出處分頁整筆補存（.28）：唯一對碼且主檔記有出處時，唯讀讀回來源分頁原始列，
     * 以編號或欄結構（項目/型號/位置）核對確為同一筆才併入快照；只補缺不覆寫已存內容。
     * 列內容對不上（移列/排序）→拒絕錯綁，快照標「來源未補齊」可見狀態；
     * 來源讀取失敗→保留既有快照並同樣標記；同碼多候選不猜。 */
    async enrichLegacySnapshotFromSource(code) {
      const a = this._db().assets.find((x) => x.code === code);
      if (!a) return { done: false, reason: "新帳無此編號" };
      const matches = this.legacyRows().filter((r) => r.code === code);
      if (matches.length > 1) return { done: false, reason: "舊帳同編號多筆，未自動補" };
      if (!matches.length) return { done: false, reason: "舊帳無對碼" };
      const r = matches[0];
      const tab = r.sourceTab || r.siteLead || "";
      const rowNo = Number(r.srcRow) || 0;
      if (!tab || !rowNo) return { done: false, reason: "主檔未記出處" };
      let snap = null;
      try { snap = a.legacySnapshot ? JSON.parse(a.legacySnapshot) : null; } catch (e) { snap = null; }
      if (snap && snap.sources && snap.sources[tab] && Object.keys(snap.sources[tab]).length > 1) return { done: true, skipped: true };
      const markIncomplete = (reason) => {
        const next = snap && typeof snap === "object" && !Array.isArray(snap) ? Object.assign({}, snap) : { code: r.code, recordKey: r.recordKey, provenance: r.provenance, sources: {} };
        next.sources = next.sources && typeof next.sources === "object" ? next.sources : {};
        const cur = next["來源未補齊"] && typeof next["來源未補齊"] === "object" ? Object.assign({}, next["來源未補齊"]) : {};
        if (cur[tab] && cur[tab]["原因"] === reason) return; /* 已標同因，不重寫 */
        cur[tab] = { "列": rowNo, "原因": reason, "時間": new Date().toISOString() };
        next["來源未補齊"] = cur;
        this.saveAsset(code, { legacySnapshot: JSON.stringify(next) });
      };
      let src;
      try { src = await this._readFull(tab); }
      catch (e) { markIncomplete("來源分頁讀取失敗：" + String((e && e.message) || e)); return { done: false, incomplete: "讀取失敗" }; }
      /* 來源列＝試算表實際列號（含表頭列）：bridge rows 自第 2 列起 */
      const row = src.rows[rowNo - 2];
      if (!row) { markIncomplete("來源列不存在（可能已刪列），拒絕錯綁"); return { done: false, incomplete: "列不存在" }; }
      const h = (src.header || []).map((x) => String(x == null ? "" : x).trim());
      const gv = (...names) => { for (const nm of names) { const n = h.indexOf(nm); if (n !== -1 && String(row[n] || "").trim()) return String(row[n]).trim(); } return ""; };
      const masterRaw = {};
      (r.header || []).forEach((hh, n) => { if (hh) masterRaw[hh] = String((r.raw || [])[n] == null ? "" : r.raw[n]).trim(); });
      const srcCode = gv("編號", "資產編號"), masterCode = masterRaw["編號"] || masterRaw["資產編號"] || "";
      let verified = false;
      if (srcCode) {
        /* 來源列載有編號：須與主檔記載編號一致；主檔記無編號而來源有→身分出入了，退回結構核對也不綁 */
        verified = !!(masterCode && srcCode === masterCode);
      } else {
        const pairs = [
          [gv("項目", "名稱", "資產名稱"), r.name],
          [gv("型號", "型號規格"), r.model],
          [gv("位置", "地點位置", "區域"), r.zone || r.place || ""]
        ];
        const checked = pairs.filter(([sv, mv]) => sv && mv);
        verified = checked.length >= 2 && checked.every(([sv, mv]) => String(sv).trim() === String(mv).trim());
      }
      if (!verified) { markIncomplete("來源列內容與主檔記載不符（可能移列或排序），拒絕錯綁"); return { done: false, incomplete: "核對不符" }; }
      const srcRowObj = {};
      h.forEach((hh, n) => { if (hh && String(row[n] || "").trim()) srcRowObj[hh] = String(row[n]).trim(); });
      const next = snap && typeof snap === "object" && !Array.isArray(snap) ? Object.assign({}, snap) : {};
      next.code = r.code; next.recordKey = r.recordKey; next.provenance = r.provenance;
      next.sources = next.sources && typeof next.sources === "object" ? Object.assign({}, next.sources) : {};
      const curSrc = next.sources[tab] && typeof next.sources[tab] === "object" ? next.sources[tab] : {};
      const add = Object.assign({ "列": rowNo }, srcRowObj);
      const merged = Object.assign({}, curSrc);
      Object.keys(add).forEach((k) => { if (!(k in merged) || !String(merged[k] || "").trim()) merged[k] = add[k]; });
      next.sources[tab] = merged;
      if (next["來源未補齊"] && next["來源未補齊"][tab]) { const c = Object.assign({}, next["來源未補齊"]); delete c[tab]; next["來源未補齊"] = c; }
      this.saveAsset(code, { legacySnapshot: JSON.stringify(next) });
      return { done: true };
    }
    observeAsset(sess, code, zone, occupantName) {
      const rawProject = String(sess.project || "").trim();
      const currentProject = ["", "全部", "全部專案", "未指定", "未指定（待確認）", "未指定(待確認)"].includes(rawProject) ? "" : rawProject;
      const department = String(sess.department || "").trim();
      const db = this._db();
      const BLOCK = ["待修", "維修中", "已報廢"];
      const existing = db.assets.find((a) => a.code === code);
      if (existing) {
        if (BLOCK.includes(existing.status)) {
          return { exception: true, reason: "既有狀態「" + existing.status + "」，不因掃描自動改回可用", asset: existing };
        }
        const metadata = this.departmentReady ? this.legacyMetadata(code) : { patch: {}, issue: "" };
        const patch = Object.assign({}, metadata.patch);
        const departmentMismatch = !!(department && existing.department && existing.department !== department);
        if (department && !existing.department) patch.department = department;
        /* 使用者 14:30 定案：掃到原本沒有專案的設備，歸入正在盤的專案；已屬其他專案的保留原歸屬，只提示差異 */
        if (currentProject && ["", "未指定", "未指定（待確認）", "未指定(待確認)"].includes(String(existing.project || "").trim())) patch.project = currentProject;
        if (existing.site !== sess.site || (zone && existing.zone !== zone)) { patch.site = sess.site; patch.zone = zone || existing.zone; }
        if (Object.keys(patch).length) {
          this.saveAsset(existing.code, patch);
          return { exception: false, moved: !!patch.site, assignedProject: patch.project || "", departmentMismatch, metadataIssue: metadata.issue, asset: existing };
        }
        return { exception: false, moved: false, departmentMismatch, metadataIssue: metadata.issue, asset: existing };
      }
      const now = new Date().toISOString();
      /* 新掃建檔：座位使用人帶入為保管人（僅新建；既有資產一律不改保管人）。無座位使用人→留空待現場確認。 */
      const bring = String(occupantName || "").trim();
      const a = { code, name: "", model: "", serial: "", owner: bring, site: sess.site, zone: zone || "",
        status: "使用中", project: currentProject, department, brand: "", origin: "未確認", type: "", mfgYear: "", po: "",
        purchase: "", activate: "", warranty: "", source: "盤點", createdAt: now, createdBy: this.actor, updatedAt: now };
      if (this.departmentReady) { const metadata = this.legacyMetadata(code); Object.assign(a, metadata.patch); }
      db.assets.push(a);
      a.__write = this._mirror(a, async () => {
        const rowNum = await this._append("assets", assetToRow(a, this.actor));
        a.__row = rowNum;
      });
      return { exception: false, created: true, ownerBroughtIn: bring || "", asset: a };
    }
    /* 釐清標示：寫入前由呼叫端過 validateAnnotation；快照由呼叫端以 snapshotOf(舊帳列) 提供 */
    addAnnotation(ann) {
      const db = this._db();
      const full = Object.assign({ at: new Date().toISOString(), confirmer: this.actor }, ann);
      db.annotations.push(full);
      full.__write = this._mirror(full, async () => {
        const rowNum = await this._append("annotations", annotationToRow(full));
        full.__row = rowNum;
      },{noRetry:!!ann.noRetry});
      return full;
    }
    annotationsOf(recordKey) { return this._db().annotations.filter((a) => a.recordKey === recordKey); }
    legacyRows() { return this._legacyRows || []; }
    legacyError() { return this._legacyError || ""; }
    legacyFlows() { return this._legacyFlows || []; }
    legacyQuestions() { return this._legacyQuestions || []; }
    legacyAuxError() { return this._legacyAuxError || ""; }
    legacyNotes() { return this._legacyNotes || []; }
    newOperationId() { return operationId(); } /* 同一張註記表單的重送共用同一 operationId，bridge 據此去重 */
    legacyNoteError() { return this._legacyNotesError || ""; }
    async _reloadLegacyNotes() {
      const ln = await this._readFull("\u73fe\u5834\u8a3b\u8a18");
      this._legacyNotes = ln.rows.map((row) => rowToNote(row)).filter((n) => n.recordKey);
      this._legacyNotesError = "";
    }
    /* \u820a\u5eab\u8a3b\u8a18\uff1a\u5beb\u5165\u820a\u5e33\u300c\u73fe\u5834\u8a3b\u8a18\u300d\u5206\u9801\uff08bridge legacy-note\uff09\u3002operationId/reservationToken \u7531 _fetchAuth \u6ce8\u5165\u3002 */
    async addLegacyNote(input) {
      const res = await this._fetchAuth(this._url("legacy-note", "\u73fe\u5834\u8a3b\u8a18"), { method: "POST", headers: this._authHeaders({ "content-type": "application/json" }), body: JSON.stringify(input || {}) });
      const body = await res.json().catch(() => null);
      if (!res || !res.ok) { const err = new Error((body && body.error && body.error.message) || ("\u73fe\u5834\u8a3b\u8a18\u5beb\u5165\u5931\u6557\uff08HTTP " + (res ? res.status : "?") + "\uff09")); err.code = (body && body.error && body.error.code) || ""; throw err; }
      await this._reloadLegacyNotes().catch((e) => {
        this._legacyNotesError = "\u8a3b\u8a18\u5df2\u9001\u51fa\uff0c\u4f46\u6e05\u55ae\u8b80\u56de\u5931\u6557\uff08" + String((e && e.message) || e) + "\uff09\uff1b\u8a3b\u8a18\u72c0\u614b\u672a\u78ba\u8a8d\uff0c\u8acb\u91cd\u65b0\u6574\u7406\u5f8c\u6838\u5c0d\u3002";
      });
      return body;
    }
    /* 以原 operationId 查證註記是否已落地：讀到=已寫入；讀不到不代表未寫入（請求可能仍在途），呼叫方必須保留未確認狀態；讀取失敗擲錯，同樣不可當未寫入 */
    async verifyLegacyNote(operationId) {
      if (!operationId) return null;
      await this._reloadLegacyNotes();
      return (this._legacyNotes || []).find((n) => n.key === operationId) || null;
    }
    async loadSeatMap() {
      try { const b = await this._readFull("座位圖");
        const headers = ["事件鍵","類型","圖版本","據點","區域","座位編號","資產編號","內容JSON","時間","經手人"];
        if (!headers.every((v,i) => b.header[i] === v)) throw new Error("座位圖欄位不符");
        this.seatRows = b.rows; this.seatReady = true; this.seatError = "";
      } catch(e) { this.seatReady = false; this.seatError = e.message; this.seatRows = []; }
      return this.seatRows;
    }
    async appendSeatEvent(row) {
      this._seatAttempts=this._seatAttempts||new Set();if(this._seatAttempts.has(row[0]))throw Error('上次座位寫入結果待查，不可重送；請先核對');
      if (!this.seatReady) throw new Error("座位圖尚未連接，未寫入");
      this._seatAttempts.add(row[0]);this._writeGeneration=(this._writeGeneration||0)+1;
      const res = await this._fetchAuth(this._url("seat-event", "座位圖"), {method:"POST",headers:this._authHeaders({"content-type":"application/json"}),body:JSON.stringify({row,...(row[1]==='placement'&&this._editReservations?.has(row[6])?{editorCode:row[6],reservationToken:this._editReservations.get(row[6]).token}: {})})});
      if (!res || !res.ok) { let b;try{b=await res.json()}catch{}if(res.status===409)await this.loadSeatMap();const err=new Error(b?.error?.message || b?.error?.code || (typeof b?.error==="string"?b.error:"") || "座位資料未同步，請重試");err.conflict=res.status===409;throw err; }
      const body = await res.json(); if (!body.ok) throw new Error("座位寫回失敗");
      const stored = body.row || row;
      if (!this.seatRows.some(r => r[0] === stored[0])) this.seatRows.push(stored);
      this._seatAttempts.delete(row[0]);return stored;
    }
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

  global.ZgErpSheets = Object.freeze({ SheetsStore, TABS, HEADERS, MOVEMENT_TYPE, NOT_CONNECTED, UNSYNCED,movementToRow,rowToMovement });
  if (typeof module !== "undefined" && module.exports) module.exports = { SheetsStore, TABS, HEADERS, MOVEMENT_TYPE, movementToRow,rowToMovement,NOT_CONNECTED, UNSYNCED, annotationToRow, rowToAnnotation, rowToLegacy, rowToFlow, rowToQuestion };
})(typeof window !== "undefined" ? window : globalThis);
