(function(root){'use strict';
function rebase(base,draft,fresh){const conflicts=[],values={};for(const k of Object.keys(draft)){const old=String(base[k]??''),typed=String(draft[k]??''),live=String(fresh[k]??'');if(typed!==old&&live!==old&&live!==typed)conflicts.push(k);values[k]=typed!==old?typed:live;}return{conflicts,values,base:Object.fromEntries(Object.keys(base).map(k=>[k,String(fresh[k]??'')]))};}
/* 同座位連動：只連動 保管人/使用部門（owner/department）。專案、座位使用人、其他欄位一律不連動。
   座位使用人不等於設備保管人；連動的來源永遠是本次編輯草稿，不是座位使用人。 */
const CASCADE_FIELDS=Object.freeze(['owner','department']);
/* changed: {owner?, department?} 僅本次實際改變的欄位。bindings: {code:{version,seat}}。
   回傳 {fields, seat:{version,seat}|null, peers:[{code,patch,expected}]}；peers 只含值會真正改變的同座位設備。 */
function planSeatCascade(opts){
  const bindings=(opts&&opts.bindings)||{},assets=(opts&&opts.assets)||[],code=opts&&opts.code,changed=(opts&&opts.changed)||{};
  const fields=CASCADE_FIELDS.filter(f=>changed[f]!==undefined);
  const empty={fields,seat:null,peers:[]};
  if(!code||!fields.length)return empty;
  const b=bindings[code];
  if(!b)return empty;
  const peers=[];
  for(const a of assets){
    if(!a||!a.code||a.code===code)continue;
    const pb=bindings[a.code];
    if(!pb||pb.version!==b.version||pb.seat!==b.seat)continue;
    const patch={},expected={};
    for(const f of fields){const next=String(changed[f]??''),cur=String(a[f]??'');if(cur!==next){patch[f]=next;expected[f]=cur;}}
    if(Object.keys(patch).length)peers.push({code:a.code,patch,expected});
  }
  peers.sort((x,y)=>x.code.localeCompare(y.code));
  return {fields,seat:{version:b.version,seat:b.seat},peers};
}
/* 全有或全無執行：先預讀＋保留全部同座位設備（任一失敗→不寫任何一筆），
   再依序寫入；任一寫入失敗→把已寫入的（含主設備）補償回復到預讀值，並如實回報每一步。
   store 需提供 reserveAssetEdit/releaseAssetEdit/readAssetForEdit/saveAssetVerified(code,draft,base,opId)。
   opId 讓整批寫入共用同一個 operationId 以便追查。 */
async function runSeatCascade(store,code,draft,base,plan,opId){
  const peers=(plan&&plan.peers)||[];
  if(!peers.length){await store.saveAssetVerified(code,draft,base,opId);return{saved:[code],cascaded:[]};}
  const preflight=[];
  for(const p of peers){
    const fresh=await store.readAssetForEdit(p.code);
    const drift=Object.keys(p.expected).filter(f=>String(fresh[f]??'')!==p.expected[f]);
    if(drift.length){throw new Error('同座位設備 '+p.code+' 的欄位已被改動（'+drift.join('、')+'），未寫入任何資料；請重新整理核對後再儲存。');}
    preflight.push({code:p.code,fresh,patch:p.patch});
  }
  const reserved=[];
  try{for(const p of peers){await store.reserveAssetEdit(p.code);reserved.push(p.code);}}
  catch(e){for(const c of reserved){try{await store.releaseAssetEdit(c);}catch(_){}}throw new Error('同座位設備無法取得編輯權（'+e.message+'），未寫入任何資料；請稍後重試。');}
  const written=[];
  const revertOne=async(w)=>{
    try{await store.releaseAssetEdit(w.code);}catch(_){}
    await store.reserveAssetEdit(w.code);
    await store.saveAssetVerified(w.code,w.revertDraft,w.revertBase,opId);
  };
  try{
    const afterPrimary={...base};for(const k of Object.keys(draft))afterPrimary[k]=['未指定（待確認）','未指定(待確認)','未指定'].includes(draft[k])?'':draft[k];
    await store.saveAssetVerified(code,draft,base,opId);
    written.push({code,revertDraft:{...base},revertBase:afterPrimary});
    for(const p of preflight){
      const peerDraft={...p.fresh,...p.patch};
      await store.saveAssetVerified(p.code,peerDraft,p.fresh,opId);
      written.push({code:p.code,revertDraft:{...p.fresh},revertBase:{...p.fresh,...p.patch}});
    }
  }catch(e){
    const rolled=[],failed=[];
    for(const w of written){try{await revertOne(w);rolled.push(w.code);}catch(re){failed.push(w.code+'（'+(re&&re.message||re)+'）');}}
    for(const c of reserved){if(!written.some(w=>w.code===c)){try{await store.releaseAssetEdit(c);}catch(_){}}}
    let msg='同座位連動寫入失敗（'+(e&&e.message||e)+'）。';
    if(failed.length)msg+='警告：以下設備未能回復，請立即人工核對：'+failed.join('、')+'。';
    else if(rolled.length)msg+='已回復本次全部寫入（'+rolled.join('、')+'），同座位資料維持原狀。';
    throw new Error(msg);
  }
  return{saved:[code,...preflight.map(p=>p.code)],cascaded:preflight.map(p=>p.code)};
}
const api=Object.freeze({rebase,planSeatCascade,runSeatCascade,CASCADE_FIELDS});root.ErpEditCore=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
