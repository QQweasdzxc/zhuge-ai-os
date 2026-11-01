// Family Vocabulary Quest — private capability-token API; no login screen.
// Only the bearer family link token grants access. Never commit that token or service key.
const BASE = Deno.env.get("SUPABASE_URL") || "";
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ORIGIN = "https://vocab-quest-family.onrender.com";
const hdr = { "apikey": SERVICE, "Authorization": "Bearer " + SERVICE, "Content-Type": "application/json" };
const cors = { "Access-Control-Allow-Origin": ORIGIN, "Access-Control-Allow-Methods": "POST,OPTIONS", "Access-Control-Allow-Headers": "content-type,apikey,authorization", "Cache-Control": "no-store", "Vary": "Origin" };
function respond(payload, status=200){return new Response(JSON.stringify(payload),{status,headers:{...cors,"Content-Type":"application/json"}})}
function failure(error, status=400){return respond({ok:false,error},status)}
function must(value, label){if(!value)throw new Error(label)}
async function rest(table, query="", method="GET", body=null){
 const url = BASE + "/rest/v1/" + table + (query?"?"+query:"");
 const res = await fetch(url,{method,headers:{...hdr,...((method==="POST"||method==="PATCH")?{"Prefer":"return=representation"}:{})},body:body===null?undefined:JSON.stringify(body)});
 const json = await res.json().catch(()=>null);
 if(!res.ok){console.error("vocab REST failed",table,res.status);throw new Error("雲端資料庫操作失敗")}
 return json;
}
async function tokenHash(token){const bytes=new TextEncoder().encode(token);const digest=await crypto.subtle.digest("SHA-256",bytes);return [...new Uint8Array(digest)].map(x=>x.toString(16).padStart(2,"0")).join("")}
function text(s,max){return typeof s==="string"?s.trim().slice(0,max):""}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:cors});
 if(req.method!=="POST")return failure("僅支援 POST",405);
 const origin=req.headers.get("Origin");
 if(origin&&origin!==ORIGIN)return failure("不允許的網站來源",403);
 if(!BASE||!SERVICE)return failure("雲端服務設定缺失",503);
 let data;
 try{data=await req.json()}catch{return failure("資料格式錯誤")}
 const token=data&&typeof data.token==="string"?data.token:"";
 if(!/^[a-zA-Z0-9_-]{35,128}$/.test(token))return failure("請使用家庭專用連結",403);
 try{
  const hash=await tokenHash(token);
  const family=await rest("vocab_family_spaces","secret_hash=eq."+hash+"&select=id&limit=1");
  if(!family.length)return failure("家庭連結無效",403);
  const familyId=family[0].id;
  const f=encodeURIComponent("eq."+familyId);
  const action=data.action;
  if(action==="load"){
   const [learners,units,attempts]=await Promise.all([
    rest("vocab_family_learners","family_id="+f+"&select=id,name,created_at&order=created_at.asc&limit=100"),
    rest("vocab_family_units","family_id="+f+"&select=id,category,week,title,words,sort_order&order=sort_order.asc,created_at.asc&limit=150"),
    rest("vocab_family_attempts","family_id="+f+"&select=id,learner_id,unit_id,scope_name,mode,question_count,correct_count,answers,result_status,target_count,created_at&order=created_at.desc&limit=200")
   ]);
   return respond({ok:true,learners,units,attempts})
  }
  if(action==="addLearner"){
   const name=text(data.name,24);
   if(!name||name.length>24)return failure("請填寫測驗者暱稱");
   const found=await rest("vocab_family_learners","family_id="+f+"&name=eq."+encodeURIComponent(name)+"&select=id,name&limit=1");
   if(found.length)return respond({ok:true,learner:found[0]});
   const added=await rest("vocab_family_learners","","POST",{family_id:familyId,name});
   return respond({ok:true,learner:added[0]})
  }
  if(action==="saveAttempt"){
   const learnerId=text(data.learnerId,40);
   if(!/^[0-9a-f-]{36}$/.test(learnerId))return failure("測驗者資料不正確");
   const who=await rest("vocab_family_learners","family_id="+f+"&id=eq."+learnerId+"&select=id&limit=1");
   if(!who.length)return failure("找不到測驗者",403);
   const allowed=["meaning","spelling","sentence","all"];
   const mode=text(data.mode,20);
   if(!allowed.includes(mode))return failure("關卡不正確");
   const answers=Array.isArray(data.answers)?data.answers:[];
   if(!answers.length||answers.length>1500)return failure("作答數量不正確");
   for(const a of answers){if(!a||typeof a.word!=="string"||a.word.length>80||typeof a.correct!=="boolean"||![0,1,2].includes(a.stage))return failure("作答內容不正確")}
   const count=answers.filter(x=>x.correct).length;
   const status=data.resultStatus==="game_over"?"game_over":"completed";
   const targetCount=data.targetCount===undefined?answers.length:Number(data.targetCount);
   if(!Number.isInteger(targetCount)||targetCount<answers.length||targetCount>1500)return failure("預定題數不正確");
   if(status==="completed"&&targetCount!==answers.length)return failure("完成測驗的作答題數不足");
   if(status==="game_over"&&answers.length-count<3)return failure("需累積三個錯誤才能 Game Over");
   const scope=text(data.scopeName,200);
   if(!scope)return failure("缺少測驗範圍");
   const unitId=typeof data.unitId==="string"?data.unitId:null;
   if(unitId){
    const found=await rest("vocab_family_units","family_id="+f+"&id=eq."+encodeURIComponent(unitId)+"&select=id&limit=1");
    if(!found.length)return failure("指定單元不屬於這個家庭",403)
   }
   const added=await rest("vocab_family_attempts","","POST",{family_id:familyId,learner_id:learnerId,unit_id:unitId||null,scope_name:scope,mode,question_count:answers.length,correct_count:count,answers,result_status:status,target_count:targetCount});
   return respond({ok:true,attempt:{id:added[0].id,created_at:added[0].created_at,correct_count:count,question_count:answers.length,result_status:status,target_count:targetCount}})
  }
  if(action==="updateUnit"){
   const unitId=text(data.unitId,36),category=text(data.category,100);
   const week=text(data.week,30),title=text(data.title,120);
   if(!/^[0-9a-f-]{36}$/.test(unitId)||!category||!week||!title)return failure("請填入正確的單元與週次");
   const owned=await rest("vocab_family_units",
      "id=eq."+encodeURIComponent(unitId)+"&family_id="+f+"&select=id,category,week,title",
      "PATCH",{category,week,title});
   if(!Array.isArray(owned)||!owned.length)return failure("找不到可以編輯的家庭單元",404);
   return respond({ok:true,unit:owned[0]})
  }
  if(action==="addUnit"){
   const category=text(data.category,100),week=text(data.week,30),title=text(data.title,120);
   const ws=Array.isArray(data.words)?data.words:[];
   if(!category||!title||ws.length<1||ws.length>500)return failure("請填教材、週次與單字");
   const cleaned=[];
   for(const w of ws){
    const en=text(w.en,80).toLowerCase(),zh=text(w.zh,300),sentence=text(w.sentence,500);
    if(!/^[a-z][a-z'-]*$/.test(en)||!zh||!sentence.includes("____"))return failure("單字格式不完整，例句必須含 ____");
    cleaned.push({en,zh,sentence,tip:text(w.tip,500),ipa:text(w.ipa,160)})
   }
   const added=await rest("vocab_family_units","","POST",{family_id:familyId,category,week,title,words:cleaned,sort_order:0});
   return respond({ok:true,unit:{id:added[0].id,category,week,title,words:cleaned}})
  }
  return failure("不支援的操作")
 }catch(err){console.error("vocab cloud operation",String(err&&err.message));return failure("雲端操作未完成，請稍後再試",503)}
});
