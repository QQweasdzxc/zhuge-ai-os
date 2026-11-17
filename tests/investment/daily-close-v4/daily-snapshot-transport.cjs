'use strict';
const {verifiedCalendar,validateVenue,SOURCES}=require('./source-policy.cjs');
const manifest=require('./calendar-manifest-2026.json');
const CALENDAR_URLS=Object.freeze({TWSE:manifest.TWSE.sourceUrl,TPEX:manifest.TPEX.sourceUrl});
function createDailySnapshotLoader({fetchImpl=globalThis.fetch,clock=Date.now,ttlMs=300000,timeoutMs=12000}={}){
 let saved=null,inFlight=null;
 async function request(url,{method='GET',body,headers={}}={}){
  const response=await fetchImpl(url,{method,body,headers:{accept:'application/json',...headers},redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
  if(!response.ok)throw Error('OFFICIAL_SOURCE_HTTP');
  const length=Number(response.headers.get('content-length')||0);if(length>12*1024*1024)throw Error('OFFICIAL_SOURCE_TOO_LARGE');
  const text=await response.text();if(text.length>12*1024*1024)throw Error('OFFICIAL_SOURCE_TOO_LARGE');
  let value;try{value=JSON.parse(text);}catch{throw Error('OFFICIAL_SOURCE_INVALID_JSON');}
  return value;
 }
 async function fresh(){
  const before=clock();
  if(new Date(before+8*3600000).getUTCFullYear()!==manifest.year)throw Error('CALENDAR_YEAR_NOT_REVIEWED');
  const [TWSE,TPEX,twseCalendar,tpexCalendar]=await Promise.all([
   request(SOURCES.TWSE),request(SOURCES.TPEX),request(CALENDAR_URLS.TWSE),
   request(CALENDAR_URLS.TPEX,{method:'POST',body:manifest.TPEX.form,headers:{'content-type':'application/x-www-form-urlencoded; charset=UTF-8','referer':'https://www.tpex.org.tw/zh-tw/announce/market/holiday.html','x-requested-with':'XMLHttpRequest'}})
  ]);
  const now=clock(),receivedAt=new Date(now).toISOString();
  if(now-before>60000)throw Error('PUBLIC_SNAPSHOT_TIMEOUT');
  const calendars={TWSE:await verifiedCalendar('TWSE',twseCalendar,{manifest,receivedAt}),TPEX:await verifiedCalendar('TPEX',tpexCalendar,{manifest,receivedAt})};
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
