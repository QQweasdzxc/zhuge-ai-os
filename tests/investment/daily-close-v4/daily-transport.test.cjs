'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createDailySnapshotLoader,validatePublicSnapshot,CALENDAR_URLS}=require('./daily-snapshot-transport.cjs');
const {SOURCES}=require('./source-policy.cjs');
const {createDailyHandler}=require('./daily-edge-handler.cjs');
const {createReadOnlyOverlay}=require('./readonly-adapter.cjs');
const Position=require('./model/position.js'),Calculation=require('./model/calculation.js');
const fixture=path=>JSON.parse(fs.readFileSync(path,'utf8'));
const source={TWSE:fixture('./evidence/twse-daily-live.json'),TPEX:fixture('./evidence/tpex-daily-live.json')};
const calendars={TWSE:fixture('./evidence/calendar/twse-calendar-2026-live.json'),TPEX:fixture('./evidence/calendar/tpex-calendar-2026-live.json')};
const now=Date.parse('2026-11-17T16:10:00Z');
function fetcher({fresh=true}={}){const calls=[];let fail=false;const fn=async(url,options)=>{calls.push({url,options});if(fail)throw Error('NETWORK_DOWN');let value;if(url===SOURCES.TWSE)value=fresh?source.TWSE.map(x=>({...x,Date:'1151117'})):source.TWSE;else if(url===SOURCES.TPEX)value=source.TPEX;else if(url===CALENDAR_URLS.TWSE)value=calendars.TWSE;else if(url===CALENDAR_URLS.TPEX)value=calendars.TPEX;else throw Error('UNEXPECTED_DESTINATION');return new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});};return{calls,fn,setFail:()=>{fail=true;}};}
test('public transport fetches exactly fixed official sources, no private symbols, public-only 5min cache and no stale fallback',async()=>{const f=fetcher();let time=now;const load=createDailySnapshotLoader({fetchImpl:f.fn,clock:()=>time});const [a,b]=await Promise.all([load(),load()]);assert.equal(a,b);assert.equal(f.calls.length,4);assert.equal(validatePublicSnapshot(a,{now:time}),true);assert.equal(f.calls.find(x=>x.url===CALENDAR_URLS.TPEX).options.method,'POST');assert.ok(f.calls.every(x=>!JSON.stringify(x.options).includes('owner')&&!JSON.stringify(x.options).includes('2330')));await load();assert.equal(f.calls.length,4);time+=300001;f.setFail();await assert.rejects(load(),/NETWORK_DOWN/);await assert.rejects(load(),/NETWORK_DOWN/);});
test('captured stale TWSE response is not marked valid, and forged calendars/contracts fail client validation',async()=>{const f=fetcher({fresh:false}),snapshot=await createDailySnapshotLoader({fetchImpl:f.fn,clock:()=>now})();assert.equal(snapshot.quality.TWSE.reason,'STALE_DAILY_DATA');assert.equal(validatePublicSnapshot(snapshot,{now}),false);const g=fetcher(),valid=await createDailySnapshotLoader({fetchImpl:g.fn,clock:()=>now})();const forged=structuredClone(valid);forged.calendars.TWSE.closed.push('2026-11-17');assert.equal(validatePublicSnapshot(forged,{now}),false);assert.equal(validatePublicSnapshot({...valid,readOnly:false},{now}),false);});
test('HTTP boundary rejects unauthenticated/AAL1/foreign origin/unknown fields before public reads and permits only authorized read mode',async()=>{let reads=0,session={userId:'owner',aal:'aal2'};const handler=createDailyHandler({loadSnapshot:async()=>{reads++;return{readOnly:true};},verifySession:async()=>session});const request=(body={mode:'official_daily_close'},origin='https://qqweasdzxc.github.io',method='POST')=>new Request('https://edge.example',{method,headers:{origin,'content-type':'application/json'},...(method==='POST'?{body:JSON.stringify(body)}:{})});assert.equal((await handler(request({},'https://untrusted.example'))).status,403);assert.equal((await handler(request({},undefined,'GET'))).status,405);session=null;assert.equal((await handler(request())).status,401);session={userId:'owner',aal:'aal1'};assert.equal((await handler(request())).status,403);session={userId:'owner',aal:'aal2'};assert.equal((await handler(request({mode:'official_daily_close',symbols:['2330']}))).status,400);assert.equal(reads,0);assert.equal((await handler(request())).status,200);assert.equal(reads,1);});
test('source failures retain all cost/identity but remove every historical snapshot valuation from current totals without mutating originals',async()=>{const raw=[{id:'private-position',symbol:'0050',market:'TW',currency:'TWD',quantity:10,invested_cost:700,last_price:99,market_value:990,unrealized_pnl:290,unrealized_pct:41.4,effective_at:'2026-01-02'}],before=JSON.stringify(raw);for(const sourceState of ['network','invalid']){const overlay=createReadOnlyOverlay({getSession:()=>({authenticated:true,ownerId:'owner',generation:'generation',aal:'aal2'}),loadPublicSnapshot:async()=>{if(sourceState==='network')throw Error('DOWN');return{};},validatePublicSnapshot:()=>false});const [p]=(await overlay(raw)).map(Position.normalize);assert.equal(p.investedCost,700);assert.equal(p.symbol,'0050');assert.equal(p.marketValue,null);assert.equal(p.lastPrice,null);assert.equal(p.unrealizedPnl,null);assert.equal(p.unrealizedPercent,null);assert.equal(p.historicalValuation.marketValue,990);const s=Calculation.summarize([p]);assert.equal(s.tw.cost,700);assert.equal(s.tw.pricedCount,0);assert.equal(s.tw.unpricedCount,1);assert.equal(JSON.stringify(raw),before);}});
test('HTTP boundary accepts only server verified AAL1 read bypass, never missing/unknown assurance',async()=>{let reads=0,session;const handler=createDailyHandler({loadSnapshot:async()=>{reads++;return{readOnly:true};},verifySession:async()=>session});const request=()=>new Request('https://edge.example',{method:'POST',body:JSON.stringify({mode:'official_daily_close'})});for(const s of[{userId:'owner',aal:'aal1',readMfaBypassed:true},{userId:'owner',aal:'aal2'}]){session=s;assert.equal((await handler(request())).status,200);}assert.equal(reads,2);for(const s of[{userId:'owner',aal:'aal1',readMfaBypassed:false},{userId:'owner',aal:'aal1'},{userId:'owner',aal:'unknown',readMfaBypassed:true},{userId:'owner',readMfaBypassed:true}]){session=s;assert.equal((await handler(request())).status,403);}assert.equal(reads,2);});
function streamFetcher(tpexPlan,{clock=Date.now}={}){const calls=[];const enc=new TextEncoder();const ok=value=>new Response(JSON.stringify(value),{status:200,headers:{'content-type':'application/json'}});
 const fn=async(url,options)=>{calls.push({url,options});
  if(url===SOURCES.TWSE)return ok(source.TWSE.map(x=>({...x,Date:'1151117'})));
  if(url===CALENDAR_URLS.TWSE)return ok(calendars.TWSE);if(url===CALENDAR_URLS.TPEX)return ok(calendars.TPEX);
  if(url!==SOURCES.TPEX)throw Error('UNEXPECTED_DESTINATION');
  const plan=tpexPlan[Math.min(calls.filter(c=>c.url===SOURCES.TPEX).length-1,tpexPlan.length-1)];
  const chunks=plan.chunks.map(c=>typeof c==='string'?enc.encode(c):c);
  return new Response(new ReadableStream({start(c){let t=0;chunks.forEach((chunk,i)=>{t+=plan.delays[i]||0;const h=setTimeout(()=>{try{c.enqueue(chunk)}catch{}},t);h.unref?.()});const h=setTimeout(()=>{try{c.close()}catch{}},t+(plan.closeAfter??0));h.unref?.()}}),{status:200,headers:{'content-type':'application/json'}});};
 return{calls,fn};}
