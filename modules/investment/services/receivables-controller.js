(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.InvestmentReceivablesController=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
function create({repository,onChange=()=>{},newKey=()=>globalThis.crypto.randomUUID()}={}){
 let state={status:'idle',items:[],error:'',notice:'',busy:false,form:{},formOpen:false},key='',fingerprint='';
 const emit=patch=>{state={...state,...patch};onChange(state);return state;};
 async function load(){try{const items=await repository.loadReceivables();emit({status:'ready',items,error:''});return items;}catch(e){emit({status:'error',error:e.message||'應收款讀取失敗'});return null;}}
 function capture(form,open=true){state={...state,form:{...form},formOpen:open};}
 async function createRecord(form){if(state.busy)return false;capture(form);const current=JSON.stringify(form);if(current!==fingerprint||!key){fingerprint=current;key=newKey();}emit({busy:true,error:'',notice:''});
  try{const row=await repository.createReceivable({...form,idempotencyKey:key});if(!row?.receivable_id)throw Error('應收款回傳格式無法驗證');key='';fingerprint='';emit({busy:false,form:{},formOpen:false,notice:'登記成功',error:''});const items=await load();if(!items)emit({notice:'登記成功，但清單讀回失敗，請重新讀取；不要重複登記。'});return true;}
  catch(e){emit({busy:false,error:e.message||'登記失敗，輸入已保留'});return false;}}
 async function setStatus(id,next){if(state.busy)return false;emit({busy:true,error:'',notice:''});try{const row=await repository.updateReceivableStatus(id,next);if(row?.receivable_id!==id||row.status!==next)throw Error('應收款狀態回傳無法驗證');emit({items:state.items.map(x=>x.id===id?{...x,status:next}:x),busy:false,notice:'狀態已更新'});await load();return true;}catch(e){emit({busy:false,error:e.message||'狀態更新失敗'});return false;}}
 return Object.freeze({getState:()=>state,load,capture,createRecord,setStatus});
}
return Object.freeze({create});});
