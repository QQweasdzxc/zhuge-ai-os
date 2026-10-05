const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const {resolveBrowserExecutable}=require('./browser-executable');
const {provisioningDb,board}=require('./fixtures/c-consumer-provisioning-db');
const {fn,read}=require('./fixtures/module-c-workspace-lifecycle-sql');
const ROOT=path.resolve(__dirname,'..');
function motherPage(){
 const original=fs.readFileSync(path.join(ROOT,'app/Board/template-preview/index.html'),'utf8');
 const auth=fs.readFileSync(path.join(__dirname,'ai-board-batch-2-browser.html'),'utf8');
 const authSeam=auth.slice(auth.indexOf('  let session = null;'),auth.indexOf('  const mockWorkspaces = ['));
 // Actual Mother markup, shared renderers and Runtime. Only authentication and
 // transport are isolated; provisioning executes the reviewed SQL in PGlite.
 const scripts=['config/version.js','components/zhuge-navigation.js','components/zhuge-shell.js','components/task-card.js','components/task-drawer.js','components/task-board.js','components/golden-master.js','components/activity-classifier.js','board/board-read-service.js','components/task-action-contract.js','components/task-action-adapters.js','board/workspace-ordering-authority.js'];
 const seam=`<script>${authSeam}
 window.ZhugeTemplateAdoptionRuntime={isCreator:false};
 const transport=async(kind,payload)=>{const r=await fetch('/qa/'+kind,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});const result=await r.json();if(!r.ok)throw Error(result.error);return result;};
 const gateway={select:(table,query)=>transport('select',{table,query}),rpc:(name,args)=>transport('rpc',{name,args})};
 window.ZhugeSupabaseGateway={createDataGateway:()=>gateway};
 const real=window.ZhugeBoardReadService;
 window.ZhugeBoardReadService={...real,createInstanceService:options=>{const service=real.createInstanceService({...options,boardInstanceId:options.boardInstanceId||${JSON.stringify(board)},gateway,completionArchiveLifecycle:false});return {...service,getAuthorityConformance:async()=>null};}};
 ZhugeSharedShell.mountHeader(document.querySelector('[data-zhuge-shared-header]'),{title:'C 唯一看板母版',description:'Operational Motherboard',identity:{displayName:'QA owner'},actionMarkup:ZhugeGoldenMaster.renderHeaderActions({applicationScope:'c'})});
 </script>`;
 return original.slice(0,original.indexOf('<script src='))+scripts.map(s=>`<script src="/shared/${s}"></script>`).join('\n')+seam+'<script src="/shared/components/golden-master-runtime.js"></script></body></html>';
}
test('Create Board Golden Journey: real Mother clicks → canonical SQL → shared navigation → persisted Consumer',async t=>{
 const db=await provisioningDb();
 await db.exec(fn(read('docs/supabase/20260910_c_workflow_capability_v2.sql'),'public.board_c_workflow_get'));
 const calls=[];
 const tables=new Set(['board_instances','board_workspaces','board_tasks','board_workflow_definitions','board_workflow_steps','board_workflow_transitions','board_workflow_gates','board_workflow_evidence_requirements','board_workflow_state','engineering_activity_log']);
 const server=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://localhost');
   if(url.pathname.startsWith('/qa/')){
    let raw='';for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw);let result;
    if(url.pathname==='/qa/select'){
     assert.ok(tables.has(input.table),'QA table allowlist');
     const query=new URLSearchParams(input.query);const values=[];const where=[];
     for(const [key,value] of query){if(['select','order','limit'].includes(key))continue;assert.match(key,/^[a-z_]+$/);
      if(value==='is.null')where.push(`${key} is null`);
      else if(value.startsWith('eq.')){values.push(value.slice(3)==='true'?true:value.slice(3)==='false'?false:value.slice(3));where.push(`${key}=$${values.length}`);}
      else if(value.startsWith('in.(')){values.push(value.slice(4,-1).split(','));where.push(`${key}=any($${values.length})`);}
      else throw Error('Unsupported isolated filter '+value);
     }
     // Fixture schema intentionally contains only this journey's columns. All
     // rows/filters come from SQL; no RPC responses or Board rows are mocked.
     result=(await db.query(`select * from ${input.table}${where.length?' where '+where.join(' and '):''}`,values)).rows;
     const order=query.get('order')?.split(',')[0]?.split('.')[0];if(order)result.sort((a,b)=>String(a[order]??'').localeCompare(String(b[order]??''),undefined,{numeric:true}));
    }else{
     assert.ok(['board_provision_c_consumer_v2','board_c_workflow_get'].includes(input.name),'QA RPC allowlist');
     const args=input.args||{};const keys=Object.keys(args);keys.forEach(k=>assert.match(k,/^p_[a-z_]+$/));
     result=(await db.query(`select public.${input.name}(${keys.map((k,i)=>`${k} => $${i+1}`).join(',')}) result`,keys.map(k=>typeof args[k]==='object'&&args[k]!==null?JSON.stringify(args[k]):args[k]))).rows[0].result;
     calls.push({name:input.name,args,result});
    }
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
   }
   if(url.pathname.endsWith('/template-preview/')||url.pathname.endsWith('/template-preview/index.html')){res.setHeader('Content-Type','text/html');res.end(motherPage());return;}
   if(url.pathname==='/favicon.ico'){res.statusCode=204;res.end();return;}
   assert.ok(url.pathname.startsWith('/shared/'),'Only shared static assets are exposed');
   const file=path.resolve(ROOT,'.'+url.pathname);assert.ok(file.startsWith(path.join(ROOT,'shared')+path.sep));
   res.setHeader('Content-Type',file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':'application/octet-stream');res.end(fs.readFileSync(file));
  }catch(error){res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({error:error.message}));}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 const browser=await chromium.launch({headless:true,executablePath:resolveBrowserExecutable()||chromium.executablePath(),args:['--no-sandbox']});
 t.after(async()=>{await browser.close();await new Promise(resolve=>server.close(resolve));await db.close();});
 for(const [project,prefix] of [['','QANONE'],['worklog','QAWLOG'],['investment','QAINVT']]){
  await t.test(project||'unassigned',async()=>{
   const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(10000);t.after(()=>page.close());const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
   page.on('dialog',dialog=>dialog.accept());
   await page.goto(origin+'/app/Board/template-preview/');
   const create=page.locator('[data-board-create-consumer]');await create.waitFor();
   for(const selector of ['[data-board-create-consumer]','[data-board-create-workspace]','[data-board-create-card]']){
    const button=page.locator(selector);assert.equal(await button.evaluate(n=>getComputedStyle(n).cursor),'pointer');
    await button.hover();await page.waitForTimeout(160);assert.notEqual(await button.evaluate(n=>getComputedStyle(n).filter),'none');
    await button.focus();assert.notEqual(await button.evaluate(n=>getComputedStyle(n).outlineStyle),'none');
   }
   await create.evaluate(n=>n.disabled=true);assert.equal(await create.evaluate(n=>getComputedStyle(n).cursor),'not-allowed');assert.ok(Number(await create.evaluate(n=>getComputedStyle(n).opacity))<1);await create.evaluate(n=>n.disabled=false);
   await create.click();await page.locator('#consumerCreateModal').waitFor({state:'visible'});
   await page.click('[data-consumer-create]');assert.match(await page.locator('#consumerCreateStatus').innerText(),/名稱/);
   await page.selectOption('#consumerBoardProject',project);await page.fill('#consumerBoardName','Golden '+prefix);
   await page.fill('#consumerBoardPrefix','!');await page.click('[data-consumer-create]');assert.match(await page.locator('#consumerCreateStatus').innerText(),/代號/);
   if(project==='worklog'){
    const before=(await db.query('select count(*) count from board_instances')).rows[0].count;
    await page.fill('#consumerBoardPrefix','QANONE');await page.click('[data-consumer-create]');await page.waitForFunction(()=>document.querySelector('#consumerCreateStatus')?.dataset.state==='error');
    assert.match(await page.locator('#consumerCreateStatus').innerText(),/建立看板失敗/);assert.equal(await page.locator('[data-consumer-create]').isEnabled(),true);
    assert.equal((await db.query('select count(*) count from board_instances')).rows[0].count,before,'failed user submit leaves no partial Board');
   }
   await page.fill('#consumerBoardPrefix',prefix);
   await page.click('[data-consumer-create]');await page.waitForFunction(()=>document.querySelector('#consumerCreateStatus')?.dataset.state==='success');
   const call=calls.filter(c=>c.name==='board_provision_c_consumer_v2').at(-1);const id=call.result.board_instance.id;
   assert.equal(call.args.p_application_scope,null);assert.equal(call.args.p_project_assignment,project||null);
   const replay=(await db.query('select board_provision_c_consumer_v2($1,$2,$3,$4,$5,$6,$7,$8) result',Object.values(call.args))).rows[0].result;
   assert.equal(replay.board_instance.id,id,'retry preserves canonical identity');
   const rows=(await db.query('select * from board_workspaces where board_instance_id=$1',[id])).rows;
   assert.equal(rows.length,4);assert.ok(rows.every(w=>w.active&&w.application_scope===null));
   const published=(await db.query("select * from board_workflow_definitions where board_instance_id=$1 and status='published'",[id])).rows;assert.equal(published.length,1);
   const steps=(await db.query('select * from board_workflow_steps where workflow_version_id=$1',[published[0].id])).rows;assert.equal(steps.length,4);assert.equal(new Set(steps.map(s=>s.workspace_id)).size,4);
   assert.equal((await db.query('select * from board_workflow_transitions where workflow_version_id=$1',[published[0].id])).rows.length,0);
   const adoption=(await db.query("select consumer_adoptions from module_releases where module_id='c'")).rows[0].consumer_adoptions;assert.ok(JSON.stringify(adoption).includes(id));
   const nav=page.locator(`[data-zhuge-shared-navigation] a[href*="${id}"]`);await nav.waitFor();assert.match(await page.locator('[data-zhuge-shared-navigation]').innerText(),/套用的看板/);
   await page.locator("#consumerCreateModal [data-consumer-create-close]").first().click();
   await nav.click();await page.waitForURL('**/*boardInstanceId='+id);await page.locator('[data-workspace-id]').first().waitFor();assert.equal(await page.locator('[data-workspace-id]').count(),4);
   await page.reload();await page.locator('[data-workspace-id]').first().waitFor();assert.equal(await page.locator('[data-workspace-id]').count(),4);
   assert.deepEqual(errors,[]);await page.close();
  });
 }
});
