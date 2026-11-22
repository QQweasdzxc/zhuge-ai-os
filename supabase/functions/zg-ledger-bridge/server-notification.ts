import {verifiedObservation} from './live-event-core.mjs';
// Approved private channel only. Canonical saved observation facts, never pending drafts.
export async function notifyVerifiedSave(supabaseUrl:string,serviceKey:string,transport:typeof fetch=fetch,body?:unknown){
 try{if(!supabaseUrl||!serviceKey)return false;
 const observation=verifiedObservation(body);
 const messages:any[]=[{topic:'zg-erp-ledger-invalidate-v1',event:'invalidate',private:true,payload:{v:1}}];
 if(observation){messages.length=0;messages.push({topic:'zg-erp-ledger-invalidate-v1',event:'observation-verified',private:true,payload:observation});}
 const response=await transport(supabaseUrl+'/realtime/v1/api/broadcast',{
  method:'POST',headers:{apikey:serviceKey,authorization:'Bearer '+serviceKey,'content-type':'application/json'},
  body:JSON.stringify({messages}),
  signal:AbortSignal.timeout(350)
 });return response.ok;
 }catch{return false}
}