test('slow but progressing body completes; old fixed whole-request timeout would have aborted it',async()=>{
 const payload=JSON.stringify(source.TPEX),half=Math.floor(payload.length/2);
 // An empty (zero-byte) chunk no longer resets the stall watchdog, so the
 // third chunk must land within stallMs of the last positive chunk.
 const f=streamFetcher([{chunks:[payload.slice(0,half),'',payload.slice(half)],delays:[200,50,200]}]);
 const events=[];const load=createDailySnapshotLoader({fetchImpl:f.fn,timeoutMs:100,stallMs:400,onDiagnostic:e=>events.push(e)});
 const snapshot=await load();
 assert.equal(snapshot.TPEX.length,source.TPEX.length);assert.equal(f.calls.filter(c=>c.url===SOURCES.TPEX).length,1);
 assert.deepEqual(events.filter(e=>e.source==='TPEX_DAILY'),[]);});
test('true body stall aborts, emits SOURCE_STALLED then SOURCE_RETRY, and one retry succeeds within budget',async()=>{
 const payload=JSON.stringify(source.TPEX);
 const f=streamFetcher([{chunks:[payload.slice(0,64)],delays:[20],closeAfter:60*60*1000},{chunks:[payload],delays:[10]}]);
 const events=[];const started=Date.now();
 const load=createDailySnapshotLoader({fetchImpl:f.fn,timeoutMs:2000,stallMs:150,retryBudgetMs:1000,snapshotTimeoutMs:30000,onDiagnostic:e=>events.push(e)});
 const snapshot=await load();
 assert.equal(snapshot.TPEX.length,source.TPEX.length);assert.equal(f.calls.filter(c=>c.url===SOURCES.TPEX).length,2);
 const codes=events.filter(e=>e.source==='TPEX_DAILY').map(e=>e.code);
 assert.deepEqual(codes,['SOURCE_STALLED','SOURCE_RETRY']);
 assert(Date.now()-started<10000);});
