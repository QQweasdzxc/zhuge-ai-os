import { test } from 'node:test';import assert from 'node:assert/strict';
import { createGateway } from '../gateway.mjs';import { sweep } from '../cleanup-worker.mjs';
const request = body => new Request('https://edge.test/', { method: 'POST', headers: { Authorization: 'Bearer user-jwt' }, body: JSON.stringify(body) });
test('gateway media capability binds intent, verifies fresh ACL and streams without bearer headers', async()=>{
 const calls=[];const access={enabled:true,bucket:'board-task-attachments',key:'card/id/a.pdf',filename:'a.pdf',ttl:15};
 const handler=createGateway({baseUrl:'https://storage.test',anonKey:'anon',serviceKey:'server-only',fetcher:async(url,options)=>{
  calls.push([url,options]);if(url.endsWith('/auth/v1/user'))return Response.json({id:'user'});
  if(url.endsWith('/rpc/attachment_access')||url.endsWith('/rpc/attachment_redeem'))return Response.json(access);
  if(url.includes('/object/authenticated/'))return new Response('%PDF-1.4 fixture',{headers:{'Content-Type':'application/pdf'}});
  throw Error('unexpected request');
 }});
 const response=await handler(request({module:'board',id:'attachment',intent:'download'}));assert.equal(response.status,200);
 const data=await response.json();assert.equal(data.expires_in,15);assert.ok(new URL(data.url).searchParams.has('cap'));
 assert.equal(calls[0][1].headers.Authorization,'Bearer user-jwt');assert.equal(calls[1][1].headers.Authorization,'Bearer user-jwt');assert.ok(!JSON.stringify(data).includes('server-only'));
 const native=await handler(new Request(data.url+'&download=false'));assert.equal(native.status,200);assert.match(native.headers.get('Content-Disposition'),/^attachment/);assert.equal(await native.text(),'%PDF-1.4 fixture');
 assert.equal(JSON.parse(calls[2][1].body).p_intent,'download');assert.equal(calls[3][1].headers.Authorization,'Bearer server-only');
 const tampered=new URL(data.url);const cap=tampered.searchParams.get('cap');const [payload,sig]=cap.split('.');const json=JSON.parse(Buffer.from(payload,'base64url').toString());json.intent='preview';tampered.searchParams.set('cap',Buffer.from(JSON.stringify(json)).toString('base64url')+'.'+sig);
 assert.equal((await handler(new Request(tampered))).status,404,'download cannot be converted to inline preview');
});
test('expired/cross-workspace/unauthorized policy response never reaches privileged storage or reflects raw error',async()=>{
 for(const status of [401,403,404,500]){let count=0;const handler=createGateway({baseUrl:'https://storage.test',anonKey:'anon',serviceKey:'secret',fetcher:async()=>{count++;return new Response('provider secret url?signature=private',{status})}});const result=await handler(request({module:'board',id:'foreign'}));assert.equal(result.status,404);assert.equal(count,1);assert.ok(!(await result.text()).includes('signature'));}
});
test('manual deletion requires successful confirmed claim, then Storage acknowledgment before tombstone',async()=>{
 const calls=[];const handler=createGateway({baseUrl:'https://storage.test',anonKey:'anon',serviceKey:'server',fetcher:async(url,options)=>{
 calls.push(url);if(url.endsWith('/auth/v1/user'))return Response.json({id:'user'});if(url.endsWith('/rpc/attachment_request_delete')){assert.equal(JSON.parse(options.body).p_confirm,true);return Response.json({module:'board',attachment_id:'id',bucket:'board-task-attachments',object_key:'card/id/a.pdf',delete_token:'lease'});}
 if(url.includes('/object/info/'))return new Response(null,{status:404});
 if(url.includes('/storage/'))return Response.json([]);if(url.endsWith('/attachment_finish_delete'))return new Response(null,{status:204});throw Error('unexpected');}});
 assert.equal((await handler(request({action:'delete',module:'board',id:'id',confirm:true}))).status,200);assert.ok(calls[2].includes('/storage/'));assert.ok(calls[4].endsWith('/attachment_finish_delete'));
});
test('cleanup stays disabled by default; failure retains claim; successful retries are bounded',async()=>{
 let calls=0;const claim=async()=>{calls++;return {state:'deleting',delete_token:'token',bucket:'board-task-attachments'}};
 assert.deepEqual(await sweep({claim}),{enabled:false,deleted:0});assert.equal(calls,0);
 let finalized=0;await assert.rejects(sweep({enabled:true,claim,remove:async()=>{throw Error('Storage failed')},finish:async()=>finalized++}));assert.equal(finalized,0);
 const result=await sweep({enabled:true,claim,remove:async()=>{},finish:async()=>finalized++,limit:2});assert.equal(result.deleted,2);assert.equal(finalized,2);
});
test('browser cannot invoke automatic cleanup even with a valid user session',async()=>{const handler=createGateway({baseUrl:'https://storage.test',anonKey:'anon',serviceKey:'server',cleanupEnabled:true,fetcher:async()=>{throw Error('must not fetch')}});assert.equal((await handler(request({action:'sweep'}))).status,403)});
