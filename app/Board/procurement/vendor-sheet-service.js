(function initializeVendorSheetService(global){
  "use strict";
  const SHEETS_API="https://sheets.googleapis.com/v4/spreadsheets";
  const DEFAULTS={spreadsheetId:"1RO6idAURJi40wnzH7LBeTzkJpSGQ2yZbfSJ7hMde1jY",sheetName:"廠商名冊-CS集團(CS、CK、UU)",range:"A:T",timeoutMs:15000,chunkSize:25,maxRows:1000};
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
      try{
        response=await this.fetchImpl(`${SHEETS_API}/${this.config.spreadsheetId}${path}`,{
          method:options.method||"GET",signal:controller.signal,
          headers:{Authorization:`Bearer ${accessToken}`,...(options.body?{"Content-Type":"application/json"}:{}),...(options.headers||{})},
          body:options.body?JSON.stringify(options.body):undefined
        });
      }catch(error){
        if(error?.name==="AbortError") throw new VendorSheetError(`Google Sheet 連線逾時（${Math.round(timeoutMs/1000)} 秒），請重新同步。`,"SHEETS_TIMEOUT");
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
    async list(options={}){
      const onProgress=typeof options.onProgress==="function"?options.onProgress:()=>{};
      onProgress({phase:"auth",percent:5,message:"確認 Google 授權…",loaded:0,total:0});
      if(!this.isAuthorized()) throw new VendorSheetError("Google Sheet 尚未授權，請重新使用 Google 登入。","GOOGLE_REAUTHORIZE_REQUIRED");
      onProgress({phase:"count",percent:10,message:"正在確認廠商筆數…",loaded:0,total:0});
      const idData=await this.readRange(`T2:T${this.config.maxRows}`);
      const ids=Array.isArray(idData?.values)?idData.values.map(r=>String(r?.[0]||"").trim()):[];
      let lastIndex=-1; ids.forEach((id,i)=>{if(id)lastIndex=i;});
      const total=lastIndex+1;
      if(!total){onProgress({phase:"done",percent:100,message:"同步完成 · 0 筆",loaded:0,total:0});return [];}
      const rows=[]; const chunk=Math.max(1,Number(this.config.chunkSize)||25);
      for(let offset=0;offset<total;offset+=chunk){
        const start=2+offset,end=Math.min(1+total,start+chunk-1);
        const percent=Math.min(95,15+Math.round((offset/total)*80));
        onProgress({phase:"read",percent,message:`正在讀取 Google Sheet… ${Math.min(offset,total)} / ${total} 筆`,loaded:Math.min(offset,total),total});
        const data=await this.readRange(`A${start}:T${end}`);
        const values=Array.isArray(data?.values)?data.values:[];
        values.forEach((row,i)=>{const item=this.rowToItem(row,start+i);if(item.vendorName||item.vendorId||item.purchaseNo)rows.push(item);});
        const loaded=Math.min(end-1,total);
        onProgress({phase:"read",percent:Math.min(95,15+Math.round((loaded/total)*80)),message:`正在讀取 Google Sheet… ${loaded} / ${total} 筆`,loaded,total});
      }
      onProgress({phase:"render",percent:98,message:`正在更新廠商清單… ${rows.length} / ${total} 筆`,loaded:rows.length,total});
      return rows;
    }
    async update(rowNumber,patch={},options={}){
      const onProgress=typeof options.onProgress==="function"?options.onProgress:()=>{};
      if(!Number.isInteger(Number(rowNumber))||Number(rowNumber)<2) throw new VendorSheetError("無效的廠商資料列。","INVALID_ROW");
      onProgress({phase:"read",percent:15,message:"正在讀取原始資料…",loaded:0,total:1});
      const current=await this.readRow(Number(rowNumber));
      KEYS.forEach((key,i)=>{if(Object.prototype.hasOwnProperty.call(patch,key)) current[i]=String(patch[key]??"");});
      onProgress({phase:"write",percent:55,message:"正在寫回 Google Sheet… 0 / 1 筆",loaded:0,total:1});
      const range=encodeURIComponent(`${q(this.config.sheetName)}!A${rowNumber}:T${rowNumber}`);
      await this.request(`/values/${range}?valueInputOption=USER_ENTERED`,{method:"PUT",body:{range:`${this.config.sheetName}!A${rowNumber}:T${rowNumber}`,majorDimension:"ROWS",values:[current]}});
      onProgress({phase:"verify",percent:85,message:"正在確認寫入結果… 1 / 1 筆",loaded:1,total:1});
      const verified=await this.readRow(Number(rowNumber));
      onProgress({phase:"done",percent:100,message:"已寫回 Google Sheet · 1 / 1 筆",loaded:1,total:1});
      return this.rowToItem(verified,Number(rowNumber));
    }
    async readRow(rowNumber){const data=await this.readRange(`A${rowNumber}:T${rowNumber}`);const row=[...((data?.values||[])[0]||[])];while(row.length<20)row.push("");return row.slice(0,20);}
  }
  global.VendorSheetService={VendorSheetService,VendorSheetError,config:DEFAULTS};
})(window);