test('retry is skipped when remaining overall budget is below retryBudgetMs',async()=>{
 const f=streamFetcher([{chunks:['{"a"'],delays:[20],closeAfter:60*60*1000}]);
 const events=[];
 const load=createDailySnapshotLoader({fetchImpl:f.fn,timeoutMs:2000,stallMs:150,retryBudgetMs:30000,snapshotTimeoutMs:30000,onDiagnostic:e=>events.push(e)});
 await assert.rejects(load(),/OFFICIAL_SOURCE_STALLED/);
 assert.equal(f.calls.filter(c=>c.url===SOURCES.TPEX).length,1);
 assert.deepEqual(events.filter(e=>e.source==='TPEX_DAILY').map(e=>e.code),['SOURCE_STALLED']);});
test('hard snapshot deadline aborts an endlessly dripping body with SOURCE_TIMEOUT and never exceeds the overall cap',async()=>{
 const drip={chunks:Array.from({length:1000},()=>'x'),delays:Array.from({length:1000},()=>30),closeAfter:60*60*1000};
 const f=streamFetcher([drip]);const events=[];const started=Date.now();
 const load=createDailySnapshotLoader({fetchImpl:f.fn,timeoutMs:2000,stallMs:5000,snapshotTimeoutMs:400,retryBudgetMs:0,onDiagnostic:e=>events.push(e)});
 await assert.rejects(load(),/OFFICIAL_SOURCE_DEADLINE/);
 assert(Date.now()-started<10000,'overall cap must bound the attempt');
 assert.equal(f.calls.filter(c=>c.url===SOURCES.TPEX).length,1);
 assert.deepEqual(events.filter(e=>e.source==='TPEX_DAILY').map(e=>e.code),['SOURCE_TIMEOUT']);});
test('mid-stream 12MB cap still fails closed without retry',async()=>{
 const big='x'.repeat(3*1024*1024);
 const f=streamFetcher([{chunks:[big,big,big,big,big],delays:[5,5,5,5,5]}]);
 const events=[];
 const load=createDailySnapshotLoader({fetchImpl:f.fn,timeoutMs:2000,stallMs:2000,retryBudgetMs:0,onDiagnostic:e=>events.push(e)});
 await assert.rejects(load(),/OFFICIAL_SOURCE_TOO_LARGE/);
 assert.equal(f.calls.filter(c=>c.url===SOURCES.TPEX).length,1);
 assert.deepEqual(events.filter(e=>e.source==='TPEX_DAILY').map(e=>e.code),['OFFICIAL_SOURCE_TOO_LARGE']);});
test('response without a byte stream is still bounded by the deadline and aborts its signal',async()=>{
 const signals=[];const events=[];const started=Date.now();
 const load=createDailySnapshotLoader({snapshotTimeoutMs:120,stallMs:40,retryBudgetMs:0,onDiagnostic:e=>events.push(e),fetchImpl:async(u,o)=>{signals.push(o.signal);return{ok:true,status:200,headers:new Headers(),text:()=>new Promise(()=>{})};}});
 await assert.rejects(load(),/OFFICIAL_SOURCE_DEADLINE/);
 assert(Date.now()-started<10000,'text fallback must settle near the deadline, not hang');
 assert(signals.length===4&&signals.every(s=>s.aborted),'every request signal must be aborted');
 assert(events.some(e=>e.code==='SOURCE_TIMEOUT'&&e.stage==='body'));});
