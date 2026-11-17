'use strict';
function createDailyHandler({loadSnapshot,verifySession,allowedOrigins=['https://qqweasdzxc.github.io']}={}){
 if(typeof loadSnapshot!=='function'||typeof verifySession!=='function')throw Error('HANDLER_DEPENDENCIES_REQUIRED');
 return async function handler(request){
  const origin=request.headers.get('origin')||'';
  const headers={'content-type':'application/json; charset=utf-8','cache-control':'no-store','x-content-type-options':'nosniff','vary':'Origin'};
  const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
  if(origin&&!allowedOrigins.includes(origin))return response({code:'ORIGIN_NOT_ALLOWED'},403);
  if(origin)Object.assign(headers,{'access-control-allow-origin':origin,'access-control-allow-headers':'authorization,apikey,x-client-info,content-type','access-control-allow-methods':'POST,OPTIONS'});
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(request.method!=='POST')return response({code:'POST_REQUIRED'},405);
  let session;try{session=await verifySession(request);}catch{return response({code:'AUTH_REQUIRED'},401);}
  if(!session?.userId)return response({code:'AUTH_REQUIRED'},401);
  if(session.aal!=='aal2')return response({code:'AAL2_REQUIRED'},403);
  const declared=Number(request.headers.get('content-length')||0);if(declared>1024)return response({code:'INVALID_REQUEST'},400);
  let input;try{const text=await request.text();if(text.length>1024)throw Error();input=JSON.parse(text);}catch{return response({code:'INVALID_REQUEST'},400);}
  if(!input||Array.isArray(input)||input.mode!=='official_daily_close'||Object.keys(input).length!==1)return response({code:'INVALID_REQUEST'},400);
  try{return response(await loadSnapshot());}catch{return response({code:'OFFICIAL_DAILY_SOURCE_UNAVAILABLE',readOnly:true},503);}
 };
}
module.exports={createDailyHandler};
