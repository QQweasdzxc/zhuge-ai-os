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
    mapSite: "", mapZone: "", mapImg: "", mapEdit: false
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
  const projAssets = (p) => assets().filter((a) => (a.project || D.UNASSIGNED) === p);

  /* ---- 掃描 ---- */
  function scan(code) {
    code = String(code || "").trim();
    if (!code || !S.sess) return;
    const a = getA(code);
    const status = !a ? "none" : a.site !== S.site ? "site" : a.zone !== S.zone ? "zone" : "ok";
    store.addRecord(S.sess, { code, status, zone: S.zone, at: new Date().toISOString() });
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
      S.sess = store.startSession(S.site, g.lat, g.lon, g.acc != null ? g.acc : null);
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
      "</div>" +
      '<button class="btn" data-a="start"' + (S.site ? "" : " disabled") + ">開始連續掃描" + (S.site ? " · " + esc(S.site) : "") + "</button></div>";
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
        (r.status === "none" ? '<div class="tloc">先記下來，盤點後再補登。</div>' : "") + "</div>";
    } else {
      toast = '<div class="toast idle">還沒掃到東西。輸入登記編號，或點下面的測試按鈕模擬掃描。</div>';
    }
    return '<div class="screen">' +
      '<div class="scanbar"><button class="zonebtn" data-a="zoneopen"><span class="lbl">' + esc(S.site) + " · 目前區域</span><b>" + esc(S.zone) + " ▾</b></button>" +
      '<button class="btn mini" data-a="toresult">結束 (' + recs.length + ")</button></div>" +
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
      '<button class="pill sm" data-a="scan" data-v="CSXX999999999">不在清冊內的編號</button>' +
      (last ? '<button class="pill sm" data-a="scan" data-v="' + esc(last.code) + '">再掃同一個</button>' : "") + "</div>" +
      '<div class="lbl sim">本次已掃 ' + recs.length + " 筆</div>" +
      [...recs].reverse().map((r) => {
        const a = getA(r.code);
        return '<button class="item" data-a="open" data-v="' + esc(r.code) + '">' + chip(dupFlag(r)) +
          '<span class="iname">' + esc(a ? a.name : r.code) + '</span><span class="icode">' + esc(r.code.slice(-6)) + "</span>" +
          (S.open === r.code ? '<span class="idet">' + (a ? esc(a.model) + " · S/N " + esc(a.serial || "未登記") + " · 狀態 " + esc(a.status) + " · 保管人 " + esc(a.owner) + " · 歸屬 " + esc(a.project || D.UNASSIGNED) + " · 購入 " + esc(a.purchase || "未登記") + " · 啟用 " + esc(a.activate || "未登記") + " · 保固 " + esc(a.warranty || "未登記") + " · 登記 " + esc(a.site) + " " + esc(a.zone) : "清冊無此編號") + " · " + esc(new Date(r.at).toLocaleTimeString("zh-TW", { hour12: false })) + (r.n > 1 ? " · 已重複 " + r.n + " 次" : "") + "</span>" : "") + "</button>";
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
      '<div class="tiles"><div class="tile"><b>' + count("ok") + '</b>相符</div><div class="tile"><b>' + count("zone") + '</b>位置不符</div><div class="tile"><b>' + count("site") + '</b>異地</div><div class="tile"><b>' + count("none") + "</b>查無</div></div>" +
      (badStatus > 0 ? '<div class="warn">掃到 ' + badStatus + " 台狀態不是正常使用（待修、維修中或已報廢）。盤點只記「有沒有看到」，不會把狀態改成正常。</div>" : "") +
      '<div class="lbl sim">' + esc(S.site) + "位置表：應有 / 已掃</div><div class=\"ztable\">" +
      zonesOf(S.site).map((z) => {
        const should = siteAssets.filter((a) => a.zone === z);
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
          '<div class="zrow"><span><b>' + esc(x.a.name) + "</b> " + esc(x.a.code.slice(-6)) + '<br><span class="small">' + esc(x.a.site) + " " + esc(x.a.zone) + " · " + esc(x.a.status) + " · 歸屬 " + esc(x.a.project || D.UNASSIGNED) + (x.note ? " · " + esc(x.note) : "") + '</span></span><span class="small">' + esc(x.tag) + "</span></div>").join("")) +
        (list.length > 8 ? '<div class="small">另有 ' + (list.length - 8) + " 筆。</div>" : "") + "</div>";
    }
    let projDrill = "";
    if (pfilter) {
      const list = projAssets(pfilter);
      projDrill = '<div class="drill"><div class="lbl">「' + esc(pfilter) + "」反查到 " + list.length + " 台，分布在 " + esc([...new Set(list.map((a) => a.site))].join("、") || "無") + "；同一專案可跨據點。</div>" +
        list.map((a) => '<div class="zrow"><span><b>' + esc(a.name) + "</b> " + esc(a.code.slice(-6)) + '<br><span class="small">' + esc(a.site) + " " + esc(a.zone) + " · " + esc(a.owner) + " · " + esc(a.status) + '</span></span><span class="small">' + esc((a.project || D.UNASSIGNED).replace("（測試）", "")) + "</span></div>").join("") + "</div>";
    }
    const tiles = '<div class="' + (isPhone ? "tiles two" : "dtiles") + '">' +
      '<button class="tile tb' + (metric === "total" ? " sel" : "") + '" data-a="metric" data-v="total"><b>' + sum.t + "</b>設備總數</button>" +
      '<button class="tile tb' + (metric === "done" ? " sel" : "") + '" data-a="metric" data-v="done"><b>' + (sum.t ? Math.round((sum.d / sum.t) * 100) : 0) + "%</b>已盤點（" + sum.d + "）</button>" +
      '<button class="tile tb' + (metric === "todo" ? " sel" : "") + '" data-a="metric" data-v="todo"><b>' + (sum.t - sum.d) + "</b>未盤到</button>" +
      '<button class="tile tb' + (metric === "zone" ? " sel" : "") + '" data-a="metric" data-v="zone"><b>' + sum.z + "</b>位置不符</button></div>";
    const stChips = '<div class="lbl sim">設備狀態篩選（和盤點是兩回事）</div><div class="chips">' +
      '<button class="pill sm' + (dst === "" ? " on" : "") + '" data-a="dst" data-v="">全部</button>' +
      D.STATUSES.map((st) => '<button class="pill sm' + (dst === st ? " on" : "") + '" data-a="dst" data-v="' + esc(st) + '">' + esc(st) + " " + stCount(st) + "</button>").join("") + "</div>";
    const pjChips = '<div class="lbl sim">歸屬專案（按專案反查設備，和實際放置地點、保管人分開；專案名為虛構測試）</div><div class="chips">' +
      '<button class="pill sm' + (pfilter === "" ? " on" : "") + '" data-a="pfilter" data-v="">全部</button>' +
      projects().map((p) => '<button class="pill sm' + (pfilter === p ? " on" : "") + '" data-a="pfilter" data-v="' + esc(p) + '">' + esc(p) + " " + projAssets(p).length + "</button>").join("") + "</div>";
    return tiles + drill + stChips + pjChips + projDrill + siteTable(rows, sorted, isPhone);
  }
  function siteTable(rows, sorted, isPhone) {
    const mlabel = { total: "依設備數排序", done: "依盤點進度排序", todo: "依未盤到排序", zone: "依位置不符排序" }[S.metric];
    if (isPhone) {
      return '<div class="lbl sim">各據點 · ' + mlabel + " · 點開看明細</div>" + sorted.map((r) =>
        '<div class="srow"><button class="shead" data-a="dsite" data-v="' + esc(r.n) + '"><span class="sname">' + esc(r.n) + '</span><span class="spct">' + r.pct + '%</span><span class="bar"><i style="width:' + r.pct + '%"></i></span><span class="smeta">已盤 ' + r.done + "/" + r.t + " · 未盤 " + r.left + " · 不符 " + r.z + "</span></button>" +
        (S.dsite === r.n ? '<div class="sdet"><div class="lbl">狀態分布</div><div class="smeta">' + D.STATUSES.map((st) => esc(st) + " " + assets().filter((a) => a.site === r.n && a.status === st).length).join(" · ") + '</div><button class="pill sm" data-a="gosite" data-v="' + esc(r.n) + '">去盤點' + esc(r.n) + "</button></div>" : "") + "</div>").join("");
    }
    return '<div class="dtable"><div class="dtr head"><span>據點</span><span>設備數</span><span>已盤</span><span>進度</span><span>未盤</span><span>不符</span><span class="opt">狀態分布' + (S.dst ? "（" + esc(S.dst) + "）" : "") + "</span></div>" +
      sorted.map((r) => '<div class="dtr"><span><b>' + esc(r.n) + "</b></span><span>" + r.t + "</span><span>" + r.done + '</span><span class="bar"><i style="width:' + r.pct + '%"></i></span><span>' + r.left + "</span><span>" + r.z + '</span><span class="smeta opt">' + (S.dst ? esc(S.dst) + " " + assets().filter((a) => a.site === r.n && a.status === S.dst).length + " 台" : D.STATUSES.map((st) => esc(st) + " " + assets().filter((a) => a.site === r.n && a.status === st).length).join(" · ")) + "</span></div>").join("") + "</div>" +
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
    const list = assets().filter((a) => a.site === S.asite);
    const zones = zonesOf(S.asite);
    return '<h3 class="ptitle">設備資料</h3><p class="psub">編輯保管人、區域、設備狀態、歸屬專案、序號與日期。儲存只更新這個瀏覽器的測試資料，不會寫回試算表。</p>' +
      '<div class="chips">' + siteNames().map((p) => '<button class="pill sm' + (S.asite === p ? " on" : "") + '" data-a="asite" data-v="' + esc(p) + '">' + esc(p) + "</button>").join("") + "</div>" +
      '<div class="dtable"><div class="atr head"><span>登記編號</span><span>名稱 / 型號 / S/N</span><span>歸屬專案</span><span class="opt">保管人</span><span class="opt">區域</span><span>狀態</span><span></span></div>' +
      list.map((a) => {
        const lr = lastRecordOf(a.code);
        let row = '<button class="atr arow" data-a="edit" data-v="' + esc(a.code) + '"><span class="icode">' + esc(a.code) + "</span>" +
          "<span>" + esc(a.name) + ' <span class="small">' + esc(a.model) + " · S/N " + esc(a.serial || "未登記") + "</span>" + (a.__edited ? '<span class="dbadge"> 已修改（此瀏覽器）</span>' : "") + (S.savedAt === a.code ? '<span class="dbadge"> ✓已儲存</span>' : "") + "</span>" +
          "<span>" + esc((a.project || D.UNASSIGNED).replace("（測試）", "")) + '</span><span class="opt">' + esc(a.owner) + '</span><span class="opt">' + esc(a.zone) + "</span><span>" + esc(a.status) + '</span><span class="small">' + (S.editCode === a.code ? "收合" : "編輯") + "</span></button>";
        if (S.editCode === a.code && S.editDraft) {
          const d = S.editDraft;
          row += '<div class="drawer">' +
            '<div class="frow"><span class="lbl">保管人</span><input class="inp" data-f="owner" value="' + esc(d.owner) + '"></div>' +
            '<div class="frow"><span class="lbl">區域</span><select class="inp" data-f="zone">' + zones.map((z) => '<option value="' + esc(z) + '"' + (d.zone === z ? " selected" : "") + ">" + esc(z) + "</option>").join("") + "</select></div>" +
            '<div class="frow"><span class="lbl">設備狀態</span><select class="inp" data-f="status">' + D.STATUSES.map((st) => '<option value="' + esc(st) + '"' + (d.status === st ? " selected" : "") + ">" + esc(st) + "</option>").join("") + "</select></div>" +
            '<div class="frow"><span class="lbl">歸屬專案</span><select class="inp" data-f="project">' + projects().map((p) => '<option value="' + esc(p) + '"' + ((d.project || D.UNASSIGNED) === p ? " selected" : "") + ">" + esc(p) + "</option>").join("") + "</select></div>" +
            '<div class="frow"><span class="lbl">設備序號</span><input class="inp" data-f="serial" value="' + esc(d.serial) + '" placeholder="S/N，可留空"></div>' +
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
          selAssets.map((a) => '<div class="zrow"><span><b>' + esc(a.name) + "</b> " + esc(a.code.slice(-6)) + '<br><span class="small">S/N ' + esc(a.serial || "未登記") + " · " + esc(a.status) + " · 保管人 " + esc(a.owner) + " · 歸屬 " + esc((a.project || D.UNASSIGNED).replace("（測試）", "")) + "</span></span></div>").join("")) + "</div>"
        : '<div class="small">點圖上任一位置，帶出該位置的設備資料。</div>');
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
            '<span class="idet">' + (a ? esc(a.status) + " · S/N " + esc(a.serial || "未登記") + " · 歸屬 " + esc(a.project || D.UNASSIGNED) + " · 登記 " + esc(a.site) + " " + esc(a.zone) + " → 現場 " + esc(r.sessionSite) + " " + esc(r.zone) : "清冊查無，需補登") + " · " + esc(new Date(r.at).toLocaleString("zh-TW", { hour12: false })) + "</span>" +
            decisionButtons(r) + "</div>";
        }).join("")) +
      '<button class="btn secondary" disabled style="margin-top:8px">寫回試算表（正式版功能，待接入你的表格）</button>';
  }
  function pcView() {
    const tab = S.dtab;
    const body = tab === "dash" ? pcDash() : tab === "assets" ? pcAssets() : tab === "zones" ? pcZones() : tab === "map" ? pcMap() : pcDiff();
    const recs = curRecs();
    const diffN = allRecords().filter((r) => r.status !== "ok" && !r.decision).length;
    return '<div class="desktop"><div class="dbody"><nav class="dside"><div class="dlogo">諸葛 · 設備管理</div>' +
      '<button class="dnav' + (tab === "dash" ? " on" : "") + '" data-a="dtab" data-v="dash">總覽儀表板</button>' +
      '<button class="dnav' + (tab === "assets" ? " on" : "") + '" data-a="dtab" data-v="assets">設備資料</button>' +
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
    else if (a === "dtab") { S.dtab = v; S.editCode = ""; S.editDraft = null; }
    else if (a === "asite") { S.asite = v; S.editCode = ""; S.editDraft = null; }
    else if (a === "gosite") { S.site = v; S.dash = false; S.screen = "start"; }
    else if (a === "edit") {
      if (S.editCode === v) { S.editCode = ""; S.editDraft = null; }
      else {
        const x = getA(v);
        S.editCode = v;
        S.editDraft = { owner: x.owner, zone: x.zone, status: x.status, project: x.project || D.UNASSIGNED, serial: x.serial, purchase: x.purchase, activate: x.activate, warranty: x.warranty };
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
    if (S.editDraft && Object.prototype.hasOwnProperty.call(S.editDraft, f)) S.editDraft[f] = e.target.value;
  });
  document.addEventListener("change", (e) => {
    if (e.target.getAttribute && e.target.getAttribute("data-f") === "mapfile") {
      const file = e.target.files && e.target.files[0];
      if (file) { S.mapImg = URL.createObjectURL(file); S.mapZone = ""; render(); }
      return;
    }
    const f = e.target.getAttribute && e.target.getAttribute("data-f");
    if (f && S.editDraft && Object.prototype.hasOwnProperty.call(S.editDraft, f)) S.editDraft[f] = e.target.value;
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.getAttribute && e.target.getAttribute("data-f") === "manualCode") { scan(S.manualCode); S.manualCode = ""; render(); }
  });

  render();
})();