test('one failing source aborts and cleans up the sibling transfers before load rejects',async()=>{
 const rows=[];
 const load=createDailySnapshotLoader({snapshotTimeoutMs:5000,stallMs:3000,retryBudgetMs:0,fetchImpl:async(u,o)=>{
  const row={url:u,signal:o.signal,cancelled:false};rows.push(row);
  if(rows.length===1)return new Response('error',{status:503});
  return new Response(new ReadableStream({start(c){const h=setTimeout(()=>{try{c.enqueue(new TextEncoder().encode(' '))}catch{}},60000);h.unref?.()},cancel(){row.cancelled=true;}}),{status:200});}});
 await assert.rejects(load(),/OFFICIAL_SOURCE_HTTP/);
 // Cleanup finished before the rejection propagated: a later load cannot overlap abandoned streams.
 assert.deepEqual(rows.slice(1).map(r=>({aborted:r.signal.aborted,cancelled:r.cancelled})),[{aborted:true,cancelled:true},{aborted:true,cancelled:true},{aborted:true,cancelled:true}]);});
test('a retried attempt failing at the header stage is labelled header, without the previous attempt status',async()=>{
 const payload=JSON.stringify(source.TPEX);let tpexCalls=0;const events=[];
 const f=streamFetcher([{chunks:[payload.slice(0,64)],delays:[20],closeAfter:60*60*1000}]);
 const wrapped=async(u,o)=>{if(u===SOURCES.TPEX){tpexCalls++;if(tpexCalls===2)return new Promise(()=>{});}return f.fn(u,o);};
 const load=createDailySnapshotLoader({fetchImpl:wrapped,timeoutMs:120,stallMs:150,retryBudgetMs:1000,snapshotTimeoutMs:30000,onDiagnostic:e=>events.push(e)});
 await assert.rejects(load(),/OFFICIAL_SOURCE_HEADER_TIMEOUT/);
 const tpex=events.filter(e=>e.source==='TPEX_DAILY');
 assert.deepEqual(tpex.map(e=>[e.stage,e.code]),[['body','SOURCE_STALLED'],['body','SOURCE_RETRY'],['fetch','SOURCE_TIMEOUT']]);
 assert(!('status' in tpex[2]),'no stale 200 from the first attempt');});
test('a request that fails itself also aborts its signal and cancels its unread body',async()=>{
 for(const kind of['http','length']){
  const rows=[];
  const load=createDailySnapshotLoader({snapshotTimeoutMs:2000,stallMs:500,retryBudgetMs:0,fetchImpl:async(u,o)=>{
   const row={url:u,signal:o.signal,cancelled:false};rows.push(row);
   const stream=new ReadableStream({cancel(){row.cancelled=true;}});
   if(rows.length===1)return kind==='http'?new Response(stream,{status:503}):new Response(stream,{status:200,headers:{'content-length':String(13*1024*1024)}});
   return new Response(stream,{status:200});
  }});
  await assert.rejects(load(),kind==='http'?/OFFICIAL_SOURCE_HTTP/:/OFFICIAL_SOURCE_TOO_LARGE/);
  assert.deepEqual(rows.map(r=>({aborted:r.signal.aborted,cancelled:r.cancelled})),Array.from({length:4},()=>({aborted:true,cancelled:true})),kind+': every request including the failing one is aborted and cancelled');
 }});
test('zero-byte chunks are not progress and do not reset the stall watchdog',async()=>{
 const events=[];const started=Date.now();
 const load=createDailySnapshotLoader({snapshotTimeoutMs:5000,stallMs:150,retryBudgetMs:999999,onDiagnostic:e=>events.push(e),fetchImpl:async(u,o)=>{
  return new Response(new ReadableStream({start(c){const timer=setInterval(()=>{try{c.enqueue(new Uint8Array(0))}catch{}},7);o.signal.addEventListener('abort',()=>clearInterval(timer));},cancel(){}}),{status:200});
 }});
 await assert.rejects(load(),/OFFICIAL_SOURCE_STALLED/);
 assert(Date.now()-started<4000,'stall must fire near stallMs, well before the 5000ms overall deadline');
 assert.deepEqual(events.map(e=>[e.stage,e.code]),[['body','SOURCE_STALLED']]);});
