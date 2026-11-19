/* Build from reviewed close-only sources; no automatic effects at load. */
(function(root){
const __modules=Object.create(null),__cache=Object.create(null);
__modules["./daily-close.cjs"]=function(module,exports,require){
'use strict';
// Isolated close-only candidate. No network, persistence, or live-provider registration.
function validDate(raw) {
  const s=String(raw??'').replace(/\D/g,'');
  let y,m,d;
  if(s.length===7){y=Number(s.slice(0,3))+1911;m=Number(s.slice(3,5));d=Number(s.slice(5));}
  else if(s.length===8){y=Number(s.slice(0,4));m=Number(s.slice(4,6));d=Number(s.slice(6));}
  else return null;
  const dt=new Date(Date.UTC(y,m-1,d));
  return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d ? `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`:null;
}
function price(raw){if(typeof raw!=='string'&&typeof raw!=='number')return null;const s=String(raw).trim();if(!/^\d+(?:\.\d+)?$/.test(s))return null;const n=Number(s);return Number.isFinite(n)&&n>0?n:null;}
const sources=Object.freeze({TWSE:'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',TPEX:'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'});
function dailyClose(rows,{venue,symbol,receivedAt}={}){
 if(!sources[venue])throw new Error('Explicit supported venue required');
 if(!Array.isArray(rows))throw new Error('Array payload required');
 if(!/^[0-9A-Z]{4,6}$/.test(String(symbol??'')))throw new Error('Explicit security code required');
 if(!Number.isFinite(Date.parse(receivedAt)))throw new Error('Received timestamp required');
 const code=venue==='TWSE'?'Code':'SecuritiesCompanyCode';
 const candidates=rows.filter(r=>r&&String(r[code])===symbol).map(r=>({date:validDate(r.Date),price:price(r[venue==='TWSE'?'ClosingPrice':'Close'])})).filter(r=>r.date).sort((a,b)=>b.date.localeCompare(a.date));
 const latest=candidates[0];
 const conflicts=latest&&candidates.filter(r=>r.date===latest.date).some(r=>r.price!==latest.price);
 // A missing or conflicting latest close must not fall back to an older close.
 const value=latest&&!conflicts?latest.price:null;
 return Object.freeze({contract:'zhuge-investment-quote-v1',symbol,market:'TW',venue,currency:'TWD',price:value,available:value!==null,provider:venue.toLowerCase()+'-daily-close',source:venue+' Daily Close OpenAPI',sourceUrl:sources[venue],asOf:latest?.date||'',receivedAt,quoteType:'daily_close',delayed:true,realtime:false,error:conflicts?'CONFLICTING_LATEST_CLOSE':value===null?'DAILY_CLOSE_UNAVAILABLE':null});
}
module.exports={dailyClose,validDate};

};
__modules["./venue-readonly-join.cjs"]=function(module,exports,require){
'use strict';
const {validDate}=require('./daily-close.cjs');
const SOURCES=Object.freeze({TWSE:'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',TPEX:'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'});
// Read-only join over caller-supplied official daily datasets. A quote with no
// price can establish membership, but never establishes a usable close.
function resolveVenue(position,datasets,{receivedAt}={}){
 const fail=reason=>Object.freeze({resolved:false,reason,venue:null,evidence:[]});
 if(position?.market!=='TW'||position?.currency!=='TWD')return fail('OUTSIDE_TW_TWD_SCOPE');
 if(!/^[0-9A-Z]{4,6}$/.test(position.symbol||''))return fail('EXACT_CODE_REQUIRED');
 if(!Number.isFinite(Date.parse(receivedAt)))return fail('READ_TIME_REQUIRED');
 if(!Array.isArray(datasets?.TWSE)||!Array.isArray(datasets?.TPEX))return fail('BOTH_OFFICIAL_DATASETS_REQUIRED');
 const evidence=[];
 for(const venue of ['TWSE','TPEX']){
  const key=venue==='TWSE'?'Code':'SecuritiesCompanyCode';
  const rows=datasets[venue].filter(r=>r&&r[key]===position.symbol);
  if(rows.length){const dates=rows.map(r=>validDate(r.Date));if(dates.some(d=>!d))return fail('INVALID_MEMBERSHIP_DATE');const date=dates.sort().at(-1);if(date>new Date(Date.parse(receivedAt)+8*60*60*1000).toISOString().slice(0,10))return fail('FUTURE_MEMBERSHIP_DATE');evidence.push(Object.freeze({venue,symbol:position.symbol,sourceUrl:SOURCES[venue],dataDate:date,receivedAt}));}
 }
 if(evidence.length!==1)return fail(evidence.length?'AMBIGUOUS_MEMBERSHIP':'CODE_NOT_FOUND');
 if(position.venue&&position.venue!==evidence[0].venue)return fail('EXISTING_VENUE_CONFLICT');
 return Object.freeze({resolved:true,reason:'EXACT_OFFICIAL_MEMBERSHIP',venue:evidence[0].venue,evidence:Object.freeze(evidence)});
}
function overlayVenues(positions,datasets,options){return positions.map(position=>{const match=resolveVenue(position,datasets,options);return Object.freeze({position:Object.freeze({...position,...(match.resolved?{venue:match.venue}:{venue:''})}),resolution:match});});}
module.exports={resolveVenue,overlayVenues};

};
__modules["./source-policy.cjs"]=function(module,exports,require){
'use strict';
const {validDate}=require('./daily-close.cjs');
const DAY=86400000;
const SOURCES=Object.freeze({TWSE:'https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL',TPEX:'https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes'});
function taipeiDay(now){if(!Number.isFinite(now))throw Error('CLOCK_REQUIRED');return new Date(now+8*3600000).toISOString().slice(0,10);}
function parseTwseCalendar(payload,{year,receivedAt,sourceUrl}={}){
 if(payload?.stat!=='ok'||payload.date!==`${year}0101`||!Array.isArray(payload.data)||payload.total!==payload.data.length||payload.data.length<10||payload.fields?.[0]!=='日期'||payload.fields?.[1]!=='名稱')throw Error('CALENDAR_RESPONSE_INVALID');
 const closed=[],opened=[],seen=new Set();
 for(const row of payload.data){const date=validDate(row?.[0]);if(!date||!date.startsWith(`${year}-`)||seen.has(date)||typeof row[1]!=='string'||!row[1])throw Error('CALENDAR_ROW_INVALID');seen.add(date);if(/開始交易日|最後交易日/.test(row[1]))opened.push(date);else closed.push(date);}
 if(!opened.length||!closed.length)throw Error('CALENDAR_COVERAGE_INVALID');
 return Object.freeze({venue:'TWSE',year,closed:Object.freeze(closed),opened:Object.freeze(opened),receivedAt,sourceUrl});
}
function latestExpectedClose(calendar,{now=Date.now(),publicationCutoffHour=18}={}){
 // 18:00 Taipei is a conservative application cutoff, not a claimed exchange
 // publication guarantee. Prior daily close may be shown before it with date.
 const today=taipeiDay(now),received=Date.parse(calendar?.receivedAt);
 if(!Number.isFinite(received)||received>now+60000||now-received>DAY||calendar.year!==Number(today.slice(0,4))||!Array.isArray(calendar.closed)||!Array.isArray(calendar.opened))throw Error('CURRENT_YEAR_CALENDAR_REQUIRED');
 const localHour=new Date(now+8*3600000).getUTCHours();
 let day=Date.parse(today+'T00:00:00Z')-(localHour<publicationCutoffHour?DAY:0);
 for(let i=0;i<32;i++,day-=DAY){const date=new Date(day).toISOString().slice(0,10),weekday=new Date(day).getUTCDay();if(!date.startsWith(`${calendar.year}-`))throw Error('PRIOR_YEAR_CALENDAR_REQUIRED');if(calendar.opened.includes(date)||(!calendar.closed.includes(date)&&weekday!==0&&weekday!==6))return date;}
 throw Error('CALENDAR_LOOKBACK_EXCEEDED');
}
function validateVenue(rows,{venue,sourceUrl,receivedAt,calendar,now=Date.now()}={}){
 const fail=reason=>Object.freeze({valid:false,reason,venue});
 if(!SOURCES[venue]||sourceUrl!==SOURCES[venue]||calendar?.venue!==venue)return fail('SOURCE_PROVENANCE_REQUIRED');
 const time=Date.parse(receivedAt);if(!Number.isFinite(time)||time>now+60000||now-time>15*60000)return fail('PUBLIC_RESPONSE_TOO_OLD');
 let expected;try{expected=latestExpectedClose(calendar,{now});}catch(e){return fail(e.message);}
 if(!Array.isArray(rows)||!rows.length)return fail('EMPTY_OR_NON_ARRAY');
 const minimumRows=venue==='TWSE'?1000:10000;if(rows.length<minimumRows)return fail('TRUNCATION_GUARD');
 const code=venue==='TWSE'?'Code':'SecuritiesCompanyCode',close=venue==='TWSE'?'ClosingPrice':'Close',seen=new Map();
 let dataDate='';
 for(const row of rows){if(!row||typeof row!=='object'||!Object.hasOwn(row,close)||typeof row[code]!=='string'||!/^[0-9A-Z]{4,6}$/.test(row[code]))return fail('ROW_SCHEMA_INVALID');const date=validDate(row.Date);if(!date)return fail('DATA_DATE_INVALID');if(dataDate&&dataDate!==date)return fail('MIXED_DATA_DATES');dataDate=date;const previous=seen.get(row[code]);if(previous&&previous!==JSON.stringify(row))return fail('DUPLICATE_CODE_CONFLICT');seen.set(row[code],JSON.stringify(row));}
 if(seen.size<minimumRows)return fail('UNIQUE_CODE_TRUNCATION_GUARD');
 if(dataDate>taipeiDay(now))return fail('FUTURE_DATA');
 if(dataDate!==expected)return fail(dataDate<expected?'STALE_DAILY_DATA':'UNEXPECTED_SESSION_DATE');
 return Object.freeze({valid:true,venue,dataDate,expectedDate:expected,receivedAt,rowCount:rows.length,uniqueCodes:seen.size,sourceUrl,completeness:'transport-array-validated-not-universe-guaranteed'});
}
async function verifiedCalendar(venue,payload,{manifest,receivedAt,cryptoImpl=globalThis.crypto}={}){
 const entry=manifest?.[venue];
 if(!entry||manifest.year!==2026||payload?.stat!=='ok'||!Number.isFinite(Date.parse(receivedAt)))throw Error('CALENDAR_PROVENANCE_REQUIRED');
 let value;
 if(venue==='TWSE'){if(payload.date!==`${manifest.year}0101`||payload.total!==payload.data?.length)throw Error('CALENDAR_YEAR_OR_TOTAL');value=JSON.stringify(payload.data);}
 else if(venue==='TPEX'){if(payload.endDate!==`${manifest.year}0101`||typeof payload.data?.html!=='string')throw Error('CALENDAR_YEAR_OR_TOTAL');value=payload.data.html;}
 else throw Error('CALENDAR_VENUE_REQUIRED');
 const digest=[...new Uint8Array(await cryptoImpl.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(b=>b.toString(16).padStart(2,'0')).join('');
 if(digest!==entry.digest)throw Error('CALENDAR_CONTENT_CHANGED');
 return Object.freeze({venue,year:manifest.year,closed:Object.freeze(entry.closed.slice()),opened:Object.freeze(entry.opened.slice()),sourceUrl:entry.sourceUrl,receivedAt,digest});
}
module.exports={taipeiDay,parseTwseCalendar,latestExpectedClose,validateVenue,verifiedCalendar,SOURCES};

};
__modules["./daily-snapshot-transport.cjs"]=function(module,exports,require){
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

};
__modules["./readonly-adapter.cjs"]=function(module,exports,require){
'use strict';
const {overlayVenues}=require('./venue-readonly-join.cjs');
function safeSession(getSession){let s;try{s=getSession();}catch{throw Error('SESSION_UNVERIFIABLE');}if(!s||s.authenticated!==true||!s.ownerId||!s.generation||!(s.aal==='aal2'||(s.aal==='aal1'&&s.readMfaBypassed===true)))throw Error('SESSION_REQUIRED');return {ownerId:s.ownerId,generation:s.generation};}
function createReadOnlyOverlay({getSession,loadPublicSnapshot,validatePublicSnapshot,clock=Date.now}={}){
 if([getSession,loadPublicSnapshot,validatePublicSnapshot].some(f=>typeof f!=='function'))throw Error('READ_ONLY_DEPENDENCIES_REQUIRED');
 // No fallback permission or completeness policy. Snapshot validation must be
 // provided by the separate official-source transport/calendar implementation.
 return async function enrichRawPositions(rows){
  const start=safeSession(getSession),guard=()=>{const current=safeSession(getSession);if(current.ownerId!==start.ownerId||current.generation!==start.generation)throw Error('SESSION_CHANGED');};
  if(!Array.isArray(rows))throw Error('RAW_ROWS_REQUIRED');
  const original=JSON.stringify(rows);
  const unpriced=rows.map(stripSnapshotValuation);
  let snapshot,valid=false,reason='PUBLIC_SOURCE_NOT_VALIDATED';
  try{snapshot=await loadPublicSnapshot();guard();valid=await validatePublicSnapshot(snapshot,{now:clock()});guard();}
  catch(error){guard();reason='PUBLIC_SOURCE_UNAVAILABLE';}
  if(valid!==true){guard();return Object.freeze(unpriced.map(row=>Object.freeze({...row,venue:'',venueResolution:Object.freeze({resolved:false,venue:null,reason,evidence:[]})})));}
  const results=overlayVenues(unpriced,{TWSE:snapshot.TWSE,TPEX:snapshot.TPEX},{receivedAt:snapshot.receivedAt});guard();
  if(JSON.stringify(rows)!==original)throw Error('SOURCE_ROWS_MUTATED');
  return Object.freeze(results.map(({position,resolution})=>Object.freeze({...position,venueResolution:resolution})));
 };
}
function buildDailyRequests(positions){
 const accepted=[],blocked=[],seen=new Set();
 for(const p of positions||[]){
  if(p.positionStatus==='history'||Number(p.quantity||0)<=0)continue;
  const resolution=p.venueResolution;
  if(p.market!=='TW'||p.currency!=='TWD'||!['TWSE','TPEX'].includes(p.venue)||resolution?.resolved!==true||resolution.venue!==p.venue){blocked.push(Object.freeze({sourceId:p.sourceId||p.id||'',symbol:p.symbol||'',reason:'DAILY_SOURCE_UNRESOLVED'}));continue;}
  const key=[p.market,p.venue,p.currency,p.symbol].join(':');if(seen.has(key))continue;seen.add(key);
  accepted.push(Object.freeze({symbol:p.symbol,market:'TW',currency:'TWD',venue:p.venue,name:p.name||''}));
 }
 return Object.freeze({accepted:Object.freeze(accepted),blocked:Object.freeze(blocked)});
}
function stripSnapshotValuation(row){
 const historicalValuation=Object.freeze({lastPrice:row.lastPrice??row.last_price??null,marketValue:row.marketValue??row.market_value??null,unrealizedPnl:row.unrealizedPnl??row.unrealized_pnl??null,unrealizedPercent:row.unrealizedPercent??row.unrealized_pct??null,effectiveAt:row.effectiveAt??row.effective_at??row.snapshot_at??null,kind:'historical_snapshot_not_current_quote'});
 return Object.freeze({...row,lastPrice:null,last_price:null,marketValue:null,market_value:null,unrealizedPnl:null,unrealized_pnl:null,unrealizedPercent:null,unrealized_pct:null,returnRate:null,return_rate:null,historicalValuation});
}
module.exports={createReadOnlyOverlay,buildDailyRequests,stripSnapshotValuation};

};
__modules["./daily-consumer.cjs"]=function(module,exports,require){
'use strict';
const {createReadOnlyOverlay,buildDailyRequests,stripSnapshotValuation}=require('./readonly-adapter.cjs');
const {validatePublicSnapshot}=require('./daily-snapshot-transport.cjs');
const {dailyClose}=require('./daily-close.cjs');
function createDailyConsumer({getSession,invokeFunction,normalizeQuote=x=>x,clock=Date.now}={}){
 if(typeof getSession!=='function'||typeof invokeFunction!=='function')throw Error('DAILY_CONSUMER_DEPENDENCIES_REQUIRED');
 const initial=getSession();
 if(!initial?.ownerId||!initial.generation)throw Error('SESSION_REQUIRED');
 function assertBoundSession(){const current=getSession();if(current?.authenticated!==true||current.ownerId!==initial.ownerId||current.generation!==initial.generation)throw Error('SESSION_CHANGED');return current;}
 let snapshot=null,inFlight=null;
 async function loadPublicSnapshot(){
  if(snapshot&&Number.isFinite(Date.parse(snapshot.receivedAt))&&clock()-Date.parse(snapshot.receivedAt)<300000)return snapshot;
  if(inFlight)return inFlight;
  inFlight=Promise.resolve(invokeFunction('investment-daily-close-read',{mode:'official_daily_close'})).then(value=>{snapshot=value;return value;}).catch(error=>{snapshot=null;throw error;}).finally(()=>{inFlight=null;});
  return inFlight;
 }
 const overlay=createReadOnlyOverlay({getSession:assertBoundSession,loadPublicSnapshot,validatePublicSnapshot,clock});
 async function enrichRawPositions(rows){
  const s=assertBoundSession();
  // AAL1 requires the resolved Creator read policy. The Edge independently
  // checks the saved server policy; client state never grants server access.
  if(s?.authenticated===true&&s.ownerId&&s.generation&&s.aal==='aal1'&&s.readMfaBypassed!==true)return Object.freeze(rows.map(row=>Object.freeze({...stripSnapshotValuation(row),venue:'',venueResolution:Object.freeze({resolved:false,venue:null,reason:'AAL2_REQUIRED_FOR_DAILY_SOURCE',evidence:[]})})));
  return overlay(rows);
 }
 function load(positions=[]){
  const s=assertBoundSession();if(!s||s.authenticated!==true||!(s.aal==='aal2'||(s.aal==='aal1'&&s.readMfaBypassed===true)))return pack([],positions,'DAILY_SOURCE_AAL2_REQUIRED');
  if(!validatePublicSnapshot(snapshot,{now:clock()}))return pack([],positions,'OFFICIAL_DAILY_SOURCE_NOT_CURRENT');
  const {accepted}=buildDailyRequests(positions);
  const quotes=accepted.map(p=>normalizeQuote(dailyClose(snapshot[p.venue],{venue:p.venue,symbol:p.symbol,receivedAt:snapshot.receivedAt}),clock()));
  return pack(quotes,positions,null);
 }
 function pack(quotes,positions,error){const gate=buildDailyRequests(positions);return Object.freeze({generatedAt:snapshot?.contract==='investment-official-daily-snapshot-v1'?snapshot.receivedAt:null,quotes:Object.freeze(quotes),fx:null,news:Object.freeze([]),contexts:Object.freeze([]),analyses:Object.freeze([]),strategyScans:Object.freeze([]),volumeConfirmations:Object.freeze([]),homeworkPacks:Object.freeze([]),quality:Object.freeze({dailyClose:Object.freeze({error,available:quotes.filter(q=>q.available).length,requested:gate.accepted.length,blocked:gate.blocked.length,sourceQuality:snapshot?.quality||{}})}),error});}
 return Object.freeze({enrichRawPositions,load,assertBoundSession});
}
module.exports={createDailyConsumer};

};
__modules["./daily-edge-handler.cjs"]=function(module,exports,require){
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
  if(!(session.aal==='aal2'||(session.aal==='aal1'&&session.readMfaBypassed===true)))return response({code:'AAL2_REQUIRED'},403);
  const declared=Number(request.headers.get('content-length')||0);if(declared>1024)return response({code:'INVALID_REQUEST'},400);
  let input;try{const text=await request.text();if(text.length>1024)throw Error();input=JSON.parse(text);}catch{return response({code:'INVALID_REQUEST'},400);}
  if(!input||Array.isArray(input)||input.mode!=='official_daily_close'||Object.keys(input).length!==1)return response({code:'INVALID_REQUEST'},400);
  try{return response(await loadSnapshot());}catch{return response({code:'OFFICIAL_DAILY_SOURCE_UNAVAILABLE',readOnly:true},503);}
 };
}
module.exports={createDailyHandler};

};
__modules['./calendar-manifest-2026.json']=function(module){module.exports={
  "year": 2026,
  "scope": "TWSE and TPEx stock market only; not bond calendars",
  "policy": "Exact official annual calendar content digest required; changed content and uncovered years fail closed. Weekend closure is used only inside this verified annual coverage. 18:00 Taipei is an application publication cutoff, not an exchange guarantee.",
  "TWSE": {
    "sourceUrl": "https://www.twse.com.tw/rwd/zh/holidaySchedule/holidaySchedule?response=json&date=20260101",
    "digest": "48fcae212c1a741387131f124b4a520b8165b6fbd730d94f0899454161e8b9a5",
    "digestField": "data",
    "closed": [
      "2026-01-01",
      "2026-02-12",
      "2026-02-13",
      "2026-02-15",
      "2026-02-16",
      "2026-02-17",
      "2026-02-18",
      "2026-02-19",
      "2026-02-20",
      "2026-02-27",
      "2026-02-28",
      "2026-04-03",
      "2026-04-04",
      "2026-04-05",
      "2026-04-06",
      "2026-05-01",
      "2026-06-19",
      "2026-09-25",
      "2026-09-28",
      "2026-10-09",
      "2026-10-10",
      "2026-10-25",
      "2026-10-26",
      "2026-12-25"
    ],
    "opened": [
      "2026-01-02",
      "2026-02-11",
      "2026-02-23"
    ]
  },
  "TPEX": {
    "sourceUrl": "https://www.tpex.org.tw/www/zh-tw/bulletin/tradingDate",
    "method": "POST",
    "form": "date=2026&response=json",
    "digest": "b7c0ae6990f4e14aff19decf1932243a0d867f1abbad51d5ebc28eb7c05d7432",
    "digestField": "data.html",
    "closed": [
      "2026-01-01",
      "2026-02-12",
      "2026-02-13",
      "2026-02-15",
      "2026-02-16",
      "2026-02-17",
      "2026-02-18",
      "2026-02-19",
      "2026-02-20",
      "2026-02-27",
      "2026-02-28",
      "2026-04-03",
      "2026-04-04",
      "2026-04-05",
      "2026-04-06",
      "2026-05-01",
      "2026-06-19",
      "2026-09-25",
      "2026-09-28",
      "2026-10-09",
      "2026-10-10",
      "2026-10-25",
      "2026-10-26",
      "2026-12-25"
    ],
    "opened": [
      "2026-01-02",
      "2026-02-11",
      "2026-02-23"
    ]
  }
}
;};
function __require(name){if(__cache[name])return __cache[name].exports;if(!__modules[name])throw Error("MODULE_NOT_BUNDLED");const module={exports:{}};__cache[name]=module;__modules[name](module,module.exports,__require);return module.exports;}
root.InvestmentDailyCloseService=Object.freeze({...__require('./daily-consumer.cjs'),...__require('./readonly-adapter.cjs')});
})(globalThis);
