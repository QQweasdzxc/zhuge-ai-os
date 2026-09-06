(function initializeVendorSheetService(global){
  "use strict";
  const SHEETS_API="https://sheets.googleapis.com/v4/spreadsheets";
  const BRIDGE_FUNCTION="gas-vendor-bridge";
  const DEFAULTS={spreadsheetId:"1RO6idAURJi40wnzH7LBeTzkJpSGQ2yZbfSJ7hMde1jY",sheetName:"廠商名冊-CS集團(CS、CK、UU)",range:"A:T",timeoutMs:15000,bridgeTimeoutMs:45000,chunkSize:25,maxRows:1000};
  const KEYS=["orderDate","company","purchaseNo","vendorName","taxId","contactMailLegacy","paymentTerms","products","integritySignedAt","integrityOriginal","csrSelfAssessment","csrOriginal","phone","contactName","mobile","email","project","contracted","insured","vendorId"];
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
        if(error?.name==="AbortError") throw new VendorSheetError(`Vendor Server Bridge 連線逾時（${Math.round(timeoutMs/1000)} 秒）。`,`BRIDGE_TIMEOUT`);
        throw new VendorSheetError(error?.message||"Vendor Server Bridge 讀取失敗。",error?.code||"BRIDGE_READ_FAILED",error?.status||0);
      }finally{clearTimeout(timer);}
    }
    async bridgeRead(){return this.bridgeRequest({action:"read"});}
    async bridgeUpdate(vendorId,patch){return this.bridgeRequest({action:"update",vendorId,patch});}
    async list(options={}){
      const onProgress=typeof options.onProgress==="function"?options.onProgress:()=>{};
      onProgress({phase:"auth",percent:5,message:"確認 Zhuge AI OS 登入…",loaded:0,total:0});
      onProgress({phase:"read",percent:10,message:"透過 Server Bridge 讀取 Google Sheet…",loaded:0,total:0});
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
      onProgress({phase:"write",percent:55,message:"正在透過 Server Bridge 寫回 Google Sheet…",loaded:0,total:1});
      const data=await this.bridgeUpdate(String(vendorId).trim(),patch);
      const raw=data?.vendor;
      if(!raw||String(raw.vendorId||"").trim()!==String(vendorId).trim()) throw new VendorSheetError("Vendor Server Bridge 寫入回讀無法驗證。","BRIDGE_WRITE_READBACK_INVALID");
      onProgress({phase:"verify",percent:85,message:"正在確認 Google Sheet 寫入結果…",loaded:1,total:1});
      const item={rowNumber:Number(raw.rowNumber)||0};
      KEYS.forEach(key=>item[key]=String(raw[key]??"").trim());
      onProgress({phase:"done",percent:100,message:"已寫回 Google Sheet · 1 / 1 筆",loaded:1,total:1});
      return item;
    }
    async readRow(rowNumber){const data=await this.readRange(`A${rowNumber}:T${rowNumber}`);const row=[...((data?.values||[])[0]||[])];while(row.length<20)row.push("");return row.slice(0,20);}
  }
  global.VendorSheetService={VendorSheetService,VendorSheetError,config:DEFAULTS};
})(window);
