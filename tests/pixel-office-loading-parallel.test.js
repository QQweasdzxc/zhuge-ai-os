'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),Tf=require('../labs/pixel-office-3d/tf-source');
const response=(data,status=200)=>({status,json:async()=>data});
test('independent enrichments start together after auth/issues; one final complete snapshot',async()=>{
 const calls=[],gates={};let stale=false;
 const fetch=async(url,init)=>{calls.push({url,init});if(url.endsWith('/auth/zhuge'))return response({token:'jwt'});if(url.includes('/api/issues?'))return response({issues:[{id:'i',title:'T',project_id:'p',assignee_type:'agent',assignee_id:'a',status_category:'in_progress'}],total:1});return new Promise(resolve=>{gates[url]=resolve});};
 let settled=false;const pending=Tf.pollTfOnce(fetch,'',0,{apiBase:'https://fixture.invalid',workspace:'w',supabaseToken:'supa',isStale:()=>stale}).then(v=>{settled=true;return v});
 for(let i=0;i<10;i++)await Promise.resolve();
 assert.equal(calls.length,6);assert.equal(Object.keys(gates).length,4);assert.equal(settled,false);
 for(const {url,init} of calls.slice(2)){assert.equal(init.headers.authorization,'Bearer jwt');assert.equal(init.headers['X-Workspace-Slug'],'w');assert.equal(init.credentials,'omit');}
 for(const [url,resolve] of Object.entries(gates))resolve(response(url.includes('/projects?')?{projects:[{id:'p',title:'P'}]}:url.includes('/native-ai-tasks?')?{tasks:[]}:url.includes('/agents?')?{agents:[{id:'a',name:'Agent'}]}:[]));
 const result=await pending;assert.equal(result.state,'ok');assert.equal(result.sessions[0].project,'P');assert.equal(result.sessions[0].tf.assigneeAgent.name,'Agent');assert.equal(result.total,1);
});
test('logout during parallel reads drops the entire result; no partial identity',async()=>{
 let stale=false;const gates=[];
 const fetch=async url=>url.endsWith('/auth/zhuge')?response({token:'jwt'}):url.includes('/api/issues?')?response({issues:[]}):new Promise(resolve=>gates.push(resolve));
 const p=Tf.pollTfOnce(fetch,'',0,{apiBase:'https://fixture.invalid',workspace:'w',supabaseToken:'supa',isStale:()=>stale});for(let i=0;i<10;i++)await Promise.resolve();stale=true;gates.forEach(r=>r(response({})));assert.equal((await p).state,'stale');
});
test('auth rejection starts no enrichment, source error never invents a snapshot',async()=>{
 const calls=[];const fetch=async u=>{calls.push(u);return response({},401)};assert.equal((await Tf.pollTfOnce(fetch,'',0,{apiBase:'https://fixture.invalid',workspace:'w',supabaseToken:'supa'})).state,'auth-required');assert.equal(calls.length,1);
});
