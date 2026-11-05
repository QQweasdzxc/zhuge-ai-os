/* 地圖總覽（唯讀）：全台灣 → 北北區 → 縣市 → 據點 → 座位圖 → 座位。
 * 資料一律即時讀自同一份試算表（store.state() 與 loadSeatMap 的座位事件），不另存一份、不寫入。
 * 營運層級是呈現設定，不是新據點資料；尚未核對的據點只顯示「待核對」，不產生數字。
 * 台灣本島外框：Natural Earth 50m（public domain）簡化，不含任何公司資料。 */
(function (g) {
  'use strict';
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const TW = {
    view: "0 0 240 433.3",
    path: "M121.0,190.2 L113.0,198.6 L106.6,207.5 L104.0,215.9 L104.2,224.5 L102.4,232.3 L99.2,240.0 L86.7,237.8 L79.8,232.3 L78.3,223.2 L69.2,212.3 L65.8,209.1 L52.7,203.0 L40.7,199.9 L31.5,195.4 L32.7,195.8 L25.9,189.7 L20.7,183.2 L10.0,164.8 L6.3,160.4 L1.4,156.3 L0.0,152.3 L1.7,147.8 L6.3,141.2 L9.1,134.5 L6.8,125.3 L7.7,116.3 L11.2,112.3 L72.0,57.2 L88.5,45.4 L98.7,39.7 L107.2,33.2 L115.3,25.0 L125.2,17.5 L132.2,15.2 L167.1,8.4 L178.0,2.0 L186.8,0.0 L196.6,0.1 L203.0,3.2 L208.7,6.8 L214.7,8.8 L230.2,12.3 L236.9,15.8 L240.0,21.7 L230.6,27.3 L225.9,32.4 L225.1,38.0 L226.7,45.6 L226.9,53.2 L215.2,71.0 L202.6,82.1 L199.2,87.7 L195.3,101.4 L187.9,115.2 L181.6,132.7 L171.3,150.7 L165.4,158.2 L158.2,165.4 L140.7,179.0 L121.0,190.2 Z",
    pin: { x: 176, y: 30, label: "北北區" },
  };
  /* 縣市比對只用已登記據點名稱前綴；新北／板橋是使用者描述的待核對節點，不比對任何據點。 */
  const REGION = {
    id: "north", name: "北北區",
    cities: [
      { id: "taipei", name: "台北市", match: (s) => s.indexOf("台北") === 0 },
      { id: "newtaipei", name: "新北市", match: () => false },
    ],
  };
  const PENDING_SITES = ["板橋一區", "板橋二區", "板橋三區"];
  const time = (v) => (v ? new Date(v).toLocaleString("zh-TW", { hour12: false }) : "");
  const latest = (list, pick) => list.reduce((m, x) => { const t = pick(x); return t && (!m || t > m) ? t : m; }, "");

  /* 範圍統計（純函式，測試用）：assets/records 皆為已限定範圍後的陣列。 */
  function scopeCounts(assets, records, filters) {
    const f = filters || {};
    const match = (a) =>
      (!f.department || (a.department || "未填部門") === f.department) &&
      (!f.project || (a.project || "未指定（待確認）") === f.project) &&
      (!f.type || (a.type || "未填類型") === f.type);
    const list = (assets || []).filter(match);
    const byType = {}, byStatus = {};
    for (const a of list) {
      byType[a.type || "未填類型"] = (byType[a.type || "未填類型"] || 0) + 1;
      byStatus[a.status || "未填狀態"] = (byStatus[a.status || "未填狀態"] || 0) + 1;
    }
    return { total: list.length, list, byType, byStatus, lastScan: latest(records || [], (r) => r.at) };
  }
  function citySites(allSiteNames, cityId) {
    const city = REGION.cities.find((c) => c.id === cityId);
    return (allSiteNames || []).filter((s) => city && city.match(s));
  }
  function unmatchedSites(allSiteNames) {
    return (allSiteNames || []).filter((s) => !REGION.cities.some((c) => c.match(s)));
  }

  function create(store, rerender) {
    const S = { level: "country", city: "", site: "", zone: "", seat: null, drill: false, fDept: "", fProj: "", fType: "", seatLoadAsked: false };
    const db = () => store.state();
    const assets = () => db().assets || [];
    const records = () => (db().records || []).map((r) => ({ ...r, sessionSite: ((db().sessions || []).find((x) => x.id === r.sessionId) || {}).site || "" }));
    const siteNames = () => { const a = (db().sites || []).map((s) => s.name), b = assets().map((x) => x.site).filter(Boolean); return [...new Set(a.concat(b))]; };
    const seatModel = () => g.ErpSeatCore.reduce(store.seatRows || []);
    const filters = () => ({ department: S.fDept, project: S.fProj, type: S.fType });

    function scopeAssets() {
      let list = assets();
      if (S.level === "region") { const ns = REGION.cities.flatMap((c) => citySites(siteNames(), c.id)); list = list.filter((a) => ns.includes(a.site)); }
      else if (S.level === "city") { const ns = citySites(siteNames(), S.city); list = list.filter((a) => ns.includes(a.site)); }
      else if (S.level === "site" || S.level === "office") list = list.filter((a) => a.site === S.site);
      if (S.level === "office" && S.zone) list = list.filter((a) => (a.zone || "") === S.zone);
      if (S.level === "office" && S.seat !== null) {
        const m = currentMap();
        if (m) { const codes = new Set(Object.values(seatModel().bindings).filter((e) => e.version === m.id && e.seat === S.seat).map((e) => e.code)); list = list.filter((a) => codes.has(a.code)); }
      }
      return list;
    }
    function scopeRecords() {
      let list = records();
      if (S.level === "region") { const ns = REGION.cities.flatMap((c) => citySites(siteNames(), c.id)); list = list.filter((r) => ns.includes(r.sessionSite)); }
      else if (S.level === "city") { const ns = citySites(siteNames(), S.city); list = list.filter((r) => ns.includes(r.sessionSite)); }
      else if (S.level === "site" || S.level === "office") list = list.filter((r) => r.sessionSite === S.site);
      if (S.level === "office" && S.seat !== null) {
        const m = currentMap();
        if (m) { const codes = new Set(Object.values(seatModel().bindings).filter((e) => e.version === m.id && e.seat === S.seat).map((e) => e.code)); list = list.filter((r) => codes.has(r.code)); }
      }
      return list;
    }
    function currentMap() {
      if (!S.site || !S.zone) return null;
      const maps = seatModel().maps.filter((m) => m.site === S.site && m.zone === S.zone);
      return maps[maps.length - 1] || null;
    }
    function zonesOf(site) {
      const s = (db().sites || []).find((x) => x.name === site);
      const za = assets().filter((a) => a.site === site).map((a) => a.zone).filter(Boolean);
      const zm = seatModel().maps.filter((m) => m.site === site).map((m) => m.zone);
      return [...new Set((s ? s.zones : []).concat(za, zm))];
    }

    function crumb() {
      const parts = [["country", "全台灣"]];
      if (S.level !== "country") parts.push(["region", REGION.name]);
      if (["city", "site", "office"].includes(S.level)) parts.push(["city", (REGION.cities.find((c) => c.id === S.city) || {}).name || S.city]);
      if (["site", "office"].includes(S.level)) parts.push(["site", S.site]);
      if (S.level === "office") parts.push(["office", S.zone]);
      return '<nav class="geo-crumb" aria-label="所在層級">' + parts.map(([lv, label], i) => (i ? '<span> / </span>' : "") + '<button class="pill sm" data-a="geo" data-v="go:' + lv + '">' + esc(label) + "</button>").join("") + "</nav>";
    }
    function filterChips(all) {
      const groups = [["fDept", "部門", (a) => a.department || "未填部門"], ["fProj", "專案", (a) => a.project || "未指定（待確認）"], ["fType", "類型", (a) => a.type || "未填類型"]];
      return '<div class="geo-filters">' + groups.map(([key, label, pick]) => {
        const opts = [...new Set(all.map(pick))];
        if (!opts.length) return "";
        return '<span class="geo-fgroup"><b>' + label + "</b>" + '<button class="pill sm' + (S[key] === "" ? " on" : "") + '" data-a="geo" data-v="f:' + key + ':">全部</button>' + opts.map((o) => '<button class="pill sm' + (S[key] === o ? " on" : "") + '" data-a="geo" data-v="f:' + key + ":" + esc(o) + '">' + esc(o) + "</button>").join("") + "</span>";
      }).join("") + "</div>";
    }
    function panel(title) {
      const all = scopeAssets(), recs = scopeRecords();
      const c = scopeCounts(all, recs, filters());
      let h = '<section class="geo-panel" aria-live="polite"><h3>' + esc(title) + " · 總覽</h3>" + filterChips(all);
      h += '<div class="geo-kpis"><button class="geo-kpi" data-a="geo" data-v="drill:toggle"><span>設備台數</span><b>' + c.total + '</b><small>台 · 點數字看組成</small></button>' +
        '<div class="geo-kpi"><span>最近設備掃描</span><b class="geo-time">' + (c.lastScan ? esc(time(c.lastScan)) : "未有可驗證紀錄") + "</b><small>只算目前範圍與篩選的帳上掃描</small></div>" +
        '<div class="geo-kpi"><span>本區完整盤點</span><b class="geo-time">未有可驗證紀錄</b><small>不把單次掃描或修改當整區結案</small></div></div>';
      const types = Object.entries(c.byType), statuses = Object.entries(c.byStatus);
      if (types.length) h += '<div class="geo-break"><b>類型</b>' + types.map(([t, n]) => '<button class="pill sm" data-a="geo" data-v="f:fType:' + esc(t) + '">' + esc(t) + " · " + n + "台</button>").join("") + "</div>";
      if (statuses.length) h += '<div class="geo-break"><b>狀態</b>' + statuses.map(([t, n]) => '<span class="geo-stat">' + esc(t) + " " + n + "台</span>").join("") + "</div>";
      if (S.drill) h += '<div class="geo-drill"><h4>數字背後的設備 · ' + c.list.length + "台</h4>" + (c.list.length ? c.list.map((a) => '<div class="geo-asset"><b>' + esc(a.code) + "</b><span>" + esc(a.name || "未填名稱") + " · " + esc(a.model || "未填型號") + "</span><small>" + esc(a.site || "未填據點") + " / " + esc(a.zone || "未填區域") + " · " + esc(a.status || "未填狀態") + "<br>部門：" + esc(a.department || "未填") + " · 專案：" + esc(a.project || "未指定") + "</small></div>").join("") : '<p role="status">此範圍及篩選下沒有符合的設備；這不代表全台沒有設備。</p>') + '<button class="pill sm" data-a="geo" data-v="drill:toggle">收起設備清單</button></div>';
      h += '<p class="geo-note">數字即時讀自正式試算表，只含目前已登記的新帳設備；舊帳預期與實掃分開看，不相加。統計範圍隨左方層級與上方篩選改變。</p></section>';
      return h;
    }
    function pendingPanel(title, lines) {
      return '<section class="geo-panel"><h3>' + esc(title) + ' · 總覽</h3><div class="geo-pending-badge">概念範圍，尚無核實資料</div><dl class="geo-metrics"><div><dt>正式設備台數</dt><dd>待對應</dd></div><div><dt>最近設備掃描</dt><dd>未有可驗證紀錄</dd></div><div><dt>本區完整盤點</dt><dd>未有可驗證紀錄</dd></div></dl>' + lines.map((l) => "<p>" + esc(l) + "</p>").join("") + "</section>";
    }
    function seatPanel(m) {
      const md = seatModel(), seat = m.seats.find((s) => s.number === S.seat);
      if (!seat) return "";
      const o = md.occupants[m.id + ":" + seat.number];
      const links = Object.values(md.bindings).filter((e) => e.version === m.id && e.seat === seat.number);
      const lastScan = latest(scopeRecords(), (r) => r.at);
      const checks = Object.values(md.checks).filter((e) => e.version === m.id && e.seat === seat.number && e.data && e.data.confirmed === true);
      const lastCheck = latest(checks, (e) => e.at);
      return '<section class="geo-panel"><h3>' + seat.number + "號座位 · " + esc(S.site) + " " + esc(S.zone) + "</h3>" +
        '<div class="geo-person">' + (o && o.data.name ? esc(o.data.name) : "目前使用人待確認") + "</div>" +
        '<p class="geo-note">人員是座位使用人，不自動等於設備保管人。</p>' +
        "<h4>此座位設備 " + links.length + "台</h4>" +
        (links.length ? links.map((e) => { const a = assets().find((x) => x.code === e.code); return '<div class="geo-asset"><b>' + esc(e.code) + "</b><span>" + esc(a ? (a.name || "未填名稱") + " · " + (a.model || "未填型號") : "清冊查無") + "</span></div>"; }).join("") : "<p>此座位未有已登記設備。</p>") +
        '<dl class="geo-metrics"><div><dt>最近設備掃描</dt><dd>' + (lastScan ? esc(time(lastScan)) : "未有可驗證紀錄") + "</dd></div><div><dt>本點核對完成</dt><dd>" + (lastCheck ? esc(time(lastCheck)) : "未有可驗證紀錄") + "</dd></div><div><dt>本區完整盤點</dt><dd>未有可驗證紀錄</dd></div></dl>" +
        '<p class="geo-note">時間只取自正式盤點與座位核對紀錄；不用設備異動或場次開始冒充完成。</p>' +
        '<button class="pill sm" data-a="geo" data-v="seat:">看整層總覽</button></section>';
    }
    function seatGrid(m) {
      const refs = new Map(m.seats.map((s) => [s.ref, s]));
      return '<div class="seat-layout-scroll seat-fit" data-seat-width="' + m.width + '" data-seat-height="' + m.height + '" aria-label="' + esc(S.site) + " " + esc(S.zone) + ' 座位圖"><div class="seat-layout" style="width:' + m.width + "px;height:" + m.height + 'px">' +
        m.cells.map((c) => { if (refs.has(c.ref)) return ""; const b = c.border || {}; const line = (n) => (b[n] ? "1px solid #bbb" : "0"); return '<div class="seat-cell" style="left:' + c.x + "px;top:" + c.y + "px;width:" + c.w + "px;height:" + c.h + "px;background:" + esc(c.fill) + ";color:" + esc(c.ink) + ";border-left:" + line("left") + ";border-right:" + line("right") + ";border-top:" + line("top") + ";border-bottom:" + line("bottom") + ";font-size:" + Math.min(c.fontSize, 14) + 'px">' + esc(c.text || "").replace(/\n/g, "<br>") + "</div>"; }).join("") +
        m.seats.map((s) => { const c = m.cells.find((x) => x.ref === s.ref) || {}; return '<button class="seat-cell seat-anchor geo-seat' + (S.seat === s.number ? " chosen" : "") + '" data-a="geo" data-v="seat:' + s.number + '" style="left:' + s.x + "px;top:" + s.y + "px;width:" + s.w + "px;height:" + Math.max(s.h, 22) + "px;background:" + esc(c.fill || "#fff") + '" title="點看人員、設備與盤點時間">' + s.number + "</button>"; }).join("") +
        "</div></div>";
    }
    function taiwanSvg() {
      const p = TW.pin;
      return '<div class="geo-tw"><svg viewBox="' + TW.view + '" role="img" aria-label="台灣本島示意圖（公開地理資料，非精確行政界）"><path d="' + TW.path + '" class="geo-tw-land"/>' +
        '<g class="geo-tw-pin" data-a="geo" data-v="go:region" role="button" tabindex="0" aria-label="進入北北區"><circle cx="' + p.x + '" cy="' + p.y + '" r="10" class="geo-tw-dot"/><text x="' + (p.x + 14) + '" y="' + (p.y + 4) + '" class="geo-tw-label">' + esc(p.label) + "</text></g></svg>" +
        '<button class="btn" data-a="geo" data-v="go:region">進入北北區（台北＋新北）</button>' +
        '<p class="geo-note">台灣外框是公開地理資料（Natural Earth, public domain），只作導覽，不是精確行政邊界，也不含公司資料。</p></div>';
    }
    function nodeCard(v, title, sub, cls) { return '<button class="geo-node ' + (cls || "") + '" data-a="geo" data-v="' + esc(v) + '"><b>' + esc(title) + "</b><span>" + esc(sub) + "</span></button>"; }
    function pendingCard(title, sub) { return '<div class="geo-node geo-pending"><b>' + esc(title) + "</b><span>" + esc(sub) + "</span></div>"; }

    function html() {
      if (!S.seatLoadAsked) { S.seatLoadAsked = true; Promise.resolve(store.loadSeatMap()).then(() => rerender()).catch(() => rerender()); }
      const names = siteNames();
      let left = "", right = "";
      if (S.level === "country") {
        const other = unmatchedSites(names);
        left = '<h3 class="ptitle">地圖總覽</h3><p class="psub">從全台一路點到座位；右側總覽跟著範圍改變。先看全貌，再往下到辦公室、人員與設備。</p>' + taiwanSvg() +
          (other.length ? '<div class="geo-block"><b>其他已登記據點（尚未歸入營運區）</b>' + other.map((s) => nodeCard("go:site:" + s, s, "直接查看")).join("") + "</div>" : "");
        right = panel("全台灣");
      } else if (S.level === "region") {
        const tpe = citySites(names, "taipei"), ntp = citySites(names, "newtaipei");
        left = '<h3 class="ptitle">北北區</h3><p class="psub">台北＋新北是營運區集合，不是行政從屬。</p><div class="geo-nodes">' +
          nodeCard("go:city:taipei", "台北市", tpe.length ? tpe.length + " 處已登記據點 · " + assets().filter((a) => tpe.includes(a.site)).length + " 台設備" : "尚無已登記據點") +
          (ntp.length ? nodeCard("go:city:newtaipei", "新北市", ntp.length + " 處已登記據點") : pendingCard("新北市", "板橋三個地點 · 待核對正式據點")) + "</div>";
        right = panel(REGION.name + "（已核實據點）");
      } else if (S.level === "city" && S.city === "taipei") {
        const tpe = citySites(names, "taipei");
        left = '<h3 class="ptitle">台北市</h3><p class="psub">點據點看樓層與座位。</p><div class="geo-nodes">' +
          (tpe.length ? tpe.map((s) => nodeCard("go:site:" + s, s, assets().filter((a) => a.site === s).length + " 台設備")).join("") : "<p>尚無已登記據點。</p>") + "</div>";
        right = panel("台北市");
      } else if (S.level === "city" && S.city === "newtaipei") {
        left = '<h3 class="ptitle">新北市</h3><p class="psub">以下是依你的描述列入的概念節點，尚未核對。</p><div class="geo-nodes">' + nodeCard("go:pending", "板橋", "三個地點 · 待核對") + "</div>";
        right = pendingPanel("新北市", ["板橋一、二、三區是示意名稱，不代表已有三個正式據點。", "人員與設備資料未載入，不填入假人名或假設備。"]);
      } else if (S.level === "pending") {
        left = '<h3 class="ptitle">板橋 · 三個地點</h3><p class="psub">待核對的概念據點。</p><div class="geo-nodes">' + PENDING_SITES.map((s) => pendingCard(s, "待核對正式據點")).join("") + "</div>";
        right = pendingPanel("板橋", ["三個地點尚未核對名稱、數量與圖面。", "完成核對前不顯示任何設備數字。"]);
      } else if (S.level === "site") {
        const zs = zonesOf(S.site), maps = seatModel().maps.filter((m) => m.site === S.site);
        left = '<h3 class="ptitle">' + esc(S.site) + '</h3><p class="psub">點樓層／區域看座位圖。</p><div class="geo-nodes">' +
          (zs.length ? zs.map((z) => { const has = maps.some((m) => m.zone === z); const n = assets().filter((a) => a.site === S.site && (a.zone || "") === z).length; return nodeCard("go:office:" + z, z || "未分區", n + " 台設備" + (has ? "" : " · 尚未建立座位圖"), has ? "" : "geo-nomap"); }).join("") : "<p>此據點尚未登記區域。</p>") + "</div>";
        right = panel(S.site);
      } else if (S.level === "office") {
        const m = currentMap();
        if (!m) {
          left = '<h3 class="ptitle">' + esc(S.site) + " " + esc(S.zone) + '</h3><div class="geo-node geo-pending"><b>尚未建立座位圖</b><span>此區域的設備清單仍可看右方總覽；座位圖請由「更多管理 → 座位圖」匯入。</span></div>';
          right = panel(S.site + " " + S.zone);
        } else if (S.seat !== null) {
          left = '<h3 class="ptitle">' + esc(S.site) + " " + esc(S.zone) + '</h3><p class="psub">點座位看人員、設備與盤點時間；目前選 ' + S.seat + " 號。</p>" + seatGrid(m);
          right = seatPanel(m);
        } else {
          left = '<h3 class="ptitle">' + esc(S.site) + " " + esc(S.zone) + '</h3><p class="psub">點座位看人員、設備與盤點時間。</p>' + seatGrid(m);
          right = panel(S.site + " " + S.zone);
        }
      }
      return '<div class="geo-view">' + crumb() + '<div class="geo-grid"><div class="geo-left">' + left + '</div><div class="geo-right">' + right + "</div></div></div>";
    }

    function act(v) {
      const i = v.indexOf(":"), cmd = i < 0 ? v : v.slice(0, i), arg = i < 0 ? "" : v.slice(i + 1);
      if (cmd === "go") {
        if (arg === "country") { S.level = "country"; S.city = S.site = S.zone = ""; S.seat = null; }
        else if (arg === "region") { S.level = "region"; S.site = S.zone = ""; S.seat = null; }
        else if (arg === "city") { S.level = "city"; S.site = S.zone = ""; S.seat = null; if (S.city !== "newtaipei") S.city = S.city || "taipei"; }
        else if (arg === "site") { S.level = "site"; S.zone = ""; S.seat = null; }
        else if (arg === "office") { S.level = "office"; S.seat = null; }
        else if (arg.indexOf("city:") === 0) { S.level = "city"; S.city = arg.slice(5); S.site = S.zone = ""; S.seat = null; }
        else if (arg.indexOf("site:") === 0) { S.level = "site"; S.site = arg.slice(5); S.city = S.site.indexOf("台北") === 0 ? "taipei" : S.city || "taipei"; S.zone = ""; S.seat = null; }
        else if (arg.indexOf("office:") === 0) { S.level = "office"; S.zone = arg.slice(7); S.seat = null; }
        else if (arg === "pending") { S.level = "pending"; S.city = "newtaipei"; S.seat = null; }
        S.drill = false;
      } else if (cmd === "seat") { S.seat = arg === "" ? null : Number(arg); }
      else if (cmd === "drill") { S.drill = !S.drill; }
      else if (cmd === "f") {
        const j = arg.indexOf(":"), key = arg.slice(0, j), val = arg.slice(j + 1);
        if (key === "fDept") S.fDept = val; else if (key === "fProj") S.fProj = val; else if (key === "fType") S.fType = val;
      }
      rerender();
    }
    return { html, act, state: S };
  }
  g.ErpGeoOverview = { create, scopeCounts, citySites, unmatchedSites };
  if (typeof module !== "undefined") module.exports = g.ErpGeoOverview;
})(typeof window !== "undefined" ? window : globalThis);
