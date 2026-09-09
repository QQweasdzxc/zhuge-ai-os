(function(){
  "use strict";
  let mountedRoot=null;
  const BUSINESS_CATEGORIES=["採購","總務"];
  const COLUMN_DEFS=[
    {key:"vendorName",label:"廠商名稱",defaultVisible:true,fixed:true},
    {key:"company",label:"公司",defaultVisible:true},
    {key:"businessCategory",label:"業務分類",defaultVisible:true},
    {key:"products",label:"產品／服務",defaultVisible:true},
    {key:"contactName",label:"聯絡人",defaultVisible:true},
    {key:"mobile",label:"手機",defaultVisible:true},
    {key:"email",label:"Email",defaultVisible:true},
    {key:"paymentTerms",label:"付款方式",defaultVisible:false},
    {key:"phone",label:"電話",defaultVisible:false},
    {key:"orderDate",label:"下單日期",defaultVisible:false},
    {key:"purchaseNo",label:"採購單編號",defaultVisible:false},
    {key:"taxId",label:"統編",defaultVisible:false},
    {key:"contactMailLegacy",label:"原始通報 Email",defaultVisible:false},
    {key:"project",label:"專案",defaultVisible:false},
    {key:"contracted",label:"是否簽約",defaultVisible:false},
    {key:"insured",label:"是否投保",defaultVisible:false},
    {key:"integritySignedAt",label:"誠信簽署日期",defaultVisible:false},
    {key:"integrityOriginal",label:"誠信原始資料",defaultVisible:false},
    {key:"csrSelfAssessment",label:"CSR 自評",defaultVisible:false},
    {key:"csrOriginal",label:"CSR 原始資料",defaultVisible:false}
  ];
  const CORE_FIELDS=[
    {key:"vendorName",label:"廠商名稱",required:true},
    {key:"company",label:"公司"},
    {key:"products",label:"產品／服務",wide:true,textarea:true},
    {key:"contactName",label:"聯絡人"},
    {key:"phone",label:"電話"},
    {key:"mobile",label:"手機"},
    {key:"email",label:"Email",type:"email"},
    {key:"paymentTerms",label:"付款方式",wide:true}
  ];
  const MORE_FIELDS=[
    {key:"orderDate",label:"下單日期"},
    {key:"purchaseNo",label:"採購單編號"},
    {key:"taxId",label:"統編"},
    {key:"contactMailLegacy",label:"原始通報 Email"},
    {key:"project",label:"專案",wide:true},
    {key:"contracted",label:"是否簽約"},
    {key:"insured",label:"是否投保"},
    {key:"integritySignedAt",label:"誠信簽署日期"},
    {key:"integrityOriginal",label:"誠信原始資料",wide:true,textarea:true},
    {key:"csrSelfAssessment",label:"CSR 自評",wide:true,textarea:true},
    {key:"csrOriginal",label:"CSR 原始資料",wide:true,textarea:true}
  ];
  const EDITABLE_KEYS=[...CORE_FIELDS.map(field=>field.key),...MORE_FIELDS.map(field=>field.key),"businessCategory"];
  const esc=value=>String(value??"").replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const parseCategories=value=>(Array.isArray(value)?value:[value]).flatMap(item=>String(item??"").split(/[、,，/／|;；\s]+/)).map(item=>item.trim()).filter(Boolean);
  const categoryText=value=>parseCategories(value).join("、")||"—";
  const valueText=(row,key)=>key==="businessCategory"?categoryText(row[key]):String(row[key]??"").trim()||"—";

  function fieldMarkup(field){
    const required=field.required?" required":"";
    const control=field.textarea
      ? `<textarea name="${field.key}" rows="3"${required}></textarea>`
      : `<input name="${field.key}"${field.type?` type="${field.type}"`:" type=\"text\""}${required}>`;
    return `<label${field.wide?' class="wide"':''}><span>${field.label}${field.required?' <em>必填</em>':''}</span>${control}</label>`;
  }
  function categoryMarkup(){
    return `<fieldset class="vendor-category-field" data-vendor-category><legend>業務分類 <em>至少選一項</em></legend><div class="vendor-category-options">${BUSINESS_CATEGORIES.map(category=>`<label><input type="checkbox" name="businessCategory" value="${esc(category)}"><span>${esc(category)}</span></label>`).join("")}</div><small data-vendor-category-error></small></fieldset>`;
  }
  function mountVendorClient(){
    const root=document.querySelector('[data-procurement-panel="vendors"]');
    if(!root||!window.VendorSheetService||root===mountedRoot)return;
    mountedRoot=root;
    root.dataset.vendorClientMounted="true";
    const service=new window.VendorSheetService.VendorSheetService();
    let rows=[];
    let selected=null;
    let editorMode="edit";
    const visibleColumns=new Set(COLUMN_DEFS.filter(column=>column.defaultVisible).map(column=>column.key));
    const coreMarkup=CORE_FIELDS.map(field=>fieldMarkup(field)).join("");
    const moreMarkup=MORE_FIELDS.map(field=>fieldMarkup(field)).join("");
    root.innerHTML=`<section class="vendor-page">
      <div class="vendor-toolbar"><div><h2>廠商清單</h2><p>先看常用的廠商與聯絡資訊，需要時再顯示更多欄位。</p></div><div class="vendor-toolbar-actions"><button type="button" class="vendor-add" data-vendor-add>＋ 新增廠商</button><div class="vendor-sync" data-vendor-sync aria-live="polite">尚未更新</div></div></div>
      <div class="vendor-progress" data-vendor-progress hidden><div class="vendor-progress-head"><strong data-vendor-progress-label>準備更新…</strong><span data-vendor-progress-percent>0%</span></div><div class="vendor-progress-track"><div class="vendor-progress-bar" data-vendor-progress-bar></div></div></div>
      <div class="vendor-filters"><input type="search" data-vendor-search placeholder="搜尋廠商、產品、聯絡人、電話、Email…"><select data-vendor-company><option value="">全部公司</option></select><select data-vendor-category><option value="">全部業務分類</option><option value="採購">採購</option><option value="總務">總務</option></select><input type="search" data-vendor-product placeholder="產品／服務"><button type="button" data-vendor-refresh>↻ 重新整理</button></div>
      <div class="vendor-list-tools"><div class="vendor-summary"><strong data-vendor-count>0</strong><span>筆資料</span><span class="vendor-source">資料來自共用廠商名冊</span></div><details class="vendor-column-picker"><summary>顯示欄位</summary><div class="vendor-column-options" data-vendor-column-options></div></details></div>
      <div class="vendor-table-wrap"><table class="vendor-table" data-vendor-table><thead data-vendor-head></thead><tbody data-vendor-body></tbody></table></div>
      <div class="vendor-mobile-list" data-vendor-mobile-list></div><div class="vendor-empty" data-vendor-empty hidden>找不到符合條件的廠商。</div>
    </section>
    <dialog class="vendor-dialog" data-vendor-dialog><form data-vendor-form novalidate><div class="vendor-dialog-head"><div><div class="vendor-dialog-kicker">廠商資料</div><h3 data-vendor-title>廠商資料</h3></div><button type="button" data-vendor-close aria-label="關閉">×</button></div><section class="vendor-form-section"><h4>常用資料</h4><div class="vendor-form">${coreMarkup}${categoryMarkup()}</div></section><details class="vendor-more-fields"><summary>更多資料（選填）</summary><div class="vendor-form">${moreMarkup}</div></details><div class="vendor-dialog-actions"><span data-vendor-save-state aria-live="polite"></span><button type="button" data-vendor-cancel>取消</button><button type="button" class="primary" data-vendor-save>儲存資料</button></div></form></dialog>`;
    const $=selector=>root.querySelector(selector);
    const body=$("[data-vendor-body]");
    const head=$("[data-vendor-head]");
    const mobileList=$("[data-vendor-mobile-list]");
    const search=$("[data-vendor-search]");
    const company=$("[data-vendor-company]");
    const category=$("[data-vendor-category]");
    const product=$("[data-vendor-product]");
    const sync=$("[data-vendor-sync]");
    const dialog=$("[data-vendor-dialog]");
    const form=$("[data-vendor-form]");
    const progress=$("[data-vendor-progress]");
    const progressLabel=$("[data-vendor-progress-label]");
    const progressPercent=$("[data-vendor-progress-percent]");
    const progressBar=$("[data-vendor-progress-bar]");
    const categoryError=$("[data-vendor-category-error]");

    function setSync(text,state=""){sync.textContent=text;sync.dataset.state=state;}
    function setProgress(info={}){const percent=Math.max(0,Math.min(100,Number(info.percent)||0));progress.hidden=false;progressLabel.textContent=info.message||"更新中…";progressPercent.textContent=`${percent}%`;progressBar.style.width=`${percent}%`;progress.dataset.state=info.phase||"";}
    function finishProgress(){setTimeout(()=>{progress.hidden=true;},900);}
    function activeColumns(){return COLUMN_DEFS.filter(column=>visibleColumns.has(column.key)||column.fixed);}
    function renderColumnOptions(){
      $("[data-vendor-column-options]").innerHTML=COLUMN_DEFS.map(column=>`<label><input type="checkbox" data-vendor-column="${column.key}"${visibleColumns.has(column.key)?" checked":""}${column.fixed?" disabled":""}><span>${column.label}${column.fixed?"（固定）":""}</span></label>`).join("");
    }
    function filteredRows(){
      const query=search.value.trim().toLowerCase();
      const productQuery=product.value.trim().toLowerCase();
      const companyValue=company.value;
      const categoryValue=category.value;
      return rows.filter(row=>{
        const haystack=COLUMN_DEFS.map(column=>row[column.key]).join(" ").toLowerCase();
        const categories=parseCategories(row.businessCategory);
        return (!query||haystack.includes(query))&&(!productQuery||String(row.products||"").toLowerCase().includes(productQuery))&&(!companyValue||row.company===companyValue)&&(!categoryValue||categories.includes(categoryValue));
      });
    }
    function cellMarkup(row,column){const text=valueText(row,column.key);return `<td data-column="${column.key}"><span class="vendor-cell-ellipsis" title="${esc(text)}">${esc(text)}</span></td>`;}
    function mobileMarkup(row){
      return `<article class="vendor-mobile-card"><div class="vendor-mobile-card-head"><div><strong>${esc(valueText(row,"vendorName"))}</strong><small>${esc(valueText(row,"company"))}</small></div><button type="button" class="vendor-edit" data-row="${Number(row.rowNumber)||0}">查看／編輯</button></div><div class="vendor-mobile-category">${esc(categoryText(row.businessCategory))}</div><p class="vendor-mobile-products" title="${esc(valueText(row,"products"))}">${esc(valueText(row,"products"))}</p><div class="vendor-mobile-contact"><span>${esc(valueText(row,"contactName"))}</span><span>${esc(valueText(row,"mobile"))}</span><span>${esc(valueText(row,"email"))}</span></div></article>`;
    }
    function render(){
      const list=filteredRows();
      const columns=activeColumns();
      $("[data-vendor-count]").textContent=list.length;
      $("[data-vendor-empty]").hidden=Boolean(list.length);
      head.innerHTML=`<tr>${columns.map(column=>`<th data-column="${column.key}">${column.label}</th>`).join("")}<th class="vendor-actions-heading">操作</th></tr>`;
      body.innerHTML=list.map(row=>`<tr>${columns.map(column=>cellMarkup(row,column)).join("")}<td class="vendor-actions-cell"><button type="button" class="vendor-edit" data-row="${Number(row.rowNumber)||0}">查看／編輯</button></td></tr>`).join("");
      mobileList.innerHTML=list.map(mobileMarkup).join("");
    }
    function fillCompanies(){
      const current=company.value;
      const values=[...new Set(rows.map(row=>row.company).filter(Boolean))].sort((a,b)=>a.localeCompare(b,"zh-Hant"));
      company.innerHTML='<option value="">全部公司</option>'+values.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join("");
      if(values.includes(current))company.value=current;
    }
    function fillCategories(){
      const current=category.value;
      const values=new Set(BUSINESS_CATEGORIES);
      rows.forEach(row=>parseCategories(row.businessCategory).forEach(value=>values.add(value)));
      category.innerHTML='<option value="">全部業務分類</option>'+[...values].map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join("");
      if(values.has(current))category.value=current;
    }
    async function load(){
      setSync("正在更新…","loading");
      setProgress({phase:"start",percent:1,message:"正在讀取廠商資料…"});
      try{
        rows=await service.list({onProgress:setProgress});
        fillCompanies();
        fillCategories();
        render();
        setProgress({phase:"done",percent:100,message:`資料已更新 · ${rows.length} 筆`});
        setSync(`已更新 · ${new Date().toLocaleTimeString("zh-TW",{hour:"2-digit",minute:"2-digit"})}`,"ok");
        finishProgress();
      }catch(error){
        console.error(error);
        setProgress({phase:"error",percent:0,message:error.message||"資料更新失敗"});
        setSync(error.message||"資料更新失敗","error");
        body.innerHTML=`<tr><td colspan="${activeColumns().length+1}" class="vendor-error">${esc(error.message||"目前無法取得廠商資料")}</td></tr>`;
        mobileList.innerHTML=`<div class="vendor-error">${esc(error.message||"目前無法取得廠商資料")}</div>`;
      }
    }
    function setCategorySelection(values){
      const selectedCategories=new Set(parseCategories(values));
      form.querySelectorAll('input[name="businessCategory"]').forEach(input=>{input.checked=selectedCategories.has(input.value);});
    }
    function setEditorValues(row){
      EDITABLE_KEYS.forEach(key=>{
        if(key==="businessCategory")return;
        const field=form.elements.namedItem(key);
        if(field)field.value=String(row[key]??"");
      });
      setCategorySelection(row.businessCategory);
      categoryError.textContent="";
      $(".vendor-more-fields").open=false;
    }
    function openEditor(rowNumber){
      selected=rows.find(row=>row.rowNumber===Number(rowNumber));
      if(!selected)return;
      editorMode="edit";
      $("[data-vendor-title]").textContent=selected.vendorName||"廠商資料";
      setEditorValues(selected);
      $("[data-vendor-save-state]").textContent="";
      $("[data-vendor-save]").textContent="儲存資料";
      dialog.showModal();
    }
    function openCreate(){
      selected={};
      editorMode="create";
      form.reset();
      setCategorySelection(["採購"]);
      $("[data-vendor-title]").textContent="新增廠商";
      categoryError.textContent="";
      $(".vendor-more-fields").open=false;
      $("[data-vendor-save-state]").textContent="";
      $("[data-vendor-save]").textContent="新增廠商";
      dialog.showModal();
    }
    function collectPayload(){
      const payload={};
      EDITABLE_KEYS.forEach(key=>{
        if(key==="businessCategory")payload[key]=[...form.querySelectorAll('input[name="businessCategory"]:checked')].map(input=>input.value);
        else{const field=form.elements.namedItem(key);payload[key]=String(field?.value||"").trim();}
      });
      return payload;
    }
    function validatePayload(payload){
      const nameField=form.elements.namedItem("vendorName");
      if(!payload.vendorName){nameField.setCustomValidity("請填寫廠商名稱。");nameField.reportValidity();nameField.setCustomValidity("");return false;}
      if(!payload.businessCategory.length){categoryError.textContent="請至少選擇一項業務分類。";form.querySelector('input[name="businessCategory"]').focus();return false;}
      categoryError.textContent="";
      return true;
    }
    async function save(){
      if(!selected)return;
      const patch=collectPayload();
      if(!validatePayload(patch))return;
      const isCreate=editorMode==="create";
      const button=$("[data-vendor-save]");
      const state=$("[data-vendor-save-state]");
      button.disabled=true;
      state.textContent=isCreate?"正在新增資料…":"正在更新資料…";
      try{
        const updated=await (isCreate?service.create(patch,{onProgress:info=>{setProgress(info);state.textContent=info.message||"正在新增資料…";}}):service.update(selected.vendorId,patch,{onProgress:info=>{setProgress(info);state.textContent=info.message||"正在更新資料…";}}));
        const index=rows.findIndex(row=>row.vendorId===updated.vendorId);
        if(index>=0)rows[index]=updated;else rows.push(updated);
        selected=updated;
        editorMode="edit";
        fillCompanies();
        fillCategories();
        render();
        setSync(`已更新 · ${new Date().toLocaleTimeString("zh-TW",{hour:"2-digit",minute:"2-digit"})}`,"ok");
        state.textContent=isCreate?"廠商已新增":"資料已更新";
        finishProgress();
        setTimeout(()=>dialog.close(),650);
      }catch(error){
        console.error(error);
        setProgress({phase:"error",percent:0,message:error.message||"資料更新失敗"});
        state.textContent=error.message||"資料更新失敗，請稍後再試。";
      }finally{button.disabled=false;}
    }

    renderColumnOptions();
    [search,product].forEach(element=>element.addEventListener("input",render));
    [company,category].forEach(element=>element.addEventListener("change",render));
    $("[data-vendor-column-options]").addEventListener("change",event=>{
      const input=event.target.closest("[data-vendor-column]");
      if(!input||input.disabled)return;
      if(input.checked)visibleColumns.add(input.dataset.vendorColumn);else visibleColumns.delete(input.dataset.vendorColumn);
      render();
    });
    $("[data-vendor-refresh]").addEventListener("click",load);
    $("[data-vendor-add]").addEventListener("click",openCreate);
    body.addEventListener("click",event=>{const button=event.target.closest("[data-row]");if(button)openEditor(button.dataset.row);});
    mobileList.addEventListener("click",event=>{const button=event.target.closest("[data-row]");if(button)openEditor(button.dataset.row);});
    $("[data-vendor-save]").addEventListener("click",save);
    $("[data-vendor-close]").addEventListener("click",()=>dialog.close());
    $("[data-vendor-cancel]").addEventListener("click",()=>dialog.close());
    form.addEventListener("submit",event=>{event.preventDefault();save();});
    form.querySelectorAll('input[name="businessCategory"]').forEach(input=>input.addEventListener("change",()=>{categoryError.textContent="";}));
    window.addEventListener("zhuge:procurement-tab-change",event=>{if(event.detail?.key==="vendors"&&!rows.length)load();});
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
