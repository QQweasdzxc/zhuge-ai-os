(function initializeVendorSheetService(global){
  "use strict";
  const SHEETS_API="https://sheets.googleapis.com/v4/spreadsheets";
  const BRIDGE_FUNCTION="gas-vendor-bridge";
  const DEFAULTS={spreadsheetId:"1RO6idAURJi40wnzH7LBeTzkJpSGQ2yZbfSJ7hMde1jY",sheetName:"廠商名冊-CS集團(CS、CK、UU)",range:"A:U",timeoutMs:15000,bridgeTimeoutMs:45000,chunkSize:25,maxRows:1000};
  const KEYS=["orderDate","company","purchaseNo","vendorName","taxId","contactMailLegacy","paymentTerms","products","integritySignedAt","integrityOriginal","csrSelfAssessment","csrOriginal","phone","contactName","mobile","email","project","contracted","insured","vendorId","businessCategory"];
  const BUSINESS_CATEGORIES=["採購","總務"];
  function normalizeBusinessCategories(value,required=false){
    const values=(Array.isArray(value)?value:[value]).flatMap(item=>String(item??"").split(/[、,，/／|;；\s]+/)).map(item=>item.trim()).filter(Boolean);
    const unique=[...new Set(values)];
    if(!unique.length){if(required) throw new VendorSheetError("業務分類至少選擇一項。","VENDOR_CATEGORY_REQUIRED");return "";}
    const invalid=unique.filter(item=>!BUSINESS_CATEGORIES.includes(item));
    if(invalid.length) throw new VendorSheetError("業務分類只能選擇「採購」或「總務」。","VENDOR_CATEGORY_INVALID");
    return BUSINESS_CATEGORIES.filter(item=>unique.includes(item)).join("、");
  }
  function token(){
    if(typeof global.currentGoogleProviderToken==="function") return String(global.currentGoogleProviderToken()||"");
    const s=typeof global.getStoredAuthSession==="function"?global.getStoredAuthSession():null;
    return String(s?.provider_token||"");
  }
  function q(name){return `'${String(name).replace(/'/g,"''")}'`}
  class VendorSheetError extends Error{constructor(message,code="VENDOR_SHEET_ERROR",status=0){super(message);this.name="VendorSheetError";this.code=code;this.status=status;}}
  class VendorSheetService{
    constructor(options={}){this.config={...DEFAULTS,...options};this.fetchImpl=options.fetchImpl||global.fetch?.bind(global);}
    isAuthorized(){return Boolean(token());}
    async request(path,options={}){
      const accessToken=token();
      if(!accessToken) throw new VendorSheetError("Google Sheet 尚未授權，請重新使用 Google 登入。","GOOGLE_REAUTHORIZE_REQUIRED");
      if(!this.fetchImpl) throw new VendorSheetError("瀏覽器無法啟動 Google Sheet 連線。","FETCH_UNAVAILABLE");
      const controller=new AbortController();
      const timeoutMs=Number(options.timeoutMs||this.config.timeoutMs||15000);
      const timer=setTimeout(()=>controller.abort(),timeoutMs);
      let response;
      const fetchPromise=this.fetchImpl(`${SHEETS_API}/${this.config.spreadsheetId}${path}`,{
        method:options.method||"GET",signal:controller.signal,
        headers:{Authorization:`Bearer ${accessToken}`,...(options.body?{"Content-Type":"application/json"}:{}),...(options.headers||{})},
        body:options.body?JSON.stringify(options.body):undefined
      });
      const hardTimeout=new Promise((_,reject)=>setTimeout(()=>{
        try{controller.abort();}catch(_){}
        reject(new VendorSheetError(`Google Sheet 連線逾時（${Math.round(timeoutMs/1000)} 秒）。`,"SHEETS_TIMEOUT"));
      },timeoutMs));
      try{
        response=await Promise.race([fetchPromise,hardTimeout]);
      }catch(error){
        if(error instanceof VendorSheetError) throw error;
        if(error?.name==="AbortError") throw new VendorSheetError(`Google Sheet 連線逾時（${Math.round(timeoutMs/1000)} 秒）。`,"SHEETS_TIMEOUT");
        throw new VendorSheetError(`無法連線 Google Sheet：${error?.message||"網路錯誤"}`,"SHEETS_NETWORK_ERROR");
      }finally{clearTimeout(timer);}
      if(!response.ok){
        const details=await response.text().catch(()=>"");
        if(response.status===401||response.status===403) throw new VendorSheetError("Google Sheet 權限不足或授權已失效，請重新 Google 登入授權。","GOOGLE_REAUTHORIZE_REQUIRED",response.status);
        throw new VendorSheetError(`Google Sheet 同步失敗（HTTP ${response.status}）${details?`：${details.slice(0,180)}`:""}`,"SHEETS_API_ERROR",response.status);
      }
      return response.status===204?null:response.json();
    }
    async readRange(a1){
      const range=encodeURIComponent(`${q(this.config.sheetName)}!${a1}`);
      return this.request(`/values/${range}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`);
    }
    rowToItem(row,rowNumber){const item={rowNumber};KEYS.forEach((key,i)=>item[key]=String(row[i]??"").trim());return item;}
    async bridgeRequest(body){
      const gateway=global.ZhugeSupabaseGateway?.createDataGateway?.();
      if(!gateway?.invokeFunction) throw new VendorSheetError("Shared Supabase 服務尚未就緒。","BRIDGE_UNAVAILABLE");
      const controller=new AbortController();
      const timeoutMs=Number(this.config.bridgeTimeoutMs||this.config.timeoutMs||15000);
      let timer;
      const timeoutPromise=new Promise((_,reject)=>{timer=setTimeout(()=>{
        try{controller.abort();}catch(_){ }
        const error=new Error(`Vendor Server Bridge 連線逾時（${Math.round(timeoutMs/1000)} 秒）。`);
        error.name="AbortError";
        reject(error);
      },timeoutMs);});
      try{
        return await Promise.race([
          gateway.invokeFunction(BRIDGE_FUNCTION,body,{signal:controller.signal}),
          timeoutPromise
        ]);
      }catch(error){
        if(error?.name==="AbortError") throw new VendorSheetError(`廠商資料服務逾時（${Math.round(timeoutMs/1000)} 秒）。`,`BRIDGE_TIMEOUT`);
        throw new VendorSheetError(error?.message||"廠商資料讀取失敗。",error?.code||"BRIDGE_READ_FAILED",error?.status||0);
      }finally{clearTimeout(timer);}
    }
    async bridgeRead(){return this.bridgeRequest({action:"read"});}
    async bridgeUpdate(vendorId,patch){return this.bridgeRequest({action:"update",vendorId,patch});}
    async bridgeCreate(vendor){return this.bridgeRequest({action:"create",vendor});}
    async list(options={}){
      const onProgress=typeof options.onProgress==="function"?options.onProgress:()=>{};
      onProgress({phase:"auth",percent:5,message:"確認 Zhuge AI OS 登入…",loaded:0,total:0});
      onProgress({phase:"read",percent:10,message:"正在取得廠商資料…",loaded:0,total:0});
      const data=await this.bridgeRead();
      const body=Array.isArray(data?.rows)?data.rows:[];
      const reportedCount=Number(data?.vendorCount);
      if(!Number.isInteger(reportedCount)||reportedCount!==body.length) throw new VendorSheetError("Vendor Server Bridge 回傳筆數無法驗證。","BRIDGE_RESPONSE_INVALID");
      const rows=body.map((row,i)=>{
        const item={rowNumber:Number(row?.rowNumber)||i+2};
        KEYS.forEach(key=>item[key]=String(row?.[key]??"").trim());
        return item;
      }).filter(item=>item.vendorName||item.vendorId||item.purchaseNo);
      if(rows.length!==reportedCount) throw new VendorSheetError("Vendor Server Bridge 回傳資料不完整。","BRIDGE_RESPONSE_INVALID");
      onProgress({phase:"read",percent:95,message:`已讀取 ${rows.length} 筆廠商資料`,loaded:rows.length,total:rows.length});
      onProgress({phase:"render",percent:98,message:`正在更新廠商清單… ${rows.length} / ${rows.length} 筆`,loaded:rows.length,total:rows.length});
      return rows;
    }
    async update(vendorId,patch={},options={}){
      const onProgress=typeof options.onProgress==="function"?options.onProgress:()=>{};
      if(!String(vendorId||"").trim()) throw new VendorSheetError("無效的廠商 ID。","INVALID_VENDOR_ID");
      onProgress({phase:"write",percent:55,message:"正在更新廠商資料…",loaded:0,total:1});
      const payload={...patch};
      if(Object.prototype.hasOwnProperty.call(payload,"businessCategory")) payload.businessCategory=normalizeBusinessCategories(payload.businessCategory,true);
      const data=await this.bridgeUpdate(String(vendorId).trim(),payload);
      const raw=data?.vendor;
      if(!raw||String(raw.vendorId||"").trim()!==String(vendorId).trim()) throw new VendorSheetError("廠商資料更新結果無法確認。","BRIDGE_WRITE_READBACK_INVALID");
      onProgress({phase:"verify",percent:85,message:"正在確認更新結果…",loaded:1,total:1});
      const item={rowNumber:Number(raw.rowNumber)||0};
      KEYS.forEach(key=>item[key]=String(raw[key]??"").trim());
      onProgress({phase:"done",percent:100,message:"廠商資料已更新",loaded:1,total:1});
      return item;
    }
    async create(vendor={},options={}){
      const onProgress=typeof options.onProgress==="function"?options.onProgress:()=>{};
      const payload={};
      KEYS.filter(key=>key!=="vendorId").forEach(key=>{payload[key]=key==="businessCategory"?normalizeBusinessCategories(vendor[key],true):String(vendor[key]??"").trim();});
      if(!payload.vendorName) throw new VendorSheetError("請填寫廠商名稱。","VENDOR_NAME_REQUIRED");
      onProgress({phase:"write",percent:55,message:"正在新增廠商資料…",loaded:0,total:1});
      const data=await this.bridgeCreate(payload);
      const raw=data?.vendor;
      if(!raw||!String(raw.vendorId||"").trim()) throw new VendorSheetError("廠商新增結果無法確認。","BRIDGE_CREATE_READBACK_INVALID");
      const item={rowNumber:Number(raw.rowNumber)||0};
      KEYS.forEach(key=>item[key]=String(raw[key]??"").trim());
      onProgress({phase:"verify",percent:85,message:"正在確認新增結果…",loaded:1,total:1});
      onProgress({phase:"done",percent:100,message:"廠商資料已新增",loaded:1,total:1});
      return item;
    }
    async readRow(rowNumber){const data=await this.readRange(`A${rowNumber}:U${rowNumber}`);const row=[...((data?.values||[])[0]||[])];while(row.length<21)row.push("");return row.slice(0,21);}
  }
  global.VendorSheetService={VendorSheetService,VendorSheetError,config:DEFAULTS};
})(window);
