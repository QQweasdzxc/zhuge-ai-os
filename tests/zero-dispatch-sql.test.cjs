const {test}=require('node:test'),a=require('node:assert/strict'),fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const candidate=__dirname+'/..', baseline=process.env.ERP_BASELINE_ROOT||__dirname+'/../baseline';
const actor='11111111-1111-4111-8111-111111111111',raw='ISOLATED-PRECHECK-ONLY';
const header=['觀察鍵','場次鍵','據點','區域','圖版本','座位編號','標籤狀態','掃碼原文','設備序號','型號','備註','掃描時間','保存時間','經手人','核對狀態'];
const payload=()=>({observationId:crypto.randomUUID(),sessionId:'R',zone:'測試樓層',seatTarget:{map:'fixture-map',seat:26},labelStatus:'有QR',scanRaw:raw,serial:'',model:'',note:'',capturedAt:new Date().toISOString(),localAccount:'fixture@example.invalid',autoCapture:true});
test('actual SQL plus handler: zero-dispatch boundary and every ambiguous custody/write outcome',async t=>{
 const db=new PGlite();
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);insert into auth.users values('${actor}');`);
 await db.exec(fs.readFileSync(baseline+'/supabase/migrations/20261104140500_erp_edit_custody.sql','utf8'));
 async function run(root,mode,indexSource){
  await db.exec('delete from erp_edit_custody;delete from erp_write_attempts;delete from erp_write_operations;');
  let writes=0,obsReads=0,failed=false;const rows=[],rpcs=[];
  const admin={rpc:async(name,args)=>{rpcs.push(name);const params=Object.values(args),call=`select ${name}(${params.map((_,i)=>'$'+(i+1)).join(',')})`;try{await db.query(call,params);if(!failed&&((mode==='begin-ack-lost'&&name==='erp_begin_write')||(mode==='attempt-ack-lost'&&name==='erp_attempt_begin')||(mode==='finish-ack-lost'&&name==='erp_finish_write'))){failed=true;return{error:{message:'isolated committed RPC response unavailable'}}}return{error:null}}catch(e){return{error:{message:e.message}}}}};
  const googleFetch=async(url,init={})=>{
   if(init.method==='POST'){
    writes++;rows.push(...JSON.parse(init.body).values);
    if(mode==='append-timeout')throw Error('isolated write timeout');
    if(mode==='append-503')return new Response('{}',{status:503});
    return Response.json({updates:{updatedRange:'現場觀察!A2:O2'}});
   }
   const decoded=decodeURIComponent(url),tab=decoded.includes('/values/')?decoded.split('/values/')[1].split('!')[0]:'';
   if(mode.startsWith('http-')&&tab==='現場觀察')return new Response(mode.endsWith('-html')?'<html>upstream unavailable</html>':'{}',{status:Number(mode.split('-')[1])});
   if(mode==='timeout'&&tab==='現場觀察')throw new DOMException('isolated timeout','TimeoutError');
   if(mode==='type-error'&&tab==='現場觀察')throw new TypeError('isolated unknown');
   if(mode==='bad-json'&&tab==='現場觀察')return new Response('not-json',{status:200});
   if(mode.startsWith('mixed-')){
    if(tab==='現場觀察'){if(mode==='mixed-404-slow')await new Promise(r=>setTimeout(r,20));return new Response('{}',{status:404})}
    if(tab==='盤點場次'){if(mode==='mixed-503-slow')await new Promise(r=>setTimeout(r,20));return new Response('<html>error</html>',{status:503})}
   }
   if(tab==='現場觀察'){
    obsReads++;
    if(mode==='precheck-read-fails'&&obsReads===1)return Response.json({error:{message:'isolated read unavailable'}},{status:503});
    if(mode==='postappend-read-fails'&&obsReads===2)throw Error('isolated readback unavailable');
    return Response.json({values:[mode==='schema-invalid'?[]:header,...rows]});
   }
   if(tab==='盤點場次')return Response.json({values:[[],['R','測試據點','','','','','','','','',mode==='round-closed'?'已結束':'進行中','','','erp-shared-round-v1']]});
   if(tab==='座位圖')return Response.json({values:[[],['map-event','map','fixture-map','測試據點','測試樓層','','',JSON.stringify({seats:[{number:26},{number:27}],cells:[],width:300,height:200}),'','']]});
   if(tab==='資產')return Response.json({values:[['資產編號']]});
   throw Error('unexpected isolated request '+tab);
  };
  const fixture=require(root+'/tests/erp-cutover/fixture-handler.cjs');
  const h=await fixture({sessions:[],observations:rows,adminOverride:admin,googleFetch,indexSource,envOverride:{ZG_ERP_PRIVATE_UPDATES_ENABLED:'false'}});
  const body=payload(),response=await h.request('https://fixture.invalid/?action=field-observation&tab='+encodeURIComponent('現場觀察'),'POST',body),result=await response.json();
  const operations=(await db.query('select * from erp_write_operations')).rows,custody=(await db.query('select * from erp_edit_custody')).rows,attempts=(await db.query('select * from erp_write_attempts')).rows;
  return{status:response.status,result,operations,custody,attempts,writes,body,rpcs,rows,request:h.request,writesNow:()=>writes};
 }
 await t.test('baseline read failure closes zero-attempt operation yet returns no no-write proof',async()=>{const x=await run(baseline,'precheck-read-fails');a.equal(x.status,502);a.equal(x.writes,0);a.equal(x.attempts.length,0);a.equal(x.custody.length,0);a.equal(x.operations[0].phase,'COMPLETE');a.equal(x.result.error.details.observationWriteState,undefined)});
 await t.test('candidate read failure proves zero attempts and closes dispatch before certifying unsent',async()=>{const x=await run(candidate,'precheck-read-fails');a.equal(x.status,503);a.equal(x.result.error.code,'OBSERVATION_PRECHECK_UNAVAILABLE');a.equal(x.result.error.details.observationWriteState,'not-started');a.equal(x.writes,0);a.equal(x.attempts.length,0);a.equal(x.custody.length,0);a.equal(x.operations[0].phase,'COMPLETE');a.equal(x.operations[0].dispatch_closed,true);await a.rejects(db.query('select erp_attempt_begin($1,$2)',[x.operations[0].operation_id,crypto.randomUUID()]),/OPERATION_NOT_WRITING/)});
 for(const mode of ['begin-ack-lost','attempt-ack-lost','append-timeout','append-503','postappend-read-fails','finish-ack-lost'])await t.test(mode+' cannot certify or retry as unsent',async()=>{
  const x=await run(candidate,mode);a.equal(x.result.error?.details?.observationWriteState,undefined);
  if(mode==='finish-ack-lost'){a.equal(x.status,200);a.equal(x.writes,1);return;}
  a.ok(x.status>=400);
  if(mode==='begin-ack-lost'){a.equal(x.writes,0);a.equal(x.operations[0].phase,'WRITING');a.equal(x.custody.length,3)}
  else {a.equal(x.operations[0].phase,'UNCERTAIN');a.equal(x.custody.length,3);a.equal(x.attempts.length,1);a.equal(x.attempts[0].outcome,mode==='postappend-read-fails'?'DONE':mode==='attempt-ack-lost'?'STARTED':'UNKNOWN')}
 });
 await t.test('dedicated precheck code after a real attempt still cannot certify not-started',async()=>{
  const original=fs.readFileSync(candidate+'/supabase/functions/zg-ledger-bridge/index.ts','utf8');
  const modified=original.replace("      const saved=(await sheetsRead(token,target.spreadsheetId,tab)).rows.filter(r=>r[0]===plan.row[0]);", "      throw new HttpError('isolated post-dispatch code collision',503,'OBSERVATION_PRECHECK_UNAVAILABLE');\n      const saved=(await sheetsRead(token,target.spreadsheetId,tab)).rows.filter(r=>r[0]===plan.row[0]);");
  a.notEqual(modified,original);const x=await run(candidate,'success',modified);a.equal(x.status,503);a.equal(x.writes,1);a.equal(x.attempts[0].outcome,'DONE');a.equal(x.operations[0].phase,'UNCERTAIN');a.equal(x.custody.length,3);a.equal(x.result.error.details.observationWriteState,undefined);
 });
 await t.test('certified unsent continuation traverses actual SQL again and appends once with original observation identity',async()=>{
  const x=await run(candidate,'precheck-read-fails');a.equal(x.result.error.details.observationWriteState,'not-started');
  const r=await x.request('https://fixture.invalid/?action=field-observation&tab='+encodeURIComponent('現場觀察'),'POST',x.body),b=await r.json();a.equal(r.status,200);a.equal(x.writesNow(),1);a.equal(b.row[0],x.body.observationId);a.equal(b.row[1],x.body.sessionId);a.equal(b.row[4],x.body.seatTarget.map);a.equal(b.row[5],x.body.seatTarget.seat);
  const ops=(await db.query('select phase,dispatch_closed from erp_write_operations')).rows;a.equal(ops.length,2);a.ok(ops.every(o=>o.phase==='COMPLETE'&&o.dispatch_closed));a.equal((await db.query('select * from erp_write_attempts')).rows.length,1);a.equal((await db.query('select * from erp_edit_custody')).rows.length,0);
 });
 await t.test('finish acknowledgement loss after precheck failure never emits no-write proof',async()=>{
  // A focused source fault combines a failed initial read with a committed finish whose response is lost.
  const f=candidate+'/supabase/functions/zg-ledger-bridge/index.ts',original=fs.readFileSync(f,'utf8');
  // Custom run selects fault mode through the reader while leaving the actual SQL closure unchanged.
  const modified=original.replace("if(action==='field-observation'){\n      const prechecks=", "if(action==='field-observation'){\n      throw new HttpError('isolated precheck fault',503,'OBSERVATION_PRECHECK_UNAVAILABLE');\n      const prechecks=");
  a.notEqual(modified,original);
  const x=await run(candidate,'finish-ack-lost',modified);a.equal(x.status,503);a.equal(x.writes,0);a.equal(x.attempts.length,0);a.equal(x.operations[0].phase,'COMPLETE');a.equal(x.custody.length,0);a.equal(x.result.error.details.observationWriteState,undefined)
 });
 for(const mode of ['schema-invalid','round-closed'])await t.test('permanent '+mode+' is not put in automatic precheck retry',async()=>{const x=await run(candidate,mode);a.ok(x.status>=400);a.equal(x.writes,0);a.equal(x.operations[0].phase,'COMPLETE');a.equal(x.custody.length,0);a.equal(x.result.error.details.observationWriteState,undefined)});
 for(const mode of ['http-403','http-404','http-400','http-401','http-501','type-error','bad-json','mixed-404-slow','mixed-503-slow'])await t.test(mode+' is certified unsent but BLOCKED, not transient',async()=>{const x=await run(candidate,mode);a.equal(x.status,503);a.equal(x.result.error.code,'OBSERVATION_PRECHECK_BLOCKED');a.equal(x.result.error.details.observationWriteState,'not-started');a.equal(x.writes,0);a.equal(x.attempts.length,0);a.equal(x.operations[0].phase,'COMPLETE');a.equal(x.custody.length,0)});
 for(const mode of ['http-408','http-429','http-500','http-502-html','http-503-html','http-504','timeout'])await t.test(mode+' is reliable transient and certified zero dispatch',async()=>{const x=await run(candidate,mode);a.equal(x.status,503);a.equal(x.result.error.code,'OBSERVATION_PRECHECK_UNAVAILABLE');a.equal(x.result.error.details.observationWriteState,'not-started');a.equal(x.writes,0);a.equal(x.attempts.length,0);a.equal(x.operations[0].phase,'COMPLETE')});
 for(const code of ['OBSERVATION_PRECHECK_BLOCKED','OBSERVATION_PRECHECK_UNAVAILABLE']){
 await t.test(code+' finish response lost cannot provide proof',async()=>{const original=fs.readFileSync(candidate+'/supabase/functions/zg-ledger-bridge/index.ts','utf8'),modified=original.replace("      const prechecks=",`      throw new HttpError('isolated precheck fault',503,'${code}');\n      const prechecks=`);a.notEqual(original,modified);const x=await run(candidate,'finish-ack-lost',modified);a.equal(x.status,503);a.equal(x.result.error.details.observationWriteState,undefined);a.equal(x.operations[0].phase,'COMPLETE')});
 await t.test(code+' after dispatch cannot provide proof',async()=>{const original=fs.readFileSync(candidate+'/supabase/functions/zg-ledger-bridge/index.ts','utf8'),modified=original.replace("      const saved=(await sheetsRead(token,target.spreadsheetId,tab)).rows.filter(r=>r[0]===plan.row[0]);",`      throw new HttpError('isolated post-dispatch fault',503,'${code}');\n      const saved=(await sheetsRead(token,target.spreadsheetId,tab)).rows.filter(r=>r[0]===plan.row[0]);`);const x=await run(candidate,'success',modified);a.equal(x.status,503);a.equal(x.result.error.details.observationWriteState,undefined);a.equal(x.operations[0].phase,'UNCERTAIN');a.equal(x.attempts.length,1)});
 }
 await t.test('successful save remains one append and verified exact original identity/seat',async()=>{const x=await run(candidate,'success');a.equal(x.status,200);a.equal(x.writes,1);a.equal(x.rows.length,1);a.equal(x.result.row[0],x.body.observationId);a.equal(x.result.row[5],26);a.equal(x.attempts[0].outcome,'DONE');a.equal(x.operations[0].phase,'COMPLETE');a.equal(x.custody.length,0)});
 }finally{await db.close()}
});
