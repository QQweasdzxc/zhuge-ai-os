// The API keeps its existing logical asset schema while Sheets can display seat first.
export const ASSET_HEADER = ['資產編號','名稱','型號','序號','據點','區域','保管人','專案','狀態','品牌','產地','類型','製造年份','PO編號','採購日期','啟用日期','保固到期','來源','建立時間','建立人','最後異動時間','使用部門','舊帳記錄鍵','舊帳出處','舊帳快照','資料補入時間'];
export function detectLayout(header) {
 const same=(a,b)=>a.length===b.length&&a.every((v,i)=>v===b[i]);
 if(same(header,[...ASSET_HEADER,'對應座位編號']))return {offset:0,seat:'AA'};
 if(same(header,['對應座位編號',...ASSET_HEADER]))return {offset:1,seat:'A'};
 throw Error('ASSET_LAYOUT_UNKNOWN');
}
export function logicalRows(values,layout){return values.map(r=>r.slice(layout.offset,layout.offset+26));}
const number=s=>[...s].reduce((n,c)=>n*26+c.charCodeAt(0)-64,0);
const letters=n=>n?letters(Math.floor((n-1)/26))+String.fromCharCode(65+(n-1)%26):'';
export function shiftRange(range,offset){
 const m=/^('?資產'?)!([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(range);
 if(!m)throw Error('ASSET_RANGE_INVALID');
 const start=number(m[2]),end=m[4]?number(m[4]):start;
 if(start+offset<1||end+offset>27)throw Error('ASSET_RANGE_INVALID');
 return m[1]+'!'+letters(start+offset)+m[3]+(m[4]?':'+letters(end+offset)+m[5]:'');
}
export function mapBatch(batch,assetSheetId,layout){
 const result=structuredClone(batch);
 for(const request of result.requests){
  if(request.updateCells?.start?.sheetId===assetSheetId){const s=request.updateCells.start;if(!Number.isInteger(s.columnIndex)||s.columnIndex<0||s.columnIndex>25)throw Error('ASSET_RANGE_INVALID');s.columnIndex+=layout.offset;}
  else if(request.appendCells?.sheetId===assetSheetId){for(const r of request.appendCells.rows){if(r.values.length>26)throw Error('ASSET_RANGE_INVALID');if(layout.offset)r.values.unshift({});}}
  else if(request.updateCells?.range?.sheetId===assetSheetId)throw Error('ASSET_RANGE_UNSUPPORTED');
 }
 return result;
}
