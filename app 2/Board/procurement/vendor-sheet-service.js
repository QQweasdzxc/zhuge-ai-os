(function initializeVendorSheetService(global){
  "use strict";
  const SHEETS_API="https://sheets.googleapis.com/v4/spreadsheets";
  const DEFAULTS={
    spreadsheetId:"1RO6idAURJi40wnzH7LBeTzkJpSGQ2yZbfSJ7hMde1jY",
    sheetName:"廠商名冊-CS集團(CS、CK、UU)",
    range:"A:T"
  };
  const HEADERS=["實際下單\n(年/月)","公司","採購單編號","廠商","統編","聯繫人Mail","對廠商付款方式","產品","廉潔承諾書-簽回時間","廉潔承諾書-正本是否取得","企業社會責任自評表","企責-正本是否取得","電話","聯繫窗口","手機","Mail","專案","是否簽約","是否投保","廠商ID"];
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
      const response=await this.fetchImpl(`${SHEETS_API}/${this.config.spreadsheetId}${path}`,{
        method:options.method||"GET",headers:{Authorization:`Bearer ${accessToken}`,...(options.body?{"Content-Type":"application/json"}:{}),...(options.headers||{})},body:options.body?JSON.stringify(options.body):undefined
      });
      if(!response.ok){
        const details=await response.text().catch(()=>"");
        if(response.status===401||response.status===403) throw new VendorSheetError("Google Sheet 權限不足或授權已失效，請重新 Google 登入授權。","GOOGLE_REAUTHORIZE_REQUIRED",response.status);
        throw new VendorSheetError(`Google Sheet 同步失敗（HTTP ${response.status}）${details?`：${details.slice(0,180)}`:""}`,"SHEETS_API_ERROR",response.status);
      }
      return response.status===204?null:response.json();
    }
    async list(){
      const range=encodeURIComponent(`${q(this.config.sheetName)}!${this.config.range}`);
      const data=await this.request(`/values/${range}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`);
      const rows=Array.isArray(data?.values)?data.values:[];
      const header=rows[0]||[];
      const headerMap=new Map(header.map((v,i)=>[String(v).trim(),i]));
      return rows.slice(1).map((row,index)=>{
        const item={rowNumber:index+2};
        KEYS.forEach((key,i)=>{const headerIndex=headerMap.has(HEADERS[i].trim())?headerMap.get(HEADERS[i].trim()):i;item[key]=String(row[headerIndex]??"").trim();});
        return item;
      }).filter(v=>v.vendorName||v.vendorId||v.purchaseNo);
    }
    async update(rowNumber,patch={}){
      if(!Number.isInteger(Number(rowNumber))||Number(rowNumber)<2) throw new VendorSheetError("無效的廠商資料列。","INVALID_ROW");
      const current=await this.readRow(Number(rowNumber));
      KEYS.forEach((key,i)=>{if(Object.prototype.hasOwnProperty.call(patch,key)) current[i]=String(patch[key]??"");});
      const range=encodeURIComponent(`${q(this.config.sheetName)}!A${rowNumber}:T${rowNumber}`);
      await this.request(`/values/${range}?valueInputOption=USER_ENTERED`,{method:"PUT",body:{range:`${this.config.sheetName}!A${rowNumber}:T${rowNumber}`,majorDimension:"ROWS",values:[current]}});
      return this.list();
    }
    async readRow(rowNumber){
      const range=encodeURIComponent(`${q(this.config.sheetName)}!A${rowNumber}:T${rowNumber}`);
      const data=await this.request(`/values/${range}?majorDimension=ROWS&valueRenderOption=FORMATTED_VALUE`);
      const row=[...((data?.values||[])[0]||[])];while(row.length<20)row.push("");return row.slice(0,20);
    }
  }
  global.VendorSheetService={VendorSheetService,VendorSheetError,config:DEFAULTS};
})(window);
