'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createDailySnapshotLoader,CALENDAR_URLS}=require('./daily-snapshot-transport.cjs');
const {SOURCES}=require('./source-policy.cjs');const {createDailyHandler}=require('./daily-edge-handler.cjs');
const read=p=>JSON.parse(fs.readFileSync(p));const now=Date.parse('2026-11-17T16:10:00Z');
const payloads={
 [SOURCES.TWSE]:read('./evidence/twse-daily-live.json').map(r=>({...r,Date:'1151117'})),
 [SOURCES.TPEX]:read('./evidence/tpex-daily-live.json'),
 [CALENDAR_URLS.TWSE]:read('./evidence/calendar/twse-calendar-2026-live.json'),
 [CALENDAR_URLS.TPEX]:read('./evidence/calendar/tpex-calendar-2026-live.json')
};
const names=['TWSE_DAILY','TPEX_DAILY','TWSE_CALENDAR','TPEX_CALENDAR'];const urls=Object.keys(payloads);
const ok=u=>new Response(JSON.stringify(payloads[u]));
function loader(failAt,fail,events,observer){return createDailySnapshotLoader({clock:()=>now,fetchImpl:async u=>u===failAt?fail():ok(u),onDiagnostic:observer||((e)=>events.push(e))});}
test('diagnostics identify each fixed public source without logging arbitrary error text, request URLs or user data',async()=>{
 for(let i=0;i<urls.length;i++){const events=[],original=Error('synthetic-private-marker token=secret user=private');await assert.rejects(loader(urls[i],()=>{throw original;},events)(),e=>e===original);assert.deepEqual(events,[{event:'official_daily_source_failure',source:names[i],stage:'fetch',code:'SOURCE_FAILURE',durationMs:0}]);assert(!JSON.stringify(events).includes('synthetic-private-marker'));assert(!JSON.stringify(events).includes('https:'));}
});
test('timeout and abort are fixed codes, HTTP status is numeric, no response body escapes',async()=>{
 for(const [name,code] of [['TimeoutError','SOURCE_TIMEOUT'],['AbortError','SOURCE_ABORTED']]){const e=Error('secret');e.name=name;const events=[];await assert.rejects(loader(urls[0],()=>{throw e;},events)());assert.equal(events[0].code,code);}
 const events=[];await assert.rejects(loader(urls[0],()=>new Response('private body',{status:503}),events)(),/OFFICIAL_SOURCE_HTTP/);assert.equal(events[0].status,503);assert.equal(events[0].stage,'http');assert.equal(events[0].code,'OFFICIAL_SOURCE_HTTP');assert(!JSON.stringify(events).includes('private body'));
});
test('body, oversized and JSON failures keep their original fail-closed results',async()=>{
 const cases=[
 [()=>({ok:true,status:200,headers:new Headers(),text:async()=>{throw Error('body-private');}}),'body','SOURCE_FAILURE'],
 [()=>new Response('{}',{headers:{'content-length':String(13*1024*1024)}}),'http','OFFICIAL_SOURCE_TOO_LARGE'],
 [()=>new Response('invalid-private-json'),'json','OFFICIAL_SOURCE_INVALID_JSON']
 ];for(const [fail,stage,code] of cases){const events=[];await assert.rejects(loader(urls[0],fail,events)());assert.equal(events[0].stage,stage);assert.equal(events[0].code,code);}
});
test('calendar digest failure logs only an allowlisted code, successful snapshots log nothing',async()=>{
 const events=[];await assert.rejects(loader(CALENDAR_URLS.TPEX,()=>new Response(JSON.stringify({...payloads[CALENDAR_URLS.TPEX],data:{html:'unreviewed-public-calendar'}})),events)(),/CALENDAR_CONTENT_CHANGED/);assert.deepEqual(events,[{event:'official_daily_source_failure',source:'TPEX_CALENDAR',stage:'validation',code:'CALENDAR_CONTENT_CHANGED'}]);
 const clean=[];const result=await loader('',null,clean)();assert(result.quality.TWSE.valid&&result.quality.TPEX.valid);assert.deepEqual(clean,[]);
});
test('throwing observer cannot change original failure or expose diagnostic details in HTTP response',async()=>{
 const original=Error('private arbitrary error');const load=loader(urls[0],()=>{throw original;},[],()=>{throw Error('observer broke');});await assert.rejects(load(),e=>e===original);
 const handler=createDailyHandler({loadSnapshot:load,verifySession:async()=>({userId:'synthetic-owner',aal:'aal2'})});const response=await handler(new Request('https://edge.example',{method:'POST',body:JSON.stringify({mode:'official_daily_close'})}));assert.equal(response.status,503);assert.deepEqual(await response.json(),{code:'OFFICIAL_DAILY_SOURCE_UNAVAILABLE',readOnly:true});
});
