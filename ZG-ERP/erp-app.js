/* ZG-ERP 庫存／設備管理 — 第一批（測試資料版）。
 * 資料一律來自 ZgErpData（目前是瀏覽器內的虛構測試資料；正式版改接 Google 試算表，
 * 比照 vendor-sheet-service / gas-vendor-bridge 模式，欄位待使用者提供實際表格後對照）。
 * 本頁不連接、不讀寫任何正式試算表或資料庫。
 */
(function () {
  "use strict";
  const D = window.ZgErpData;
  const store = D.store;
  const LABEL = { ok: "相符", zone: "位置不符", site: "異地設備", none: "查無編號", dup: "重複掃描" };
  const GLYPH = { ok: "✓", zone: "≠", site: "⇄", none: "?", dup: "×2" };
  const LOGIN_URL = "../modules/worklog/?app=1&workspace=dashboard";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function dist(a, b, c, d) {
    const r = Math.PI / 180, x = (c - a) * r, y = (d - b) * r * Math.cos(((a + c) / 2) * r);
    return Math.sqrt(x * x + y * y) * 6371;
  }
  function timeStr(d) { return d.toTimeString().slice(0, 8); }
  function chip(st) { return '<span class="chip chip-' + st + '"><b>' + GLYPH[st] + "</b> " + LABEL[st] + "</span>"; }

  function session() {
    try { return JSON.parse(localStorage.getItem("zhuge_ai_os_google_auth_session_v1") || "null"); } catch { return null; }
  }

  const S = {
    mode: (new URLSearchParams(location.search).get("mode") === "phone" || window.innerWidth < 700) ? "phone" : "pc",
    dtab: "dash", dash: false, screen: "start",
    place: "", gps: null, gpsErr: "", site: "", zone: "", zoneOpen: false,
    open: "", filter: "all", metric: "total", dsite: "", dst: "", pfilter: "",
    asite: "", editCode: "", editDraft: null, savedAt: "", newZone: {}, sess: null, manualCode: "", camOn: false, camErr: "", camLast: "", camLastAt: 0,
    mapSite: "", mapZone: "", mapImg: "", mapEdit: false, retTab: "", scanProject: "", afOrigin: "", afBrand: "", afType: "", ageBasis: "purchase", ageFilter: "", ibOpen: "", ibConfirm: "", ibDraft: null, recvBatch: "", recvCode: "", recvLast: null
  };

  /* ---- 資料導出 ---- */
  const db = () => store.state();
  const sites = () => db().sites;
  const siteNames = () => sites().map((s) => s.name);
  const siteOf = (n) => sites().find((s) => s.name === n);
  const zonesOf = (n) => { const s = siteOf(n); return s ? s.zones : []; };
  const assets = () => db().assets;
  const getA = (code) => assets().find((a) => a.code === code);
  const projects = () => [...db().projects, D.UNASSIGNED];
  const allRecords = () => db().records.map((r) => ({ ...r, sessionSite: (db().sessions.find((x) => x.id === r.sessionId) || {}).site || "" }));
  function lastRecordOf(code) {
    const rs = allRecords().filter((r) => r.code === code);
    return rs.length ? rs[rs.length - 1] : null;
  }
  const curRecs = () => (S.sess ? store.sessionRecords(S.sess) : []);
  /* 位置圖標記：只存「區域 → 圖上位置」對照（本機測試用）。正式版對照放試算表、圖檔放私有儲存，不放公開 repo。 */
  const MARKS_KEY = "zg_erp_mapmarks_v1";
  function getMarks() { try { return JSON.parse(localStorage.getItem(MARKS_KEY) || "{}"); } catch { return {}; } }
  function setMark(site, zone, x, y) { const m = getMarks(); (m[site] = m[site] || {})[zone] = { x, y }; try { localStorage.setItem(MARKS_KEY, JSON.stringify(m)); } catch {} }

  function siteRows() {
    return sites().map((s) => {
      const mine = assets().filter((a) => a.site === s.name);
      const done = mine.filter((a) => lastRecordOf(a.code)).length;
      const mismatch = mine.filter((a) => {
        const r = lastRecordOf(a.code);
        return r && (r.sessionSite !== a.site || r.zone !== a.zone);
      }).length;
      const pct = mine.length ? Math.round((done / mine.length) * 100) : 0;
      return { n: s.name, t: mine.length, done, left: mine.length - done, z: mismatch, pct };
    });
  }
  const stCount = (st) => assets().filter((a) => a.status === st).length;
  const todayStr = () => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); };
  /* 需要處理：待修/維修中、保固已到期（用現有欄位即時算，不造假數據）、未決定的盤點差異 */
  function attention() {
    const t = todayStr();
    const items = [];
    assets().forEach((a) => {
      if (a.status === "待修" || a.status === "維修中") items.push({ a, why: a.status, tone: "bad" });
      else if (a.warranty && a.warranty < t) items.push({ a, why: "保固已到期 " + a.warranty, tone: "mid" });
    });
    const undecided = allRecords().filter((r) => r.status !== "ok" && !r.decision).length;
    const recv = openBatches().map((b) => ({ b, left: b.items.filter((x) => x.state === "pending").length, got: b.items.filter((x) => x.state === "received").length }));
    return { items, undecided, recv };
  }
  function attentionCard() {
    const { items, undecided, recv } = attention();
    if (!items.length && !undecided && !recv.length) return '<div class="acard ok"><b>目前沒有需要立即處理的項目。</b><span class="small">待修、維修中、保固到期和未決定的盤點差異會列在這裡。</span></div>';
    const shown = items.slice(0, 6);
    let rows = shown.map((x) =>
      '<div class="arow2"><span class="dot ' + x.tone + '"></span><span class="aname"><b>' + esc(x.a.name) + "</b> " + esc(x.a.code.slice(-6)) +
      '<br><span class="small">' + esc(x.a.site) + " " + esc(x.a.zone) + " · 保管人 " + esc(x.a.owner) + " · " + esc(x.why) + '</span></span>' +
      '<button class="pill sm" data-a="ajump" data-v="' + esc(x.a.code) + '">處理</button></div>').join("");
    recv.forEach((x) => { rows += '<div class="arow2"><span class="dot mid"></span><span class="aname"><b>進貨「' + esc(x.b.vendor || x.b.model || "未填廠商") + "」</b>" +
      (x.left ? "待收 " + x.left + " 台" : "已收齊 ") + (x.got ? "，已核對 " + x.got + " 台待確認入庫" : "") +
      '<br><span class="small">' + esc(x.b.brand || "未填品牌") + " · " + esc(x.b.model || "未填型號") + " · 產地 " + esc(x.b.origin) + '</span></span>' +
      '<button class="pill sm" data-a="goinbound" data-v="' + esc(x.b.id) + '">去核對</button></div>'; });
    if (undecided) rows += '<div class="arow2"><span class="dot mid"></span><span class="aname"><b>' + undecided + " 筆盤點差異</b>還沒決定" +
      '<br><span class="small">手機掃到的位置不符或查無編號，決定後才會從這裡消失。</span></span>' +
      '<button class="pill sm" data-a="godiff">去決定</button></div>';
    if (items.length > shown.length) rows += '<div class="small">另有 ' + (items.length - shown.length) + " 筆；到「設備資料」依狀態篩選可逐筆處理。</div>";
    return '<div class="acard"><div class="albl">需要處理（' + (items.length + (undecided ? 1 : 0) + recv.length) + "）</div>" + rows + "</div>";
  }
  const projAssets = (p) => assets().filter((a) => (a.project || D.UNASSIGNED) === p);
  const batches = () => store.listBatches();
  const openBatches = () => batches().filter((b) => !b.closed);
  const originOf = (a) => a.origin || "未確認";
  const brandOf = (a) => a.brand || "未確認";
  const distinctOrigins = () => [...new Set(assets().map(originOf))];
  /* 設備年齡：依所選基準（購入/啟用/製造年份）計算；缺該日期列「年限未確認」，不猜。門檻由使用者設定，預設 5 年為待確認值，不自動報廢。 */
  const AGE_THRESHOLD_DEFAULT = 5;
  function assetAge(a, basis) {
    const now = new Date().getFullYear();
    if (basis === "mfgYear") return a.mfgYear ? now - Number(a.mfgYear) : null;
    const v = basis === "activate" ? a.activate : a.purchase;
    return v ? now - Number(String(v).slice(0, 4)) : null;
  }
  const distinctBrands = () => [...new Set(assets().map(brandOf))];

  /* ---- 掃描 ---- */
  function scan(code) {
    code = String(code || "").trim();
    if (!code || !S.sess) return;
    const a = getA(code);
    const status = !a ? "none" : a.site !== S.site ? "site" : a.zone !== S.zone ? "zone" : "ok";
    const sessProj = S.sess.project || "";
    const pm = !!(a && sessProj && (a.project || D.UNASSIGNED) !== sessProj);
    store.addRecord(S.sess, { code, status, zone: S.zone, at: new Date().toISOString(), projMismatch: pm, sessProject: sessProj });
    S.open = code;
    render();
  }
  function detectGps() {
    S.gpsErr = "";
    if (!navigator.geolocation) { S.gpsErr = "這個瀏覽器不支援定位，請直接選擇盤點據點。"; render(); return; }
    let done = false;
    const wd = setTimeout(() => {
      if (done) return;
      done = true;
      S.gpsErr = "定位逾時：瀏覽器沒有回應（可能授權視窗沒有顯示或被忽略）。請直接選擇盤點據點，或確認網址列的定位授權後再試。";
      render();
    }, 12000);
    navigator.geolocation.getCurrentPosition((pos) => {
      if (done) return;
      done = true; clearTimeout(wd);
      const fix = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: Math.round(pos.coords.accuracy || 0), at: timeStr(new Date()) };
      S.gps = fix;
      let best = null, bd = Infinity;
      sites().forEach((s) => { const d = dist(fix.lat, fix.lon, s.lat, s.lon); if (d < bd) { bd = d; best = s.name; } });
      S.nearest = best; S.nearestD = bd;
      if (best) S.site = best;
      render();
    }, (err) => {
      if (done) return;
      done = true; clearTimeout(wd);
      const code = err && err.code;
      S.gpsErr = code === 1 ? "定位權限被拒絕。要用定位請在瀏覽器設定允許；目前可手動選擇盤點據點，紀錄會註記沒有定位。"
        : code === 2 ? "目前收不到定位訊號（可能在室內或訊號弱）。可手動選擇盤點據點，或到空曠處再試。"
        : code === 3 ? "定位逾時。可手動選擇盤點據點，或再試一次。"
        : "定位失敗（" + (err && err.message ? err.message : "未知原因") + "）。可改為手動選擇盤點據點，紀錄會註記沒有定位。";
      render();
    }, { enableHighAccuracy: true, timeout: 10000 });
  }
  function startSession() {
    if (!S.site) return;
    const begin = (fix) => {
      const g = fix || S.gps || { lat: null, lon: null, acc: null };
      S.sess = store.startSession(S.site, g.lat, g.lon, g.acc != null ? g.acc : null, S.scanProject || "");
      S.zone = zonesOf(S.site)[0] || "";
      S.open = ""; S.screen = "scan";
      render();
    };
    // 開始盤點時抓一次起點定位：未決定時會跳出一次瀏覽器授權請求；明確拒絕則不問，維持手動據點
    if (!S.gps && navigator.geolocation) {
      const capture = () => {
        let done = false;
        const wd = setTimeout(() => {
          if (done) return;
          done = true;
          S.gpsErr = "起點定位逾時：瀏覽器沒有回應（可能授權視窗沒有顯示）。本次先以手動據點開始，紀錄會註記沒有定位。";
          begin(null);
        }, 8000);
        navigator.geolocation.getCurrentPosition((pos) => {
          if (done) return;
          done = true; clearTimeout(wd);
          const f = { lat: pos.coords.latitude, lon: pos.coords.longitude, acc: Math.round(pos.coords.accuracy || 0), at: timeStr(new Date()) };
          S.gps = f; S.gpsErr = ""; begin(f);
        }, (err) => {
          if (done) return;
          done = true; clearTimeout(wd);
          S.gpsErr = err && err.code === 1 ? "定位權限被拒絕。本次紀錄會註記沒有定位；之後要用定位請在瀏覽器設定允許。"
            : "起點定位未取得（" + (err && err.code === 3 ? "逾時" : "收不到訊號") + "）。本次先以手動據點開始，紀錄會註記沒有定位。";
          begin(null);
        }, { enableHighAccuracy: true, timeout: 6000 });
      };
      if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: "geolocation" }).then((p) => {
          if (p.state === "denied") { S.gpsErr = "定位權限已被拒絕。本次紀錄會註記沒有定位；要用定位請在瀏覽器設定允許。"; begin(null); }
          else capture();
        }).catch(() => capture());
      } else capture();
    } else begin(null);
  }

  /* ---- 相機連續掃描：getUserMedia 取影像；條碼辨識優先 BarcodeDetector，不支援時用內建 jsQR（僅 QR） ---- */
  const cam = { stream: null, det: null, timer: null, canvas: null, dedup: null, engine: "" };
  function camStop(silent) {
    if (cam.timer) { clearInterval(cam.timer); cam.timer = null; }
    if (cam.stream) { cam.stream.getTracks().forEach((t) => t.stop()); cam.stream = null; }
    cam.det = null; cam.engine = "";
    S.camOn = false;
    if (!silent) render();
  }
  function camOnCode(val) {
    if (!val) return;
    if (!cam.dedup) cam.dedup = ErpScanCore.makeDeduper(3000);
    if (cam.dedup.accept(val)) scan(val);
  }
  function camTick() {
    const v = document.getElementById("camv");
    if (!v || v.readyState < 2 || !S.sess) return;
    if (cam.engine === "barcode") {
      cam.det.detect(v).then((codes) => {
        if (codes && codes.length) camOnCode(String(codes[0].rawValue || "").trim());
      }).catch(() => { /* 單次辨識失敗略過，繼續下一幀 */ });
    } else if (cam.engine === "jsqr") {
      try {
        if (!cam.canvas) cam.canvas = document.createElement("canvas");
        const w = v.videoWidth, h = v.videoHeight;
        if (!w || !h) return;
        cam.canvas.width = w; cam.canvas.height = h;
        const ctx = cam.canvas.getContext("2d", { willReadFrequently: true });
        ctx.drawImage(v, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);
        camOnCode(ErpScanCore.decodeWithJsQR(window.jsQR, img.data, w, h).trim());
      } catch (e) { /* 單幀失敗略過 */ }
    }
  }
  function camStart() {
    S.camErr = "";
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      S.camErr = "這個瀏覽器沒有相機功能（需要 HTTPS 與支援的瀏覽器），請用輸入或測試按鈕。"; render(); return;
    }
    const hasBD = "BarcodeDetector" in window;
    const hasJsQR = !!(window.ErpScanCore && window.jsQR);
    if (!hasBD && !hasJsQR) {
      S.camErr = "這個瀏覽器不支援即時條碼辨識，備用辨識元件也未載入，請用輸入或測試按鈕。"; render(); return;
    }
    let settled = false;
    const watchdog = setTimeout(() => {
      if (settled) return;
      settled = true;
      camStop(true);
      S.camErr = "相機超過 8 秒沒有回應（可能沒有相機或授權視窗被擋）。請用輸入或測試按鈕，或換一支手機瀏覽器再試。";
      render();
    }, 8000);
    navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false }).then((stream) => {
      if (settled) { stream.getTracks().forEach((t) => t.stop()); return; }
      settled = true; clearTimeout(watchdog);
      cam.stream = stream;
      cam.engine = hasBD ? "barcode" : "jsqr";
      if (hasBD) cam.det = new BarcodeDetector({ formats: ["qr_code", "code_128", "code_39", "ean_13", "ean_8", "data_matrix"] });
      cam.dedup = ErpScanCore.makeDeduper(3000);
      S.camOn = true; S.camLast = ""; S.camLastAt = 0;
      render();
      cam.timer = setInterval(camTick, cam.engine === "jsqr" ? 700 : 600);
    }).catch((err) => {
      if (settled) return;
      settled = true; clearTimeout(watchdog);
      S.camErr = err && err.name === "NotAllowedError"
        ? "相機權限被拒絕。要用相機掃描請在瀏覽器網址列允許相機後再試；目前先用輸入或測試按鈕。"
        : err && err.name === "NotFoundError"
        ? "找不到可用的相機鏡頭。請用輸入或測試按鈕。"
        : "相機開啟失敗（" + (err && err.name ? err.name : "未知原因") + "），請用輸入或測試按鈕。";
      render();
    });
  }
  function afterRender() {
    if (S.camOn && cam.stream) {
      const v = document.getElementById("camv");
      if (v && v.srcObject !== cam.stream) { v.srcObject = cam.stream; v.play().catch(() => {}); }
    }
  }

  /* ---- 共用元件 ---- */
  function mockBar() {
    return '<div class="mockbar">這是<b>測試資料</b>畫面：資料為虛構範例，只存在這個瀏覽器，不會寫入你的 Google 試算表或任何正式系統。正式版將直接讀寫你的試算表（欄位對照待你提供實際表格）。</div>';
  }
  function loginBar() {
    const s = session();
    if (s && s.access_token) {
      const who = s.user && (s.user.email || s.user.name) ? esc(s.user.email || s.user.name) : "已登入";
      return '<div class="loginbar">諸葛登入狀態：' + who + "</div>";
    }
    return '<div class="loginbar">尚未登入諸葛。測試資料可直接操作；正式版需要 <a href="' + LOGIN_URL + '">登入諸葛</a> 才能讀寫你的試算表。</div>';
  }
  function zhugeBar() {
    return '<div class="zhugebar"><b>諸葛</b><span>／ ZG-ERP 庫存 · 設備管理</span><a class="pill sm" style="display:inline-flex;align-items:center;text-decoration:none" href="../">返回諸葛</a></div>';
  }
  function modeBar() {
    return '<div class="modebar">' +
      '<button class="mb' + (S.mode === "pc" ? " on" : "") + '" data-a="mode" data-v="pc">電腦 · 管理編輯</button>' +
      '<button class="mb' + (S.mode === "phone" ? " on" : "") + '" data-a="mode" data-v="phone">手機 · 現場掃描</button></div>';
  }

  /* ---- 手機端 ---- */
  function phoneStart() {
    const g = S.gps;
    return '<div class="screen"><h3 class="ptitle">設備盤點</h3>' +
      '<p class="psub">按開始後會記下當下定位與時間，之後可以連續掃描。定位只用來判斷最近據點，不會用來猜樓層或房間。</p>' +
      '<div class="card"><div class="lbl">掃描起點定位（使用瀏覽器實際定位，需你授權）</div>' +
      (!g
        ? '<button class="btn secondary" data-a="gps">取得目前定位</button>' + (S.gpsErr ? '<div class="warn">' + esc(S.gpsErr) + "</div>" : "")
        : '<div class="big">' + g.lat.toFixed(4) + ", " + g.lon.toFixed(4) + "</div>" +
          '<div class="small">準確度約 ±' + g.acc + " 公尺 · " + esc(g.at) + "</div>" +
          (S.nearest ? '<div class="match">最近據點：<b>' + esc(S.nearest) + "</b>（距離約 " + (S.nearestD < 1 ? Math.round(S.nearestD * 1000) + " 公尺" : S.nearestD.toFixed(1) + " 公里") + "）</div>" : "")) +
      '<div class="lbl" style="margin-top:14px">盤點據點（可改）</div>' +
      '<div class="chips">' + siteNames().map((p) => '<button class="pill' + (S.site === p ? " on" : "") + '" data-a="site" data-v="' + esc(p) + '">' + esc(p) + "</button>").join("") + "</div>" +
      (g && S.nearest && S.site && S.site !== S.nearest ? '<div class="warn">你選的據點和定位最近的據點不同，結果會註記。</div>' : "") +
      '<div class="lbl" style="margin-top:14px">這次主要盤哪個專案？（可先設定，掃描時沿用，不用每筆重選）</div>' +
      '<div class="chips"><button class="pill' + (S.scanProject === "" ? " on" : "") + '" data-a="sproj" data-v="">全部專案</button>' +
      projects().map((p) => '<button class="pill' + (S.scanProject === p ? " on" : "") + '" data-a="sproj" data-v="' + esc(p) + '">' + esc(p.replace("（測試）", "")) + "</button>").join("") + "</div>" +
      '<div class="small">設定的只是「這次盤點的範圍」，不會改任何設備的歸屬專案。掃到其他專案的設備會提示並照樣記錄。</div>' +
      (S.site ? '<div class="match">本次範圍：<b>' + esc(S.site) + "</b>" + (S.scanProject ? " · <b>" + esc(S.scanProject.replace("（測試）", "")) + "</b>" : " · 全部專案") +
        " · 應盤 <b>" + assets().filter((a) => a.site === S.site && (!S.scanProject || (a.project || D.UNASSIGNED) === S.scanProject)).length + "</b> 台</div>" : "") +
      "</div>" +
      '<button class="btn" data-a="start"' + (S.site ? "" : " disabled") + ">開始連續掃描" + (S.site ? " · " + esc(S.site) : "") + (S.scanProject ? " · " + esc(S.scanProject.replace("（測試）", "")) : "") + "</button></div>";
  }
  function phoneScan() {
    const recs = curRecs();
    const last = recs.length ? recs[recs.length - 1] : null;
    const lastShown = last ? [...recs].reverse().find((r) => r.code === S.open) || last : null;
    const dupFlag = (r) => (r.n > 1 ? "dup" : r.status);
    const siteAssets = assets().filter((a) => a.site === S.site);
    const foreign = assets().find((a) => a.site !== S.site);
    let toast;
    if (lastShown) {
      const r = lastShown, a = getA(r.code), st = dupFlag(r);
      toast = '<div class="toast t-' + st + '">' + chip(st) +
        '<div class="tname">' + (a ? esc(a.name) : "清冊中找不到") + "</div>" +
        '<div class="tcode">' + esc(r.code) + "</div>" +
        (a ? '<div class="tloc">設備狀態：<b>' + esc(a.status) + "</b>" + (a.status !== "使用中" && a.status !== "備用" ? "（掃描不會改狀態）" : "") +
          "<br>歸屬專案：<b>" + esc(a.project || D.UNASSIGNED) + "</b><br>設備序號：" + esc(a.serial || "未登記") +
          "<br>登記：" + esc(a.site) + " " + esc(a.zone) + "<br>現場：" + esc(S.site) + " " + esc(r.zone) + "</div>" : "") +
        (lastShown.projMismatch && a ? '<div class="warn">歸屬專案是「' + esc((a.project || D.UNASSIGNED).replace("（測試）", "")) + "」，和這次設定的「" + esc((lastShown.sessProject || "").replace("（測試）", "")) + "」不同。已記錄，不會自動改歸屬。</div>" : "") +
        (r.status === "none" ? '<div class="tloc">先記下來，盤點後再補登。</div>' : "") + "</div>";
    } else {
      toast = '<div class="toast idle">還沒掃到東西。輸入登記編號，或點下面的測試按鈕模擬掃描。</div>';
    }
    const sessProj = S.sess.project || "";
    const scope = assets().filter((a) => a.site === S.site && (!sessProj || (a.project || D.UNASSIGNED) === sessProj));
    const scopeGot = scope.filter((a) => recs.some((r) => r.code === a.code));
    const scopeMiss = scope.filter((a) => !scopeGot.includes(a));
    const outScope = recs.filter((r) => { const x = getA(r.code); return !x || x.site !== S.site || (sessProj && (x.project || D.UNASSIGNED) !== sessProj); }).length;
    const otherProj = sessProj ? assets().find((a) => a.site === S.site && (a.project || D.UNASSIGNED) !== sessProj) : null;
    const scopeStrip = '<div class="scope"><div class="sct"><span>本次範圍：' + esc(S.site) + (sessProj ? " · " + esc(sessProj.replace("（測試）", "")) : " · 全部專案") + "</span><span>" + scopeGot.length + " / " + scope.length + "</span></div>" +
      '<span class="bar"><i style="width:' + (scope.length ? Math.round((scopeGot.length / scope.length) * 100) : 0) + '%"></i></span>' +
      '<div class="smeta">應盤 ' + scope.length + " · 已掃 " + scopeGot.length + " · " + (scopeMiss.length ? "<b class=\"pbad\">還差 " + scopeMiss.length + "</b>" : "全部掃完") +
      (outScope ? " · 範圍外 " + outScope + " 筆（都有記錄）" : "") + "</div>" +
      (scopeMiss.length ? '<div class="smeta">未掃：' + scopeMiss.slice(0, 8).map((a) => esc(a.name) + " " + esc(a.code.slice(-4))).join("、") + (scopeMiss.length > 8 ? " …等 " + scopeMiss.length + " 台" : "") + "</div>" : "") + "</div>";
    return '<div class="screen">' +
      '<div class="scanbar"><button class="zonebtn" data-a="zoneopen"><span class="lbl">' + esc(S.site) + " · 目前區域</span><b>" + esc(S.zone) + " ▾</b></button>" +
      '<button class="btn mini" data-a="toresult">結束 (' + recs.length + ")</button></div>" +
      scopeStrip +
      '<div class="small">起點定位 ' + (S.sess.lat != null ? Number(S.sess.lat).toFixed(3) + ", " + Number(S.sess.lon).toFixed(3) + (S.sess.acc != null ? "（±" + S.sess.acc + " m）" : "") : "無（手動選擇據點）") + " · " + esc(new Date(S.sess.at).toLocaleTimeString("zh-TW", { hour12: false })) + "（固定，換區域不會改）</div>" +
      (S.zoneOpen ? '<div class="zonepick">' + zonesOf(S.site).map((z) => '<button class="pill' + (S.zone === z ? " on" : "") + '" data-a="zone" data-v="' + esc(z) + '">' + esc(z) + "</button>").join("") + "</div>" : "") +
      (S.camOn
        ? '<div class="view live"><video id="camv" autoplay playsinline muted></video><span class="hint">' + (cam.engine === "jsqr" ? "對準 QR 碼（此瀏覽器僅支援 QR），掃到會自動記一筆（同一張 3 秒內不重複計）" : "對準 QR／條碼，掃到會自動記一筆（同一張 3 秒內不重複計）") + '</span></div><div class="frow"><button class="pill sm" data-a="camstop">關閉相機</button></div>'
        : '<div class="view" role="img" aria-label="相機取景區"><i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i><div class="qr"></div><span class="hint">可用相機連續掃描，或用下方輸入／測試按鈕</span></div><div class="frow"><button class="pill sm" data-a="camstart">開啟相機掃描</button></div>' + (S.camErr ? '<div class="warn">' + esc(S.camErr) + "</div>" : "")) +
      toast +
      '<div class="frow"><input class="inp" data-f="manualCode" placeholder="輸入登記編號（如 CSPH107030182）" value="' + esc(S.manualCode) + '"><button class="btn mini" data-a="manual">掃描</button></div>' +
      '<div class="lbl sim">測試用：模擬掃到（虛構設備）</div><div class="chips">' +
      siteAssets.slice(0, 4).map((a) => '<button class="pill sm" data-a="scan" data-v="' + esc(a.code) + '">' + esc(a.name) + " " + esc(a.code.slice(-4)) + "</button>").join("") +
      (foreign ? '<button class="pill sm" data-a="scan" data-v="' + esc(foreign.code) + '">其他據點的設備</button>' : "") +
      (otherProj ? '<button class="pill sm" data-a="scan" data-v="' + esc(otherProj.code) + '">其他專案的設備</button>' : "") +
      '<button class="pill sm" data-a="scan" data-v="CSXX999999999">不在清冊內的編號</button>' +
      (last ? '<button class="pill sm" data-a="scan" data-v="' + esc(last.code) + '">再掃同一個</button>' : "") + "</div>" +
      '<div class="lbl sim">本次已掃 ' + recs.length + " 筆</div>" +
      [...recs].reverse().map((r) => {
        const a = getA(r.code);
        return '<button class="item" data-a="open" data-v="' + esc(r.code) + '">' + chip(dupFlag(r)) +
          '<span class="iname">' + esc(a ? a.name : r.code) + '</span><span class="icode">' + esc(r.code.slice(-6)) + "</span>" +
          (S.open === r.code ? '<span class="idet">' + (a ? esc(a.model) + " · S/N " + esc(a.serial || "未登記") + " · 狀態 " + esc(a.status) + " · 保管人 " + esc(a.owner) + " · 歸屬 " + esc(a.project || D.UNASSIGNED) + " · 購入 " + esc(a.purchase || "未登記") + " · 啟用 " + esc(a.activate || "未登記") + " · 保固 " + esc(a.warranty || "未登記") + " · 登記 " + esc(a.site) + " " + esc(a.zone) : "清冊無此編號") + " · " + esc(new Date(r.at).toLocaleTimeString("zh-TW", { hour12: false })) + (r.n > 1 ? " · 已重複 " + r.n + " 次" : "") + (r.projMismatch ? " · 歸屬專案與本次範圍不同（未改歸屬）" : "") + "</span>" : "") + "</button>";
      }).join("") + "</div>";
  }
  function decisionButtons(r) {
    if (r.decision) return '<span class="done">已選：' + esc(r.decision) + "</span>";
    return '<span class="acts">' +
      (r.status !== "none" ? '<button class="pill sm" data-a="decide" data-v="' + esc(r.code) + '" data-d="維持登記">維持登記</button>' : "") +
      '<button class="pill sm" data-a="decide" data-v="' + esc(r.code) + '" data-d="' + (r.status === "none" ? "標記補登" : "以現場為準") + '">' + (r.status === "none" ? "標記補登" : "以現場為準") + "</button>" +
      '<button class="pill sm" data-a="decide" data-v="' + esc(r.code) + '" data-d="稍後處理">稍後</button></span>';
  }
  function phoneResult() {
    const recs = curRecs();
    const count = (st) => recs.filter((r) => r.status === st).length;
    const todo = recs.filter((r) => r.status !== "ok" && !r.decision);
    const shown = (S.filter === "todo" ? todo : recs).filter((r) => r.status !== "ok");
    const siteAssets = assets().filter((a) => a.site === S.site);
    const badStatus = recs.filter((r) => { const a = getA(r.code); return a && (a.status === "維修中" || a.status === "待修" || a.status === "已報廢"); }).length;
    return '<div class="screen"><h3 class="ptitle">' + esc(S.site) + "盤點結果</h3>" +
      '<p class="psub">起點定位 ' + (S.sess.lat != null ? Number(S.sess.lat).toFixed(3) + ", " + Number(S.sess.lon).toFixed(3) + (S.sess.acc != null ? "（±" + S.sess.acc + " m）" : "") : "無") + " · 共掃 " + recs.length + " 筆 · 只存在這個瀏覽器，尚未連接試算表</p>" +
      (() => { const sp = S.sess.project || "";
        const sc = siteAssets.filter((a) => !sp || (a.project || D.UNASSIGNED) === sp);
        const got = sc.filter((a) => recs.some((r) => r.code === a.code));
        const pm = recs.filter((r) => r.projMismatch).length;
        return '<div class="scope"><div class="sct"><span>本次範圍：' + esc(S.site) + (sp ? " · " + esc(sp.replace("（測試）", "")) : " · 全部專案") + "</span><span>" + got.length + " / " + sc.length + "</span></div>" +
          '<span class="bar"><i style="width:' + (sc.length ? Math.round((got.length / sc.length) * 100) : 0) + '%"></i></span>' +
          '<div class="smeta">範圍內應盤 ' + sc.length + " · 掃到 " + got.length + " · " + (sc.length - got.length ? "<b class=\"pbad\">未掃 " + (sc.length - got.length) + "</b>" : "全部掃完") + "</div>" +
          (pm ? '<div class="warn">' + pm + " 台掃到的設備歸屬在其他專案，已記錄、沒有改歸屬。</div>" : "") + "</div>"; })() +
      '<div class="tiles"><div class="tile"><b>' + count("ok") + '</b>相符</div><div class="tile"><b>' + count("zone") + '</b>位置不符</div><div class="tile"><b>' + count("site") + '</b>異地</div><div class="tile"><b>' + count("none") + "</b>查無</div></div>" +
      (badStatus > 0 ? '<div class="warn">掃到 ' + badStatus + " 台狀態不是正常使用（待修、維修中或已報廢）。盤點只記「有沒有看到」，不會把狀態改成正常。</div>" : "") +
      '<div class="lbl sim">' + esc(S.site) + "位置表：應有 / 已掃" + (S.sess.project ? "（只算本次範圍專案）" : "") + "</div><div class=\"ztable\">" +
      zonesOf(S.site).map((z) => {
        const should = siteAssets.filter((a) => a.zone === z && (!S.sess.project || (a.project || D.UNASSIGNED) === S.sess.project));
        const got = should.filter((a) => recs.some((r) => r.code === a.code));
        const miss = should.filter((a) => !got.includes(a));
        return '<div class="zrow"><span>' + esc(z) + "</span><b>" + got.length + " / " + should.length + "</b>" +
          (miss.length ? '<span class="miss">未掃：' + miss.map((a) => esc(a.name) + " " + esc(a.code.slice(-4))).join("、") + "</span>" : "") + "</div>";
      }).join("") + "</div>" +
      '<div class="lbl sim">需要你決定（' + todo.length + "）</div>" +
      '<div class="chips"><button class="pill sm' + (S.filter === "all" ? " on" : "") + '" data-a="filter" data-v="all">全部</button><button class="pill sm' + (S.filter === "todo" ? " on" : "") + '" data-a="filter" data-v="todo">只看待處理</button></div>' +
      (shown.length === 0 ? '<div class="toast idle">沒有要處理的項目。</div>"'.replace('"</div>"', '"') : shown.map((r) => {
        const a = getA(r.code);
        return '<div class="item static">' + chip(r.status) + '<span class="iname">' + esc(a ? a.name : r.code) + '</span><span class="icode">' + esc(r.code.slice(-6)) + "</span>" +
          '<span class="idet">' + (a ? esc(a.status) + " · S/N " + esc(a.serial || "未登記") + " · 歸屬 " + esc(a.project || D.UNASSIGNED) + " · 購入 " + esc(a.purchase || "未登記") + " · 保固 " + esc(a.warranty || "未登記") + " · 登記 " + esc(a.site) + " " + esc(a.zone) + " → 現場 " + esc(S.site) + " " + esc(r.zone) : "清冊查無，需補登") + "</span>" +
          decisionButtons(r) + "</div>";
      }).join("")) +
      '<div class="hand">接下來在電腦整理：這批差異也會出現在「電腦 · 管理編輯」的盤點差異裡（同一瀏覽器）。</div>' +
      '<button class="btn" data-a="mode" data-v="pc">到電腦管理端處理</button>' +
      '<button class="btn secondary" disabled>寫回試算表（正式版功能，待接入你的表格）</button>' +
      '<button class="btn secondary" data-a="tostart">回到起點</button></div>';
  }
  function phoneDash() {
    const rows = siteRows();
    const sum = rows.reduce((a, r) => ({ t: a.t + r.t, d: a.d + r.done, z: a.z + r.z }), { t: 0, d: 0, z: 0 });
    const metric = S.metric;
    const sorted = [...rows].sort((a, b) => metric === "todo" ? b.left - a.left : metric === "zone" ? b.z - a.z : metric === "done" ? b.pct - a.pct : b.t - a.t);
    return '<div class="screen"><h3 class="ptitle">統計儀表板</h3><p class="psub">由本頁測試資料即時計算，不是公司實際資料。</p>' + dashBody(rows, sum, sorted, true) + "</div>";
  }
  function dashBody(rows, sum, sorted, isPhone) {
    const metric = S.metric, dst = S.dst, pfilter = S.pfilter;
    let drill = "";
    if (metric !== "total") {
      let list = [];
      if (metric === "done") list = assets().filter((a) => lastRecordOf(a.code)).map((a) => ({ a, tag: "已掃", note: "" }));
      if (metric === "todo") list = assets().filter((a) => !lastRecordOf(a.code)).map((a) => ({ a, tag: "未盤", note: "" }));
      if (metric === "zone") list = assets().filter((a) => { const r = lastRecordOf(a.code); return r && (r.sessionSite !== a.site || r.zone !== a.zone); }).map((a) => { const r = lastRecordOf(a.code); return { a, tag: "位置不符", note: "現場 " + r.sessionSite + " " + r.zone }; });
      if (dst) list = list.filter((x) => x.a.status === dst);
      drill = '<div class="drill"><div class="lbl">' + { done: "已盤點明細", todo: "未盤到明細", zone: "位置不符明細" }[metric] + "（篩選：" + esc(dst || "全部狀態") + "）</div>" +
        (list.length === 0 ? '<div class="small">沒有符合的設備。</div>' : list.slice(0, 8).map((x) =>
          '<div class="zrow act"><span><b>' + esc(x.a.name) + "</b> " + esc(x.a.code.slice(-6)) + '<br><span class="small">' + esc(x.a.site) + " " + esc(x.a.zone) + " · " + esc(x.a.status) + " · 歸屬 " + esc(x.a.project || D.UNASSIGNED) + (x.note ? " · " + esc(x.note) : "") + '</span></span><button class="pill sm" data-a="ajump" data-v="' + esc(x.a.code) + '">處理</button><span class="small">' + esc(x.tag) + "</span></div>").join("")) +
        (list.length > 8 ? '<div class="small">另有 ' + (list.length - 8) + " 筆。</div>" : "") + "</div>";
    }
    let projDrill = "";
    if (pfilter) {
      const list = projAssets(pfilter);
      projDrill = '<div class="drill"><div class="lbl">「' + esc(pfilter) + "」反查到 " + list.length + " 台，分布在 " + esc([...new Set(list.map((a) => a.site))].join("、") || "無") + "；同一專案可跨據點。</div>" +
        list.map((a) => '<div class="zrow act"><span><b>' + esc(a.name) + "</b> " + esc(a.code.slice(-6)) + '<br><span class="small">' + esc(a.site) + " " + esc(a.zone) + " · " + esc(a.owner) + " · " + esc(a.status) + '</span></span><button class="pill sm" data-a="ajump" data-v="' + esc(a.code) + '">處理</button><span class="small">' + esc((a.project || D.UNASSIGNED).replace("（測試）", "")) + "</span></div>").join("") + "</div>";
    }
    const tiles = '<div class="' + (isPhone ? "tiles two" : "dtiles") + '">' +
      '<button class="tile tb' + (metric === "total" ? " sel" : "") + '" data-a="metric" data-v="total"><b>' + sum.t + "</b>設備總數</button>" +
      '<button class="tile tb' + (metric === "done" ? " sel" : "") + '" data-a="metric" data-v="done"><b>' + (sum.t ? Math.round((sum.d / sum.t) * 100) : 0) + "%</b>已盤點（" + sum.d + "）</button>" +
      '<button class="tile tb' + (metric === "todo" ? " sel" : "") + '" data-a="metric" data-v="todo"><b>' + (sum.t - sum.d) + "</b>未盤到</button>" +
      '<button class="tile tb' + (metric === "zone" ? " sel" : "") + '" data-a="metric" data-v="zone"><b>' + sum.z + "</b>位置不符</button></div>";
    const stChips = '<div class="lbl sim">設備狀態篩選（和盤點是兩回事）</div><div class="chips">' +
      '<button class="pill sm' + (dst === "" ? " on" : "") + '" data-a="dst" data-v="">全部</button>' +
      D.STATUSES.map((st) => '<button class="pill sm' + (dst === st ? " on" : "") + '" data-a="dst" data-v="' + esc(st) + '">' + esc(st) + " " + stCount(st) + "</button>").join("") + "</div>";

    return attentionCard() + tiles + drill + siteTable(rows, sorted, isPhone) + stChips + projTable(pfilter) + projDrill;
  }
  function projTable(pfilter) {
    const head = '<div class="lbl sim">各專案使用概況（按專案反查設備，和實際放置地點、保管人分開；專案名為虛構測試）</div>';
    const rowsHtml = projects().map((p) => {
      const list = projAssets(p);
      const use = list.filter((a) => a.status === "使用中").length;
      const repair = list.filter((a) => a.status === "待修" || a.status === "維修中").length;
      const where = [...new Set(list.map((a) => a.site))].join("、");
      return '<button class="prow' + (pfilter === p ? " sel" : "") + '" data-a="pfilter" data-v="' + esc(p) + '">' +
        '<span class="pn">' + esc(p.replace("（測試）", "")) + '</span><span>' + list.length + " 台</span>" +
        '<span>使用中 ' + use + '</span><span class="' + (repair ? "pbad" : "") + '">' + (repair ? "待修/維修 " + repair : "—") + '</span>' +
        '<span class="small">' + esc(where) + "</span></button>";
    }).join("");
    return head + '<div class="ptable">' + rowsHtml + "</div>" +
      (pfilter ? '<div class="chips" style="margin-top:6px"><button class="pill sm" data-a="pfilter" data-v="">清除專案篩選</button></div>' : "");
  }
  function siteTable(rows, sorted, isPhone) {
    const mlabel = { total: "依設備數排序", done: "依盤點進度排序", todo: "依未盤到排序", zone: "依位置不符排序" }[S.metric];
    if (isPhone) {
      return '<div class="lbl sim">各據點 · ' + mlabel + " · 點開看明細</div>" + sorted.map((r) =>
        '<div class="srow"><button class="shead" data-a="dsite" data-v="' + esc(r.n) + '"><span class="sname">' + esc(r.n) + '</span><span class="spct">' + r.pct + '%</span><span class="bar"><i style="width:' + r.pct + '%"></i></span><span class="smeta">已盤 ' + r.done + "/" + r.t + " · 未盤 " + r.left + " · 不符 " + r.z + "</span></button>" +
        (S.dsite === r.n ? '<div class="sdet"><div class="lbl">狀態分布</div><div class="smeta">' + D.STATUSES.map((st) => esc(st) + " " + assets().filter((a) => a.site === r.n && a.status === st).length).join(" · ") + '</div><button class="pill sm" data-a="gosite" data-v="' + esc(r.n) + '">去盤點' + esc(r.n) + "</button></div>" : "") + "</div>").join("");
    }
    return '<div class="lbl sim">各據點盤點進度 · ' + mlabel + " · 最沒進度的排前面</div>" +
      '<div class="scards">' + sorted.map((r) => {
        const worst = r.left > 0;
        return '<div class="scard"><div class="sct"><b>' + esc(r.n) + "</b><span class=\"spct\">" + r.pct + "%</span></div>" +
          '<span class="bar"><i style="width:' + r.pct + '%"></i></span>' +
          '<div class="smeta">已盤 ' + r.done + "/" + r.t + (worst ? ' · <b class="pbad">未盤 ' + r.left + "</b>" : " · 全部盤完") + (r.z ? ' · <b class="pbad">不符 ' + r.z + "</b>" : "") + "</div>" +
          '<div class="smeta">' + D.STATUSES.map((st) => esc(st) + " " + assets().filter((a) => a.site === r.n && a.status === st).length).join(" · ") + "</div>" +
          '<div class="scact"><button class="pill sm" data-a="sitelist" data-v="' + esc(r.n) + '">看設備</button>' +
          (worst ? '<button class="pill sm" data-a="gositepc" data-v="' + esc(r.n) + '">去盤點</button>' : "") + "</div></div>";
      }).join("") + "</div>" +
      '<p class="small">正式版會用試算表的「最後盤點時間」和「登記區域」計算，並可匯出報表。</p>';
  }

  /* ---- 電腦端 ---- */
  function pcDash() {
    const rows = siteRows();
    const sum = rows.reduce((a, r) => ({ t: a.t + r.t, d: a.d + r.done, z: a.z + r.z }), { t: 0, d: 0, z: 0 });
    const sorted = [...rows].sort((a, b) => S.metric === "todo" ? b.left - a.left : S.metric === "zone" ? b.z - a.z : S.metric === "done" ? b.pct - a.pct : b.t - a.t);
    return '<h3 class="ptitle">總覽儀表板</h3><p class="psub">由本頁測試資料即時計算，不是公司實際資料。</p>' + dashBody(rows, sum, sorted, false);
  }
  function pcAssets() {
    if (!S.asite) S.asite = siteNames()[0] || "";
    const list = assets().filter((a) => a.site === S.asite)
      .filter((a) => !S.afOrigin || originOf(a) === S.afOrigin)
      .filter((a) => !S.afBrand || brandOf(a) === S.afBrand)
      .filter((a) => !S.afType || (a.type || "未分類") === S.afType)
      .filter((a) => {
        if (!S.ageFilter) return true;
        const g = assetAge(a, S.ageBasis);
        return S.ageFilter === "aged" ? (g !== null && g >= (S.ageThreshold || AGE_THRESHOLD_DEFAULT)) : g === null;
      });
    const zones = zonesOf(S.asite);
    return '<h3 class="ptitle">設備資料</h3><p class="psub">編輯保管人、區域、設備狀態、歸屬專案、序號與日期。儲存只更新這個瀏覽器的測試資料，不會寫回試算表。</p>' +
      (S.retTab ? '<div class="chips"><button class="pill sm" data-a="back">← 回' + ({ dash: "儀表板", map: "位置圖", diff: "盤點差異" }[S.retTab] || "上一頁") + "</button></div>" : "") +
      '<div class="chips">' + siteNames().map((p) => '<button class="pill sm' + (S.asite === p ? " on" : "") + '" data-a="asite" data-v="' + esc(p) + '">' + esc(p) + "</button>").join("") + "</div>" +
      '<div class="chips"><span class="lbl" style="align-self:center">產地</span>' +
      '<button class="pill sm' + (S.afOrigin === "" ? " on" : "") + '" data-a="aforigin" data-v="">全部</button>' +
      distinctOrigins().map((o) => '<button class="pill sm' + (S.afOrigin === o ? " on" : "") + '" data-a="aforigin" data-v="' + esc(o) + '">' + esc(o) + "</button>").join("") + "</div>" +
      '<div class="chips"><span class="lbl" style="align-self:center">品牌</span>' +
      '<button class="pill sm' + (S.afBrand === "" ? " on" : "") + '" data-a="afbrand" data-v="">全部</button>' +
      distinctBrands().map((b) => '<button class="pill sm' + (S.afBrand === b ? " on" : "") + '" data-a="afbrand" data-v="' + esc(b) + '">' + esc(b) + "</button>").join("") + "</div>" +
      '<div class="chips"><span class="lbl" style="align-self:center">產品類型</span>' +
      '<button class="pill sm' + (S.afType === "" ? " on" : "") + '" data-a="aftype" data-v="">全部</button>' +
      [...new Set(assets().map((a) => a.type || "未分類"))].map((t) => '<button class="pill sm' + (S.afType === t ? " on" : "") + '" data-a="aftype" data-v="' + esc(t) + '">' + esc(t) + "</button>").join("") + "</div>" +
      '<p class="small">產品類型（耳機/話機/PC/NB…可新增）和品牌、型號分開記，能交叉篩選。產地是製造產地，和品牌所屬國、廠商所在地分開記；逐台保留，沒資料列「未確認」，不由品牌推斷。' + (S.afOrigin || S.afBrand || S.afType ? "目前篩出 " + list.length + " 台。" : "") + "</p>" +
      '<div class="chips"><span class="lbl" style="align-self:center">年限</span>' +
      '<button class="pill sm' + (S.ageFilter === "" ? " on" : "") + '" data-a="agefilter" data-v="">全部</button>' +
      '<button class="pill sm' + (S.ageFilter === "aged" ? " on" : "") + '" data-a="agefilter" data-v="aged">屆齡</button>' +
      '<button class="pill sm' + (S.ageFilter === "unknown" ? " on" : "") + '" data-a="agefilter" data-v="unknown">年限未確認</button>' +
      '<select class="inp sm" data-f="ageBasis" style="min-height:36px">' +
      [["purchase", "從購入日算"], ["activate", "從啟用日算"], ["mfgYear", "從製造年份算"]].map((o) => '<option value="' + o[0] + '"' + (S.ageBasis === o[0] ? " selected" : "") + ">" + o[1] + "</option>").join("") + "</select>" +
      '<input class="inp sm" type="number" min="1" max="30" data-f="ageThreshold" value="' + (S.ageThreshold || AGE_THRESHOLD_DEFAULT) + '" style="width:64px;min-height:36px"><span class="lbl" style="align-self:center">年（待確認，不是公司正式規定）</span></div>' +
      (S.ageFilter === "aged" ? '<p class="small">屆齡評估清單 ' + list.length + ' 台：滿 ' + (S.ageThreshold || AGE_THRESHOLD_DEFAULT) + ' 年只列入評估，不會自動改狀態或報廢；實際淘汰由你決定。</p>' : "") +
      '<div class="dtable"><div class="atr head"><span>登記編號</span><span>名稱 / 型號 / S/N</span><span>歸屬專案</span><span class="opt">保管人</span><span class="opt">區域</span><span>狀態</span><span></span></div>' +
      list.map((a) => {
        const lr = lastRecordOf(a.code);
        let row = '<button class="atr arow" data-a="edit" data-v="' + esc(a.code) + '"><span class="icode">' + esc(a.code) + "</span>" +
          "<span>" + esc(a.name) + ' <span class="small">' + esc(a.model) + " · S/N " + esc(a.serial || "未登記") + " · " + esc(brandOf(a)) + " · 產地 " + esc(originOf(a)) + (a.po ? " · PO " + esc(a.po) : "") + "</span>" + (a.__edited ? '<span class="dbadge"> 已修改（此瀏覽器）</span>' : "") + (S.savedAt === a.code ? '<span class="dbadge"> ✓已儲存</span>' : "") + "</span>" +
          "<span>" + esc((a.project || D.UNASSIGNED).replace("（測試）", "")) + '</span><span class="opt">' + esc(a.owner) + '</span><span class="opt">' + esc(a.zone) + "</span><span>" + esc(a.status) + '</span><span class="small">' + (S.editCode === a.code ? "收合" : "編輯") + "</span></button>";
        if (S.editCode === a.code && S.editDraft) {
          const d = S.editDraft;
          row += '<div class="drawer">' +
            '<div class="frow"><span class="lbl">保管人</span><input class="inp" data-f="owner" value="' + esc(d.owner) + '"></div>' +
            '<div class="frow"><span class="lbl">區域</span><select class="inp" data-f="zone">' + zones.map((z) => '<option value="' + esc(z) + '"' + (d.zone === z ? " selected" : "") + ">" + esc(z) + "</option>").join("") + "</select></div>" +
            '<div class="frow"><span class="lbl">設備狀態</span><select class="inp" data-f="status">' + D.STATUSES.map((st) => '<option value="' + esc(st) + '"' + (d.status === st ? " selected" : "") + ">" + esc(st) + "</option>").join("") + "</select></div>" +
            '<div class="frow"><span class="lbl">歸屬專案</span><select class="inp" data-f="project">' + projects().map((p) => '<option value="' + esc(p) + '"' + ((d.project || D.UNASSIGNED) === p ? " selected" : "") + ">" + esc(p) + "</option>").join("") + "</select></div>" +
            '<div class="frow"><span class="lbl">設備序號</span><input class="inp" data-f="serial" value="' + esc(d.serial) + '" placeholder="S/N，可留空"></div>' +
            '<div class="frow"><span class="lbl">品牌</span><input class="inp" data-f="brand" value="' + esc(d.brand || "") + '" placeholder="品牌，可留空"></div>' +
            '<div class="frow"><span class="lbl">產地</span><input class="inp" data-f="origin" value="' + esc(d.origin || "") + '" placeholder="製造產地；沒資料留「未確認」，不要依品牌猜"></div>' +
            '<div class="frow"><span class="lbl">產品類型</span><input class="inp" data-f="type" value="' + esc(d.type || "") + '" placeholder="耳機/話機/PC/NB…可新增分類"></div>' +
            '<div class="frow"><span class="lbl">PO 編號</span><input class="inp" data-f="po" value="' + esc(d.po || "") + '" placeholder="採購編號，可回查到貨批次"></div>' +
            '<div class="frow"><span class="lbl">製造年份</span><input class="inp" data-f="mfgYear" value="' + esc(d.mfgYear || "") + '" placeholder="如 2023；和購入日、啟用日分開"></div>' +
            '<div class="frow"><span class="lbl">購入日期</span><input class="inp" type="date" data-f="purchase" value="' + esc(d.purchase) + '"></div>' +
            '<div class="frow"><span class="lbl">啟用日期</span><input class="inp" type="date" data-f="activate" value="' + esc(d.activate) + '"></div>' +
            '<div class="frow"><span class="lbl">保固到期</span><input class="inp" type="date" data-f="warranty" value="' + esc(d.warranty) + '"></div>' +
            '<div class="frow"><span class="lbl">最後盤點</span><span class="small">' + (lr ? esc(new Date(lr.at).toLocaleString("zh-TW", { hour12: false })) + "（由掃描紀錄帶出，不可手改）" : "尚未盤點") + "</span></div>" +
            '<div class="frow"><button class="btn mini" data-a="save">儲存（只存這個瀏覽器）</button><button class="pill sm" data-a="cancel">取消</button></div>' +
            '<div class="small">狀態改動是人工判斷（例如送修），手機掃描本身不會改狀態。歸屬專案和實際放置地點分開。序號、購入、啟用、保固到期都可留空；登記編號不等於設備序號。</div></div>';
        }
        return row;
      }).join("") + "</div>";
  }
  function pcZones() {
    return '<h3 class="ptitle">位置表</h3><p class="psub">維護各據點的區域和據點座標。座標讓手機用定位找最近據點；區域清單就是手機上「目前區域」的選項。正式版位置表會放在你的試算表。</p>' +
      sites().map((s) => '<div class="zcard"><div><b>' + esc(s.name) + '</b> <span class="small">座標 ' + s.lat.toFixed(4) + ", " + s.lon.toFixed(4) + "（測試值）</span></div>" +
        s.zones.map((z) => '<div class="zrow"><span>' + esc(z) + "</span><b>" + assets().filter((a) => a.site === s.name && a.zone === z).length + " 台</b></div>").join("") +
        '<div class="frow"><input class="inp" data-f="nz_' + esc(s.name) + '" placeholder="新增' + esc(s.name) + '的區域" value="' + esc(S.newZone[s.name] || "") + '"><button class="pill sm" data-a="addzone" data-v="' + esc(s.name) + '">加入</button></div>' +
        '<div class="small">加入後，手機端「目前區域」會出現這個選項。重新命名、停用區域是正式版的功能。</div></div>').join("");
  }
  function zoneAssets(site, zone) { return assets().filter((a) => a.site === site && a.zone === zone); }
  function demoPlanSvg(site, zones, sel) {
    /* 示意平面圖：依區域數自動排的假格局，只為示範「點位置帶出設備」。 */
    const cols = Math.min(3, zones.length) || 1, rows = Math.ceil(zones.length / cols) || 1;
    const W = 640, H = 120 * rows + 20, cw = (W - 20) / cols;
    let cells = "";
    zones.forEach((z, i) => {
      const cx = 10 + (i % cols) * cw, cy = 10 + Math.floor(i / cols) * 120;
      const on = sel === z;
      cells += '<g data-a="mapzone" data-v="' + esc(z) + '" style="cursor:pointer">' +
        '<rect x="' + cx + '" y="' + cy + '" width="' + (cw - 10) + '" height="110" rx="10" fill="' + (on ? "#e3f2ef" : "#fff") + '" stroke="' + (on ? "var(--ds-teal)" : "var(--ds-hairline)") + '" stroke-width="' + (on ? 2 : 1) + '"/>' +
        '<text x="' + (cx + 12) + '" y="' + (cy + 26) + '" font-size="13" font-weight="600" fill="var(--ds-ink)">' + esc(z) + "</text>" +
        '<text x="' + (cx + 12) + '" y="' + (cy + 46) + '" font-size="11" fill="var(--ds-ink-2)">' + zoneAssets(site, z).length + " 台設備</text></g>";
    });
    return '<svg viewBox="0 0 ' + W + " " + H + '" style="width:100%;max-width:720px;border:1px solid var(--ds-hairline);border-radius:12px;background:#fafafa">' + cells + "</svg>";
  }
  function pcMap() {
    if (!S.mapSite) S.mapSite = siteNames()[0] || "";
    const zones = zonesOf(S.mapSite);
    const marks = getMarks()[S.mapSite] || {};
    const sel = S.mapZone;
    const selAssets = sel ? zoneAssets(S.mapSite, sel) : [];
    let canvas;
    if (S.mapImg) {
      canvas = '<div style="position:relative;max-width:720px"><img src="' + S.mapImg + '" style="width:100%;border:1px solid var(--ds-hairline);border-radius:12px;display:block" data-a="mapimg" alt="位置圖（本機預覽）">' +
        zones.filter((z) => marks[z]).map((z) =>
          '<button class="pill sm" data-a="mapzone" data-v="' + esc(z) + '" style="position:absolute;left:' + marks[z].x + "%;top:" + marks[z].y + "%;transform:translate(-50%,-50%);min-height:32px;background:" + (sel === z ? "var(--ds-teal);color:#fff;border-color:var(--ds-teal)" : "#fff") + '">' + esc(z) + "</button>").join("") + "</div>";
    } else {
      canvas = demoPlanSvg(S.mapSite, zones, sel);
    }
    return '<h3 class="ptitle">位置圖</h3>' +
      '<p class="psub">選據點、在圖上點一個位置，就帶出該位置的設備、歸屬專案與狀態。位置標記由人綁定到區域，不靠系統猜圖。設備清單仍讀同一份資料（正式版：你的 Google 試算表），圖裡不另存一套。</p>' +
      '<div class="chips">' + siteNames().map((p) => '<button class="pill sm' + (S.mapSite === p ? " on" : "") + '" data-a="mapsite" data-v="' + esc(p) + '">' + esc(p) + "</button>").join("") + "</div>" +
      '<div class="frow"><label class="pill sm" style="display:inline-flex;align-items:center;cursor:pointer">選擇圖檔（本機預覽）<input type="file" accept="image/*" data-f="mapfile" style="display:none"></label>' +
      (S.mapImg ? '<button class="pill sm" data-a="mapedit">' + (S.mapEdit ? "完成標記" : "標記位置") + '</button><button class="pill sm" data-a="mapclear">移除圖檔</button>' : "") + "</div>" +
      (S.mapImg
        ? '<div class="small">圖檔只在這個瀏覽器這次開啟期間預覽，<b>沒有上傳</b>；正式上傳需要私有儲存位置（不放公開網站），之後依你提供的儲存方式處理。' + (S.mapEdit ? '標記模式：先在下方選一個區域，再點圖上的位置。' : "") + "</div>"
        : '<div class="small">目前顯示自動產生的<b>示意平面圖</b>（不是實際格局）。上傳你的位置圖後，可改用實際圖面標記。</div>') +
      (S.mapEdit && S.mapImg ? '<div class="chips">' + zones.map((z) => '<button class="pill sm' + (sel === z ? " on" : "") + '" data-a="mapzone" data-v="' + esc(z) + '">' + esc(z) + (marks[z] ? " ✓" : "") + "</button>").join("") + "</div>" : "") +
      canvas +
      (sel ? '<div class="card"><div class="lbl">' + esc(S.mapSite) + " · " + esc(sel) + " 的設備（" + selAssets.length + " 台）</div>" +
        (selAssets.length === 0 ? '<div class="small">這個位置目前沒有登記設備。</div>' :
          selAssets.map((a) => '<div class="zrow act"><span><b>' + esc(a.name) + "</b> " + esc(a.code.slice(-6)) + '<br><span class="small">S/N ' + esc(a.serial || "未登記") + " · " + esc(a.status) + " · 保管人 " + esc(a.owner) + " · 歸屬 " + esc((a.project || D.UNASSIGNED).replace("（測試）", "")) + '</span></span><button class="pill sm" data-a="ajump" data-v="' + esc(a.code) + '">處理</button></div>').join("")) + "</div>"
        : '<div class="small">點圖上任一位置，帶出該位置的設備資料。</div>');
  }
  /* ---- 入庫作業：整批建單（待入庫，不影響庫存）→ 到貨核對（手機）→ 確認入庫（此時才建設備）---- */
  function pcInbound() {
    const bs = batches().slice().reverse();
    const nb = S.nb || (S.nb = { po: "", vendor: "", brand: "", model: "", origin: "", mfgYear: "", type: "", note: "", serials: "" });
    let html = '<h3 class="ptitle">入庫作業</h3><p class="psub">廠商序號清單先建成「待入庫」批次，不增加庫存；實物到貨逐台核對後確認入庫，才產生內部登記編號並列入設備與應盤。測試資料只存在此瀏覽器。</p>';
    // 建單
    html += '<div class="card"><div class="lbl">建立進貨批次（貼上廠商給的序號清單，每行一筆）</div>' +
      '<div class="frow"><span class="lbl">PO 編號</span><input class="inp" data-f="nb_po" value="' + esc(nb.po) + '" placeholder="採購編號；同一筆採購分批到貨用同一個"></div>' +
      '<div class="frow"><span class="lbl">廠商</span><input class="inp" data-f="nb_vendor" value="' + esc(nb.vendor) + '" placeholder="廠商名稱（測試）"></div>' +
      '<div class="frow"><span class="lbl">品牌</span><input class="inp" data-f="nb_brand" value="' + esc(nb.brand) + '" placeholder="品牌"></div>' +
      '<div class="frow"><span class="lbl">型號</span><input class="inp" data-f="nb_model" value="' + esc(nb.model) + '" placeholder="型號"></div>' +
      '<div class="frow"><span class="lbl">產地</span><input class="inp" data-f="nb_origin" value="' + esc(nb.origin) + '" placeholder="製造產地；沒資料留空會記「未確認」"></div>' +
      '<div class="frow"><span class="lbl">產品類型</span><input class="inp" data-f="nb_type" value="' + esc(nb.type) + '" placeholder="耳機/話機/PC/NB…可新增分類"></div>' +
      '<div class="frow"><span class="lbl">製造年份</span><input class="inp" data-f="nb_mfgYear" value="' + esc(nb.mfgYear) + '" placeholder="如 2025，可留空"></div>' +
      '<div class="frow"><span class="lbl">序號清單</span><textarea class="inp" data-f="nb_serials" rows="4" placeholder="每行一筆廠商序號">' + esc(nb.serials) + '</textarea></div>' +
      '<div class="frow"><span class="lbl">備註</span><input class="inp" data-f="nb_note" value="' + esc(nb.note) + '" placeholder="可留空"></div>' +
      '<button class="btn" data-a="nbcreate">建立待入庫批次</button>' + (S.nbNote ? '<div class="toast t-none" style="margin-top:8px">' + esc(S.nbNote) + "</div>" : "") + '</div>';
    // 批次列表
    if (!bs.length) html += '<div class="toast idle" style="margin-top:10px">還沒有進貨批次。</div>';
    html += bs.map((b) => {
      const pend = b.items.filter((x) => x.state === "pending").length;
      const got = b.items.filter((x) => x.state === "received").length;
      const inb = b.items.filter((x) => x.state === "inbound").length;
      const open = S.ibOpen === b.id;
      let card = '<div class="card" style="margin-top:10px"><div class="sct"><b>' + (b.po ? "PO " + esc(b.po) + " · " : "") + esc(b.vendor || "未填廠商") + " · " + esc(b.model || "未填型號") + "</b><span class='small'>" + esc(new Date(b.at).toLocaleString("zh-TW", { hour12: false })) + "</span></div>" +
        '<div class="smeta">' + esc(b.brand || "未填品牌") + " · 產地 " + esc(b.origin) + (b.mfgYear ? " · 製造年份 " + esc(b.mfgYear) : "") + (b.note ? " · " + esc(b.note) : "") + "</div>" +
        '<span class="bar"><i style="width:' + (b.items.length ? Math.round(((got + inb) / b.items.length) * 100) : 0) + '%"></i></span>' +
        '<div class="smeta">清單 ' + b.items.length + " 台 · 待收 " + pend + " · 已核對待入庫 " + got + " · 已入庫 " + inb + (b.unexpected.length ? ' · <b class="pbad">清單外 ' + b.unexpected.length + " 筆</b>" : "") + (b.closed ? " · 全部入庫完成" : "") + "</div>" +
        '<div class="scact"><button class="pill sm" data-a="ibopen" data-v="' + esc(b.id) + '">' + (open ? "收合明細" : "看明細") + "</button>" +
        (pend || got ? '<button class="pill sm" data-a="gorecv" data-v="' + esc(b.id) + '">手機到貨核對</button>' : "") +
        (got ? '<button class="pill sm" data-a="ibconfirm" data-v="' + esc(b.id) + '">確認入庫 ' + got + " 台</button>" : "") + "</div>";
      if (open) {
        card += '<div class="dtable" style="margin-top:8px">' + b.items.map((x) =>
          '<div class="zrow"><span>' + esc(x.serial) + (x.code ? " → " + esc(x.code) : "") + '</span><span class="small">' + ({ pending: "待收", received: "已核對", inbound: "已入庫", conflict: "序號已在清冊，未重複建立" })[x.state] + "</span></div>").join("") +
          (b.unexpected.length ? '<div class="lbl sim">清單外掃到（不會自動入庫）</div>' + b.unexpected.map((u) => '<div class="zrow"><span>' + esc(u.serial) + '</span><span class="small">清單外' + (u.n > 1 ? " ×" + u.n : "") + "</span></div>").join("") : "") + "</div>";
      }
      if (S.ibConfirm === b.id) {
        const dr = S.ibDraft || (S.ibDraft = { site: siteNames()[0], zone: zonesOf(siteNames()[0])[0] || "", project: D.UNASSIGNED, owner: "公用" });
        card += '<div class="card" style="margin-top:8px;background:var(--ds-raised)"><div class="lbl">確認入庫 ' + got + ' 台：建立內部登記編號，狀態「備用」</div>' +
          '<div class="frow"><span class="lbl">入庫據點</span><select class="inp" data-f="ibd_site">' + siteNames().map((s) => '<option value="' + esc(s) + '"' + (dr.site === s ? " selected" : "") + ">" + esc(s) + "</option>").join("") + "</select></div>" +
          '<div class="frow"><span class="lbl">區域</span><select class="inp" data-f="ibd_zone">' + zonesOf(dr.site).map((z) => '<option value="' + esc(z) + '"' + (dr.zone === z ? " selected" : "") + ">" + esc(z) + "</option>").join("") + "</select></div>" +
          '<div class="frow"><span class="lbl">歸屬專案</span><select class="inp" data-f="ibd_project">' + projects().map((p) => '<option value="' + esc(p) + '"' + (dr.project === p ? " selected" : "") + ">" + esc(p) + "</option>").join("") + "</select></div>" +
          '<div class="frow"><span class="lbl">保管人</span><input class="inp" data-f="ibd_owner" value="' + esc(dr.owner) + '"></div>' +
          '<button class="btn" data-a="ibdo" data-v="' + esc(b.id) + '">建立 ' + got + ' 台設備並入庫</button>' +
          '<button class="btn secondary" data-a="ibconfirm" data-v="' + esc(b.id) + '">取消</button></div>';
      }
      if (S.ibDone && S.ibDone[b.id]) {
        card += '<div class="toast t-ok" style="margin-top:8px">已入庫 ' + S.ibDone[b.id].length + " 台：" + S.ibDone[b.id].map((a) => esc(a.code)).join("、") + "。到「設備資料」可繼續編輯。</div>";
      }
      return card + "</div>";
    }).join("");
    return html;
  }
  /* ---- 手機到貨核對 ---- */
  function phoneRecv() {
    const obs = openBatches();
    if (!S.recvBatch || !obs.some((b) => b.id === S.recvBatch)) S.recvBatch = obs.length ? obs[0].id : "";
    const b = S.recvBatch ? store.batch(S.recvBatch) : null;
    if (!b) return '<div class="screen"><h3 class="ptitle">到貨核對</h3><p class="psub">還沒有待入庫批次。先在「電腦 · 入庫作業」貼上廠商序號清單建立批次。</p><button class="btn" data-a="goinbound">到電腦建立批次</button></div>';
    const pend = b.items.filter((x) => x.state === "pending");
    const got = b.items.filter((x) => x.state === "received").length;
    const last = S.recvLast;
    const toast = last
      ? '<div class="toast t-' + (last.result === "ok" ? "ok" : last.result === "dup" ? "dup" : "none") + '">' +
        ({ ok: "✓ 核對相符", dup: "＝ 重複掃描", unexpected: "≠ 清單外", exists: "≠ 已在設備清冊", empty: "請輸入序號", nobatch: "找不到批次" })[last.result] +
        '<div class="tname">' + esc(last.serial) + "</div>" +
        '<div class="tloc">' + ({ ok: "已記為到貨，待確認入庫。", dup: "這筆序號之前已核對過，不重複計。", unexpected: "不在這批清單內，已另列，不會自動入庫。", exists: "這個序號已經是正式設備（" + esc((last.asset || {}).code || "") + "），不再入庫。" })[last.result] + "</div></div>"
      : '<div class="toast idle">輸入或掃描設備上的廠商序號開始核對。分批到貨沒問題：核對幾台就記幾台。</div>';
    return '<div class="screen"><h3 class="ptitle">到貨核對</h3>' +
      '<p class="psub">' + esc(b.vendor || "未填廠商") + " · " + esc(b.brand || "") + " " + esc(b.model || "") + " · 產地 " + esc(b.origin) + "</p>" +
      (obs.length > 1 ? '<div class="chips">' + obs.map((x) => '<button class="pill' + (S.recvBatch === x.id ? " on" : "") + '" data-a="recvbatch" data-v="' + esc(x.id) + '">' + esc(x.vendor || x.model || "批次") + "</button>").join("") + "</div>" : "") +
      '<div class="scope"><div class="sct"><span>核對進度</span><span>' + got + " / " + b.items.length + "</span></div>" +
      '<span class="bar"><i style="width:' + (b.items.length ? Math.round((got / b.items.length) * 100) : 0) + '%"></i></span>' +
      '<div class="smeta">待收 ' + pend.length + " · 已核對 " + got + (b.unexpected.length ? ' · <b class="pbad">清單外 ' + b.unexpected.length + "</b>" : "") + "</div>" +
      (pend.length ? '<div class="smeta">還沒到：' + pend.slice(0, 6).map((x) => esc(x.serial)).join("、") + (pend.length > 6 ? " …等 " + pend.length + " 筆" : "") + "</div>" : "") + "</div>" +
      toast +
      '<div class="frow"><input class="inp" data-f="recvCode" placeholder="輸入廠商序號" value="' + esc(S.recvCode) + '"><button class="btn mini" data-a="recvscan">核對</button></div>' +
      '<div class="lbl sim">測試用：模擬掃到</div><div class="chips">' +
      (pend.length ? '<button class="pill sm" data-a="recvtest" data-v="' + esc(pend[0].serial) + '">清單內序號</button>' : "") +
      (got ? '<button class="pill sm" data-a="recvtest" data-v="' + esc(b.items.find((x) => x.state === "received").serial) + '">重複掃已核對</button>' : "") +
      '<button class="pill sm" data-a="recvtest" data-v="SN-NOT-IN-LIST">清單外序號</button>' +
      '<button class="pill sm" data-a="recvtest" data-v="YK-T46U-107030182">已在清冊的序號</button></div>' +
      '<div class="hand">核對完到「電腦 · 入庫作業」確認入庫，才會產生登記編號並列入設備。</div>' +
      '<button class="btn" data-a="goinbound" data-v="' + esc(b.id) + '">到電腦確認入庫</button></div>';
  }

  function pcDiff() {
    const recs = allRecords().filter((r) => r.status !== "ok").slice().reverse();
    const todoN = recs.filter((r) => !r.decision).length;
    return '<h3 class="ptitle">盤點差異</h3><p class="psub">手機掃完的差異在這裡逐筆決定。決定只記在這個瀏覽器，「寫回試算表」不會執行。</p>' +
      '<div class="lbl sim">累計掃描差異（所有場次，新→舊）：' + recs.length + " 筆 · 待處理 " + todoN + "</div>" +
      (recs.length === 0 ? '<div class="toast idle">還沒有掃描紀錄。到「手機 · 現場掃描」掃幾筆，差異會出現在這裡（同一瀏覽器）。</div>' :
        recs.map((r) => {
          const a = getA(r.code);
          return '<div class="item static">' + chip(r.status) + '<span class="iname">' + esc(a ? a.name : r.code) + '</span><span class="icode">' + esc(r.code.slice(-6)) + "</span>" +
            '<span class="idet">' + (a ? esc(a.status) + " · S/N " + esc(a.serial || "未登記") + " · 歸屬 " + esc(a.project || D.UNASSIGNED) + " · 登記 " + esc(a.site) + " " + esc(a.zone) + " → 現場 " + esc(r.sessionSite) + " " + esc(r.zone) : "清冊查無，需補登") + (r.projMismatch ? " · 歸屬專案與該場次範圍不同（未改歸屬）" : "") + " · " + esc(new Date(r.at).toLocaleString("zh-TW", { hour12: false })) + "</span>" +
            decisionButtons(r) + "</div>";
        }).join("")) +
      '<button class="btn secondary" disabled style="margin-top:8px">寫回試算表（正式版功能，待接入你的表格）</button>';
  }
  function pcView() {
    const tab = S.dtab;
    const body = tab === "dash" ? pcDash() : tab === "assets" ? pcAssets() : tab === "inbound" ? pcInbound() : tab === "zones" ? pcZones() : tab === "map" ? pcMap() : pcDiff();
    const recs = curRecs();
    const diffN = allRecords().filter((r) => r.status !== "ok" && !r.decision).length;
    return '<div class="desktop"><div class="dbody"><nav class="dside"><div class="dlogo">諸葛 · 設備管理</div>' +
      '<button class="dnav' + (tab === "dash" ? " on" : "") + '" data-a="dtab" data-v="dash">總覽儀表板</button>' +
      '<button class="dnav' + (tab === "assets" ? " on" : "") + '" data-a="dtab" data-v="assets">設備資料</button>' +
      '<button class="dnav' + (tab === "inbound" ? " on" : "") + '" data-a="dtab" data-v="inbound">入庫作業' + (openBatches().length ? " (" + openBatches().length + ")" : "") + '</button>' +
      '<button class="dnav' + (tab === "zones" ? " on" : "") + '" data-a="dtab" data-v="zones">位置表</button>' +
      '<button class="dnav' + (tab === "map" ? " on" : "") + '" data-a="dtab" data-v="map">位置圖</button>' +
      '<button class="dnav' + (tab === "diff" ? " on" : "") + '" data-a="dtab" data-v="diff">盤點差異' + (diffN > 0 ? " (" + diffN + ")" : "") + "</button></nav>" +
      '<div class="dmain"><div class="dhand">' + (recs.length > 0
        ? "手機在 <b>" + esc(S.site) + "</b> 掃了 " + recs.length + " 筆（" + esc(new Date(S.sess.at).toLocaleTimeString("zh-TW", { hour12: false })) + " 起，同一瀏覽器）。差異已帶到「盤點差異」。"
        : "還沒有手機掃描紀錄。切到上方「手機 · 現場掃描」掃幾筆，這裡會接著顯示（同一瀏覽器）。") + "</div>" + body + "</div></div></div>";
  }

  /* ---- 渲染 ---- */
  function render() {
    if ((S.mode !== "phone" || S.screen !== "scan" || S.dash) && S.camOn) camStop(true);
    const root = document.getElementById("erp-root");
    let html = zhugeBar() + loginBar() + mockBar() + modeBar();
    if (S.mode === "phone") {
      let body;
      if (S.dash) body = phoneDash();
      else if (S.screen === "recv") body = phoneRecv();
      else if (S.screen === "start") body = phoneStart();
      else if (S.screen === "scan") body = phoneScan();
      else body = phoneResult();
      html += '<div class="phone">' + body + '<div class="tabbar"><button class="' + (!S.dash ? "on" : "") + '" data-a="tab" data-v="scan">盤點</button><button class="' + (S.dash ? "on" : "") + '" data-a="tab" data-v="dash">儀表板</button></div></div>';
    } else {
      html += pcView();
    }
    root.innerHTML = html;
    afterRender();
  }

  /* ---- 事件 ---- */
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-a]");
    if (!t) return;
    const a = t.getAttribute("data-a"), v = t.getAttribute("data-v") || "";
    if (a === "mode") { S.mode = v; }
    else if (a === "tab") { S.dash = v === "dash"; }
    else if (a === "site") { S.site = v; }
    else if (a === "gps") { detectGps(); return; }
    else if (a === "start") { startSession(); return; }
    else if (a === "zoneopen") { S.zoneOpen = !S.zoneOpen; }
    else if (a === "zone") { S.zone = v; S.zoneOpen = false; }
    else if (a === "scan") { scan(v); return; }
    else if (a === "camstart") { camStart(); return; }
    else if (a === "camstop") { camStop(); return; }
    else if (a === "manual") { scan(S.manualCode); S.manualCode = ""; return; }
    else if (a === "open") { S.open = S.open === v ? "" : v; }
    else if (a === "toresult") { S.screen = "result"; }
    else if (a === "tostart") { S.screen = "start"; }
    else if (a === "filter") { S.filter = v; }
    else if (a === "metric") { S.metric = v; }
    else if (a === "dsite") { S.dsite = S.dsite === v ? "" : v; }
    else if (a === "dst") { S.dst = v; }
    else if (a === "pfilter") { S.pfilter = S.pfilter === v ? "" : v; }
    else if (a === "dtab") { S.dtab = v; S.editCode = ""; S.editDraft = null; S.retTab = ""; }
    else if (a === "ajump") {
      const x = getA(v); if (!x) return;
      S.retTab = S.dtab; S.mode = "pc"; S.dash = false;
      S.dtab = "assets"; S.asite = x.site;
      S.editCode = v;
      S.editDraft = { owner: x.owner, zone: x.zone, status: x.status, project: x.project || D.UNASSIGNED, serial: x.serial, purchase: x.purchase, activate: x.activate, warranty: x.warranty, brand: x.brand || "", origin: x.origin || "", mfgYear: x.mfgYear || "", type: x.type || "", po: x.po || "" };
    }
    else if (a === "back") { S.dtab = S.retTab || "dash"; S.retTab = ""; S.editCode = ""; S.editDraft = null; }
    else if (a === "godiff") { S.mode = "pc"; S.dash = false; S.dtab = "diff"; }
    else if (a === "sitelist") { S.mode = "pc"; S.dash = false; S.asite = v; S.dtab = "assets"; S.retTab = "dash"; S.editCode = ""; S.editDraft = null; }
    else if (a === "gositepc") { S.mode = "phone"; S.dash = false; S.site = v; S.screen = "start"; }
    else if (a === "sproj") { S.scanProject = v; }
    else if (a === "asite") { S.asite = v; S.editCode = ""; S.editDraft = null; }
    else if (a === "gosite") { S.site = v; S.dash = false; S.screen = "start"; }
    else if (a === "edit") {
      if (S.editCode === v) { S.editCode = ""; S.editDraft = null; }
      else {
        const x = getA(v);
        S.editCode = v;
        S.editDraft = { owner: x.owner, zone: x.zone, status: x.status, project: x.project || D.UNASSIGNED, serial: x.serial, purchase: x.purchase, activate: x.activate, warranty: x.warranty, brand: x.brand || "", origin: x.origin || "", mfgYear: x.mfgYear || "", type: x.type || "", po: x.po || "" };
      }
    }
    else if (a === "cancel") { S.editCode = ""; S.editDraft = null; }
    else if (a === "save") {
      if (S.editCode && S.editDraft) {
        store.saveAsset(S.editCode, { ...S.editDraft });
        S.savedAt = S.editCode; S.editCode = ""; S.editDraft = null;
      }
    }
    else if (a === "addzone") {
      const val = (S.newZone[v] || "").trim();
      if (val) { store.addZone(v, val); S.newZone[v] = ""; }
    }
    else if (a === "mapsite") { S.mapSite = v; S.mapZone = ""; }
    else if (a === "mapzone") { S.mapZone = S.mapZone === v ? "" : v; }
    else if (a === "mapedit") { S.mapEdit = !S.mapEdit; }
    else if (a === "mapclear") { S.mapImg = ""; S.mapEdit = false; }
    else if (a === "mapimg") {
      if (S.mapEdit && S.mapZone) {
        const r = t.getBoundingClientRect();
        setMark(S.mapSite, S.mapZone, Math.round(((e.clientX - r.left) / r.width) * 1000) / 10, Math.round(((e.clientY - r.top) / r.height) * 1000) / 10);
      }
    }
    else if (a === "aforigin") { S.afOrigin = v; }
    else if (a === "afbrand") { S.afBrand = v; }
    else if (a === "aftype") { S.afType = v; }
    else if (a === "agefilter") { S.ageFilter = v; }
    else if (a === "goinbound") { S.mode = "pc"; S.dash = false; S.dtab = "inbound"; if (v) S.ibOpen = v; }
    else if (a === "nbcreate") {
      const nb = S.nb || {};
      const serials = String(nb.serials || "").split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (!serials.length) { S.nbNote = "請先貼上至少一筆序號（每行一筆）。"; }
      else {
        const b = store.addBatch({ po: nb.po, vendor: nb.vendor, brand: nb.brand, model: nb.model, origin: nb.origin, mfgYear: nb.mfgYear, type: nb.type, note: nb.note, serials });
        S.nb = { po: "", vendor: "", brand: "", model: "", origin: "", mfgYear: "", type: "", note: "", serials: "" }; S.nbNote = "";
        S.ibOpen = b.id; S.ibConfirm = ""; S.ibDraft = null;
      }
    }
    else if (a === "ibopen") { S.ibOpen = S.ibOpen === v ? "" : v; }
    else if (a === "ibconfirm") {
      if (S.ibConfirm === v) { S.ibConfirm = ""; S.ibDraft = null; }
      else {
        const b = store.batch(v); if (!b) return;
        S.ibConfirm = v; S.ibOpen = v;
        const s0 = siteNames()[0] || "";
        S.ibDraft = { site: s0, zone: zonesOf(s0)[0] || "", project: D.UNASSIGNED, owner: "公用" };
      }
    }
    else if (a === "ibdo") {
      const made = store.confirmInbound(v, S.ibDraft || {});
      if (made.length) {
        S.ibDone = S.ibDone || {}; S.ibDone[v] = made;
        S.ibConfirm = ""; S.ibDraft = null; S.ibOpen = v;
      }
    }
    else if (a === "gorecv") { S.mode = "phone"; S.screen = "recv"; S.recvBatch = v; S.recvLast = null; }
    else if (a === "recvbatch") { S.recvBatch = v; S.recvLast = null; }
    else if (a === "recvscan") {
      const r = store.receiveSerial(S.recvBatch, S.recvCode);
      S.recvLast = { serial: String(S.recvCode || "").trim(), result: r.result, asset: r.asset || null };
      S.recvCode = "";
    }
    else if (a === "recvtest") {
      const r = store.receiveSerial(S.recvBatch, v);
      S.recvLast = { serial: v, result: r.result, asset: r.asset || null };
    }
    else if (a === "decide") {
      if (S.sess) store.decide(S.sess.id, v, t.getAttribute("data-d"));
      else {
        const r = allRecords().find((x) => x.code === v && !x.decision);
        if (r) store.decide(r.sessionId, v, t.getAttribute("data-d"));
      }
    }
    render();
  });
  document.addEventListener("input", (e) => {
    const f = e.target.getAttribute && e.target.getAttribute("data-f");
    if (!f) return;
    if (f === "manualCode") { S.manualCode = e.target.value; return; }
    if (f.indexOf("nz_") === 0) { S.newZone[f.slice(3)] = e.target.value; return; }
    if (f.indexOf("nb_") === 0) { S.nb = S.nb || {}; S.nb[f.slice(3)] = e.target.value; return; }
    if (f.indexOf("ibd_") === 0) { if (S.ibDraft) S.ibDraft[f.slice(4)] = e.target.value; return; }
    if (f === "recvCode") { S.recvCode = e.target.value; return; }
    if (f === "ageThreshold") { S.ageThreshold = Number(e.target.value) || AGE_THRESHOLD_DEFAULT; return; } /* 重繪在 change（blur/Enter/步進）時做，避免打字中斷焦點 */
    if (f === "ageBasis") { S.ageBasis = e.target.value; render(); return; }
    if (f === "ageThreshold") { S.ageThreshold = Number(e.target.value) || AGE_THRESHOLD_DEFAULT; render(); return; }
    if (S.editDraft && Object.prototype.hasOwnProperty.call(S.editDraft, f)) S.editDraft[f] = e.target.value;
  });
  document.addEventListener("change", (e) => {
    if (e.target.getAttribute && e.target.getAttribute("data-f") === "mapfile") {
      const file = e.target.files && e.target.files[0];
      if (file) { S.mapImg = URL.createObjectURL(file); S.mapZone = ""; render(); }
      return;
    }
    const f = e.target.getAttribute && e.target.getAttribute("data-f");
    if (f === "ageBasis") { S.ageBasis = e.target.value; render(); return; }
    if (f.indexOf("ibd_") === 0 && S.ibDraft) {
      S.ibDraft[f.slice(4)] = e.target.value;
      if (f === "ibd_site") S.ibDraft.zone = zonesOf(S.ibDraft.site)[0] || "";
      render(); return;
    }
    if (f && S.editDraft && Object.prototype.hasOwnProperty.call(S.editDraft, f)) S.editDraft[f] = e.target.value;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.getAttribute && e.target.getAttribute("data-f") === "manualCode") { scan(S.manualCode); S.manualCode = ""; render(); }
  });

  render();
})();
