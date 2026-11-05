/* ZG-ERP 庫存／設備管理 — 正式版（接 zg-ledger-bridge → 現存資料庫試算表）。
 * 資料一律來自 ZgErpData（DATA_BACKEND=sheets：讀寫使用者的 Google 試算表，
 * 比照 vendor-sheet-service / gas-vendor-bridge 模式，欄位待使用者提供實際表格後對照）。
 * 本頁不連接、不讀寫任何正式試算表或資料庫。
 */
(function () {
  "use strict";
  const D = window.ZgErpData;
  const store = D.store;
  const intakeUI = window.ErpIntakeUI ? window.ErpIntakeUI.create(store, () => render()) : null;
  const seatUI = window.ErpSeatUI ? window.ErpSeatUI.create(store, () => render()) : null;
  const geoUI = window.ErpGeoOverview ? window.ErpGeoOverview.create(store, () => render()) : null;
  const repairUI=window.ErpRepairUI?window.ErpRepairUI.create(store,()=>render()):null;
  const differenceUI=window.ErpDifferenceUI?window.ErpDifferenceUI.create(store,()=>render()):null;
  const LABEL = { ok: "相符", zone: "位置不符", site: "異地設備", none: "查無編號", dup: "重複掃描" };
  const GLYPH = { ok: "✓", zone: "≠", site: "⇄", none: "?", dup: "×2" };
  const LOGIN_URL = "./";

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function dist(a, b, c, d) {
    const r = Math.PI / 180, x = (c - a) * r, y = (d - b) * r * Math.cos(((a + c) / 2) * r);
    return Math.sqrt(x * x + y * y) * 6371;
  }
  function timeStr(d) { return d.toTimeString().slice(0, 8); }
  function chip(st) { return '<span class="chip chip-' + st + '"><b>' + GLYPH[st] + "</b> " + LABEL[st] + "</span>"; }
  /* 每筆記錄的寫回狀態：失敗要看得見（未同步），進行中標同步中 */
  function syncMark(r) {
    if (D.isMock || !r) return "";
    if (r.__unsynced) return '<span class="syncmark">未同步</span>';
    if (r.__pending) return '<span class="syncmark ing">同步中</span>';
    return "";
  }

  function scanSyncState(r) {
    if (D.isMock) return "mock";
    const entities = [r, r && getA(r.code), S.sess].filter(Boolean);
    if (r && r.__seatError) return "failed";
    if (r && r.__seatPending) return "pending";
    if (entities.some((x) => x.__unsynced)) return "failed";
    if (entities.some((x) => x.__pending)) return "pending";
    return "saved";
  }
  function scanSyncCopy(state) {
    return state === "failed" ? "辨識到，但未同步。尚未存妥，請點未同步提示重試。" : state === "pending" ? "辨識到，正在同步。請等同步完成。" : state === "mock" ? "辨識到（隔離測試，不寫正式資料）" : "已同步保存這筆掃描與設備資料。";
  }
  function refreshScanSync() {
    document.querySelectorAll("[data-scan-sync]").forEach((el) => {
      const r = curRecs().find((x) => x.code === el.getAttribute("data-scan-sync"));
      if (!r) return;
      const state = scanSyncState(r);
      el.textContent = scanSyncCopy(state);
      const card = el.closest(".toast");
      if (card) { card.classList.toggle("syncfailed", state === "failed"); card.classList.toggle("syncpending", state === "pending"); }
    });
  }
  function session() {
    for (const key of ["zhuge_ai_os_google_auth_session_v1", "zhuge_ai_os_session_v1"]) {
      try {
        const s = JSON.parse(localStorage.getItem(key) || "null");
        if (s) return s;
      } catch { /* 下一個 key */ }
    }
    return null;
  }

  /* 本機草稿：只在這台裝置、按帳號分開；「草稿已保留」不等於「已儲存」 */
  const DRAFT=window.ErpDraftCore||null;
  const DRAFTS=DRAFT?DRAFT.create((()=>{try{return window.localStorage;}catch(e){return null;}})()):null;
  const draftAcct=()=>DRAFT?DRAFT.accountOf(session()):'';
  function draftSaveEdit(){
    if(!DRAFTS||!S.editCode||!S.editDraft)return;
    const r=DRAFTS.put(draftAcct(),'asset-edit',S.editCode,{values:{...S.editDraft},base:{...S.editBase}});
    S.draftNote=r.saved?'draft':(r.reason==='no-account'?'':'failed');
    const el=document.getElementById('erp-draft-line');if(el)el.innerHTML=draftInner();
  }
  /* 非保管人欄位的正式自動存檔：只寫「這一個欄位」，以伺服器比對舊值（不符就不寫）；保管人、使用部門、區域、狀態、專案一律不自動存，仍需按儲存。
     每次寫入用掉一次編輯權，成功後重新取得並以最新資料當基準；任何不確定結果都鎖住並保留輸入。 */
  const AUTO_FIELDS=['name','model','serial','purchase','activate','warranty','brand','origin','mfgYear','type','po'];
  async function autosaveAsset(f){
    if(!S.editCode||!S.editDraft||!AUTO_FIELDS.includes(f)||S.editBusy||S.editLocked||S.editConflict)return;
    const code=S.editCode,oldBase={...S.editBase},oldDraft={...S.editDraft},val=String(oldDraft[f]??'').trim();
    if(!val&&f==='name'){if(String(oldBase[f]??'').trim()){S.autoNote='';S.editError='設備名稱不能留空，沒有儲存；正式資料維持原名稱「'+String(oldBase[f]||'')+'」。請輸入名稱，或取消編輯。';render();}return;}
    if(val===String(oldBase[f]??''))return; /* 欄位政策：只在離開欄位（change）時存；名稱不可清空，其他選填欄位清空視為有意刪除，舊值寫在提示裡 */
    if(!D.isMock&&store._editReservations?.get(code)?.attempted)return;
    let wrote=false;S.editBusy=true;S.autoNote='';render();
    try{
      if(D.isMock){store.saveAsset(code,{[f]:val});}
      else{
        await store.saveAssetVerified(code,{...oldBase,[f]:val},oldBase);wrote=true;
        await store.reserveAssetEdit(code);const fresh=await store.readAssetForEdit(code);
        const nd=editValues(fresh);
        for(const k of Object.keys(nd)){if(k!==f&&String(oldDraft[k]??'')!==String(oldBase[k]??''))nd[k]=oldDraft[k];}
        const typed=String(S.editDraft[f]??'');if(typed.trim()!==val)nd[f]=S.editDraft[f];
        S.editDraft=nd;
      }
      if(D.isMock){S.editBase={...S.editBase,[f]:val};}
      S.autoNote='已自動儲存：'+(window.ErpDraftCore?window.ErpDraftCore.fieldLabels([f])[0]:f)+(val?'':'已清空（原：'+String(oldBase[f]||'')+'）')+'（已存入正式資料並讀回）';
      const others=Object.keys(S.editDraft).some(k=>String(S.editDraft[k]??'')!==String(S.editBase[k]??''));
      if(others)draftSaveEdit();else draftDiscardEdit(code);
    }catch(e){S.editLocked=true;S.editError=wrote?'這個欄位已存入正式資料，但重新取得編輯權失敗（'+(e.message||'未知')+'）。其餘輸入保留為草稿；請取消後重新開啟再繼續。':'自動儲存沒有確認成功（'+(e.message||'未知')+'）。輸入已保留為草稿，不會重送；請取消後重新開啟核對。';draftSaveEdit();}
    finally{S.editBusy=false;render();}
  }
  function draftDiscardEdit(code){if(DRAFTS)DRAFTS.discard(draftAcct(),'asset-edit',code);S.draftNote='';}
  function draftApplyEdit(code){
    S.draftNote='';S.draftConflict=[];
    if(!DRAFTS||!DRAFT)return;
    const stored=DRAFTS.get(draftAcct(),'asset-edit',code);if(!stored)return;
    const plan=DRAFT.restorePlan(stored,{...S.editBase},window.ErpEditCore.rebase);
    if(plan.mode==='restored'||plan.mode==='merged'){S.editDraft=plan.values;S.editBase=plan.base;S.editTouched=true;S.draftNote=plan.mode==='merged'?'restored-merged':'restored';}
    else if(plan.mode==='conflict'){S.draftConflict=plan.conflicts;S.draftNote='conflict';}
  }
  const bagHooks=(kind)=>({get:k=>bagGet(kind,k),put:(k,v)=>bagPut(kind,k,v),discard:k=>bagDiscard(kind,k)});
  if(intakeUI&&intakeUI.setDrafts&&DRAFTS)intakeUI.setDrafts(bagHooks('intake-xlsx'));
  if(differenceUI&&differenceUI.setDrafts&&DRAFTS)differenceUI.setDrafts(bagHooks('difference'));
  if(geoUI&&geoUI.setDrafts&&DRAFTS)geoUI.setDrafts({get:k=>{const r=DRAFTS.get(draftAcct(),'geo-name',k);return r&&r.payload;},put:(k,v)=>DRAFTS.put(draftAcct(),'geo-name',k,v),discard:k=>DRAFTS.discard(draftAcct(),'geo-name',k)});
  if(seatUI&&DRAFTS)seatUI.setDrafts({imp:{get:()=>{const r=DRAFTS.get(draftAcct(),'seat-import','pending');return r&&r.payload;},put:v=>DRAFTS.put(draftAcct(),'seat-import','pending',v),discard:()=>DRAFTS.discard(draftAcct(),'seat-import','pending')},get:k=>{const r=DRAFTS.get(draftAcct(),'seat-name',k);return r&&r.payload;},put:(k,v)=>DRAFTS.put(draftAcct(),'seat-name',k,v),discard:k=>DRAFTS.discard(draftAcct(),'seat-name',k)});
  function draftInner(){
    const n=S.draftNote;if(S.autoNote&&!S.cancelAsk)return '<div class="match" role="status">'+esc(S.autoNote)+'</div>'+(n==='draft'?'<div class="small">另有尚未儲存的內容以草稿保留（尚未存入正式資料）</div>':'');if(!n)return '';
    if(S.cancelAsk)return '<div class="warn">取消會刪除這份尚未存入正式資料的草稿。再按一次「取消」確定刪除，或繼續編輯。</div>';
    if(n==='draft')return '<div class="small">草稿已保留在這台裝置（尚未存入正式資料）</div>';
    if(n==='restored')return '<div class="small">已還原你上次輸入的草稿（尚未存入正式資料），請核對後再儲存。</div>';
    if(n==='restored-merged')return '<div class="small">已還原上次草稿，並與這段期間的最新資料合併（尚未存入正式資料），請核對後再儲存。</div>';
    if(n==='conflict')return '<div class="warn">上次草稿與最新資料有衝突，沒有套用：'+esc(DRAFT.fieldLabels(S.draftConflict||[]).join('、'))+'。草稿仍保留；取消編輯不會刪除它，可到「管理功能 › 本機草稿」刪除。</div>';
    if(n==='failed')return '<div class="warn">草稿無法保留在這台裝置，請先不要關閉頁面。</div>';
    return '';
  }
  const KIND_LABEL={'asset-edit':'設備編輯','inbound-batch':'入庫批次表單','difference':'帳上A／現場B差異表單','intake-xlsx':'XLSX批次匯入（需重新選檔）','map-image':'地圖圖片（需重新選檔）','inbound-confirm':'入庫確認','seat-name':'座位使用人姓名','site-new':'新增據點','zone-new':'新增區域','annotation':'釐清標示','scan-held':'待核對掃描',repair:'維修登記','geo-name':'座位使用人（地圖）','seat-import':'座位圖匯入預覽（需重新選檔）','scan-setup':'掃描場次設定（部門／專案，尚未開始）','recv-serial':'到貨序號（尚未核對）'};
  function bagPut(kind,entity,values){if(DRAFTS)DRAFTS.put(draftAcct(),kind,entity,{values:{...values},base:{}});}
  function bagGet(kind,entity){const r=DRAFTS&&DRAFTS.get(draftAcct(),kind,entity);return r&&r.payload&&r.payload.values?r.payload.values:null;}
  function bagDiscard(kind,entity){if(DRAFTS)DRAFTS.discard(draftAcct(),kind,entity);}
  /* 掃描設定（部門／專案）與到貨序號框：只存本機草稿、只還原成「預填」。不自動開始盤點、不自動核對；還原內容在畫面上明示。 */
  function putSetup(){if(!DRAFTS)return;if(S.scanDepartment||S.scanProject||S.scanProjectInput)bagPut('scan-setup','new',{dept:S.scanDepartment,proj:S.scanProject,projIn:S.scanProjectInput});else bagDiscard('scan-setup','new');}
  function ensureSetupDraft(){if(S._setupRestored||S.sess||!draftAcct())return;S._setupRestored=true;const b=bagGet('scan-setup','new');if(b&&(b.dept||b.proj||b.projIn)){if(!S.scanDepartment&&b.dept)S.scanDepartment=b.dept;if(!S.scanProject&&!S.scanProjectInput){if(b.proj)S.scanProject=b.proj;if(b.projIn)S.scanProjectInput=b.projIn;}S.setupRestored=true;}}
  function ensureRecvDraft(){if(!draftAcct()||!S.recvBatch)return;S._recvR=S._recvR||{};if(S._recvR[S.recvBatch])return;S._recvR[S.recvBatch]=true;if(!S.recvCode){const d=bagGet('recv-serial',S.recvBatch);if(d&&d.v){S.recvCode=d.v;S.recvRestored=S.recvBatch;}}}
  function ensureSiteDraft(){if(S._siteRestored)return;S._siteRestored=true;if(!Object.keys(S.newSite||{}).length){const b=bagGet('site-new','new');if(b)S.newSite=b;}}
  function heldSync(){
    if(!DRAFTS)return;
    for(const [code,h] of Object.entries(S.scanHeld||{})){const ent=(h.sessionId||'')+':'+code;DRAFTS.put(draftAcct(),'scan-held',ent,{values:{code,zone:h.zone||'',sessionId:h.sessionId||'',uncertain:!!h.uncertain,error:String(h.error||''),at:new Date().toISOString()},base:{}});}
  }
  function heldDrop(code,sessionId){if(DRAFTS)DRAFTS.discard(draftAcct(),'scan-held',(sessionId||'')+':'+code);}
  function heldReloaded(){
    if(!DRAFTS)return [];const mem=new Set(Object.entries(S.scanHeld||{}).map(([c,h])=>(h.sessionId||'')+':'+c));
    return DRAFTS.list(draftAcct(),'scan-held').filter(r=>!mem.has(r.entity));
  }
  function draftCard(){
    if(!DRAFTS)return '';
    const mine=DRAFTS.list(draftAcct()).filter(r=>r.kind!=='scan-held'),held=heldReloaded();
    const lab=r=>esc(KIND_LABEL[r.kind]||'草稿')+' · '+esc(String(r.entity).slice(0,40));
    let h='<details class="card" id="erp-draft-card" style="margin:12px 0;grid-column:1/-1;width:100%;box-sizing:border-box"'+((held.length||S.draftClearAsk)?' open':'')+'><summary><b>本機草稿</b><span class="small"> · '+mine.length+' 筆'+(held.length?' · '+held.length+' 筆待核對掃描':'')+'</span></summary><p class="small">草稿存在這台裝置的瀏覽器，尚未存入正式資料，不會自動刪除。畫面只列出目前登入帳號的草稿；這只是介面分開，不是加密，同一台電腦上能操作瀏覽器的人仍可能讀到儲存內容，共用電腦請在離開前刪除。</p>';
    h+=mine.length?'<ul class="small">'+mine.map(r=>'<li>'+lab(r)+'</li>').join('')+'</ul>':'<p class="small">目前沒有保留中的草稿。</p>';
    if(held.length)h+='<div class="warn">上次中斷時有 '+held.length+' 筆掃描沒有確認保存，不會自動重送。請先到設備紀錄核對編號再移除：</div>'+held.map(r=>'<div class="small">'+esc(r.payload.values.code)+' · '+esc(r.payload.values.zone)+' · '+(r.payload.values.uncertain?'結果待查':'未保存')+'<button class="pill sm" data-a="held-ack" data-v="'+esc(r.entity)+'">我已核對，移除這筆</button></div>').join('');
    if(S.draftClearAsk){h+='<div class="warn">將永久刪除'+('你的 '+mine.length+' 筆草稿')+'（尚未存入正式資料，無法復原；待核對掃描不受影響）。</div><button class="pill" data-a="draft-clear-do">確定刪除</button><button class="pill" data-a="draft-clear-no">先不要</button>';}
    else{if(mine.length)h+='<button class="pill" data-a="draft-clear-ask" data-v="mine">刪除我的草稿</button>';}
    return h+'</details>';
  }
  if(typeof repairUI!=='undefined'&&repairUI&&repairUI.setDrafts&&DRAFTS)repairUI.setDrafts({get:k=>{const r=DRAFTS.get(draftAcct(),'repair',k);return r&&r.payload;},put:(k,v)=>DRAFTS.put(draftAcct(),'repair',k,v),discard:k=>DRAFTS.discard(draftAcct(),'repair',k)});
  function draftLine(){return '<div id="erp-draft-line" aria-live="polite">'+draftInner()+'</div>';}
  const S = {
    booting: !D.isMock, mode: new URLSearchParams(location.search).get("mode") === "phone" ? "phone" : "pc", workspaceMore: false,
    dtab: "dash", dash: false, screen: "start",
    place: "", gps: null, gpsErr: "", site: "", zone: "", zoneOpen: false,
    open: "", filter: "all", metric: "total", dsite: "", dst: "", pfilter: "",
    asite: "", editCode: "", editDraft: null, savedAt: "", newZone: {}, newSite: {}, siteErr: "", sess: null, manualCode: "", camOn: false, camErr: "", camLast: "", camLastAt: 0,
    mapSite: "", mapZone: "", mapImg: "", mapEdit: false, retTab: "", scanDepartment: "", scanSetupErr: "", scanProject: "", scanProjectInput: "", afOrigin: "", afBrand: "", afType: "", ageBasis: "purchase", ageFilter: "", ibOpen: "", ibConfirm: "", ibDraft: null, recvBatch: "", recvCode: "", recvLast: null
  };

  /* ---- 資料導出 ---- */
  const db = () => store.state();
  const sites = () => db().sites;
  const siteNames = () => sites().map((s) => s.name);
  const siteOf = (n) => sites().find((s) => s.name === n);
  const zonesOf = (n) => { const s = siteOf(n); return s ? s.zones : []; };
  const assets = () => db().assets;
  const getA = (code) => assets().find((a) => a.code === code);
  const projects = () => [...new Set([...db().projects, D.UNASSIGNED])];
  const allRecords = () => db().records.map((r) => ({ ...r, sessionSite: (db().sessions.find((x) => x.id === r.sessionId) || {}).site || "" }));
  function lastRecordOf(code) {
    const rs = allRecords().filter((r) => r.code === code);
    return rs.length ? rs[rs.length - 1] : null;
  }
  /* 掃描相符＝最後一筆掃描當下比對相符；標記補登＝新登記待核對。皆不代表保管人／座位／部門或整場盤點完成。 */
  const isScanOk = (r) => !!r && r.status === "ok" && r.sessionSite !== undefined;
  const isRegPending = (r) => !!r && r.status === "none";
  const curRecs = () => (S.sess ? store.sessionRecords(S.sess) : []);
  /* 位置圖標記：只存「區域 → 圖上位置」對照（本機測試用）。正式版對照放試算表、圖檔放私有儲存，不放公開 repo。 */
  const MARKS_KEY = "zg_erp_mapmarks_v1";
  function getMarks() { try { return JSON.parse(localStorage.getItem(MARKS_KEY) || "{}"); } catch { return {}; } }
  function setMark(site, zone, x, y) { const m = getMarks(); (m[site] = m[site] || {})[zone] = { x, y }; try { localStorage.setItem(MARKS_KEY, JSON.stringify(m)); } catch {} }

  function siteRows() {
    return sites().map((s) => {
      const mine = assets().filter((a) => a.site === s.name);
      const isMis = (r) => r && !isRegPending(r) && (r.sessionSite !== s.name || r.zone !== (mine.find((x) => x.code === r.code) || {}).zone);
      const done = mine.filter((a) => { const r = lastRecordOf(a.code); return isScanOk(r) && !isMis(r); }).length;
      const reg = mine.filter((a) => isRegPending(lastRecordOf(a.code))).length;
      const mismatch = mine.filter((a) => isMis(lastRecordOf(a.code))).length;
      const noscan = mine.filter((a) => !lastRecordOf(a.code)).length;
      const pct = mine.length ? Math.round((done / mine.length) * 100) : 0;
      return { n: s.name, t: mine.length, done, reg, left: noscan, z: mismatch, pct };
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
    const regPending = assets().filter((a) => { const r = lastRecordOf(a.code); return isRegPending(r) && !!r.decision; }).length;
    return { items, undecided, recv, regPending };
  }
  function attentionCard() {
    const { items, undecided, recv, regPending } = attention();
    if (!items.length && !undecided && !recv.length && !regPending) return '<div class="acard ok"><b>目前沒有需要立即處理的項目。</b><span class="small">待修、維修中、保固到期和未決定的盤點差異會列在這裡。</span></div>';
    const shown = items.slice(0, 6);
    let rows = shown.map((x) =>
      '<div class="arow2"><span class="dot ' + x.tone + '"></span><span class="aname"><b>' + esc(x.a.name) + "</b> " + esc(x.a.code) +
      '<br><span class="small">' + esc(x.a.site) + " " + esc(x.a.zone) + " · 保管人 " + esc(x.a.owner) + " · " + esc(x.why) + '</span></span>' +
      '<button class="pill sm" data-a="ajump" data-v="' + esc(x.a.code) + '">處理</button></div>').join("");
    recv.forEach((x) => { rows += '<div class="arow2"><span class="dot mid"></span><span class="aname"><b>進貨「' + esc(x.b.vendor || x.b.model || "未填廠商") + "」</b>" +
      (x.left ? "待收 " + x.left + " 台" : "已收齊 ") + (x.got ? "，已核對 " + x.got + " 台待確認入庫" : "") +
      '<br><span class="small">' + esc(x.b.brand || "未填品牌") + " · " + esc(x.b.model || "未填型號") + " · 產地 " + esc(x.b.origin) + '</span></span>' +
      '<button class="pill sm" data-a="goinbound" data-v="' + esc(x.b.id) + '">去核對</button></div>'; });
    if (undecided) rows += '<div class="arow2"><span class="dot mid"></span><span class="aname"><b>' + undecided + " 筆盤點差異</b>還沒決定" +
      '<br><span class="small">手機掃到的位置不符或查無編號，決定後才會從這裡消失。</span></span>' +
      '<button class="pill sm" data-a="godiff">去決定</button></div>';
    if (regPending) rows += '<div class="arow2"><span class="dot mid"></span><span class="aname"><b>' + regPending + " 台已登記待核對</b>（補登的新資產）" +
      '<br><span class="small">已標記補登，但尚未與既有帳比對，不算已盤點；僅涵蓋目前這些補登資產。</span></span>' +
      '<button class="pill sm" data-a="metric" data-v="reg">看明細</button></div>';
    if (items.length > shown.length) rows += '<div class="small">另有 ' + (items.length - shown.length) + " 筆；到「設備資料」依狀態篩選可逐筆處理。</div>";
    return '<div class="acard"><div class="albl">需要處理（' + (items.length + (undecided ? 1 : 0) + (regPending ? 1 : 0) + recv.length) + "）</div>" + rows + "</div>";
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

  function legacyDetails(code) {
    if (typeof store.legacyRows !== "function") return "";
    const rows = store.legacyRows().filter((r) => r.code === code);
    if (!rows.length) return '<div class="small">舊帳：查無此完整編號；不猜名稱、型號或序號。</div>';
    if (rows.length !== 1) return '<div class="warn">舊帳同完整編號有 ' + rows.length + ' 筆，請至舊帳比對確認，未自動選取。</div>';
    const r = rows[0], current = getA(code);
    const conflicts = current ? ["name", "model", "serial", "purchase"].filter((k) => current[k] && r[k] && String(current[k]).trim() !== String(r[k]).trim()) : [];
    const warning = conflicts.length ? '<div class="warn">新舊資料不同（' + esc(conflicts.join("、")) + '），保留新帳待查。</div>' : "";
    return warning + '<div class="small legacydetail">舊帳參考（尚未確認為現況）：' + esc(r.name || "名稱未填") + " · 型號 " + esc(r.model || "未填") + " · S/N " + esc(r.serial || "舊帳未填") + '<br>出處 ' + esc(r.provenance || r.siteLead || "") + " · " + esc(r.recordKey || "") + " · 原區域 " + esc(r.zone || "未填") + " · 原位置 " + esc(r.place || "未填") + "。不自動改使用部門、專案或保管人。</div>";
  }

  function editValues(x) {
    const d={ name:x.name||"",model:x.model||"",department:x.department||"",owner:x.owner||"",zone:x.zone||"",status:x.status||"",project:x.project||"",serial:x.serial||"",purchase:x.purchase||"",activate:x.activate||"",warranty:x.warranty||"",brand:x.brand||"",origin:x.origin||"",mfgYear:x.mfgYear||"",type:x.type||"",po:x.po||"" };
    S.editBase={...d}; S.editLegacy=[];
    const matches=(store.legacyRows?store.legacyRows():[]).filter(r=>r.code===x.code);
    if(matches.length===1)for(const k of ["name","model","serial","purchase"])if(!String(d[k]).trim()&&matches[0][k]){d[k]=matches[0][k];S.editLegacy.push(k);}
    return d;
  }


  function cascadePlanFor(code,draft,base){
    if(!code||!draft||!base||!window.ErpEditCore)return null;
    const changed={};
    if(String(draft.owner??'')!==String(base.owner??''))changed.owner=String(draft.owner??'');
    if(String(draft.department??'')!==String(base.department??''))changed.department=String(draft.department??'');
    if(!Object.keys(changed).length)return null;
    const ready=seatUI&&seatUI.state&&seatUI.state.loaded&&store.seatReady;
    if(!ready)return {unavailable:true,fields:Object.keys(changed),peers:[]};
    const plan=window.ErpEditCore.planSeatCascade({bindings:seatUI.seatBindings(),assets:assets(),code,changed});
    return plan;
  }
  async function openControlledEditor(code){
    if(S.editBusy)return;const x=getA(code);if(!x)return;
    if(S.editCode&&S.editCode!==code&&!D.isMock)await store.releaseAssetEdit(S.editCode);
    S.editTouched=false;S.editCode=code;S.editDraft=editValues(x);S.editError='';S.editSeat='';S.savedAt='';S.editBusy=true;S.editLocked=true;S.cascadeInfo='';render();
    try{if(!D.isMock){await store.reserveAssetEdit(code);const fresh=await store.readAssetForEdit(code);S.editDraft=editValues(fresh);}draftApplyEdit(code);S.editConflict=false;S.editLocked=false;}
    catch(e){S.editError=e.message+'；輸入已保留，尚未保存。';}
    finally{S.editBusy=false;render();}
  }
  async function rebaseControlledEditor(){
    const code=S.editCode,draft={...S.editDraft},base={...S.editBase};if(!code||S.editBusy||S.editConflict)return;
    if(store._editReservations?.get(code)?.attempted){S.editError='上次寫入結果待查，輸入保留，不可重新取得權限或重送。';render();return;}
    S.editBusy=true;render();
    try{
      await store.releaseAssetEdit(code);await store.reserveAssetEdit(code);
      const fresh=await store.readAssetForEdit(code);
      const merged=window.ErpEditCore.rebase(base,draft,fresh),conflicts=merged.conflicts;
      if(!conflicts.length){S.editDraft=merged.values;S.editBase=merged.base;}
      if(conflicts.length){S.editConflict=true;S.editLocked=true;S.editError='資料已被其他操作改動，輸入保留但未保存。衝突欄位：'+(window.ErpDraftCore?window.ErpDraftCore.fieldLabels(conflicts):conflicts).join('、')+'。請取消後重新核對，不自動覆蓋。';await store.releaseAssetEdit(code);}
      else{S.editLocked=false;S.editError='已重新讀取並取得編輯權，原輸入保留；請核對後再儲存。';}
    }catch(e){S.editLocked=true;S.editError=e.message;}
    finally{S.editBusy=false;render();}
  }
  function noteControlledActivity(){S.editTouched=true;if(D.isMock||!S.editCode||S.editLocked)return;store.noteEditActivity(S.editCode).catch(e=>{S.editLocked=true;S.editError=e.message;render();});}
  /* ---- 掃描 ---- */
  async function scan(code,retained,captured) {
    code = String(code || "").trim();
    if (!code || !S.sess) return;
    let seatTarget = null;
    try { if(retained)seatTarget=retained.seatTarget;else if (typeof seatUI !== "undefined" && seatUI) seatTarget = seatUI.target(S.site, S.zone, code); }
    catch(e) { S.scanSetupErr = e.message; render(); return; }
    S.scanSetupErr = "";
    if(!D.isMock&&typeof store.scanIntentVerified==='function'){
      if(S.scanBusy){S.scanQueue=S.scanQueue||[];S.scanQueue.push(retained||{sessionId:S.sess.id,code,zone:S.zone,seatTarget,...(captured||{})});render();return;}
      S.scanUncertain=false;
      S.scanBusy=true;S.scanIntent=retained||{sessionId:S.sess.id,code,zone:S.zone,seatTarget,...(captured||{})};S.manualCode=code;render();
      try{await S.sess.__write;if(S.sess.__unsynced)throw Error('盤點場次尚未保存，不能追加掃描');await store.scanIntentVerified(S.scanIntent);S.scanIntent=null;if(S.scanHeld)delete S.scanHeld[code];heldDrop(code,S.sess&&S.sess.id);S.manualCode='';S.open=code;}
      catch(e){S.scanSetupErr=e.message;S.scanUncertain=!e.safeToRetry;S.scanHeld=S.scanHeld||{};S.scanHeld[code]={...S.scanIntent,uncertain:S.scanUncertain,error:e.message};heldSync();}
      finally{S.scanBusy=false;render();const next=S.scanQueue?.shift();if(next)scan(next.code,next);}return;
    }
    const a = getA(code);
    const status = !a ? "none" : a.site !== S.site ? "site" : a.zone !== S.zone ? "zone" : "ok";
    const rawProject = String(S.sess.project || "").trim();
    const sessProj = ["", "全部", "全部專案", "未指定", "未指定（待確認）", "未指定(待確認)"].includes(rawProject) ? "" : rawProject;
    const pm = !!(a && sessProj && a.project && a.project !== D.UNASSIGNED && a.project !== sessProj); // 未指定不算衝突：依 14:30 定案歸入本次專案
    store.addRecord(S.sess, { code, status, zone: S.zone, department: S.sess.department || "", at: new Date().toISOString(), projMismatch: pm, sessProject: sessProj });
    /* 12:07 商業規則：現場掃到的設備寫進新帳（使用中）；既有待修/維修/報廢不回沖，記例外提示 */
    if (typeof store.observeAsset === "function") {
      const obs = store.observeAsset(S.sess, code, S.zone);
      if (obs && (obs.exception || obs.assignedProject || obs.departmentMismatch || obs.metadataIssue)) {
        const rec = [...curRecs()].reverse().find((r) => r.code === code);
        if (rec && obs.metadataIssue) rec.metadataIssue = obs.metadataIssue;
        if (rec && obs.departmentMismatch) rec.departmentMismatch = true;
        if (rec && obs.exception) rec.stateException = obs.reason;
        if (rec && obs.assignedProject) rec.projectAssigned = obs.assignedProject; // 原本未指定專案 → 已歸入本次專案（14:30 定案）
      }
    }
    if (seatTarget && typeof seatUI !== "undefined" && seatUI) {
      const rec = [...curRecs()].reverse().find(r => r.code === code);
      const scanSess=S.sess,scanSite=S.site,scanZone=S.zone;
      rec.__seatRetry=()=>seatUI.bind(code,scanSite,scanZone,scanSess,seatTarget);
      rec.__seatPending = true;
      Promise.all([rec.__write,getA(code)?.__write,scanSess.__write].filter(Boolean)).then(() => rec.__seatRetry()).then(() => {rec.__seatPending=false;rec.__seatError="";render();}).catch(e => {rec.__seatPending=false;rec.__seatError=e.message;render();});
    }
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
    if (S.scanProjectInput.trim()) S.scanProject = S.scanProjectInput.trim();
    S.scanDepartment = S.scanDepartment.trim();
    S.scanSetupErr = "";
    const begin = (fix) => {
      const g = fix || S.gps || { lat: null, lon: null, acc: null };
      try { S.sess = store.startSession(S.site, g.lat, g.lon, g.acc != null ? g.acc : null, S.scanProject || "", "", S.scanDepartment); }
      catch (err) { S.scanSetupErr = err.message; render(); return; }
      bagDiscard('scan-setup','new'); S.setupRestored = false;
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
  const cam = { busy:false, format:"", stream: null, det: null, timer: null, canvas: null, dedup: null, engine: "", detection: null };
  function camStop(silent) {
    if (cam.timer) { clearInterval(cam.timer); cam.timer = null; }
    if (cam.stream) { cam.stream.getTracks().forEach((t) => t.stop()); cam.stream = null; }
    cam.det = null; cam.engine = ""; cam.detection = null;
    S.camOn = false;
    if (!silent) render();
  }
  function drawQrFrame() {
    const svg = document.getElementById("qrframe"), poly = document.getElementById("qrpolygon"), label = document.getElementById("qrdetected");
    if (!svg || !poly) return;
    const d = cam.detection;
    const visible = !!(d && d.value && d.points);
    svg.toggleAttribute("hidden", !visible);
    if (visible) {
      svg.setAttribute("viewBox", "0 0 " + d.width + " " + d.height);
      poly.setAttribute("points", d.points.map((p) => p.x + "," + p.y).join(" "));
    } else poly.removeAttribute("points");
    if (label) label.textContent = d && d.value ? (visible ? "已辨識 QR／條碼，框線是實際位置；儲存狀態見下方" : "已辨識，但瀏覽器未提供位置，無法畫框；儲存狀態見下方") : "對準標籤；嗶聲只表示已讀到，保存狀態見下方";
  }
  function camOnDetection(detection) {
    cam.detection = detection;
    drawQrFrame();
    camOnCode(detection && detection.value || "", detection && detection.format || cam.format);
  }
  function camOnCode(val,format) {
    if (!cam.dedup) cam.dedup = ErpScanCore.makePresenceDeduper(1500);
    if (!cam.dedup.accept(val)) return;
    window.ErpReadFeedback?.beep();
    const isQr = /^(qr_code|QRCode)$/i.test(format||'');
    if(isQr){S.vendorReview=null;scan(val);return;} // Preserve existing deliberate QR flow.
    const hits=assets().filter(a=>a.code===val||a.serial===val);
    const unique=[...new Map(hits.map(a=>[a.code,a])).values()];
    if(unique.length===1){S.vendorReview=null;scan(unique[0].code,null,{scanSource:'vendor',scanRaw:val,scanFormat:format});return;}
    S.vendorReview={raw:val,format:format||'未知碼別',reason:unique.length?'同一條碼符合多台設備，尚未入帳':'未能唯一對應設備，尚未入帳'};
    render();
  }
  async function camTick() {
    const v=document.getElementById('camv');
    if(cam.busy||!v||v.readyState<2||!S.sess)return;
    cam.busy=true;
    try {
      if(!cam.canvas)cam.canvas=document.createElement('canvas');
      const w=v.videoWidth,h=v.videoHeight;if(!w||!h)return;
      cam.canvas.width=w;cam.canvas.height=h;
      const ctx=cam.canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(v,0,0,w,h);
      const codes=await window.ZXingWASM.readBarcodes(ctx.getImageData(0,0,w,h),{formats:['QRCode','Code128','Code39','EAN13','EAN8','ITF','DataMatrix','PDF417','Aztec'],tryHarder:true,maxNumberOfSymbols:1});
      const c=codes.find(x=>x.isValid);cam.format=c?.format||'';
      camOnDetection(c?{value:c.text,format:c.format,width:w,height:h,points:[c.position.topLeft,c.position.topRight,c.position.bottomRight,c.position.bottomLeft]}:{value:'',width:w,height:h,points:null});
    }catch(e){cam.detection=null;drawQrFrame();S.camErr='辨識元件暫時失敗，尚未入帳。可重新開相機或使用手動輸入。';}
    finally{cam.busy=false;}
  }
  function camStart() {
    window.ErpReadFeedback?.unlock().then(ok=>{S.audioReady=ok;const h=document.getElementById('qrdetected');if(h&&!ok)h.textContent='音效未啟用；請看辨識提示與保存狀態';});
    window.ZXingWASM?.setZXingModuleOverrides({locateFile:p=>p.endsWith(".wasm")?new URL("vendor/zxing_reader.wasm",location.href).href:p});
    S.camErr = "";
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      S.camErr = "這個瀏覽器沒有相機功能（需要 HTTPS 與支援的瀏覽器），請用輸入或測試按鈕。"; render(); return;
    }
    const hasBD = false;
    if (!window.ZXingWASM) {
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
      cam.engine = "zxing";
      if (hasBD) cam.det = new BarcodeDetector({ formats: ["qr_code", "code_128", "code_39", "ean_13", "ean_8", "data_matrix"] });
      cam.dedup = ErpScanCore.makePresenceDeduper(1500);
      S.camOn = true; S.camLast = ""; S.camLastAt = 0;
      render();
      cam.timer = setInterval(camTick, 700);
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
    if(seatUI)seatUI.layout();
    if (S.camOn && cam.stream) {
      const v = document.getElementById("camv");
      if (v && v.srcObject !== cam.stream) { v.srcObject = cam.stream; v.play().catch(() => {}); }
      drawQrFrame();
    }
  }

  /* ---- 共用元件 ---- */
  function mockBar() {
    if (!D.isMock) return "";
    return '<div class="mockbar">這是<b>測試資料</b>畫面：資料為虛構範例，只存在這個瀏覽器，不會寫入你的 Google 試算表或任何正式系統。正式版將直接讀寫你的試算表（欄位對照待你提供實際表格）。</div>';
  }
  /* 同步狀態徽章：同步中／未同步（可點重試）。只更新徽章，不整頁重繪，避免打斷掃描。 */
  function syncBadge() {
    if (D.isMock || typeof store.syncStatus !== "function") return "";
    setTimeout(refreshSyncBadge, 0); /* 整頁重繪會重建徽章（預設隱藏），重繪後立刻補上內容 */
    return '<div id="erp-sync-badge" class="syncbadge" style="display:none"></div><div id="erp-version-badge" class="versionbadge" style="display:none"></div>';
  }
  const LOADED_BUILD = { id: "2026-11-05.10" }; /* 隨本頁程式載入的建置識別（不含手填時間）；每次部署必須同步改這裡與 version.json 的 build。發布時間只取伺服器回應的 Last-Modified */
  async function checkAppVersion() {
    if (D.isMock) return;
    try {
      const res = await fetch("version.json", { cache: "reload" });
      if (!res.ok) return;
      const v = await res.json();
      S.manifest = v;
      if (v.build === LOADED_BUILD.id) S.servedAt = res.headers.get("last-modified") || "";
      S.newerVersion = !!(v.build && v.build !== LOADED_BUILD.id);
      refreshVersionBadge();
    } catch (e) { /* 版本檢查失敗不擋使用 */ }
  }
  function refreshVersionBadge() {
    const el = document.getElementById("erp-version-badge");
    if (!el) return;
    if (D.isMock) { el.style.display = "none"; return; }
    const st = (typeof store.syncStatus === "function") ? store.syncStatus() : {};
    const fmt = (iso) => { if (!iso) return "尚未成功同步"; const d = new Date(iso); return d.toLocaleString("zh-TW", { hour12: false, month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }); };
    const ver = "此頁版本 " + LOADED_BUILD.id + (S.servedAt ? " · 版本檔最後修改 " + fmt(new Date(S.servedAt).toISOString()) : " · 發布時間未確認");
    let cls = "versionbadge", extra = "";
    if (st.unsynced > 0) { cls += " bad"; extra = " · 同步失敗 " + st.unsynced + " 筆（見上方提示）"; }
    else if (st.pending > 0) { cls += " ing"; extra = " · 同步中"; }
    if (S.newerVersion) { cls += " new"; extra += " · 已有新版本 " + String(S.manifest.build) + "，請重新整理"; }
    el.className = cls;
    el.textContent = ver + " · 整份資料最後完整讀取 " + fmt(st.lastSync) + extra;
    el.style.display = "";
  }
  function refreshSyncBadge() {
    if (D.isMock || typeof store.syncStatus !== "function") return;
    const el = document.getElementById("erp-sync-badge");
    if (!el) return;
    const st = store.syncStatus();
    if (st.unsynced > 0) {
      el.style.display = "";
      el.className = "syncbadge bad";
      el.textContent = st.unsynced + " 筆未同步（寫入失敗，資料只在本機）——點此重試";
    } else if (st.pending > 0) {
      el.style.display = "";
      el.className = "syncbadge ing";
      el.textContent = "同步中…" + st.pending + " 筆";
    } else {
      el.style.display = "none";
      el.textContent = "";
    }
    refreshVersionBadge();
  }
  function loginBar() {
    const s = session();
    if (s && s.access_token) {
      const exp = Number(s.expires_at || (s.session && s.session.expires_at) || 0);
      const expMs = exp ? (exp < 1e12 ? exp * 1000 : exp) : 0; // Supabase 秒級與 auth-service 毫秒級都接受
      if (expMs && expMs < Date.now() && !S.booting) {
        return '<div class="loginbar">諸葛登入狀態：工作階段已過期。<a href="' + LOGIN_URL + '">重新登入諸葛</a>（換發失敗時需要）</div>';
      }
      const who = s.user && (s.user.email || s.user.name) ? esc(s.user.email || s.user.name) : "已登入";
      return '<div class="loginbar">諸葛登入狀態：' + who + "</div>";
    }
    return '<div class="loginbar">尚未登入諸葛。' + (D.isMock ? '測試資料可直接操作；正式版需要 ' : '') + '<a href="' + LOGIN_URL + '">登入諸葛</a> 才能讀寫你的試算表。</div>';
  }
  function zhugeBar() {
    return '<div class="zhugebar"><b>諸葛</b><span>／ ZG-ERP 庫存 · 設備管理</span><a class="pill sm" style="display:inline-flex;align-items:center;text-decoration:none" href="../">返回諸葛</a></div>';
  }
  function modeBar() {
    const more = S.workspaceMore ? '<section class="workspace-more" aria-label="管理功能"><h3>管理功能</h3>'+[['geo','地圖總覽'],['assets','設備資料'],['inbound','入庫作業'],['zones','公司據點'],['map','座位圖'],['diff','盤點差異'],['legacy','舊帳比對']].map(([key,label])=>'<button class="pill" data-a="workspace-manage" data-v="'+key+'">'+label+'</button>').join('')+draftCard()+'<button class="pill" data-a="workspace-more">關閉</button></section>' : '';
    return '<nav class="workspace-nav" aria-label="工作區"><span class="workspace-title">設備管理工作區</span><button class="mb'+(S.mode==='pc'&&S.dtab==='dash'?' on':'')+'" data-a="workspace-overview">總覽</button><button class="mb'+(S.mode==='phone'?' on':'')+'" data-a="workspace-scan">掃描</button><button class="mb" aria-expanded="'+!!S.workspaceMore+'" data-a="workspace-more">更多管理</button></nav>'+more;
  }

  /* ---- 手機端 ---- */
  function phoneStart() {
    ensureSetupDraft();
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
      (siteNames().length === 0
        ? '<div class="chips"><span class="small">尚未建立據點。請先到「電腦 · 管理編輯 → 公司據點」新增第一個據點，這裡才會出現選項。</span></div>'
        : '<div class="chips">' + siteNames().map((p) => '<button class="pill' + (S.site === p ? " on" : "") + '" data-a="site" data-v="' + esc(p) + '">' + esc(p) + "</button>").join("") + "</div>") +
      (g && S.nearest && S.site && S.site !== S.nearest ? '<div class="warn">你選的據點和定位最近的據點不同，結果會註記。</div>' : "") +
      (store.departmentReady || D.isMock
        ? '<div class="lbl" style="margin-top:14px">本次使用部門（與專案、保管人分開）</div><input class="inp" data-f="scanDepartment" placeholder="例如：管理部；不確定可留白" value="' + esc(S.scanDepartment) + '"><div class="small">開始前設定，之後每筆沿用。未填就記未指定；已有其他部門的設備保留原登記並提示差異。</div>'
        : '<div class="warn">使用部門欄位尚未就緒，目前不會把部門混填到專案或保管人。</div>') +
      '<div class="lbl" style="margin-top:14px">這次主要盤哪個專案？（可先設定，掃描時沿用，不用每筆重選）</div>' +
      '<div class="chips"><button class="pill' + (S.scanProject === "" ? " on" : "") + '" data-a="sproj" data-v="">全部專案</button>' +
      projects().map((p) => '<button class="pill' + (S.scanProject === p ? " on" : "") + '" data-a="sproj" data-v="' + esc(p) + '">' + esc(p.replace("（測試）", "")) + "</button>").join("") + "</div>" +
      '<div class="frow"><input class="inp" data-f="scanProjectInput" placeholder="輸入專案名稱（新建或既有皆可）" value="' + esc(S.scanProjectInput) + '"><button class="btn mini" data-a="sprojset">設定</button></div>' +
      (S.scanProject && !projects().includes(S.scanProject) ? '<div class="small">本次自訂專案「' + esc(S.scanProject) + '」：掃到的新設備、以及原本未指定專案的設備，會登記到這個專案；已屬其他專案的設備歸屬不變，掃到會提示差異。</div>' : "") +
      '<div class="small">這次設定的專案會記在每一筆掃描裡；掃到的新設備、以及原本未指定專案的設備，會登記到這個專案。已屬其他專案的設備歸屬不變，掃到會提示差異並照樣記錄。</div>' +
      (S.site ? '<div class="match">本次範圍：<b>' + esc(S.site) + "</b>" + (S.scanProject ? " · <b>" + esc(S.scanProject.replace("（測試）", "")) + "</b>" : " · 全部專案") +
        " · 應盤 <b>" + assets().filter((a) => a.site === S.site && (!S.scanProject || (a.project || D.UNASSIGNED) === S.scanProject)).length + "</b> 台</div>" : "") +
      "</div>" +
      (S.scanSetupErr ? '<div class="warn">' + esc(S.scanSetupErr) + "</div>" : "") +
      (S.setupRestored ? '<div class="warn" id="setup-restored">已還原上次尚未開始的設定：部門「' + esc(S.scanDepartment || "未填") + '」、專案「' + esc(S.scanProject || S.scanProjectInput || "全部專案") + '」。這只是預填，沒有開始盤點、沒有寫入任何資料；請核對，按下面「開始連續掃描」才會生效。<button class="pill sm" data-a="setup-clear">清除這些還原內容</button></div>' : "") +
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
      const syncState = scanSyncState(r);
      toast = '<div class="toast t-' + st + (syncState === "failed" ? " syncfailed" : syncState === "pending" ? " syncpending" : "") + '">' +
        '<b data-scan-sync="' + esc(r.code) + '">' + esc(scanSyncCopy(syncState)) + '</b><span class="small">位置比對：' + esc(LABEL[st]) + '</span>' +
        '<div class="tname">' + (a ? esc(a.name || a.code) : "清冊中找不到") + "</div>" +
        '<div class="tcode">' + esc(r.code) + "</div>" +
        (a ? '<div class="tloc">設備狀態：<b>' + esc(a.status) + "</b>" + (a.status !== "使用中" && a.status !== "備用" ? "（掃描不會改狀態）" : "") +
          "<br>使用部門：<b>" + esc(a.department || "未指定") + "</b><br>歸屬專案：<b>" + esc(a.project || D.UNASSIGNED) + "</b><br>設備序號：" + esc(a.serial || "未登記") +
          "<br>登記：" + esc(a.site) + " " + esc(a.zone) + "<br>現場：" + esc(S.site) + " " + esc(r.zone) + "</div>" : "") +
        (a && a.legacyKey ? '<div class="small">名稱／型號等空白欄位已由舊帳補入新帳：' + esc(a.legacyProvenance) + " · " + esc(a.legacyKey) + "。保留來源快照；S/N 未填不猜。</div>" : "") +
        (lastShown.metadataIssue ? '<div class="warn">' + esc(lastShown.metadataIssue) + "</div>" : "") +
        legacyDetails(r.code) +
        (lastShown.departmentMismatch ? '<div class="warn">既有使用部門與本次設定不同，保留原登記；本次觀察另外保存，待管理端確認。</div>' : "") +
        (lastShown.projMismatch && a ? '<div class="warn">歸屬專案是「' + esc((a.project || D.UNASSIGNED).replace("（測試）", "")) + "」，和這次設定的「" + esc((lastShown.sessProject || "").replace("（測試）", "")) + "」不同。已記錄，不會自動改歸屬。</div>" : "") +
        (lastShown.projectAssigned ? '<div class="tloc">原本未指定專案，已歸入「' + esc(String(lastShown.projectAssigned).replace("（測試）", "")) + "」。</div>" : "") +
        (lastShown.stateException ? '<div class="warn">' + esc(lastShown.stateException) + "。需由管理端確認後才會變更，本次掃描已照常保存。</div>" : "") +
        (r.status === "none" && !lastShown.stateException ? '<div class="tloc">新設備依現場觀察登記「使用中」；是否存妥請以上方同步狀態為準。</div>' : "") + "</div>";
    } else {
      toast = D.isMock ? '<div class="toast idle">還沒掃到東西。輸入登記編號，或點下面的測試按鈕模擬掃描。</div>' : '<div class="toast idle">還沒掃到東西。對準設備標籤掃描，或手動輸入登記編號。</div>';
    }
    // The current unresolved intent must never inherit a previous scan's success card.
    if (S.scanIntent && (S.scanBusy || S.scanHeld?.[S.scanIntent.code])) {
      const current = S.scanIntent, uncertain = !!S.scanHeld?.[current.code]?.uncertain;
      const copy = S.scanBusy ? "正在核對保存，尚未確認完成。" : uncertain ? "保存結果待查，不能確認已保存。請勿重送，也不計入已掃筆數。" : "這筆尚未保存，輸入已保留。可在下方重試。";
      toast = '<div class="toast syncpending" data-current-scan="'+esc(current.code)+'"><b>'+esc(copy)+'</b><div class="tcode">本筆掃描：'+esc(current.code)+'</div><div class="small">區域：'+esc(current.zone||"未指定")+'。先前已完成的掃描另列於下方「本次已掃」。</div></div>';
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
      (scopeMiss.length ? '<div class="smeta">未掃：' + scopeMiss.slice(0, 8).map((a) => esc(a.name) + " " + esc(a.code)).join("、") + (scopeMiss.length > 8 ? " …等 " + scopeMiss.length + " 台" : "") + "</div>" : "") + "</div>";
    return '<div class="screen">' +
      '<div class="scanbar"><button class="zonebtn" data-a="zoneopen"><span class="lbl">' + esc(S.site) + " · 目前區域</span><b>" + esc(S.zone) + " ▾</b></button>" +
      '<button class="btn mini" data-a="toresult">結束 (' + recs.length + ")</button></div>" +
      '<div class="small">本次使用部門：' + esc(S.sess.department || "未指定") + " · 專案：" + esc(S.sess.project || "全部專案") + " · 經手人：" + esc(S.sess.operator || "未記錄") + "（開始前設定，這批沿用）</div>" +
      (seatUI ? seatUI.scanPanel(S.site,S.zone,S.sess,recs) : "") +
      scopeStrip +
      (S.scanSetupErr ? '<div class="warn">'+(S.scanUncertain?'本筆掃描 '+esc(S.scanIntent?.code||'')+'：保存結果待查，請勿重送。':esc(S.scanSetupErr))+(S.scanIntent&&!S.scanUncertain?'<button class="pill" data-a="scan-intent-retry">重試這筆未保存掃描</button>':'')+'</div>' : "") +
      recs.filter(r=>r.__seatError).map(r=>'<div class="warn">座位登記未同步：'+esc(r.code)+' · '+esc(r.__seatError)+'<button class="pill" data-seat-retry="'+esc(r.code)+'">重試座位登記（不重掃設備）</button></div>').join("") +
      '<div class="small">起點定位 ' + (S.sess.lat != null ? Number(S.sess.lat).toFixed(3) + ", " + Number(S.sess.lon).toFixed(3) + (S.sess.acc != null ? "（±" + S.sess.acc + " m）" : "") : "無（手動選擇據點）") + " · " + esc(new Date(S.sess.at).toLocaleTimeString("zh-TW", { hour12: false })) + "（固定，換區域不會改）</div>" +
      (S.zoneOpen ? '<div class="zonepick">' + zonesOf(S.site).map((z) => '<button class="pill' + (S.zone === z ? " on" : "") + '" data-a="zone" data-v="' + esc(z) + '">' + esc(z) + "</button>").join("") + "</div>" : "") +
      (S.camOn
        ? '<div class="view live"><video id="camv" autoplay playsinline muted></video><svg id="qrframe" class="qrframe" preserveAspectRatio="xMidYMid meet" aria-hidden="true" hidden><polygon id="qrpolygon" vector-effect="non-scaling-stroke"></polygon></svg><span id="qrdetected" class="detectedhint" aria-live="polite">對準標籤；嗶聲只表示已讀到，保存狀態見下方</span><span class="hint">' + (cam.engine === "jsqr" ? "對準 QR 碼（此瀏覽器僅支援 QR），掃到會自動記一筆（同一張持續對準只記一次，移開約 1.5 秒後可再掃）" : "對準 QR／條碼，掃到會自動記一筆（同一張持續對準只記一次，移開約 1.5 秒後可再掃）") + '</span></div><div class="frow"><button class="pill sm" data-a="camstop">關閉相機</button></div>'
        : '<div class="view" role="img" aria-label="相機取景區"><i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i><div class="qr"></div><span class="hint">可用相機連續掃描，或用下方手動輸入</span></div><div class="frow"><button class="pill sm" data-a="camstart">開啟相機掃描</button></div>' + (S.camErr ? '<div class="warn">' + esc(S.camErr) + "</div>" : "")) +
      toast +
      (S.scanBusy?'<div class="warn">正在核對保存：'+esc(S.scanIntent?.code||'')+'，完成前不計入成功。</div>':'')+(S.scanQueue?.length?'<div class="warn">等候保存：'+S.scanQueue.map(x=>esc(x.code)).join('、')+'</div>':'')+
      heldReloaded().map(r=>'<div class="warn">上次中斷的掃描 '+esc(r.payload.values.code)+'：'+(r.payload.values.uncertain?'結果待查':'未保存')+'，不會自動重送。請先核對該編號的紀錄，再到「管理功能 › 本機草稿」移除。</div>').join('') +
      Object.values(S.scanHeld||{}).map(x=>'<div class="warn">'+(x.uncertain?'結果待查掃描 ':'未保存掃描 ')+esc(x.code)+' · '+esc(x.zone)+'：'+(x.uncertain?'不能確認已保存':esc(x.error))+(x.uncertain?'（結果待查，不可重送）':'<button class="pill" data-a="scan-intent-retry" data-v="'+esc(x.code)+'">重試這筆</button>')+'</div>').join('') +
      '<div class="frow"><input class="inp" data-f="manualCode" placeholder="輸入登記編號（如 CSPH107030182）" value="' + esc(S.manualCode) + '"><button class="btn mini" data-a="manual">手動登記</button></div>' +
      (D.isMock
        ? '<div class="lbl sim">測試用：模擬掃到（虛構設備）</div><div class="chips">' +
          siteAssets.slice(0, 4).map((a) => '<button class="pill sm" data-a="scan" data-v="' + esc(a.code) + '">' + esc(a.name) + " " + esc(a.code) + "</button>").join("") +
          (foreign ? '<button class="pill sm" data-a="scan" data-v="' + esc(foreign.code) + '">其他據點的設備</button>' : "") +
          (otherProj ? '<button class="pill sm" data-a="scan" data-v="' + esc(otherProj.code) + '">其他專案的設備</button>' : "") +
          '<button class="pill sm" data-a="scan" data-v="CSXX999999999">不在清冊內的編號</button>' +
          (last ? '<button class="pill sm" data-a="scan" data-v="' + esc(last.code) + '">再掃同一個</button>' : "") + "</div>"
        : "") +
      '<div class="lbl sim">本次已掃 ' + recs.length + " 筆（有座位圖時依座位編號排列）</div>" +
      (seatUI && seatUI.mapFor(S.site,S.zone) ? seatUI.orderedRecords(recs) : [...recs].reverse()).map((r) => {
        const a = getA(r.code);
        return '<button class="item" data-a="open" data-v="' + esc(r.code) + '">' + chip(dupFlag(r)) +
          '<span class="iname">' + (seatUI?esc(seatUI.recordLabel(r.code))+' · ':'') + esc(a ? a.name : r.code) + '</span><span class="icode">' + esc(r.code) + "</span>" +
          (S.open === r.code ? '<span class="idet">' + (a ? esc(a.model) + " · S/N " + esc(a.serial || "未登記") + " · 狀態 " + esc(a.status) + " · 保管人 " + esc(a.owner ? (a.owner === "公用" && a.source === "盤點" ? "公用（舊版預設，未確認）" : a.owner) : "未確認") + " · 使用部門 " + esc(a.department || "未指定") + " · 歸屬 " + esc(a.project || D.UNASSIGNED) + " · 購入 " + esc(a.purchase || "未登記") + " · 啟用 " + esc(a.activate || "未登記") + " · 保固 " + esc(a.warranty || "未登記") + " · 登記 " + esc(a.site) + " " + esc(a.zone) : "清冊無此編號") + " · " + esc(new Date(r.at).toLocaleTimeString("zh-TW", { hour12: false })) + (r.n > 1 ? " · 已重複 " + r.n + " 次" : "") + (r.departmentMismatch ? " · 使用部門不同（保留原登記）" : "") + " · 本次部門 " + esc(r.department || "未指定") + (r.projMismatch ? " · 歸屬專案與本次範圍不同（未改歸屬）" : "") + (r.projectAssigned ? " · 原本未指定專案→已歸入本次專案" : "") + (r.stateException ? " · ⚠ " + esc(r.stateException) : "") + "</span>" : "") + "</button>";
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
      '<p class="psub">起點定位 ' + (S.sess.lat != null ? Number(S.sess.lat).toFixed(3) + ", " + Number(S.sess.lon).toFixed(3) + (S.sess.acc != null ? "（±" + S.sess.acc + " m）" : "") : "無") + " · 使用部門 " + esc(S.sess.department || "未指定") + " · 專案 " + esc(S.sess.project || "全部專案") + " · 共掃 " + recs.length + " 筆" + (D.isMock ? " · 只存在這個瀏覽器，尚未連接試算表" : " · 寫入你的試算表；失敗會標「未同步」，點一下可重試") + "</p>" +
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
          (miss.length ? '<span class="miss">未掃：' + miss.map((a) => esc(a.name) + " " + esc(a.code)).join("、") + "</span>" : "") + "</div>";
      }).join("") + "</div>" +
      '<div class="lbl sim">需要你決定（' + todo.length + "）</div>" +
      '<div class="chips"><button class="pill sm' + (S.filter === "all" ? " on" : "") + '" data-a="filter" data-v="all">全部</button><button class="pill sm' + (S.filter === "todo" ? " on" : "") + '" data-a="filter" data-v="todo">只看待處理</button></div>' +
      (shown.length === 0 ? '<div class="toast idle">沒有要處理的項目。</div>"'.replace('"</div>"', '"') : shown.map((r) => {
        const a = getA(r.code);
        return '<div class="item static">' + chip(r.status) + syncMark(r) + '<span class="iname">' + esc(a ? a.name : r.code) + '</span><span class="icode">' + esc(r.code) + "</span>" +
          '<span class="idet">' + (a ? esc(a.status) + " · S/N " + esc(a.serial || "未登記") + " · 使用部門 " + esc(a.department || "未指定") + " · 歸屬 " + esc(a.project || D.UNASSIGNED) + " · 購入 " + esc(a.purchase || "未登記") + " · 保固 " + esc(a.warranty || "未登記") + " · 登記 " + esc(a.site) + " " + esc(a.zone) + " → 現場 " + esc(S.site) + " " + esc(r.zone) : "清冊查無，需補登") + "</span>" +
          decisionButtons(r) + "</div>";
      }).join("")) +
      '<div class="hand">接下來在電腦整理：這批掃描已寫進試算表，「電腦 · 管理編輯」的盤點差異會看到同一份。</div>' +
      '<button class="btn" data-a="mode" data-v="pc">到電腦管理端處理</button>' +
      '<button class="btn secondary" data-a="tostart">回到起點</button></div>';
  }
  function phoneDash() {
    const rows = siteRows();
    const sum = rows.reduce((a, r) => ({ t: a.t + r.t, d: a.d + r.done, g: a.g + r.reg, n: a.n + r.left, z: a.z + r.z }), { t: 0, d: 0, g: 0, n: 0, z: 0 });
    const metric = S.metric;
    const sorted = [...rows].sort((a, b) => metric === "reg" ? b.reg - a.reg : metric === "todo" ? b.left - a.left : metric === "zone" ? b.z - a.z : metric === "done" ? b.pct - a.pct : b.t - a.t);
    return '<div class="screen"><h3 class="ptitle">統計儀表板</h3><p class="psub">' + (D.isMock ? "由本頁測試資料即時計算，不是公司實際資料。" : "由現存資料庫即時計算。") + '</p>' + dashBody(rows, sum, sorted, true) + "</div>";
  }
  function dashBody(rows, sum, sorted, isPhone) {
    const metric = S.metric, dst = S.dst, pfilter = S.pfilter;
    let drill = "";
    if (metric !== "total") {
      let list = [];
      if (metric === "done") list = assets().filter((a) => { const r = lastRecordOf(a.code); return isScanOk(r) && r.sessionSite === a.site && r.zone === a.zone; }).map((a) => ({ a, tag: "掃描相符", note: "" }));
      if (metric === "reg") list = assets().filter((a) => isRegPending(lastRecordOf(a.code))).map((a) => ({ a, tag: "已登記待核對", note: "補登新資產，尚未與既有帳比對" }));
      if (metric === "todo") list = assets().filter((a) => !lastRecordOf(a.code)).map((a) => ({ a, tag: "尚無掃描", note: "" }));
      if (metric === "zone") list = assets().filter((a) => { const r = lastRecordOf(a.code); return r && !isRegPending(r) && (r.sessionSite !== a.site || r.zone !== a.zone); }).map((a) => { const r = lastRecordOf(a.code); return { a, tag: "位置不符", note: "現場 " + r.sessionSite + " " + r.zone }; });
      if (dst) list = list.filter((x) => x.a.status === dst);
      drill = '<div class="drill"><div class="lbl">' + { done: "位置核對相符明細", reg: "已登記待核對明細", todo: "尚無掃描紀錄明細", zone: "位置不符明細" }[metric] + "（篩選：" + esc(dst || "全部狀態") + "）</div>" +
        (list.length === 0 ? '<div class="small">沒有符合的設備。</div>' : list.slice(0, 8).map((x) =>
          '<div class="zrow act"><span><b>' + esc(x.a.name) + "</b> " + esc(x.a.code) + '<br><span class="small">' + esc(x.a.site) + " " + esc(x.a.zone) + " · " + esc(x.a.status) + " · 歸屬 " + esc(x.a.project || D.UNASSIGNED) + (x.note ? " · " + esc(x.note) : "") + '</span></span><button class="pill sm" data-a="ajump" data-v="' + esc(x.a.code) + '">處理</button><span class="small">' + esc(x.tag) + "</span></div>").join("")) +
        (list.length > 8 ? '<div class="small">另有 ' + (list.length - 8) + " 筆。</div>" : "") + "</div>";
    }
    let projDrill = "";
    if (pfilter) {
      const list = projAssets(pfilter);
      projDrill = '<div class="drill"><div class="lbl">「' + esc(pfilter) + "」反查到 " + list.length + " 台，分布在 " + esc([...new Set(list.map((a) => a.site))].join("、") || "無") + "；同一專案可跨據點。</div>" +
        list.map((a) => '<div class="zrow act"><span><b>' + esc(a.name) + "</b> " + esc(a.code) + '<br><span class="small">' + esc(a.site) + " " + esc(a.zone) + " · " + esc(a.owner ? (a.owner === "公用" && a.source === "盤點" ? "公用（舊版預設，未確認）" : a.owner) : "未確認") + " · " + esc(a.status) + '</span></span><button class="pill sm" data-a="ajump" data-v="' + esc(a.code) + '">處理</button><span class="small">' + esc((a.project || D.UNASSIGNED).replace("（測試）", "")) + "</span></div>").join("") + "</div>";
    }
    const tiles = '<div class="' + (isPhone ? "tiles two" : "dtiles") + '">' +
      '<button class="tile tb' + (metric === "total" ? " sel" : "") + '" data-a="metric" data-v="total"><b>' + sum.t + "</b>設備總數</button>" +
      '<button class="tile tb' + (metric === "done" ? " sel" : "") + '" data-a="metric" data-v="done"><b>' + (sum.t ? Math.round((sum.d / sum.t) * 100) : 0) + "%</b>位置核對相符（" + sum.d + "／" + sum.t + " 台，依最後一筆掃描）</button>" +
      '<button class="tile tb' + (metric === "reg" ? " sel" : "") + '" data-a="metric" data-v="reg"><b>' + sum.g + "</b>已登記待核對</button>" +
      '<button class="tile tb' + (metric === "todo" ? " sel" : "") + '" data-a="metric" data-v="todo"><b>' + sum.n + "</b>尚無掃描紀錄</button>" +
      '<button class="tile tb' + (metric === "zone" ? " sel" : "") + '" data-a="metric" data-v="zone"><b>' + sum.z + "</b>位置不符</button></div>";
    const stChips = '<div class="lbl sim">設備狀態篩選（和盤點是兩回事）</div><div class="chips">' +
      '<button class="pill sm' + (dst === "" ? " on" : "") + '" data-a="dst" data-v="">全部</button>' +
      D.STATUSES.map((st) => '<button class="pill sm' + (dst === st ? " on" : "") + '" data-a="dst" data-v="' + esc(st) + '">' + esc(st) + " " + stCount(st) + "</button>").join("") + "</div>";

    return attentionCard() + tiles + drill + siteTable(rows, sorted, isPhone) + stChips + projTable(pfilter) + projDrill;
  }
  function projTable(pfilter) {
    const head = '<div class="lbl sim">各專案使用概況（按專案反查設備，和實際放置地點、保管人分開；部門為已登記的使用部門彙總）</div>';
    const rowsHtml = projects().map((p) => {
      const list = projAssets(p);
      const use = list.filter((a) => a.status === "使用中").length;
      const repair = list.filter((a) => a.status === "待修" || a.status === "維修中").length;
      const where = [...new Set(list.map((a) => a.site))].join("、");
      const depts = {}; list.forEach((a) => { const d = String(a.department || "").trim() || "部門未填"; depts[d] = (depts[d] || 0) + 1; });
      const deptText = Object.keys(depts).sort().map((d) => d + " " + depts[d]).join("、");
      return '<button class="prow' + (pfilter === p ? " sel" : "") + '" data-a="pfilter" data-v="' + esc(p) + '">' +
        '<span class="pn">' + esc(p.replace("（測試）", "")) + '</span><span>' + list.length + " 台</span>" +
        '<span>使用中 ' + use + '</span><span class="' + (repair ? "pbad" : "") + '">' + (repair ? "待修/維修 " + repair : "—") + '</span>' +
        '<span class="small">' + esc(where) + '</span><span class="small">部門：' + esc(deptText) + "</span></button>";
    }).join("");
    return head + '<div class="ptable">' + rowsHtml + "</div>" +
      (pfilter ? '<div class="chips" style="margin-top:6px"><button class="pill sm" data-a="pfilter" data-v="">清除專案篩選</button></div>' : "");
  }
  function siteTable(rows, sorted, isPhone) {
    const mlabel = { total: "依設備數排序", done: "依位置核對相符排序", reg: "依待核對排序", todo: "依尚無掃描排序", zone: "依位置不符排序" }[S.metric];
    if (isPhone) {
      return '<div class="lbl sim">各據點 · ' + mlabel + " · 點開看明細</div>" + sorted.map((r) =>
        '<div class="srow"><button class="shead" data-a="dsite" data-v="' + esc(r.n) + '"><span class="sname">' + esc(r.n) + '</span><span class="spct">' + r.pct + '%</span><span class="bar"><i style="width:' + r.pct + '%"></i></span><span class="smeta">相符 ' + r.done + "/" + r.t + " · 待核對 " + r.reg + " · 無掃描 " + r.left + " · 不符 " + r.z + "</span></button>" +
        (S.dsite === r.n ? '<div class="sdet"><div class="lbl">狀態分布</div><div class="smeta">' + D.STATUSES.map((st) => esc(st) + " " + assets().filter((a) => a.site === r.n && a.status === st).length).join(" · ") + '</div><button class="pill sm" data-a="gosite" data-v="' + esc(r.n) + '">去盤點' + esc(r.n) + "</button></div>" : "") + "</div>").join("");
    }
    return '<div class="lbl sim">各據點位置核對（掃描相符，不等於整場盤點完成）· ' + mlabel + "</div>" +
      '<div class="scards">' + sorted.map((r) => {
        const worst = r.left > 0;
        return '<div class="scard"><div class="sct"><b>' + esc(r.n) + "</b><span class=\"spct\">" + r.pct + "%</span></div>" +
          '<span class="bar"><i style="width:' + r.pct + '%"></i></span>' +
          '<div class="smeta">位置核對相符 ' + r.done + "/" + r.t + (r.reg ? ' · <b class="pbad">已登記待核對 ' + r.reg + "</b>" : "") + (worst ? ' · 尚無掃描 ' + r.left : "") + (!r.t ? " · 尚無設備基準，不能判定盤完" : "") + (r.z ? ' · <b class="pbad">不符 ' + r.z + "</b>" : "") + "</div>" +
          '<div class="smeta">' + D.STATUSES.map((st) => esc(st) + " " + assets().filter((a) => a.site === r.n && a.status === st).length).join(" · ") + "</div>" +
          '<div class="scact"><button class="pill sm" data-a="sitelist" data-v="' + esc(r.n) + '">看設備</button>' +
          (worst ? '<button class="pill sm" data-a="gositepc" data-v="' + esc(r.n) + '">去盤點</button>' : "") + "</div></div>";
      }).join("") + "</div>" +
      '<p class="small">位置核對相符與已登記待核對依試算表盤點紀錄的最後一筆「判定」即時計算；僅涵蓋目前登記的設備，不代表整場或全公司盤點進度。</p>';
  }

  /* ---- 電腦端 ---- */
  function pcDash() {
    const rows = siteRows();
    const sum = rows.reduce((a, r) => ({ t: a.t + r.t, d: a.d + r.done, g: a.g + r.reg, n: a.n + r.left, z: a.z + r.z }), { t: 0, d: 0, g: 0, n: 0, z: 0 });
    const sorted = [...rows].sort((a, b) => S.metric === "reg" ? b.reg - a.reg : metric === "todo" ? b.left - a.left : S.metric === "zone" ? b.z - a.z : S.metric === "done" ? b.pct - a.pct : b.t - a.t);
    return '<h3 class="ptitle">總覽儀表板</h3><p class="psub">' + (D.isMock ? "由本頁測試資料即時計算，不是公司實際資料。" : "由現存資料庫即時計算。") + '</p>' + '<div class="chips"><button class="pill" data-a="dtab" data-v="geo">地圖總覽：從全台灣一路點到座位 →</button></div>' + dashBody(rows, sum, sorted, false);
  }
  function pcAssets() {
    const belongLabel = (a) => { const p = a.project && a.project !== D.UNASSIGNED ? "專案：" + a.project.replace("（測試）", "") : ""; const dep = a.department ? "部門：" + a.department : ""; return p || dep ? esc(p) + (p && dep ? "<br>" : "") + esc(dep) : esc(D.UNASSIGNED); };
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
    return '<h3 class="ptitle">設備資料</h3><p class="psub">編輯保管人、區域、設備狀態、歸屬專案、序號與日期。儲存直接寫回你的試算表；失敗會標「未同步」，不會假裝成功。</p>' +
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
      '<div class="dtable"><div class="atr head"><span>登記編號</span><span>名稱 / 型號 / S/N</span><span>歸屬專案／部門</span><span class="opt">保管人</span><span class="opt">區域</span><span>狀態</span><span></span></div>' +
      list.map((a) => {
        const lr = lastRecordOf(a.code);
        let row = '<button class="atr arow" data-a="edit" data-v="' + esc(a.code) + '"><span class="icode">' + esc(a.code) + "</span>" +
          "<span>" + esc(a.name) + ' <span class="small">' + esc(a.model) + " · S/N " + esc(a.serial || "未登記") + " · " + esc(brandOf(a)) + " · 產地 " + esc(originOf(a)) + (a.po ? " · PO " + esc(a.po) : "") + "</span>" + legacyDetails(a.code) + (S.savedAt === a.code ? '<span class="dbadge"> ✓已儲存</span>' + (S.cascadeInfo ? '<span class="small"> ' + esc(S.cascadeInfo) + '</span>' : "") : "") + "</span>" +
          "<span>" + belongLabel(a) + '</span><span class="opt">' + esc(a.owner ? (a.owner === "公用" && a.source === "盤點" ? "公用（舊版預設，未確認）" : a.owner) : "未確認") + '</span><span class="opt">' + esc(a.zone) + "</span><span>" + esc(a.status) + '</span><span class="small">' + (S.editCode === a.code ? "收合" : "編輯") + "</span></button>";
        if (S.editCode === a.code && S.editDraft) {
          const d = S.editDraft;
          row += '<div class="drawer">' + (repairUI&&!S.editLocked?repairUI.html(a):'') + (S.editLocked?'<div class="warn">編輯權限不可用，資料為唯讀，原輸入保留。'+esc(S.editError||'')+'</div>'+(S.editConflict?'':'<button class="pill" data-a="edit-rebase">重新讀取核對並取得編輯權</button>')+'<button class="pill" data-a="cancel">取消編輯</button>':'') + (S.editLegacy?.length ? '<div class="small">已帶入唯一完整編號舊帳的空白描述欄位：'+esc(S.editLegacy.join('、'))+'。供核對，按儲存才寫入；不帶入保管人或座位。</div>' : '') + '<fieldset style="border:0;padding:0;margin:0;min-width:0"' + (S.editBusy||S.editLocked ? ' disabled' : '') + '>' + legacyDetails(a.code) +
            '<div class="frow"><span class="lbl">名稱</span><input class="inp" data-f="name" value="' + esc(d.name) + '"></div>' +
            '<div class="frow"><span class="lbl">型號</span><input class="inp" data-f="model" value="' + esc(d.model) + '"></div>' +
            (store.departmentReady || D.isMock ? '<div class="frow"><span class="lbl">使用部門</span><input class="inp" data-f="department" value="' + esc(d.department || "") + '"></div>' : "") +
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
            draftLine() + (S.editError&&!S.editLocked ? '<div class="warn">' + esc(S.editError) + '</div>' : '') +
            (()=>{const plan=cascadePlanFor(a.code,d,S.editBase);if(!plan)return '';
              const fname={owner:'保管人',department:'使用部門'};
              if(plan.unavailable)return '<div class="warn">座位資料尚未讀取完成，無法檢查同座位設備；變更'+plan.fields.map(f=>fname[f]||f).join('、')+'前請先重新整理，否則無法儲存。</div>';
              if(!plan.peers.length)return '';
              const lines=plan.peers.map(p=>'<div class="small">'+esc(p.code)+'：'+Object.keys(p.patch).map(f=>esc(fname[f]||f)+' '+esc(p.expected[f]||'（空）')+' → '+esc(p.patch[f])).join('；')+'</div>').join('');
              return '<div class="warn"><b>同座位連動</b>（'+esc(String(plan.seat.seat))+'號座位 · 同座位應同保管人、同使用部門；專案不連動）。按「儲存至資料庫」會一併更新以上 '+plan.peers.length+' 台同座位設備，不能只改其中一台：'+lines+
                '<div class="small">寫入前會重新讀取每台現況，任一筆失敗會把本次已寫入的改回原值並如實回報；若回復本身失敗，會列出需要人工核對的設備。不想連動請按「取消」。</div></div>';})() +
            '<div class="frow"><button class="btn mini" data-a="save"' + (S.editBusy ? ' disabled' : '') + '>' + (S.editBusy ? '正在儲存並讀回核對…' : D.isMock ? '儲存（隔離測試）' : '儲存至資料庫') + '</button><button class="pill sm" data-a="cancel"' + (S.editBusy ? ' disabled' : '') + '>取消</button></div>' +
            (seatUI ? seatUI.assetEditor(a, S.editSeat, S.editBusy) : '') +
            '<div class="small">狀態改動是人工判斷（例如送修），手機掃描本身不會改狀態。歸屬專案和實際放置地點分開。序號、購入、啟用、保固到期都可留空；登記編號不等於設備序號。</div></fieldset></div>';
        }
        return row;
      }).join("") + "</div>";
  }
  function pcZones() {
    const addForm = '<div class="zcard"><b>新增據點</b><div class="small">建立據點和它的第一個區域；手機「盤點據點」就會出現這個選項。座標選填，填了手機才能用定位自動找最近據點。</div>' +
      (ensureSiteDraft(), "") + '<div class="frow"><input class="inp" data-f="ns_name" placeholder="據點名稱（如 台北）" value="' + esc(S.newSite.name || "") + '"></div>' +
      '<div class="frow"><input class="inp" data-f="ns_zone" placeholder="第一個區域（如 1F 辦公區）" value="' + esc(S.newSite.zone || "") + '"></div>' +
      '<div class="frow"><input class="inp" data-f="ns_lat" placeholder="緯度（選填，如 25.033）" value="' + esc(S.newSite.lat || "") + '"><input class="inp" data-f="ns_lon" placeholder="經度（選填，如 121.565）" value="' + esc(S.newSite.lon || "") + '"></div>' +
      (S.siteErr ? '<div class="warn">' + esc(S.siteErr) + "</div>" : "") +
      '<div class="frow"><button class="pill sm" data-a="addsite">建立據點</button></div></div>';
    return '<h3 class="ptitle">公司據點</h3><p class="psub">維護各據點的區域和據點座標。座標讓手機用定位找最近據點；區域清單就是手機上「目前區域」的選項。據點資料直接存進你的試算表。</p>' +
      addForm +
      (sites().length === 0 ? '<div class="zcard"><div class="small">還沒有任何據點。先用上方「新增據點」建立第一個，手機掃描才能開始。</div></div>' : "") +
      sites().map((s) => '<div class="zcard"><div><b>' + esc(s.name) + '</b> <span class="small">' + ((s.lat || s.lon) ? "座標 " + Number(s.lat || 0).toFixed(4) + ", " + Number(s.lon || 0).toFixed(4) : "未標座標") + "</span></div>" +
        s.zones.map((z) => '<div class="zrow"><span>' + esc(z) + "</span><b>" + assets().filter((a) => a.site === s.name && a.zone === z).length + " 台</b></div>").join("") +
        '<div class="frow"><input class="inp" data-f="nz_' + esc(s.name) + '" placeholder="新增' + esc(s.name) + '的區域" value="' + esc(S.newZone[s.name] != null ? S.newZone[s.name] : ((bagGet('zone-new', s.name) || {}).v || "")) + '"><button class="pill sm" data-a="addzone" data-v="' + esc(s.name) + '">加入</button></div>' +
        '<div class="small">加入後，手機端「目前區域」會出現這個選項。重新命名、停用區域尚未支援。</div></div>').join("");
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
  function legacyPcMap() {
    if (!S.mapSite) S.mapSite = siteNames()[0] || "";
    const zones = zonesOf(S.mapSite);
    const marks = getMarks()[S.mapSite] || {};
    const sel = S.mapZone;
    const selAssets = sel ? zoneAssets(S.mapSite, sel) : [];
    let canvas;
    const mapNote = (!S.mapImg && DRAFTS && bagGet('map-image', 'last')) ? '<div class="warn">上次選的地圖圖片「' + esc(bagGet('map-image', 'last').name || '') + '」不會保留在這台裝置。請重新選圖；沒有任何資料被改。<button class="pill sm" data-a="map-image-clear">清除這則提醒</button></div>' : '';
    if (S.mapImg) {
      canvas = '<div style="position:relative;max-width:720px"><img src="' + S.mapImg + '" style="width:100%;border:1px solid var(--ds-hairline);border-radius:12px;display:block" data-a="mapimg" alt="位置圖（本機預覽）">' +
        zones.filter((z) => marks[z]).map((z) =>
          '<button class="pill sm" data-a="mapzone" data-v="' + esc(z) + '" style="position:absolute;left:' + marks[z].x + "%;top:" + marks[z].y + "%;transform:translate(-50%,-50%);min-height:32px;background:" + (sel === z ? "var(--ds-teal);color:#fff;border-color:var(--ds-teal)" : "#fff") + '">' + esc(z) + "</button>").join("") + "</div>";
    } else {
      canvas = demoPlanSvg(S.mapSite, zones, sel);
    }
    return '<h3 class="ptitle">位置圖</h3>' +
      '<p class="psub">選據點、在圖上點一個位置，就帶出該位置的設備、歸屬專案與狀態。位置標記由人綁定到區域，不靠系統猜圖。設備清單仍讀同一份試算表資料，圖裡不另存一套。</p>' +
      '<div class="chips">' + siteNames().map((p) => '<button class="pill sm' + (S.mapSite === p ? " on" : "") + '" data-a="mapsite" data-v="' + esc(p) + '">' + esc(p) + "</button>").join("") + "</div>" +
      '<div class="frow"><label class="pill sm" style="display:inline-flex;align-items:center;cursor:pointer">選擇圖檔（本機預覽）<input type="file" accept="image/*" data-f="mapfile" style="display:none"></label>' +
      (S.mapImg ? '<button class="pill sm" data-a="mapedit">' + (S.mapEdit ? "完成標記" : "標記位置") + '</button><button class="pill sm" data-a="mapclear">移除圖檔</button>' : "") + "</div>" +
      (S.mapImg
        ? '<div class="small">圖檔只在這個瀏覽器這次開啟期間預覽，<b>沒有上傳</b>；正式上傳需要私有儲存位置（不放公開網站），之後依你提供的儲存方式處理。' + (S.mapEdit ? '標記模式：先在下方選一個區域，再點圖上的位置。' : "") + "</div>"
        : '<div class="small">目前顯示自動產生的<b>示意平面圖</b>（不是實際格局）。上傳你的位置圖後，可改用實際圖面標記。</div>') +
      (S.mapEdit && S.mapImg ? '<div class="chips">' + zones.map((z) => '<button class="pill sm' + (sel === z ? " on" : "") + '" data-a="mapzone" data-v="' + esc(z) + '">' + esc(z) + (marks[z] ? " ✓" : "") + "</button>").join("") + "</div>" : "") +
      mapNote + canvas +
      (sel ? '<div class="card"><div class="lbl">' + esc(S.mapSite) + " · " + esc(sel) + " 的設備（" + selAssets.length + " 台）</div>" +
        (selAssets.length === 0 ? '<div class="small">這個位置目前沒有登記設備。</div>' :
          selAssets.map((a) => '<div class="zrow act"><span><b>' + esc(a.name) + "</b> " + esc(a.code) + '<br><span class="small">S/N ' + esc(a.serial || "未登記") + " · " + esc(a.status) + " · 保管人 " + esc(a.owner ? (a.owner === "公用" && a.source === "盤點" ? "公用（舊版預設，未確認）" : a.owner) : "未確認") + " · 歸屬 " + esc((a.project || D.UNASSIGNED).replace("（測試）", "")) + '</span></span><button class="pill sm" data-a="ajump" data-v="' + esc(a.code) + '">處理</button></div>').join("")) + "</div>"
        : '<div class="small">點圖上任一位置，帶出該位置的設備資料。</div>');
  }
  function pcMap() {
    if (!seatUI) return legacyPcMap();
    S.mapSite = S.mapSite || siteNames()[0] || "";
    return '<div class="chips">' + siteNames().map(p => '<button class="pill" data-a="mapsite" data-v="' + esc(p) + '">' + esc(p) + '</button>').join("") + '</div>' + seatUI.render(S.mapSite, "");
  }
  /* ---- 入庫作業：整批建單（待入庫，不影響庫存）→ 到貨核對（手機）→ 確認入庫（此時才建設備）---- */
  function pcInbound() {
    const bs = batches().slice().reverse();
    const nb = S.nb || (S.nb = Object.assign({ po: "", vendor: "", brand: "", model: "", origin: "", mfgYear: "", type: "", note: "", serials: "" }, bagGet('inbound-batch', 'new') || {}));
    let html = '<h3 class="ptitle">入庫作業</h3><p class="psub">廠商序號清單先建成「待入庫」批次，不增加庫存；實物到貨逐台核對後確認入庫，才產生內部登記編號並列入設備與應盤。批次直接存進你的試算表。</p>';
    if(intakeUI)html+=intakeUI.html();
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
    ensureRecvDraft();
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
      (S.recvRestored === S.recvBatch && S.recvCode ? '<div class="warn">已還原上次尚未核對的序號輸入。按「核對」才會送出，不會自動核對。</div>' : '') +
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
    return '<h3 class="ptitle">盤點差異</h3><p class="psub">手機掃完的差異在這裡逐筆決定，決定結果寫進盤點紀錄。</p>' +
      '<div class="lbl sim">累計掃描差異（所有場次，新→舊）：' + recs.length + " 筆 · 待處理 " + todoN + "</div>" +
      (recs.length === 0 ? '<div class="toast idle">還沒有掃描紀錄。到「手機 · 現場掃描」掃幾筆，差異會出現在這裡。</div>' :
        recs.map((r) => {
          const a = getA(r.code);
          return '<div class="item static">' + chip(r.status) + syncMark(r) + '<span class="iname">' + esc(a ? a.name : r.code) + '</span><span class="icode">' + esc(r.code) + "</span>" +
            '<span class="idet">' + (a ? esc(a.status) + " · S/N " + esc(a.serial || "未登記") + " · 使用部門 " + esc(a.department || "未指定") + " · 歸屬 " + esc(a.project || D.UNASSIGNED) + " · 登記 " + esc(a.site) + " " + esc(a.zone) + " → 現場 " + esc(r.sessionSite) + " " + esc(r.zone) : "清冊查無，需補登") + (r.departmentMismatch ? " · 使用部門不同（保留原登記）" : "") + " · 本次部門 " + esc(r.department || "未指定") + (r.projMismatch ? " · 歸屬專案與該場次範圍不同（未改歸屬）" : "") + " · " + esc(new Date(r.at).toLocaleString("zh-TW", { hour12: false })) + "</span>" +
            decisionButtons(r) + "</div>";
        }).join("")) +
      '';
  }
  /* ---- 舊帳比對（唯讀舊帳 + 釐清標示寫新帳；現場只掃不判，此頁只出現在電腦管理端） ---- */
  function annForm(row) {
    if (S.annOpen !== row.recordKey) return '<button class="pill sm" data-a="annopen" data-v="' + esc(row.recordKey) + '">釐清標示</button>';
    const d = S.annDraft || {};
    return '<span class="acts">' +
      '<select class="inp sm" data-f="ann_conclusion">' +
      '<option value="">只記系統比對進度</option>' +
      window.ZgErpReconcile.CONCLUSIONS.map((c) => '<option value="' + esc(c) + '"' + (d.conclusion === c ? " selected" : "") + ">" + esc(c) + "</option>").join("") + "</select>" +
      '<input class="inp sm" data-f="ann_reason" placeholder="原因（報廢／遺失必填）" value="' + esc(d.reason || "") + '">' +
      '<input class="inp sm" data-f="ann_evidence" placeholder="證據（報廢／遺失必填）" value="' + esc(d.evidence || "") + '">' +
      '<input class="inp sm" data-f="ann_note" placeholder="備註（可空）" value="' + esc(d.note || "") + '">' +
      '<button class="pill sm" data-a="annsub" data-v="' + esc(row.recordKey) + '">存標示</button>' +
      '<button class="pill sm" data-a="anncancel">取消</button>' +
      (S.annErr ? '<div class="warn">' + esc(S.annErr) + "</div>" : "") + "</span>";
  }
  const LEGACY_PAGE = 100;
  /* 每組獨立分頁，避免 5,400 列全量 DOM；全部列均可抵達，篩選變更重設頁碼。 */
  function capList(key, list, renderOne) {
    const pages = S.legPages || (S.legPages = {});
    const last = Math.max(0, Math.ceil(list.length / LEGACY_PAGE) - 1);
    const page = Math.max(0, Math.min(last, Number(pages[key]) || 0));
    pages[key] = page;
    const start = page * LEGACY_PAGE;
    const end = Math.min(start + LEGACY_PAGE, list.length);
    const btn = (label, target, disabled) => '<button class="pill sm" data-a="legpage" data-v="' + esc(key) + '" data-page="' + target + '"' + (disabled ? ' disabled' : '') + ' aria-label="' + esc(key + ' ' + label) + '">' + label + '</button>';
    const nav = '<div class="zrow"><span class="small" role="status">顯示第 ' + (list.length ? start + 1 : 0) + '–' + end + ' 筆／共 ' + list.length + ' 筆 · 第 ' + (page + 1) + '/' + (last + 1) + ' 頁</span><span class="acts">' +
      btn('第一頁', 0, page === 0) + btn('上一頁', page - 1, page === 0) + btn('下一頁', page + 1, page === last) + btn('最後一頁', last, page === last) + '</span></div>';
    return nav + list.slice(start, end).map(renderOne).join('') + (list.length > LEGACY_PAGE ? nav : '');
  }
  function legacyLine(row, extra, withForm, flowText) {
    return '<div class="zrow"><span><b>' + esc(row.code || "（無編號）") + "</b> " + esc(row.name || "") + (row.model ? " · " + esc(row.model) : "") +
      '<br><span class="small">出處 ' + esc(row.provenance || row.siteLead || "?") + (row.zone ? " · " + esc(row.zone) : "") + (row.place ? " · " + esc(row.place) : "") + (row.scopeStatus ? " · " + esc(row.scopeStatus) : "") + "</span>" +
      (flowText ? '<br><span class="small">' + flowText + "</span>" : "") +
      (extra ? '<br><span class="small">' + extra + "</span>" : "") + "</span>" + (withForm ? annForm(row)+(differenceUI?differenceUI.html(row):"") : "") + "</div>";
  }
  function pcLegacy() {
    const R = window.ZgErpReconcile;
    const legacy = store.legacyRows ? store.legacyRows() : [];
    const lerr = store.legacyError ? store.legacyError() : "";
    const coded = legacy.filter((r) => r.code);
    const noCode = legacy.length - coded.length;
    if (!legacy.length) {
      return '<h3 class="ptitle">舊帳比對</h3><p class="psub">' +
        (lerr ? "舊帳暫時讀不到（" + esc(lerr) + "）。新帳功能不受影響，修好後這裡會顯示比對。" : "舊帳還沒有可比對的資料。") + "</p>";
    }
    const leads = [...new Set(legacy.map((r) => r.siteLead).filter(Boolean))].sort();
    const projs = [...new Set(legacy.map((r) => r.project).filter(Boolean))].sort();
    const scope = { source: S.legLead || "", site: "", project: S.legProj || "", closed: false }; // 不宣告範圍盤完：未掃到只標「尚未掃到」，永不輸出遺失
    const res = R.reconcile(legacy, db(), scope, db().annotations || []);
    /* 舊帳關係（整合-流轉對應）與待確認事項（整合-待確認）：唯讀線索，供「原發 A vs 現場 B」追查 */
    const flows = store.legacyFlows ? store.legacyFlows() : [];
    const questions = store.legacyQuestions ? store.legacyQuestions() : [];
    const auxErr = store.legacyAuxError ? store.legacyAuxError() : "";
    const flowsByKey = new Map();
    flows.forEach((f) => {
      [f.rkeyA, f.rkeyB, f.code].filter(Boolean).forEach((k) => {
        if (!flowsByKey.has(k)) flowsByKey.set(k, []);
        flowsByKey.get(k).push(f);
      });
    });
    const flowHint = (row) => {
      const hit = (flowsByKey.get(row.recordKey) || []).concat(row.code ? (flowsByKey.get(row.code) || []) : []);
      const uniq = [...new Map(hit.map((f) => [f.relationKey || f.note, f])).values()];
      return uniq.slice(0, 3).map((f) => "舊帳關係 " + esc(f.relationKey || "") + (f.type ? "（" + esc(f.type) + "）" : "") + (f.note ? "：" + esc(f.note) : "") + (f.status ? " · " + esc(f.status) : "")).join("<br>");
    };
    const c = res.counts;
    const chips = '<div class="chips"><button class="pill' + (!S.legLead ? " on" : "") + '" data-a="leglead" data-v="">全部出處</button>' +
      leads.map((p) => '<button class="pill' + (S.legLead === p ? " on" : "") + '" data-a="leglead" data-v="' + esc(p) + '">' + esc(p) + "</button>").join("") + "</div>" +
      (projs.length ? '<div class="chips"><button class="pill' + (!S.legProj ? " on" : "") + '" data-a="legproj" data-v="">全部專案</button>' +
        projs.map((p) => '<button class="pill' + (S.legProj === p ? " on" : "") + '" data-a="legproj" data-v="' + esc(p) + '">' + esc(p) + "</button>").join("") + "</div>" : "");
    let out = '<h3 class="ptitle">舊帳比對</h3>' +
      '<p class="psub">只列有差異、要你處理的項目；已對上的收在最下面。舊帳原文永不改寫。</p><details><summary class="small">說明</summary><p class="small">舊帳原文永不改寫；每筆的核對進度與人工結論存到新帳「釐清標示」，以記錄鍵＋出處快照連結，舊帳列變動會標「標示失配」留人工。出處與舊帳專案欄位都是原值線索，不是確認位置或正式歸屬；選定專案後，「舊帳有而未掃到」才是該專案的缺漏清單。</p></details>' +
      chips +
      '<div class="scope"><div class="sct"><span>舊帳 ' + c.legacyInScope + " 筆（範圍內）</span><span>有交代 " + c.accounted + " · 沒查清 " + c.unaccounted + "</span></div>" +
      '<div class="smeta">已盤到 ' + c.matched + " · 已釐清 " + c.clarified + " · 尚未掃到 " + c.pending + " · 位置不符 " + c.locationMismatch + " · 同編號多筆 " + c.ambiguous + " 組 · 現場實際觀察 " + c.newInventory + " 台 · 新有舊無 " + c.newOnly + (noCode ? " · 無編號 " + noCode + " 列僅人工查" : "") + "</div></div>";
    if (res.pending.length && res.newOnly.length) {
      out += '<div class="warn">本範圍有 ' + res.pending.length + " 筆舊帳尚未掃到，同時有 " + res.newOnly.length + " 台現場新掃到（舊帳沒有）。可能是少一台或換機（例如管理部原發 A、現場卻是 B）；兩邊一起列待查，系統不自動認定換機關係。查明後用釐清標示記下去向、依據與確認人。</div>";
    }
    if (auxErr) {
      out += '<div class="warn">舊帳的關係／待確認資料暫時讀不到（' + esc(auxErr) + "）；主檔比對不受影響。</div>";
    }
    const inScopeKeys = new Set(legacy.filter((r) => (!S.legLead || r.siteLead === S.legLead) && (!S.legProj || r.project === S.legProj)).map((r) => r.recordKey));
    const qShown = questions.filter((q) => {
      const toks = String(q.related || "").split(/\s+/).filter(Boolean);
      return !toks.length ? (!S.legLead && !S.legProj) : toks.some((t) => inScopeKeys.has(t));
    });
    if (qShown.length) {
      out += '<div class="lbl">舊帳待確認事項（' + qShown.length + "）— 舊帳人工紀錄，唯讀；處理結果請用釐清標示記到新帳</div><div class=\"ztable\">" +
        capList("舊帳待確認事項", qShown, (q) => '<div class="zrow"><span><b>' + esc(q.itemKey || "") + "</b> " + esc(q.category || "") + " · " + esc(q.summary || "") + '<br><span class="small">相關 ' + esc(q.related || "") + (q.suggestion ? " · 建議：" + esc(q.suggestion) : "") + (q.status ? " · " + esc(q.status) : "") + "</span></span></div>") + "</div>";
    }
    if (noCode) {
      out += '<div class="lbl">無編號原始紀錄（' + noCode + '） - 僅人工查，不自動配對設備</div><div class="ztable">' +
        capList("無編號", legacy.filter((r) => !r.code && (!S.legLead || r.siteLead === S.legLead) && (!S.legProj || r.project === S.legProj)),
          (row) => legacyLine(row, "記錄鍵 " + esc(row.recordKey), true, flowHint(row))) + '</div>';
    }
    if (res.staleAnnotations.length) {
      out += '<div class="lbl">標示失配（舊帳列內容變動，原標示未套用，請人工核對）</div><div class="ztable">' +
        capList("標示失配", res.staleAnnotations, (x) => '<div class="zrow"><span><b>' + esc(x.recordKey) + '</b> 原結論「' + esc(x.annotation.conclusion || x.annotation.progress || "") + "」<br><span class=\"small\">快照 " + esc(JSON.stringify(x.annotation.snapshot || {})) + "<br>現列 " + esc(JSON.stringify(x.currentRow || {})) + "</span></span></div>") + "</div>";
    }
    if (res.pending.length) {
      out += '<div class="lbl">尚未掃到（' + res.pending.length + "）— 不等於遺失；查明後用釐清標示記結論</div><div class=\"ztable\">" +
        capList("尚未掃到", res.pending, (x) => legacyLine(x.legacy, esc(x.openQuestion || ""), true, flowHint(x.legacy))) + "</div>";
    }
    if (res.locationMismatch.length) {
      out += '<div class="lbl">位置不符（' + res.locationMismatch.length + "）— 舊帳主張與現場觀察不同，逐筆確認，不自動改帳</div><div class=\"ztable\">" +
        capList("位置不符", res.locationMismatch, (x) => legacyLine(x.legacy, "本次在「" + esc(x.observedSite || "?") + " " + esc(x.observedZone || "") + "」觀察到。" + esc(x.openQuestion || ""), true, flowHint(x.legacy))) + "</div>";
    }
    if (res.ambiguous.length) {
      out += '<div class="lbl">同編號多筆（' + res.ambiguous.length + " 組）— 候選並列，不自動選定；請對實機逐列判定</div><div class=\"ztable\">" +
        capList("同編號候選", res.ambiguous.flatMap((g) => g.candidates.map((row) => ({ row, count: g.totalCandidates || g.candidates.length }))),
          (x) => legacyLine(x.row, "此編號共有 " + x.count + " 筆候選；不自動選定。已存結論見「已釐清」；快照變動見「標示失配」", true, flowHint(x.row))) + "</div>";
    }
    if (res.clarified.length) {
      out += '<details><summary class="lbl">已釐清（' + res.clarified.length + "）— 已有結論，預設收合</summary><div class=\"ztable\">" +
        capList("已釐清", res.clarified, (x) => legacyLine(x.legacy, (x.identityUnresolved ? "同編號候選關係仍待確認 · " : "") + "結論「" + esc(x.annotation.conclusion) + "」" + (x.annotation.reason ? " · 原因：" + esc(x.annotation.reason) : "") + (x.annotation.evidence ? " · 證據：" + esc(x.annotation.evidence) : "") + (x.annotation.note ? " · 備註：" + esc(x.annotation.note) : "") + " · 確認人 " + esc(x.annotation.confirmer || "") + " " + esc(x.annotation.at ? new Date(x.annotation.at).toLocaleString("zh-TW", { hour12: false }) : ""), false)) + "</div></details>";
    }
    if (res.matched.length) {
      out += '<details><summary class="lbl">已盤到、無差異（' + res.matched.length + "）— 不用處理，預設收合</summary><div class=\"ztable\">" +
        capList("已盤到", res.matched, (x) => legacyLine(x.legacy, "", true, flowHint(x.legacy))) + "</div></details>";
    }
    if (res.newOnly.length) {
      out += '<div class="lbl">新有舊無（' + res.newOnly.length + "）— 現場實際觀察到、舊帳沒有；已算進新帳</div><div class=\"ztable\">" +
        capList("新有舊無", res.newOnly, (x) => '<div class="zrow"><span><b>' + esc(x.code) + "</b><br><span class=\"small\">" + esc((x.observed.site || "") + " " + (x.observed.zone || "")) + " · 來源 " + esc([...x.observed.sources].join("、")) + "</span></span></div>") + "</div>";
    }
    return out;
  }
  function pcGeo() { return geoUI ? geoUI.html() : '<div class="card">地圖總覽模組未載入，請重新整理。</div>'; }
  function pcView() {
    const tab = S.dtab;
    const body = tab === "dash" ? pcDash() : tab === "assets" ? pcAssets() : tab === "inbound" ? pcInbound() : tab === "zones" ? pcZones() : tab === "map" ? pcMap() : tab === "geo" ? pcGeo() : tab === "legacy" ? pcLegacy() : pcDiff();
    const recs = curRecs();
    const diffN = allRecords().filter((r) => r.status !== "ok" && !r.decision).length;
    return '<div class="desktop"><div class="dbody"><nav class="dside"><div class="dlogo">諸葛 · 設備管理</div>' +
      '<button class="dnav' + (tab === "dash" ? " on" : "") + '" data-a="dtab" data-v="dash">總覽儀表板</button>' +
      '<button class="dnav' + (tab === "geo" ? " on" : "") + '" data-a="dtab" data-v="geo">地圖總覽</button>' +
      '<button class="dnav' + (tab === "assets" ? " on" : "") + '" data-a="dtab" data-v="assets">設備資料</button>' +
      '<button class="dnav' + (tab === "inbound" ? " on" : "") + '" data-a="dtab" data-v="inbound">入庫作業' + (openBatches().length ? " (" + openBatches().length + ")" : "") + '</button>' +
      '<button class="dnav' + (tab === "zones" ? " on" : "") + '" data-a="dtab" data-v="zones">公司據點</button>' +
      '<button class="dnav' + (tab === "map" ? " on" : "") + '" data-a="dtab" data-v="map">座位圖</button>' +
      '<button class="dnav' + (tab === "diff" ? " on" : "") + '" data-a="dtab" data-v="diff">盤點差異' + (diffN > 0 ? " (" + diffN + ")" : "") + "</button>" +
      '<button class="dnav' + (tab === "legacy" ? " on" : "") + '" data-a="dtab" data-v="legacy">舊帳比對</button></nav>' +
      '<div class="dmain"><div class="dhand">' + (recs.length > 0
        ? "手機在 <b>" + esc(S.site) + "</b> 掃了 " + recs.length + " 筆（" + esc(new Date(S.sess.at).toLocaleTimeString("zh-TW", { hour12: false })) + " 起）。差異已帶到「盤點差異」。"
        : "這個視窗尚未開始盤點場次；不代表共用試算表沒有紀錄。既有紀錄請看總覽與「盤點差異」。") + "</div>" + body + "</div></div></div>";
  }

  /* ---- 渲染 ---- */
  function render() {
    if ((S.mode !== "phone" || S.screen !== "scan" || S.dash) && S.camOn) camStop(true);
    const root = document.getElementById("erp-root");
    refreshSyncBadge.__lastRoot = root;
    if (window.ErpAuth && window.ErpAuth.state().status !== "ready" && !D.isMock) {
      const auth=window.ErpAuth.state(),signed=auth.status==="signed-out",denied=auth.status==="denied",checking=auth.status==="checking";
      root.innerHTML=zhugeBar()+'<div class="phone"><div class="card"><h2>'+ (checking?'正在確認登入…':denied?'此帳號尚未獲准使用 ERP':signed?'登入 ZG-ERP':'登入暫時無法完成')+'</h2><p>'+esc(auth.error||(denied?'已登入 Google，但尚未通過原本的使用核准。設備資料不會載入。':'沿用諸葛原本的 Google 帳號與 UUID。登入後留在 ERP；所有已核准使用者共看完整設備與盤點結果。'))+'</p>'+(!checking?'<button class="pill" data-erp-auth="'+(signed||denied||auth.error.includes('重新使用 Google')?'login':'retry')+'">'+(signed||denied||auth.error.includes('重新使用 Google')?'使用 Google 登入':'重試驗證')+'</button>':'')+'</div></div>';
      return;
    }
    let html = zhugeBar() + loginBar() + mockBar() + syncBadge() + modeBar();
    if(S.vendorReview)html+='<section class="warn" role="status"><b>已讀到 '+esc(S.vendorReview.format)+'</b><p style="overflow-wrap:anywhere">'+esc(S.vendorReview.raw)+'</p><p>'+esc(S.vendorReview.reason)+'。請在設備資料／入庫作業核對，原碼已保留，不會把廠商條碼直接當成登記編號。</p><button class="pill" data-a="vendor-copy">複製原碼</button><span role="status">'+esc(S.vendorCopyStatus||'')+'</span></section>';
    if(!D.isMock)html+='<div class="loginbar"><button class="pill sm" data-a="shared-refresh"'+(S.sharedBusy?' disabled':'')+'>'+(S.sharedBusy?'正在更新共同資料…':'更新共同盤點結果')+'</button> <span>'+esc(S.sharedMessage||(store.lastSharedReadAt?'上次更新 '+new Date(store.lastSharedReadAt).toLocaleTimeString('zh-TW'):'共用同一份設備與盤點紀錄；更新可查看其他人的新結果。'))+'</span></div>';
    if (S.bootErr) {
      root.innerHTML = html + (S.bootAuth
        ? '<div class="phone"><div class="card"><h2>工作階段已失效</h2><p>登入驗證被現存資料庫拒絕，自動換發也失敗。請 <a href="' + LOGIN_URL + '">重新登入諸葛</a> 後再回來。</p><button data-a="bootretry">重試</button></div></div>'
        : '<div class="phone"><div class="card"><h2>連線失敗</h2><p>' + esc(S.bootErr) + '</p><button data-a="bootretry">重試</button></div></div>');
      return;
    }
    if (S.booting) {
      root.innerHTML = html + '<div class="phone"><div class="card"><h2>正在連接現存資料庫…</h2></div></div>';
      return;
    }
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
    if(S.editCode&&['workspace-overview','workspace-scan','workspace-manage','mode','tab','dtab','back','godiff','sitelist','gositepc','asite','gosite'].includes(a)){
      if(S.editTouched){S.editError='還有未保存的輸入，請先保存或明確取消編輯後再離開。';render();return;}
      if(S.editBusy)return;
      if(!D.isMock)store.releaseAssetEdit(S.editCode).catch(()=>{});
      S.editCode='';S.editDraft=null;S.editConflict=false;
    }
    if(['end','finish','newsession','start','toresult'].includes(a)&&(S.scanBusy||S.scanQueue?.length||Object.keys(S.scanHeld||{}).length)){S.scanSetupErr='尚有未保存或結果待查的掃描，保留場次與輸入；請先核對。';render();return;}
    if(a==='vendor-copy'){navigator.clipboard.writeText(S.vendorReview?.raw||'').then(()=>{S.vendorCopyStatus='已複製';render();}).catch(()=>{S.vendorCopyStatus='複製未成功，請選取上方原碼';render();});return;}
    if (a === "workspace-overview") { S.mode="pc"; S.dtab="dash"; S.dash=false; S.workspaceMore=false; }
    else if (a === "workspace-scan") { S.mode="phone"; S.dash=false; S.workspaceMore=false; }
    else if (a === "held-ack") { if (DRAFTS) DRAFTS.discard(draftAcct(), 'scan-held', v); }
    else if (a === "draft-clear-ask") { S.draftClearAsk = v; }
    else if (a === "draft-clear-no") { S.draftClearAsk = ""; }
    else if (a === "draft-clear-do") {
      if (DRAFTS) { for (const r of DRAFTS.list(draftAcct())) if (r.kind !== 'scan-held') DRAFTS.discard(draftAcct(), r.kind, r.entity); }
      S.draftClearAsk = ""; S.draftNote = "";
    }
    else if (a === "map-image-clear") { bagDiscard('map-image', 'last'); }
    else if (a === "workspace-more") { S.workspaceMore=!S.workspaceMore; }
    else if (a === "workspace-manage") { S.mode="pc"; S.dtab=v; S.dash=false; S.workspaceMore=false; }
    else if (a === "mode") { S.mode = v; }
    else if (a === "tab") { S.dash = v === "dash"; }
    else if (a === "site") { if(seatUI)seatUI.resetSelection();S.site = v; }
    else if (a === "gps") { detectGps(); return; }
    else if (a === "start") { startSession(); return; }
    else if (a === "zoneopen") { S.zoneOpen = !S.zoneOpen; }
    else if (a === "zone") { if(seatUI)seatUI.resetSelection(); S.zone = v; S.zoneOpen = false; }
    else if (a === "scan") { scan(v); return; }
    else if (a === "camstart") { camStart(); return; }
    else if (a === "camstop") { camStop(); return; }
    else if (a === "manual") { scan(S.manualCode); return; }
    else if(a==='scan-intent-retry'){const held=S.scanHeld?.[v]||S.scanIntent;if(held&&!held.uncertain)scan(held.code,held);return;}
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
      openControlledEditor(v);return;
    }
    else if (a === "back") { S.dtab = S.retTab || "dash"; S.retTab = ""; S.editCode = ""; S.editDraft = null; }
    else if (a === "godiff") { S.mode = "pc"; S.dash = false; S.dtab = "diff"; }
    else if (a === "sitelist") { S.mode = "pc"; S.dash = false; S.asite = v; S.dtab = "assets"; S.retTab = "dash"; S.editCode = ""; S.editDraft = null; }
    else if (a === "gositepc") { S.mode = "phone"; S.dash = false; S.site = v; S.screen = "start"; }
    else if (a === "sproj") { S.scanProject = v; S.scanProjectInput = ""; putSetup(); }
    else if (a === "setup-clear") { S.scanDepartment = ""; S.scanProject = ""; S.scanProjectInput = ""; S.setupRestored = false; bagDiscard("scan-setup", "new"); }
    else if (a === "sprojset") { S.scanProject = (S.scanProjectInput || "").trim(); putSetup(); }
    else if (a === "asite") { S.asite = v; S.editCode = ""; S.editDraft = null; }
    else if (a === "gosite") { S.site = v; S.dash = false; S.screen = "start"; }
    else if (a === "edit") {
      if(S.editBusy)return;
      if(S.editCode===v){if(!D.isMock)store.releaseAssetEdit(v).catch(()=>{});S.editCode='';S.editDraft=null;}
      else{openControlledEditor(v);return;}
    }
    else if (a === "asset-seat-save") {
      if (!S.editBusy && !S.editLocked && S.editCode && S.editSeat) {
        const code = S.editCode, asset = getA(code); S.editBusy = true; S.editError = ""; render();
        seatUI.savePlacement(asset, S.editSeat).then(() => { S.editSeat = ""; }).catch(e => { S.editError = e.message; }).finally(() => { S.editBusy = false; render(); });
      }
    }
    else if (a === "edit-rebase") {rebaseControlledEditor();return;}
    else if (a === "cancel") { const hasDraft=S.editCode&&S.editDraft&&['draft','restored','restored-merged'].includes(S.draftNote);if(hasDraft&&!S.editLocked&&!S.cancelAsk){S.cancelAsk=true;render();return;}S.cancelAsk=false;if(S.editCode&&!S.editLocked&&S.draftNote!=='conflict')draftDiscardEdit(S.editCode);if(!D.isMock&&S.editCode)store.releaseAssetEdit(S.editCode).catch(()=>{});S.editCode = ""; S.editDraft = null; }
    else if (a === "save") {
      if (S.editCode && S.editDraft) {
        if (S.editBusy||S.editLocked) return;
        const code = S.editCode, draft = { ...S.editDraft }, base = { ...S.editBase };
        if(!String(draft.name??'').trim()){S.editError='設備名稱不能留空，沒有儲存；請輸入名稱後再儲存。';render();return;}
        S.savedAt = ""; S.editBusy = true; S.editError = ""; render();
        (async () => {
          try {
            let cascadeInfo='';
            if (D.isMock) {
              store.saveAsset(code, draft);
              const plan=cascadePlanFor(code,draft,base);
              if(plan&&!plan.unavailable&&plan.peers.length){for(const p of plan.peers)store.saveAsset(p.code,p.patch);cascadeInfo='已一併更新同座位 '+plan.peers.length+' 台：'+plan.peers.map(p=>p.code).join('、');}
            }
            else {
              const changed={};
              if(String(draft.owner??'')!==String(base.owner??''))changed.owner=String(draft.owner??'');
              if(String(draft.department??'')!==String(base.department??''))changed.department=String(draft.department??'');
              if(Object.keys(changed).length&&seatUI){
                if(!seatUI.state.loaded&&typeof store.loadSeatMap==='function'){await store.loadSeatMap();seatUI.state.loaded=true;}
                const bindings=seatUI.state.loaded&&store.seatReady?seatUI.seatBindings():null;
                if(!bindings)throw new Error('座位資料未能讀取，無法確認同座位設備；未保存，請重新整理後重試。');
                const plan=window.ErpEditCore.planSeatCascade({bindings,assets:assets(),code,changed});
                if(plan.peers.length){
                  const res=await window.ErpEditCore.runSeatCascade(store,code,draft,base,plan);
                  cascadeInfo='已一併更新同座位 '+res.cascaded.length+' 台：'+res.cascaded.join('、');
                }
                else await store.saveAssetVerified(code, draft, base);
              }
              else await store.saveAssetVerified(code, draft, base);
            }
            draftDiscardEdit(code);if (S.editCode === code) { S.savedAt = code; S.editCode = ""; S.editDraft = null; S.cascadeInfo=cascadeInfo; }
          } catch (e) { S.editLocked=true;S.editError = e.message || "儲存結果未確認，輸入保留，不可重送，請先核對"; }
          finally { S.editBusy = false; render(); }
        })();
      }
    }
    else if (a === "addsite") {
      const name = (S.newSite.name || "").trim();
      const zone = (S.newSite.zone || "").trim();
      const latS = (S.newSite.lat || "").trim(), lonS = (S.newSite.lon || "").trim();
      S.siteErr = "";
      if (!name) S.siteErr = "請填據點名稱。";
      else if (!zone) S.siteErr = "請填第一個區域。";
      else if (sites().find((x) => x.name === name)) S.siteErr = "已經有「" + name + "」這個據點。";
      else if ((latS && isNaN(Number(latS))) || (lonS && isNaN(Number(lonS)))) S.siteErr = "座標要是數字（或留空）。";
      else if ((latS && (Number(latS) < -90 || Number(latS) > 90)) || (lonS && (Number(lonS) < -180 || Number(lonS) > 180))) S.siteErr = "座標超出範圍。";
      if (S.siteErr) { render(); return; }
      if (typeof store.addSite === "function" && store.addSite(name, zone, latS === "" ? null : Number(latS), lonS === "" ? null : Number(lonS))) {
        S.newSite = {}; bagDiscard('site-new', 'new');
      }
    }
    else if (a === "addzone") {
      const val = (S.newZone[v] || "").trim();
      if (val) { store.addZone(v, val); S.newZone[v] = ""; bagDiscard('zone-new', v); }
    }
    else if (a === "mapsite") { if(seatUI)seatUI.resetSelection();S.mapSite = v; S.mapZone = ""; }
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
        S.nb = { po: "", vendor: "", brand: "", model: "", origin: "", mfgYear: "", type: "", note: "", serials: "" }; S.nbNote = ""; bagDiscard('inbound-batch', 'new');
        S.ibOpen = b.id; S.ibConfirm = ""; S.ibDraft = null;
      }
    }
    else if (a === "ibopen") { S.ibOpen = S.ibOpen === v ? "" : v; }
    else if (a === "ibconfirm") {
      if (S.ibConfirm === v) { if (DRAFTS) DRAFTS.discard(draftAcct(), 'inbound-confirm', v); S.ibConfirm = ""; S.ibDraft = null; }
      else {
        const b = store.batch(v); if (!b) return;
        S.ibConfirm = v; S.ibOpen = v;
        const s0 = siteNames()[0] || "";
        S.ibDraft = { site: s0, zone: zonesOf(s0)[0] || "", project: D.UNASSIGNED, owner: "公用" };
        const sd = DRAFTS && DRAFTS.get(draftAcct(), 'inbound-confirm', v);
        if (sd && sd.payload && sd.payload.values && siteNames().includes(sd.payload.values.site)) { const o = sd.payload.values; S.ibDraft = { ...S.ibDraft, ...o, zone: zonesOf(o.site).includes(o.zone) ? o.zone : (zonesOf(o.site)[0] || "") }; S.draftNote = 'restored'; }
      }
    }
    else if (a === "ibdo") {
      const made = store.confirmInbound(v, S.ibDraft || {});
      if (made.length) {
        S.ibDone = S.ibDone || {}; S.ibDone[v] = made;
        if (DRAFTS) DRAFTS.discard(draftAcct(), 'inbound-confirm', v);
        S.ibConfirm = ""; S.ibDraft = null; S.ibOpen = v;
      }
    }
    else if (a === "gorecv") { S.mode = "phone"; S.screen = "recv"; S.recvBatch = v; S.recvLast = null; }
    else if (a === "recvbatch") { S.recvBatch = v; S.recvLast = null; }
    else if (a === "recvscan") {
      const r = store.receiveSerial(S.recvBatch, S.recvCode);
      S.recvLast = { serial: String(S.recvCode || "").trim(), result: r.result, asset: r.asset || null };
      S.recvCode = ""; S.recvRestored = ""; bagDiscard('recv-serial', S.recvBatch);
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
    else if (a === "legpage") {
      const page = Number(t.getAttribute("data-page"));
      if (Number.isInteger(page) && page >= 0) {
        (S.legPages || (S.legPages = {}))[v] = page;
        S.annOpen = ""; S.annDraft = {}; S.annErr = "";
      }
    }
    else if (a === "leglead") { S.legLead = v; S.legPages = {}; S.annOpen = ""; S.annDraft = {}; S.annErr = ""; }
    else if (a === "legproj") { S.legProj = v; S.legPages = {}; S.annOpen = ""; S.annDraft = {}; S.annErr = ""; }
    else if (a === "annopen") { S.annOpen = v; S.annDraft = bagGet('annotation', v) || {}; S.annErr = ""; }
    else if (a === "anncancel") {
      const has = Object.values(S.annDraft || {}).some(x => String(x || '').trim());
      if (has && !S.annCancelAsk) { S.annCancelAsk = true; S.annErr = '取消會刪除已輸入的內容。再按一次「取消」確定刪除，或繼續填寫。'; }
      else { bagDiscard('annotation', S.annOpen); S.annCancelAsk = false; S.annOpen = ""; S.annDraft = {}; S.annErr = ""; }
    }
    else if (a === "annsub") {
      const row = (store.legacyRows ? store.legacyRows() : []).find((x) => x.recordKey === v);
      const d = S.annDraft || {};
      const ann = {
        recordKey: v,
        code: row ? row.code : "",
        provenance: row ? row.provenance : "",
        snapshot: row ? window.ZgErpReconcile.snapshotOf(row) : null,
        confirmer: store.actor || "", // 報廢／遺失需確認人：存檔前帶入目前登入者，validate 才過
        conclusion: (d.conclusion || "").trim(),
        reason: (d.reason || "").trim(),
        evidence: (d.evidence || "").trim(),
        note: (d.note || "").trim()
      };
      const chk = window.ZgErpReconcile.validateAnnotation(ann);
      if (!row) { S.annErr = "找不到這筆舊帳列，請重新整理後再試。"; }
      else if (!chk.ok) { S.annErr = chk.reason; }
      else {
        store.addAnnotation(ann);
        bagDiscard('annotation', S.annOpen);
        S.annOpen = ""; S.annDraft = {}; S.annErr = "";
      }
    }
    else if (a === "geo") { if (geoUI) geoUI.act(v); }
    else if (a === "asset-seat-pick") { S.editSeat = v; }
    else if (a === "asset-seat-custodian") { if (S.editDraft && Object.prototype.hasOwnProperty.call(S.editDraft, "owner")) { S.editDraft.owner = v; noteControlledActivity(); } }
    render();
  });
  document.addEventListener("input", (e) => {
    const gf = e.target.getAttribute && e.target.getAttribute("data-geo-field");
    if (gf) { if (geoUI) geoUI.field(gf, e.target.value); return; }
    const f = e.target.getAttribute && e.target.getAttribute("data-f");
    if (!f) return;
    if (f === "scanDepartment") { S.scanDepartment = e.target.value; putSetup(); return; }
    if (f === "manualCode") { S.manualCode = e.target.value; return; }
    if (f === "scanProjectInput") { S.scanProjectInput = e.target.value; putSetup(); return; }
    if (f.indexOf("ann_") === 0) { S.annDraft = S.annDraft || {}; S.annDraft[f.slice(4)] = e.target.value; if (S.annOpen) bagPut('annotation', S.annOpen, S.annDraft); return; }
    if (f.indexOf("nz_") === 0) { S.newZone[f.slice(3)] = e.target.value; bagPut('zone-new', f.slice(3), { v: e.target.value }); return; }
    if (f.indexOf("ns_") === 0) { S.newSite[f.slice(3)] = e.target.value; bagPut('site-new', 'new', S.newSite); return; }
    if (f.indexOf("nb_") === 0) { S.nb = S.nb || {}; S.nb[f.slice(3)] = e.target.value; bagPut('inbound-batch', 'new', S.nb); return; }
    if (f.indexOf("ibd_") === 0) { if (S.ibDraft) S.ibDraft[f.slice(4)] = e.target.value; return; }
    if (f === "recvCode") { S.recvCode = e.target.value; S.recvRestored = ""; if (S.recvBatch) { if (S.recvCode.trim()) bagPut("recv-serial", S.recvBatch, { v: S.recvCode }); else bagDiscard("recv-serial", S.recvBatch); } return; }
    if (f === "ageThreshold") { S.ageThreshold = Number(e.target.value) || AGE_THRESHOLD_DEFAULT; return; } /* 重繪在 change（blur/Enter/步進）時做，避免打字中斷焦點 */
    if (f === "ageBasis") { S.ageBasis = e.target.value; render(); return; }
    if (f === "ageThreshold") { S.ageThreshold = Number(e.target.value) || AGE_THRESHOLD_DEFAULT; render(); return; }
    if (f === "editSeat") S.editSeat = e.target.value;
    if (S.editDraft && Object.prototype.hasOwnProperty.call(S.editDraft, f)) {S.editDraft[f] = e.target.value;S.cancelAsk=false;S.autoNote='';noteControlledActivity();draftSaveEdit();}
  });
  document.addEventListener("change", (e) => {
    if (e.target.getAttribute && e.target.getAttribute("data-f") === "mapfile") {
      const file = e.target.files && e.target.files[0];
      if (file) { S.mapImg = URL.createObjectURL(file); S.mapZone = ""; bagPut('map-image', 'last', { name: file.name }); render(); }
      return;
    }
    const f = e.target.getAttribute && e.target.getAttribute("data-f");
    if (f === "ageBasis") { S.ageBasis = e.target.value; render(); return; }
    if (f && f.indexOf("ibd_") === 0 && S.ibDraft) {
      S.ibDraft[f.slice(4)] = e.target.value;
      if (f === "ibd_site") S.ibDraft.zone = zonesOf(S.ibDraft.site)[0] || "";
      if (DRAFTS && S.ibConfirm) DRAFTS.put(draftAcct(), 'inbound-confirm', S.ibConfirm, { values: { ...S.ibDraft } });
      render(); return;
    }
    if (f === "editSeat") S.editSeat = e.target.value;
    if (f && S.editDraft && Object.prototype.hasOwnProperty.call(S.editDraft, f)) {S.editDraft[f] = e.target.value;noteControlledActivity();draftSaveEdit();if(f==="owner"||f==="department")render();else autosaveAsset(f);} /* 保管人／部門在 blur 時重繪，讓同座位連動提示在儲存前出現 */
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target.getAttribute && e.target.getAttribute("data-f") === "manualCode") { scan(S.manualCode); }
    if (e.key === "Enter" && e.target.getAttribute && e.target.getAttribute("data-f") === "scanProjectInput") { S.scanProject = (S.scanProjectInput || "").trim(); render(); }
  });

  document.addEventListener('click',e=>{const t=e.target.closest?.('[data-diff-action]');if(t&&differenceUI)differenceUI.act(t.dataset.diffAction,t.dataset.diffKey);});
  document.addEventListener('input',e=>{if(e.target.dataset?.diffField&&differenceUI)differenceUI.field(e.target);});
  document.addEventListener('change',e=>{if(e.target.dataset?.diffField&&differenceUI)differenceUI.field(e.target);});
  function sharedReadSafe(){return !S.scanBusy&&!S.scanQueue?.length&&!Object.keys(S.scanHeld||{}).length&&!S.editDraft&&!S.ibDraft&&!S.annOpen&&!S.camOn&&!seatUI?.state.busy&&!seatUI?.state.draft&&!seatUI?.state.editing&&!intakeUI?.state.busy&&!intakeUI?.state.book&&!differenceUI?.state.key&&!repairUI?.state.code;}
  document.addEventListener('click',async e=>{const t=e.target.closest?.('[data-a="shared-refresh"]');if(!t||S.sharedBusy||!store.refreshShared)return;S.sharedBusy=true;S.sharedMessage='';render();try{await store.refreshShared(sharedReadSafe);const current=S.sess&&db().sessions.find(x=>x.id===S.sess.id);if(current)S.sess=current;S.sharedMessage='共同資料已更新，包含所有人的設備與盤點結果。';}catch(e){S.sharedMessage=e.message;}finally{S.sharedBusy=false;checkAppVersion();render();}});
  document.addEventListener('click',async e=>{const t=e.target.closest?.('[data-repair-action]');if(t&&repairUI){if(t.dataset.repairAction==='save'&&S.editTouched){repairUI.state.error='上方有尚未保存的設備編輯，請先保存或取消後再登記維修。';render();return;}await repairUI.act(t.dataset.repairAction,t.dataset.repairCode);if(t.dataset.repairAction==='save'&&!repairUI.state.code){S.editCode='';S.editDraft=null;render();}}});
  document.addEventListener('change',e=>{if(e.target.dataset?.repairField&&repairUI)repairUI.field(e.target)});
  document.addEventListener('input',e=>{if(e.target.dataset?.repairField&&repairUI)repairUI.field(e.target)});
  document.addEventListener("click",e=>{const t=e.target.closest&&e.target.closest("[data-seat-retry]");if(!t)return;const rec=curRecs().find(r=>r.code===t.dataset.seatRetry);if(!rec||!rec.__seatRetry)return;rec.__seatPending=true;rec.__seatError="";render();Promise.all([rec.__write,getA(rec.code)?.__write,S.sess.__write].filter(Boolean)).then(()=>rec.__seatRetry()).then(()=>{rec.__seatPending=false;render()}).catch(e=>{rec.__seatPending=false;rec.__seatError=e.message;render()})});
  document.addEventListener("click", e => {
    const t=e.target.closest && e.target.closest("[data-seat-action]"); if(!t||!seatUI)return;
    e.preventDefault();
    seatUI.act(t.dataset.seatAction,{number:t.dataset.seatNumber,code:t.dataset.seatCode,site:S.mode==="phone"?S.site:S.mapSite,zone:S.mode==="phone"?S.zone:"",sess:S.sess,onScan:(n,m)=>{S.site=m.site;S.zone=m.zone;S.mode="phone";S.screen="start";S.dash=false;render();}});
  });
  document.addEventListener("change",e=>{
    const f=e.target.dataset && e.target.dataset.seatField;if(!f||!seatUI)return;
    if(f==="file"){const file=e.target.files&&e.target.files[0];if(file)seatUI.file(file,S.mapSite,"");}
    else if(f==="plan-file"){const file=e.target.files&&e.target.files[0];if(file)seatUI.planFile(file);}
    else {seatUI.field(f,f==='imp-names'?e.target.checked:e.target.value);if(f==="name")seatUI.autosaveName({site:S.mode==="phone"?S.site:S.mapSite,zone:S.mode==="phone"?S.zone:""});}
  });
  document.addEventListener("input",e=>{const f=e.target.dataset&&e.target.dataset.seatField;if(f==="name"&&seatUI)seatUI.field(f,e.target.value);});
  document.addEventListener("change",e=>{if(intakeUI&&(e.target.dataset.intake||e.target.dataset.intakeMap))intakeUI.field(e.target);});
  document.addEventListener("click",e=>{const t=e.target.closest&&e.target.closest("[data-intake-action]");if(t&&intakeUI)intakeUI.act(t.dataset.intakeAction);});
  /* 開機：sheets 後端需先載入鏡像（唯一 async 入口），mock 直接渲染 */
  function boot() {
    if (!D.isMock && typeof store.init === "function") {
      S.booting = true; S.bootErr = ""; render();
      store.init().then(() => {
        S.booting = false;
        refreshVersionBadge();
        if (seatUI && typeof store.loadSeatMap === "function") store.loadSeatMap().then(() => {seatUI.state.loaded=true;render();});
        if (typeof store.onSyncChange === "function") store.onSyncChange(() => { refreshSyncBadge(); refreshScanSync(); refreshVersionBadge(); });
        checkAppVersion();
        render();
      }).catch((e) => {
        S.booting = false; S.bootErr = String(e && e.message || e); S.bootAuth = !!(e && e.authRefused);
        render();
      });
    } else {
      if (seatUI && typeof store.loadSeatMap === "function") store.loadSeatMap().then(() => {seatUI.state.loaded=true;render();});
      render();
    }
  }
  document.addEventListener("visibilitychange", () => { if (!document.hidden) checkAppVersion(); });
  document.addEventListener("click", (e) => {
    const t = e.target.closest && e.target.closest("#erp-sync-badge");
    if (t && typeof store.retryUnsynced === "function") { store.retryUnsynced(); }
  });
  document.addEventListener("click", (e) => {
    const t = e.target.closest && e.target.closest('[data-a="bootretry"]');
    if (t) boot();
  });
  document.addEventListener('click',async e=>{const t=e.target.closest?.('[data-erp-auth]');if(!t)return;if(t.dataset.erpAuth==='login')await window.ErpAuth.login();else if(await window.ErpAuth.verify())boot();});
  window.addEventListener('erp-auth-change',()=>render());
  if(window.ErpAuth&&!D.isMock)window.ErpAuth.ready.then(ok=>{if(ok)boot();else render();});else boot();
})();
