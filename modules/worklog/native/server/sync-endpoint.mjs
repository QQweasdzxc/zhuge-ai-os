// HTTP boundary. connect uses the independently minted Calendar-consent session.
// Internal scheduler has a separate bearer; CORS is a fixed deployment allowlist.
export function createSyncEndpoint({enabled=false,origins=[],schedulerSecret,verifyCaller,verifyRefreshSession,verifyGoogle,connect,status,disconnect,runOwner,runBatch}){
 const headers=origin=>({'Content-Type':'application/json','Cache-Control':'no-store',...(origins.includes(origin)?{'Access-Control-Allow-Origin':origin,'Vary':'Origin','Access-Control-Allow-Headers':'authorization,apikey,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'}:{})});
 return async request=>{const origin=request.headers.get('Origin')||'',json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:headers(origin)});if(origin&&!origins.includes(origin))return json({code:'ORIGIN_FORBIDDEN'},403);if(request.method==='OPTIONS')return new Response(null,{status:204,headers:headers(origin)});if(request.method!=='POST')return json({code:'METHOD_NOT_ALLOWED'},405);if(!enabled)return json({code:'NOT_ENABLED'},503);
  try{const length=Number(request.headers.get('content-length')||0);if(length>32768)return json({code:'PAYLOAD_TOO_LARGE'},413);const text=await request.text();if(text.length>32768)return json({code:'PAYLOAD_TOO_LARGE'},413);const body=JSON.parse(text),bearer=request.headers.get('Authorization')||'';
   if(body.action==='scheduled-run'){if(origin||!schedulerSecret||bearer!=='Bearer '+schedulerSecret)return json({code:'FORBIDDEN'},403);return json(await runBatch());}
   const caller=await verifyCaller(bearer);if(!caller?.id)return json({code:'AUTH_REQUIRED'},401);
   if(body.action==='status')return json(await status(caller.id));
   if(body.action==='disconnect'){await disconnect(caller.id);return json({status:'disconnected',owner:caller.id});}
   if(body.action==='run')return json(await runOwner(caller.id));
   if(body.action!=='connect')return json({code:'ACTION_UNSUPPORTED'},400);
   if(!body.session?.access_token||bearer!=='Bearer '+body.session.access_token||body.session.user?.id!==caller.id||!body.session.refresh_token||!body.googleAccessToken||!body.googleRefreshToken)return json({code:'CONNECTION_INCOMPLETE'},400);
   // Refresh once before accepting to prove this separate session is usable.
   const session=await verifyRefreshSession(caller.id,body.session);const google=await verifyGoogle(caller.id,body.googleAccessToken,body.googleRefreshToken);
   const result=await connect({owner:caller.id,session,googleRefreshToken:google.refreshToken,calendar:google.calendar});return json({status:'connected',owner:caller.id,calendarName:result.calendarName});
  }catch(error){const code=['AUTH_REQUIRED','OWNER_MISMATCH','RECONNECT','ACCESS_REQUIRED','CALENDAR_FORBIDDEN','CONNECTION_BUSY'].includes(error?.code)?error.code:'SYNC_FAILED';return json({code,message:'工時日曆連線或同步未完成，原資料保留。'},code==='AUTH_REQUIRED'?401:409);}
 };
}
