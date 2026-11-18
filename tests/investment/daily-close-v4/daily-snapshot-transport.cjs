'use strict';
const {verifiedCalendar,validateVenue,SOURCES}=require('./source-policy.cjs');
const manifest=require('./calendar-manifest-2026.json');
const CALENDAR_URLS=Object.freeze({TWSE:manifest.TWSE.sourceUrl,TPEX:manifest.TPEX.sourceUrl});
function createDailySnapshotLoader({fetchImpl=globalThis.fetch,clock=Date.now,ttlMs=300000,timeoutMs=12000,onDiagnostic=null}={}){
 let saved=null,inFlight=null;
 function diagnostic(source,stage,error,{status,started}={}){
  try{if(typeof onDiagnostic!=='function')return;
  const known=new Set(['OFFICIAL_SOURCE_HTTP','OFFICIAL_SOURCE_TOO_LARGE','OFFICIAL_SOURCE_INVALID_JSON','CALENDAR_PROVENANCE_REQUIRED','CALENDAR_YEAR_OR_TOTAL','CALENDAR_VENUE_REQUIRED','CALENDAR_CONTENT_CHANGED']);
  const code=known.has(error?.message)?error.message:error?.name==='TimeoutError'?'SOURCE_TIMEOUT':error?.name==='AbortError'?'SOURCE_ABORTED':'SOURCE_FAILURE';
  const event={event:'official_daily_source_failure',source,stage,code};
  if(Number.isInteger(status)&&status>=100&&status<=599)event.status=status;
  if(Number.isFinite(started)){const ms=clock()-started;if(Number.isFinite(ms)&&ms>=0)event.durationMs=Math.min(Math.floor(ms),3600000);}
  onDiagnostic(Object.freeze(event));}catch{} // Observability must never change read behavior.
 }
 async function request(source,url,{method='GET',body,headers={}}={}){
  const started=clock();let stage='fetch',status;try{
  const response=await fetchImpl(url,{method,body,headers:{accept:'application/json',...headers},redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
  status=response.status;stage='http';
  if(!response.ok)throw Error('OFFICIAL_SOURCE_HTTP');
  const length=Number(response.headers.get('content-length')||0);if(length>12*1024*1024)throw Error('OFFICIAL_SOURCE_TOO_LARGE');
  stage='body';const text=await response.text();if(text.length>12*1024*1024)throw Error('OFFICIAL_SOURCE_TOO_LARGE');
  stage='json';let value;try{value=JSON.parse(text);}catch{throw Error('OFFICIAL_SOURCE_INVALID_JSON');}
  return value;
  }catch(error){diagnostic(source,stage,error,{status,started});throw error;}
 }
 async function calendar(venue,payload,receivedAt){try{return await verifiedCalendar(venue,payload,{manifest,receivedAt});}catch(error){diagnostic(venue+'_CALENDAR','validation',error);throw error;}}
 async function fresh(){
  const before=clock();
  if(new Date(before+8*3600000).getUTCFullYear()!==manifest.year)throw Error('CALENDAR_YEAR_NOT_REVIEWED');
  const [TWSE,TPEX,twseCalendar,tpexCalendar]=await Promise.all([
   request('TWSE_DAILY',SOURCES.TWSE),request('TPEX_DAILY',SOURCES.TPEX),request('TWSE_CALENDAR',CALENDAR_URLS.TWSE),
   request('TPEX_CALENDAR',CALENDAR_URLS.TPEX,{method:'POST',body:manifest.TPEX.form,headers:{'content-type':'application/x-www-form-urlencoded; charset=UTF-8','referer':'https://www.tpex.org.tw/zh-tw/announce/market/holiday.html','x-requested-with':'XMLHttpRequest'}})
  ]);
  const now=clock(),receivedAt=new Date(now).toISOString();
  if(now-before>60000)throw Error('PUBLIC_SNAPSHOT_TIMEOUT');
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
