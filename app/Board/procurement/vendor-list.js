(function(){
  "use strict";
  let mountedRoot=null;
  function mountVendorClient(){
  const root=document.querySelector('[data-procurement-panel="vendors"]');
  if(!root||!window.VendorSheetService||root===mountedRoot)return;
  mountedRoot=root;
  root.dataset.vendorClientMounted="true";
  const service=new window.VendorSheetService.VendorSheetService();
  let rows=[]; let selected=null; let editorMode="edit";
  const EDITABLE_FIELDS=[
    {key:"orderDate",label:"日期"},{key:"company",label:"公司"},{key:"purchaseNo",label:"採購單號"},{key:"vendorName",label:"廠商名稱"},{key:"businessCategory",label:"業務分類",options:["採購","總務"]},{key:"taxId",label:"統編"},{key:"contactMailLegacy",label:"原始通報 Email"},{key:"paymentTerms",label:"付款方式"},{key:"products",label:"產品／類型",wide:true,textarea:true},{key:"integritySignedAt",label:"誠信簽署日期"},{key:"integrityOriginal",label:"誠信原始資料",wide:true,textarea:true},{key:"csrSelfAssessment",label:"CSR 自評",wide:true,textarea:true},{key:"csrOriginal",label:"CSR 原始資料",wide:true,textarea:true},{key:"phone",label:"電話"},{key:"contactName",label:"聯絡人"},{key:"mobile",label:"手機"},{key:"email",label:"Email",type:"email"},{key:"project",label:"專案",wide:true},{key:"contracted",label:"是否簽約"},{key:"insured",label:"是否投保"}
  ];
  const EDITABLE_KEYS=EDITABLE_FIELDS.map(field=>field.key);
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const editorFields=EDITABLE_FIELDS.map(field=>`<label${field.wide?' class="wide"':''}>${field.label}${field.options?`<select name="${field.key}">${field.options.map(option=>`<option value="${esc(option)}">${esc(option)}</option>`).join("")}</select>`:field.textarea?`<textarea name="${field.key}" rows="3"></textarea>`:`<input name="${field.key}"${field.type?` type="${field.type}"`:''}>`}</label>`).join("");
  root.innerHTML=`<section class="vendor-page">
    <div class="vendor-toolbar"><div><h2>廠商清單</h2><p>與 Google Sheet 共用同一份資料；此頁不建立第二套廠商主檔。</p></div><div class="vendor-toolbar-actions"><button type="button" class="vendor-add" data-vendor-add>＋ 新增廠商</button><div class="vendor-sync" data-vendor-sync>尚未同步</div></div></div><div class="vendor-progress" data-vendor-progress hidden><div class="vendor-progress-head"><strong data-vendor-progress-label>準備同步…</strong><span data-vendor-progress-percent>0%</span></div><div class="vendor-progress-track"><div class="vendor-progress-bar" data-vendor-progress-bar></div></div></div>
    <div class="vendor-filters"><input type="search" data-vendor-search placeholder="搜尋廠商、產品、聯絡人、電話、Email…"><select data-vendor-company><option value="">全部公司</option></select><select data-vendor-category><option value="">全部業務分類</option><option value="採購">採購</option><option value="總務">總務</option></select><input type="search" data-vendor-product placeholder="產品／類型"><button type="button" data-vendor-refresh>↻ 重新同步</button></div>
    <div class="vendor-summary"><strong data-vendor-count>0</strong><span>筆資料</span><span class="vendor-source">來源：(G)採購作業明細／廠商名冊-CS集團(CS、CK、UU)</span></div>
    <div class="vendor-table-wrap"><table class="vendor-table"><thead><tr><th>廠商名稱</th><th>公司</th><th>業務分類</th><th>類型／產品</th><th>聯絡人</th><th>電話</th><th>Email</th><th>付款方式</th><th></th></tr></thead><tbody data-vendor-body></tbody></table></div>
    <div class="vendor-empty" data-vendor-empty hidden>找不到符合條件的廠商。</div>
  </section>
  <dialog class="vendor-dialog" data-vendor-dialog><form method="dialog"><div class="vendor-dialog-head"><div><div class="vendor-id" data-vendor-id></div><h3 data-vendor-title>廠商資料</h3></div><button value="cancel" aria-label="關閉">×</button></div><div class="vendor-form">
    ${editorFields}
  </div><div class="vendor-dialog-actions"><span data-vendor-save-state></span><button value="cancel">取消</button><button type="button" class="primary" data-vendor-save>儲存並同步 Google Sheet</button></div></form></dialog>`;
  const $=s=>root.querySelector(s); const body=$('[data-vendor-body]'),search=$('[data-vendor-search]'),company=$('[data-vendor-company]'),category=$('[data-vendor-category]'),product=$('[data-vendor-product]'),sync=$('[data-vendor-sync]'),dialog=$('[data-vendor-dialog]'),form=dialog.querySelector('form'),progress=$('[data-vendor-progress]'),progressLabel=$('[data-vendor-progress-label]'),progressPercent=$('[data-vendor-progress-percent]'),progressBar=$('[data-vendor-progress-bar]');
  function setSync(text,state=""){sync.textContent=text;sync.dataset.state=state;}
  function setProgress(info={}){const pct=Math.max(0,Math.min(100,Number(info.percent)||0));progress.hidden=false;progressLabel.textContent=info.message||"同步中…";progressPercent.textContent=`${pct}%`;progressBar.style.width=`${pct}%`;progress.dataset.state=info.phase||"";}
  function finishProgress(){setTimeout(()=>{progress.hidden=true;},900);}
  function filters(){const q=search.value.trim().toLowerCase(),p=product.value.trim().toLowerCase(),c=company.value,k=category.value;return rows.filter(r=>{const hay=[r.vendorName,r.products,r.contactName,r.phone,r.mobile,r.email,r.taxId,r.purchaseNo,r.businessCategory].join(" ").toLowerCase();return(!q||hay.includes(q))&&(!p||r.products.toLowerCase().includes(p))&&(!c||r.company===c)&&(!k||r.businessCategory===k);});}
  function render(){const list=filters();$('[data-vendor-count]').textContent=list.length;$('[data-vendor-empty]').hidden=Boolean(list.length);body.innerHTML=list.map(r=>`<tr><td><strong>${esc(r.vendorName||"—")}</strong><small>${esc(r.vendorId||"尚無廠商ID")}</small></td><td>${esc(r.company||"—")}</td><td>${esc(r.businessCategory||"—")}</td><td class="vendor-products">${esc(r.products||"—")}</td><td>${esc(r.contactName||"—")}</td><td>${esc(r.mobile||r.phone||"—")}</td><td>${esc(r.email||r.contactMailLegacy||"—")}</td><td>${esc(r.paymentTerms||"—")}</td><td><button type="button" class="vendor-edit" data-row="${r.rowNumber}">查看／編輯</button></td></tr>`).join("");}
  function fillCompanies(){const current=company.value;const values=[...new Set(rows.map(r=>r.company).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"zh-Hant"));company.innerHTML='<option value="">全部公司</option>'+values.map(v=>`<option>${esc(v)}</option>`).join("");if(values.includes(current))company.value=current;}
  function fillCategories(){const current=category.value;const values=[...new Set(["採購","總務",...rows.map(r=>r.businessCategory).filter(Boolean)])];category.innerHTML='<option value="">全部業務分類</option>'+values.map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join("");if(values.includes(current))category.value=current;}
  async function load(){setSync("同步中…","loading");setProgress({phase:"start",percent:1,message:"準備連線 Google Sheet…"});try{rows=await service.list({onProgress:setProgress});fillCompanies();fillCategories();render();setProgress({phase:"done",percent:100,message:`同步完成 · ${rows.length} 筆廠商`});setSync(`已同步 · ${new Date().toLocaleTimeString("zh-TW",{hour:"2-digit",minute:"2-digit"})}`,"ok");finishProgress();}catch(e){console.error(e);setProgress({phase:"error",percent:0,message:e.message||"同步失敗"});setSync(e.message||"同步失敗","error");body.innerHTML=`<tr><td colspan="9" class="vendor-error">${esc(e.message||"無法讀取 Google Sheet")}</td></tr>`;}}
  function openEditor(rowNumber){selected=rows.find(r=>r.rowNumber===Number(rowNumber));if(!selected)return;editorMode="edit";$('[data-vendor-id]').textContent=selected.vendorId||`Sheet 第 ${selected.rowNumber} 列`;$('[data-vendor-title]').textContent=selected.vendorName||"廠商資料";EDITABLE_KEYS.forEach(k=>{const field=form.elements.namedItem(k);if(field)field.value=selected[k]||"";});$('[data-vendor-save-state]').textContent="";$('[data-vendor-save]').textContent="儲存並同步 Google Sheet";dialog.showModal();}
  function openCreate(){selected={};editorMode="create";$('[data-vendor-id]').textContent="Vendor ID 將由 Google Sheet Bridge 配發";$('[data-vendor-title]').textContent="新增廠商";EDITABLE_KEYS.forEach(k=>{const field=form.elements.namedItem(k);if(field)field.value=k==="businessCategory"?"採購":"";});$('[data-vendor-save-state]').textContent="";$('[data-vendor-save]').textContent="新增並同步 Google Sheet";dialog.showModal();}
  async function save(){if(!selected)return;const wasCreate=editorMode==="create";const btn=$('[data-vendor-save]'),state=$('[data-vendor-save-state]');btn.disabled=true;state.textContent="同步中…";const patch={};EDITABLE_KEYS.forEach(k=>{const field=form.elements.namedItem(k);patch[k]=field?.value.trim()||"";});try{const operation=wasCreate?service.create(patch,{onProgress:info=>{setProgress(info);state.textContent=info.message||"同步中…";}}):service.update(selected.vendorId,patch,{onProgress:info=>{setProgress(info);state.textContent=info.message||"同步中…";}});const updated=await operation;const index=rows.findIndex(r=>r.vendorId===updated.vendorId);if(index>=0)rows[index]=updated;else rows.push(updated);selected=updated;editorMode="edit";fillCompanies();fillCategories();render();setSync(`已同步 · ${new Date().toLocaleTimeString("zh-TW",{hour:"2-digit",minute:"2-digit"})}`,"ok");state.textContent=wasCreate?"已新增至 Google Sheet":"已寫回 Google Sheet";finishProgress();setTimeout(()=>dialog.close(),450);}catch(e){console.error(e);setProgress({phase:"error",percent:0,message:e.message||"同步失敗"});state.textContent=e.message||"同步失敗";}finally{btn.disabled=false;}}
  [search,company,category,product].forEach(el=>el.addEventListener("input",render));$('[data-vendor-refresh]').addEventListener("click",load);$('[data-vendor-add]').addEventListener("click",openCreate);body.addEventListener("click",e=>{const btn=e.target.closest('[data-row]');if(btn)openEditor(btn.dataset.row);});$('[data-vendor-save]').addEventListener("click",save);
  window.addEventListener("zhuge:procurement-tab-change",event=>{if(event.detail?.key==="vendors"&&!rows.length)load();});
  // Vendor directory is a live view of the Google Sheet. Start the first read as soon as
  // the page runtime is ready so the tab never sits at a misleading “尚未同步” state.
  // A later tab activation/refresh can safely retry if Google authorization is not ready yet.
  queueMicrotask(()=>load());
  }
  mountVendorClient();
  const observationRoot=document.querySelector(".main")||document.body;
  if(observationRoot&&typeof MutationObserver==="function"){
    const observer=new MutationObserver(()=>queueMicrotask(mountVendorClient));
    observer.observe(observationRoot,{childList:true,subtree:true});
  }
  window.addEventListener("zhuge-template-adoption-updated",()=>setTimeout(mountVendorClient,0));
})();
