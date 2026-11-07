// Chengyu Quest — family-only cloud scores; token arrives in request body, never in source.
const BASE = Deno.env.get("SUPABASE_URL") || "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ORIGIN = "https://chengyu-quest-family.onrender.com";
const cors = {"Access-Control-Allow-Origin":ORIGIN,"Access-Control-Allow-Methods":"POST,OPTIONS","Access-Control-Allow-Headers":"content-type,apikey,authorization","Cache-Control":"no-store","Vary":"Origin"};
const headers = {"apikey":SERVICE,"Authorization":"Bearer "+SERVICE,"Content-Type":"application/json"};
const validUuid = (s) => typeof s==="string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
function reply(value,status=200){return new Response(JSON.stringify(value),{status,headers:{...cors,"Content-Type":"application/json"}})}
function fail(message,status=400){return reply({ok:false,error:message},status)}
function clean(value,max){return typeof value==="string" ? value.trim().slice(0,max):""}
async function rest(table,qs="",method="GET",body=null){
 const url=BASE+"/rest/v1/"+table+(qs?"?"+qs:"");
 const resp=await fetch(url,{method,headers:{...headers,...(method==="POST"?{"Prefer":"return=representation"}:{})},body:body===null?undefined:JSON.stringify(body)});
 const data=await resp.json().catch(()=>null);
 if(!resp.ok){console.error("chengyu cloud database",table,resp.status);throw new Error("database operation failed")}
 return data;
}
async function sha256(value){
 const bytes=new TextEncoder().encode(value);
 const digest=await crypto.subtle.digest("SHA-256",bytes);
 return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST")return fail("僅支援 POST",405);
 const origin=req.headers.get("Origin");
 if(origin && origin!==ORIGIN)return fail("不允許的網站來源",403);
 if(!BASE||!SERVICE)return fail("雲端服務尚未設定",503);
 let data;
 try{data=await req.json()}catch{return fail("資料格式不正確")}
 const token=typeof data?.token==="string"?data.token:"";
 if(!/^[A-Za-z0-9_-]{40,128}$/.test(token))return fail("請使用家庭專用連結",403);
 try {
  const hash=await sha256(token);
  const family=await rest("chengyu_family_spaces","secret_hash=eq."+hash+"&select=id&limit=1");
  if(!Array.isArray(family)||!family.length)return fail("家庭專用連結無效",403);
  const familyId=family[0].id, f="eq."+familyId, action=data.action;
  if(action==="load"){
   const [learners,attempts]=await Promise.all([
    rest("chengyu_family_learners","family_id="+f+"&select=id,name,created_at&order=created_at.asc&limit=40"),
    rest("chengyu_family_attempts","family_id="+f+"&select=id,learner_id,level,mode,planned_count,question_count,correct_count,result_status,answers,created_at&order=created_at.desc&limit=300")
   ]);
   return reply({ok:true,learners,attempts});
  }
  if(action==="addLearner"){
   const name=clean(data.name,24);
   if(!name||name.length>24)return fail("請輸入測驗者名字");
   const existing=await rest("chengyu_family_learners","family_id="+f+"&name=eq."+encodeURIComponent(name)+"&select=id,name&limit=1");
   if(existing.length)return reply({ok:true,learner:existing[0]});
   const all=await rest("chengyu_family_learners","family_id="+f+"&select=id&limit=41");
   if(all.length>=40)return fail("測驗者已達上限");
   const added=await rest("chengyu_family_learners","","POST",{family_id:familyId,name});
   return reply({ok:true,learner:{id:added[0].id,name:added[0].name}});
  }
  if(action==="saveAttempt"){
   const learnerId=data.learnerId, runId=data.clientRunId;
   if(!validUuid(learnerId)||!validUuid(runId))return fail("測驗紀錄識別碼不正確");
   const learner=await rest("chengyu_family_learners","family_id="+f+"&id=eq."+learnerId+"&select=id&limit=1");
   if(!learner.length)return fail("找不到此測驗者",403);
   const level=clean(data.level,10),mode=clean(data.mode,20);
   if(!["國小","國中","進階","全部"].includes(level)||!["meaning","context","reverse","mixed"].includes(mode))return fail("題目設定不正確");
   const answers=Array.isArray(data.answers)?data.answers:[];
   const planned=Number(data.plannedCount),status=data.resultStatus;
   if(!answers.length||answers.length>95||!Number.isInteger(planned)||planned<answers.length||planned>95)return fail("題目數量不正確");
   if(!["completed","game_over"].includes(status))return fail("闖關結果不正確");
   for(const a of answers){
    if(!a||typeof a.word!=="string"||a.word.length>24||!["meaning","context","reverse"].includes(a.kind)||typeof a.correct!=="boolean"||typeof a.selected!=="string"||a.selected.length>350||typeof a.expected!=="string"||a.expected.length>350)return fail("答題紀錄格式不正確");
   }
   const correct=answers.filter(a=>a.correct).length;
   if(status==="completed"&&answers.length!==planned)return fail("尚未完成全部題目");
   if(status==="game_over"&&answers.length-correct<3)return fail("尚未達到 Game Over 條件");
   const previous=await rest("chengyu_family_attempts","family_id="+f+"&client_run_id=eq."+runId+"&select=id,created_at&limit=1");
   if(previous.length)return reply({ok:true,attempt:previous[0],duplicate:true});
   const rows=await rest("chengyu_family_attempts","","POST",{
    family_id:familyId,learner_id:learnerId,client_run_id:runId,level,mode,
    planned_count:planned,question_count:answers.length,correct_count:correct,result_status:status,
    answers:answers.map(a=>({word:a.word,kind:a.kind,correct:a.correct,selected:a.selected,expected:a.expected}))
   });
   return reply({ok:true,attempt:{id:rows[0].id,created_at:rows[0].created_at,correct_count:correct,question_count:answers.length}});
  }
  return fail("不支援的操作");
 } catch(error){console.error("chengyu operation",String(error?.message||error));return fail("雲端操作未完成，請稍後再試",503)}
});