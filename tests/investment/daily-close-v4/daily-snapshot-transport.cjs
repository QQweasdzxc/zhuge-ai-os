'use strict';
const {verifiedCalendar,validateVenue,SOURCES}=require('./source-policy.cjs');
const manifest=require('./calendar-manifest-2026.json');
const CALENDAR_URLS=Object.freeze({TWSE:manifest.TWSE.sourceUrl,TPEX:manifest.TPEX.sourceUrl});
const MAX_BODY_BYTES=12*1024*1024;
// Internal marker: a request aborted because a sibling source already failed.
// Identity-compared; never emitted as a diagnostic and never retried.
const SIBLING_ABORT=Error('OFFICIAL_SOURCE_SIBLING_ABORT');
function createDailySnapshotLoader({fetchImpl=globalThis.fetch,clock=Date.now,ttlMs=300000,timeoutMs=12000,stallMs=10000,snapshotTimeoutMs=60000,retryBudgetMs=15000,onDiagnostic=null}={}){
 let saved=null,inFlight=null;
 function emit(source,stage,code,{status,started}={}){
  try{if(typeof onDiagnostic!=='function')return;
  const event={event:'official_daily_source_failure',source,stage,code};
  if(Number.isInteger(status)&&status>=100&&status<=599)event.status=status;
  if(Number.isFinite(started)){const ms=clock()-started;if(Number.isFinite(ms)&&ms>=0)event.durationMs=Math.min(Math.floor(ms),3600000);}
  onDiagnostic(Object.freeze(event));}catch{} // Observability must never change read behavior.
 }
 function diagnostic(source,stage,error,{status,started}={}){
  const known=new Set(['OFFICIAL_SOURCE_HTTP','OFFICIAL_SOURCE_TOO_LARGE','OFFICIAL_SOURCE_INVALID_JSON','CALENDAR_PROVENANCE_REQUIRED','CALENDAR_YEAR_OR_TOTAL','CALENDAR_VENUE_REQUIRED','CALENDAR_CONTENT_CHANGED']);
  const code=known.has(error?.message)?error.message
   :error?.message==='OFFICIAL_SOURCE_STALLED'?'SOURCE_STALLED'
   :error?.message==='OFFICIAL_SOURCE_HEADER_TIMEOUT'||error?.message==='OFFICIAL_SOURCE_DEADLINE'?'SOURCE_TIMEOUT'
   :error?.name==='TimeoutError'?'SOURCE_TIMEOUT':error?.name==='AbortError'?'SOURCE_ABORTED':'SOURCE_FAILURE';
  emit(source,stage,code,{status,started});
 }
 // Behavior change: the body stage is bounded by progress, not by the old fixed
 // 12s whole-request clock. A slow official transfer that keeps delivering
 // bytes may now take up to the overall snapshot deadline (default 60s)
 // instead of being cut at 12s. A genuinely stuck connection is aborted after
 // stallMs without a byte. The hard deadline caps every stage of every
 // attempt, and abort always terminates the underlying read.
 async function readBody(response,ctl,deadline){
  const aborted=new Promise((_,reject)=>{if(ctl.signal.aborted)reject(ctl.signal.reason);else ctl.signal.addEventListener('abort',()=>reject(ctl.signal.reason instanceof Error?ctl.signal.reason:new Error('ABORTED')),{once:true})});
  const abortWith=message=>{try{ctl.abort(new Error(message));}catch{}};
  // Fallback for responses without a byte stream: no stall signal exists, but
  // the hard deadline and abort still bound the wait and flip the signal.
  if(!response.body||typeof response.body.getReader!=='function'){
   const hardTimer=setTimeout(()=>abortWith('OFFICIAL_SOURCE_DEADLINE'),Math.max(1,deadline-clock()));
   try{return await Promise.race([response.text(),aborted]);}
   catch(error){throw ctl.signal.aborted&&ctl.signal.reason instanceof Error?ctl.signal.reason:error;}
   finally{clearTimeout(hardTimer);}
  }
  const reader=response.body.getReader();
  const decoder=new TextDecoder();
  let size=0,out='',stallTimer,hardTimer;
  const arm=()=>{clearTimeout(stallTimer);stallTimer=setTimeout(()=>abortWith('OFFICIAL_SOURCE_STALLED'),stallMs);};
  try{
   hardTimer=setTimeout(()=>abortWith('OFFICIAL_SOURCE_DEADLINE'),Math.max(1,deadline-clock()));
   arm();
   for(;;){
    let chunk;try{chunk=await Promise.race([reader.read(),aborted]);}catch(error){throw ctl.signal.aborted&&ctl.signal.reason instanceof Error?ctl.signal.reason:error;}
    if(chunk.done)break;
    const n=chunk.value?.byteLength||0;
    // Only actual byte progress resets the stall watchdog; a zero-byte chunk
    // is not progress and must not keep a stuck transfer alive.
    if(n>0)arm();
    size+=n;
    if(size>MAX_BODY_BYTES){const tooLarge=new Error('OFFICIAL_SOURCE_TOO_LARGE');try{ctl.abort(tooLarge);}catch{}throw tooLarge;}
    out+=decoder.decode(chunk.value,{stream:true});
   }
   out+=decoder.decode();
   return out;
  }finally{clearTimeout(stallTimer);clearTimeout(hardTimer);try{reader.cancel().catch(()=>{});}catch{}}
 }
 async function request(source,url,{method='GET',body,headers={},deadline,active}={}){
  const started=clock();
  for(let attempt=1;;attempt++){
   // Per-attempt state: a retried request that fails at the header stage must
   // be labelled as a header failure, not inherit the earlier body stage or
   // its 200 status.
   let stage='fetch',status,response;
   const ctl=new AbortController();if(active)active.add(ctl);
   let error;
   try{
    const headerTimer=setTimeout(()=>{try{ctl.abort(new Error('OFFICIAL_SOURCE_HEADER_TIMEOUT'));}catch{}},Math.max(1,Math.min(timeoutMs,deadline-clock())));
    const headerAborted=new Promise((_,reject)=>{if(ctl.signal.aborted)reject(ctl.signal.reason);else ctl.signal.addEventListener('abort',()=>reject(ctl.signal.reason instanceof Error?ctl.signal.reason:new Error('ABORTED')),{once:true})});
    try{response=await Promise.race([fetchImpl(url,{method,body,headers:{accept:'application/json',...headers},redirect:'error',signal:ctl.signal}),headerAborted]);}
    catch(e){clearTimeout(headerTimer);throw ctl.signal.aborted&&ctl.signal.reason instanceof Error?ctl.signal.reason:e;}
    clearTimeout(headerTimer);
    status=response.status;stage='http';
    if(!response.ok)throw Error('OFFICIAL_SOURCE_HTTP');
    const length=Number(response.headers.get('content-length')||0);if(length>MAX_BODY_BYTES)throw Error('OFFICIAL_SOURCE_TOO_LARGE');
    stage='body';const text=await readBody(response,ctl,deadline);if(text.length>MAX_BODY_BYTES)throw Error('OFFICIAL_SOURCE_TOO_LARGE');
    stage='json';let value;try{value=JSON.parse(text);}catch{throw Error('OFFICIAL_SOURCE_INVALID_JSON');}
    return value;
   }catch(e){error=e;}
   finally{
    if(active)active.delete(ctl);
    // The request's own failure must stop its own transfer too, not only its
    // siblings': abort its signal and cancel a body that was never consumed
    // (e.g. HTTP not-ok or Content-Length over the cap). Bounded: no read loop
    // is running on these paths, and cancel() initiates stream teardown.
    if(error!==undefined){
     try{if(!ctl.signal.aborted)ctl.abort(error instanceof Error?error:new Error('ABORTED'));}catch{}
     try{const b=response?.body;if(b&&typeof b.cancel==='function'){const p=b.cancel();if(p&&typeof p.catch==='function')p.catch(()=>{});}}catch{}
    }
   }
   if(error===SIBLING_ABORT)throw error;
   // Only body-stage transport failures are retryable: HTTP status, size and
   // JSON/validation failures are deterministic and must fail as before.
   const retryable=stage==='body'&&error?.message!=='OFFICIAL_SOURCE_DEADLINE'&&error?.message!=='OFFICIAL_SOURCE_TOO_LARGE'&&attempt<2&&(deadline-clock())>retryBudgetMs;
   diagnostic(source,stage,error,{status,started});
   if(!retryable)throw error;
   emit(source,'body','SOURCE_RETRY',{started});
  }
 }
 async function calendar(venue,payload,receivedAt){try{return await verifiedCalendar(venue,payload,{manifest,receivedAt});}catch(error){diagnostic(venue+'_CALENDAR','validation',error);throw error;}}
 async function fresh(){
  const before=clock(),deadline=before+snapshotTimeoutMs,active=new Set();
  if(new Date(before+8*3600000).getUTCFullYear()!==manifest.year)throw Error('CALENDAR_YEAR_NOT_REVIEWED');
  const pending=[
   request('TWSE_DAILY',SOURCES.TWSE,{deadline,active}),request('TPEX_DAILY',SOURCES.TPEX,{deadline,active}),request('TWSE_CALENDAR',CALENDAR_URLS.TWSE,{deadline,active}),
   request('TPEX_CALENDAR',CALENDAR_URLS.TPEX,{method:'POST',body:manifest.TPEX.form,headers:{'content-type':'application/x-www-form-urlencoded; charset=UTF-8','referer':'https://www.tpex.org.tw/zh-tw/announce/market/holiday.html','x-requested-with':'XMLHttpRequest'},deadline,active})
  ];
  let TWSE,TPEX,twseCalendar,tpexCalendar;
  try{[TWSE,TPEX,twseCalendar,tpexCalendar]=await Promise.all(pending);}
  catch(error){
   // One source failing must not leave the others transferring: abort them and
   // wait for their cleanup before propagating. Every stage races the abort
   // signal (and readBody cancels the stream), so this settle is bounded and a
   // later load() cannot overlap the abandoned transfers.
   for(const ctl of active){try{ctl.abort(SIBLING_ABORT);}catch{}}
   await Promise.allSettled(pending);
   throw error;
  }
  const now=clock(),receivedAt=new Date(now).toISOString();
  if(now-before>snapshotTimeoutMs)throw Error('PUBLIC_SNAPSHOT_TIMEOUT');
  const calendars={TWSE:await calendar('TWSE',twseCalendar,receivedAt),TPEX:await calendar('TPEX',tpexCalendar,receivedAt)};
  const quality={};for(const venue of ['TWSE','TPEX'])quality[venue]=validateVenue(venue==='TWSE'?TWSE:TPEX,{venue,sourceUrl:SOURCES[venue],receivedAt,calendar:calendars[venue],now});
  const result=Object.freeze({contract:'investment-official-daily-snapshot-v1',readOnly:true,TWSE,TPEX,receivedAt,calendars,quality,sourceUrls:SOURCES,calendarPolicyYear:manifest.year,streamSubscriptions:0,mutatingOperationsInvoked:false});
  saved={result,expiresAt:now+ttlMs};return result;
 }
 return async function load(){const now=clock();if(saved&&saved.expiresAt>now)return saved.result;if(inFlight)return inFlight;inFlight=fresh().catch(error=>{saved=null;throw error;}).finally(()=>{inFlight=null;});return inFlight;};
}
function validatePublicSnapshot(snapshot,{now=Date.now()}={}){
 if(snapshot?.contract!=='investment-official-daily-snapshot-v1'||snapshot.readOnly!==true||snapshot.mutatingOperationsInvoked!==false||snapshot.streamSubscriptions!==0)return false;
 for(const venue of ['TWSE','TPEX']){
  const calendar=snapshot.calendars?.[venue],entry=manifest[venue];
  if(!calendar||calendar.year!==manifest.year||calendar.sourceUrl!==entry.sourceUrl||calendar.digest!==entry.digest||JSON.stringify(calendar.closed)!==JSON.stringify(entry.closed)||JSON.stringify(calendar.opened)!==JSON.stringify(entry.opened))return false;
  const result=validateVenue(snapshot[venue],{venue,sourceUrl:snapshot.sourceUrls?.[venue],receivedAt:snapshot.receivedAt,calendar:snapshot.calendars?.[venue],now});
  if(!result.valid)return false;
 }
 return true;
}
module.exports={createDailySnapshotLoader,validatePublicSnapshot,CALENDAR_URLS};
