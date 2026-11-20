// Candidate only. No client metadata, asset ID, user ID, session ID or row values in message.
export async function notifyVerifiedSave(supabaseUrl:string,serviceKey:string,transport:typeof fetch=fetch){
 try{if(!supabaseUrl||!serviceKey)return false;
 const response=await transport(supabaseUrl+'/realtime/v1/api/broadcast',{
  method:'POST',headers:{apikey:serviceKey,authorization:'Bearer '+serviceKey,'content-type':'application/json'},
  body:JSON.stringify({messages:[{topic:'zg-erp-ledger-invalidate-v1',event:'invalidate',private:true,payload:{v:1}}]}),
  signal:AbortSignal.timeout(350)
 });return response.ok;
 }catch{return false}
}
