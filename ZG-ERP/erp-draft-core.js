/* ZG-ERP 本機草稿保留層（純函式，儲存體可注入）。草稿不會因時間自動刪除；只有明確取消、或正式存入並讀回確認後才刪。
 * 草稿 = 輸入中、尚未存入正式資料的內容，只存在這台裝置的瀏覽器。
 * 「草稿已保留」不等於「已儲存」；只有正式寫入並讀回確認才是「已儲存」。
 * 鍵含帳號：換帳號讀不到別人的草稿；沒有帳號識別就不保存（寧可不存也不混用）。 */
(function(root){'use strict';
const PREFIX='zg_erp_draft_v1';
function enc(s){return encodeURIComponent(String(s==null?'':s));}
function keyOf(account,kind,entity){return PREFIX+'|'+enc(account)+'|'+enc(kind)+'|'+enc(entity);}
function create(storage,opts){
  const now=(opts&&opts.now)||(()=>Date.now());
  const ok=()=>!!storage;
  function put(account,kind,entity,payload){
    if(!ok()||!account||!kind||!entity)return {saved:false,reason:'no-account'};
    try{storage.setItem(keyOf(account,kind,entity),JSON.stringify({v:1,account:String(account),kind,entity:String(entity),savedAt:now(),payload}));return {saved:true};}
    catch(e){return {saved:false,reason:'storage-failed'};}
  }
  function get(account,kind,entity){
    if(!ok()||!account)return null;
    let raw;try{raw=storage.getItem(keyOf(account,kind,entity));}catch(e){return null;}
    if(!raw)return null;
    try{const r=JSON.parse(raw);if(!r||r.v!==1||r.account!==String(account)||r.kind!==kind||String(r.entity)!==String(entity))return null;return r;}catch(e){return null;}
  }
  function discard(account,kind,entity){if(!ok()||!account)return;try{storage.removeItem(keyOf(account,kind,entity));}catch(e){}}
  function list(account,kind){
    const out=[];if(!ok()||!account)return out;
    const pre=PREFIX+'|'+enc(account)+'|'+(kind?enc(kind)+'|':'');
    let n=0;try{n=storage.length;}catch(e){return out;}
    for(let i=0;i<n;i++){let k;try{k=storage.key(i);}catch(e){continue;}if(!k||k.indexOf(pre)!==0)continue;const parts=k.split('|');const r=get(account,decodeURIComponent(parts[2]),decodeURIComponent(parts[3]));if(r)out.push(r);}
    return out;
  }
  /* 這台裝置上其他帳號的草稿：不能讀，只能知道有幾筆，並可明確刪除 */
  function foreign(account){
    const out=[];if(!ok())return out;const mine=PREFIX+'|'+enc(account||'')+'|';let n=0;try{n=storage.length;}catch(e){return out;}
    for(let i=0;i<n;i++){let k;try{k=storage.key(i);}catch(e){continue;}if(k&&k.indexOf(PREFIX+'|')===0&&k.indexOf(mine)!==0)out.push(k);}
    return out;
  }
  function removeKeys(keys){for(const k of keys){try{storage.removeItem(k);}catch(e){}}}
  return Object.freeze({put,get,discard,list,foreign,removeKeys});
}
/* 還原決定：存檔時的基準值 vs 現在讀到的最新值。
 * 沒人動過 → 直接還原；有人動過但不衝突 → 合併還原；衝突 → 不還原，列出欄位，草稿保留。 */
function restorePlan(stored,fresh,rebase){
  if(!stored||!stored.payload||!stored.payload.values||!stored.payload.base)return {mode:'none'};
  const draft=stored.payload.values,base=stored.payload.base;
  const changed=Object.keys(draft).filter(k=>String(draft[k]??'')!==String(base[k]??''));
  if(!changed.length)return {mode:'none'};
  const m=rebase(base,draft,fresh);
  if(m.conflicts.length)return {mode:'conflict',conflicts:m.conflicts,changed};
  const moved=Object.keys(base).some(k=>String(base[k]??'')!==String(fresh[k]??''));
  return {mode:moved?'merged':'restored',values:m.values,base:m.base,changed};
}
function statusText(kind){return kind==='saved'?'已儲存到正式資料':kind==='draft'?'草稿已保留在這台裝置（尚未存入正式資料）':kind==='failed'?'草稿保留失敗，請先不要關閉頁面':'';}
function accountOf(session){const u=session&&(session.user||session);const id=u&&(u.email||u.id||u.sub||u.uid);return id?String(id).toLowerCase():'';}
const FIELD_LABELS=Object.freeze({name:'名稱',model:'型號',department:'使用部門',owner:'保管人',zone:'區域',status:'設備狀態',project:'歸屬專案',serial:'設備序號',purchase:'購入日期',activate:'啟用日期',warranty:'保固到期',brand:'品牌',origin:'產地',mfgYear:'製造年份',type:'產品類型',po:'PO 編號'});
function fieldLabels(keys){return (keys||[]).map(k=>FIELD_LABELS[k]||'其他欄位');}
const api=Object.freeze({fieldLabels,FIELD_LABELS,create,restorePlan,statusText,accountOf,keyOf});
root.ErpDraftCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
