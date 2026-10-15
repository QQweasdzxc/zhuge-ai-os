import {test} from 'node:test';import assert from 'node:assert/strict';import http from 'node:http';import {readFile} from 'node:fs/promises';import {chromium} from 'playwright';import {createGateway} from '../gateway.mjs';import fixtureModule from './fixture.cjs';
const {fixture,id,card,owner}=fixtureModule;
test('desktop/iPhone dashboard: real SQL capacity, safe names, explicit-confirmation delete and retained metadata',async()=>{
 const db=await fixture();let origin;const objects=new Map([[`${card}/${id}/a.pdf`,Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\n%%EOF')]]);
 const localFetch=async(url,options)=>{
  const path=new URL(url).pathname;
  if(path==='/auth/v1/user')return options.headers.Authorization==='Bearer isolated-user'?Response.json({id:owner}):new Response(null,{status:401});
  if(path.startsWith('/rest/v1/rpc/')){
   const name=path.split('/').at(-1);const args=options.body?JSON.parse(options.body):{};
   const specs={attachment_capacity:[],attachment_redeem:['p_module','p_id','p_user','p_intent'],attachment_access:['p_module','p_id','p_intent'],attachment_request_delete:['p_module','p_id','p_confirm'],attachment_finish_delete:['p_module','p_id','p_token'],attachment_record_failure:['p_module','p_id','p_token']};
   if(!specs[name])return new Response(null,{status:404});
   try {const keys=specs[name];const r=await db.query(`select public.${name}(${keys.map((_,i)=>'$'+(i+1)).join(',')}) result`,keys.map(k=>args[k]));return Response.json(r.rows[0].result);}
   catch{return new Response(null,{status:403})}
  }
  if(path==='/storage/v1/object/board-task-attachments'&&options.method==='DELETE'){for(const key of JSON.parse(options.body).prefixes)objects.delete(key);return Response.json([])}
  if(path.startsWith('/storage/v1/object/authenticated/')) return objects.has(path.split('/board-task-attachments/')[1]) ? new Response(objects.get(path.split('/board-task-attachments/')[1]),{headers:{'Content-Type':'application/pdf'}}) : new Response(null,{status:404});
  if(path.startsWith('/storage/v1/object/info/'))return objects.has(path.split('/board-task-attachments/')[1])?Response.json({size:objects.values().next().value.length}):new Response(null,{status:404});
  if(path.startsWith('/storage/v1/object/sign/'))return Response.json({signedURL:path+'?token=isolated-capability'});
  throw Error('unexpected local API '+path);
 };
 const server=http.createServer(async(req,res)=>{try{
  if(req.url.split('?')[0]==='/shared/app-config.js'){res.setHeader('Content-Type','text/javascript');res.end(`const AUTH_CONFIG={supabaseUrl:${JSON.stringify(origin)},supabaseAnonKey:'isolated-anon'};`);return;}
  if(req.url.startsWith('/functions/v1/attachment-lifecycle')){
   const chunks=[];for await(const c of req)chunks.push(c);
   const response=await createGateway({baseUrl:origin,anonKey:'isolated-anon',serviceKey:'isolated-service',fetcher:localFetch})(new Request(origin+req.url,{method:req.method,headers:req.headers,...(req.method==='POST'?{body:Buffer.concat(chunks)}:{})}));
   res.writeHead(response.status,Object.fromEntries(response.headers));res.end(await response.text());return;
  }
  const file=req.url.split('?')[0]==='/labs/attachments/'?'index.html':req.url.split('/').at(-1).split('?')[0];
  if(!['index.html','dashboard.mjs'].includes(file)){res.writeHead(404);res.end();return}
  res.setHeader('Content-Type',file.endsWith('mjs')?'text/javascript':'text/html');res.end(await readFile(new URL('../'+file,import.meta.url)));
 }catch{res.writeHead(500);res.end('isolated test failure')}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
 try{
  for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
   const context=await browser.newContext({viewport});await context.addInitScript(()=>localStorage.setItem('zhuge_ai_os_google_auth_session_v1',JSON.stringify({access_token:'isolated-user'})));
   const page=await context.newPage();const external=[];await page.route('**/*',route=>{if(!route.request().url().startsWith(origin)){external.push(route.request().url());return route.abort()}return route.continue()});
   await page.goto(origin+'/labs/attachments/');await page.getByRole('status').filter({hasText:'容量正常'}).waitFor();assert.equal(await page.locator('#items tr').count(),1);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(external,[]);
   const signed = await page.evaluate(async id => {const response=await fetch('/functions/v1/attachment-lifecycle',{method:'POST',headers:{Authorization:'Bearer isolated-user','Content-Type':'application/json'},body:JSON.stringify({module:'worktodo',id,intent:'preview'})});return response.json()},id);
   const native=await page.request.get(signed.url);assert.equal(native.status(),200);assert.match(native.headers()['content-disposition'],/^inline/);assert.match(await native.text(),/^%PDF/);
   await db.exec("update attachment_lifecycle.cards set completed_at=clock_timestamp()-interval '24 hours' where module='worktodo'");
   assert.equal((await page.request.get(signed.url)).status(),404,'already minted preview cap rechecks 24h boundary');
   const download=await page.evaluate(async id=>{const r=await fetch('/functions/v1/attachment-lifecycle',{method:'POST',headers:{Authorization:'Bearer isolated-user','Content-Type':'application/json'},body:JSON.stringify({module:'worktodo',id,intent:'download'})});return r.json()},id);
   const bytes=await page.request.get(download.url+'&inline=1');assert.equal(bytes.status(),200);assert.match(bytes.headers()['content-disposition'],/^attachment/);
   await db.exec("update attachment_lifecycle.cards set completed_at=clock_timestamp()-interval '72 hours' where module='worktodo'");
   assert.equal((await page.request.get(download.url)).status(),404,'already minted download cap rechecks 72h boundary');
   await db.exec("update attachment_lifecycle.cards set completed_at=clock_timestamp() where module='worktodo'");
   page.once('dialog',dialog=>dialog.dismiss());await page.getByRole('button',{name:'永久刪除'}).click();assert.equal(objects.size,1,'cancel never deletes');
   await context.close();
  }
  const context=await browser.newContext();await context.addInitScript(()=>localStorage.setItem('zhuge_ai_os_google_auth_session_v1',JSON.stringify({access_token:'isolated-user'})));const page=await context.newPage();await page.goto(origin+'/labs/attachments/');await page.locator('#items tr').waitFor();page.once('dialog',dialog=>dialog.accept());await page.getByRole('button',{name:'永久刪除'}).click();await page.waitForFunction(()=>document.querySelector('#items').children.length===0);assert.equal(objects.size,0);assert.equal((await db.query('select count(*)::int n from board_task_attachments')).rows[0].n,1);assert.equal((await db.query("select state from attachment_lifecycle.objects")).rows[0].state,'deleted');await context.close();
 }finally{await browser.close();await new Promise(resolve=>server.close(resolve));await db.close()}
});
