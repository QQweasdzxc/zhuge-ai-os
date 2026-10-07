const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const http=require('node:http');
const {chromium}=require('playwright');
const {resolveBrowserExecutable}=require('./browser-executable');
const {lifecycleDb,identitySnapshot,board}=require('./fixtures/module-c-board-lifecycle-sql');
const {fn,read}=require('./fixtures/module-c-workspace-lifecycle-sql');
const ROOT=path.resolve(__dirname,'..');
function motherPage(){
 const original=fs.readFileSync(path.join(ROOT,'app/Board/template-preview/index.html'),'utf8');
 const auth=fs.readFileSync(path.join(__dirname,'ai-board-batch-2-browser.html'),'utf8');
 const authSeam=auth.slice(auth.indexOf('  let session = null;'),auth.indexOf('  const mockWorkspaces = ['));
 // Actual Mother markup, shared renderers and Runtime. Only authentication and
 // transport are isolated; provisioning executes the reviewed SQL in PGlite.
 const scripts=['config/version.js','components/zhuge-navigation.js','components/zhuge-shell.js','components/task-card.js','components/task-drawer.js','components/task-board.js','components/golden-master.js','components/c-template-preview.js','components/template-management-center.js','components/activity-classifier.js','board/board-read-service.js','components/task-action-contract.js','components/task-action-adapters.js','board/workspace-ordering-authority.js'];
 const seam=`<script>${authSeam}
 window.ZhugeTemplateAdoptionRuntime={isCreator:true,service:{isTemplateEnabled:()=>true}};
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
 const db=await lifecycleDb();
 await db.exec(fn(read('docs/supabase/20260910_c_workflow_capability_v2.sql'),'public.board_c_workflow_get'));
 const calls=[];
 const tables=new Set(['board_instances','board_workspaces','board_tasks','board_workflow_definitions','board_workflow_steps','board_workflow_transitions','board_workflow_gates','board_workflow_evidence_requirements','board_workflow_state','engineering_activity_log','module_releases']);
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
     assert.ok(['board_provision_c_consumer_v2','board_c_workflow_get','board_instance_archive','board_instance_restore','board_instance_list_archived'].includes(input.name),'QA RPC allowlist');
     const args=input.args||{};const keys=Object.keys(args);keys.forEach(k=>assert.match(k,/^p_[a-z_]+$/));
     result=(await db.query(`select public.${input.name}(${keys.map((k,i)=>`${k} => $${i+1}`).join(',')}) result`,keys.map(k=>typeof args[k]==='object'&&args[k]!==null?JSON.stringify(args[k]):args[k]))).rows[0].result;
     calls.push({name:input.name,args,result});
    }
    res.setHeader('Content-Type','application/json');res.end(JSON.stringify(result));return;
   }
   if(url.pathname==='/modules/worklog/'||url.pathname==='/modules/worklog/index.html'){
    res.setHeader('Content-Type','text/html');
    const page=motherPage().replace('<script src="/shared/components/golden-master-runtime.js"></script>','');
    res.end(page.replace('</body>',`<section id="qaManagement"></section><script>
    window.ZhugeTemplateAdoptionPolicy={TEMPLATES:{board:{id:'board',code:'C',label:'看板',description:'Shared'}},PAGE_REGISTRY:{}};
    window.ZhugeTemplateAdoptionRuntime.policy={status:'resolved'};
    window.ZhugeModulePublishService={read:async()=>{const [r]=await transport('select',{table:'module_releases',query:'?'});return {publishedVersion:r.published_version,publishedBuild:r.published_build,consumers:r.consumer_adoptions};},hasPendingDevelopment:()=>false};
    const paint=()=>{const host=document.getElementById('qaManagement');host.innerHTML=ZhugeTemplateManagementCenter.render();ZhugeTemplateManagementCenter.bind(host,{onUpdated:paint});};paint();
    </script></body>`));return;
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
   const consumerName=({worklog:'晨光協作',investment:'遠山研究'})[project]||'雲間記事';
   const page=await browser.newPage({viewport:{width:1280,height:900}});page.setDefaultTimeout(10000);t.after(()=>page.close());const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
   page.on('dialog',dialog=>dialog.accept());
   await page.goto(origin+'/app/Board/template-preview/');
   const create=page.locator('[data-board-create-consumer]');await create.waitFor();
   await page.locator('[data-c-operational-motherboard]').waitFor({state:'visible'});
   assert.equal(await page.locator('[data-module-publish]').isVisible(),true,'Mother keeps full Publish Pipeline');
   assert.equal(await page.locator('[data-board-nav="board"]').innerText(),'📋 C 母版看板');
   assert.equal(await page.locator('[data-board-nav="board"]').getAttribute('aria-label'),'C 母版看板');
   for(const selector of ['[data-board-create-consumer]','[data-board-create-workspace]','[data-board-create-card]']){
    const button=page.locator(selector);assert.equal(await button.evaluate(n=>getComputedStyle(n).cursor),'pointer');
    await button.hover();await page.waitForTimeout(160);assert.notEqual(await button.evaluate(n=>getComputedStyle(n).filter),'none');
    await button.focus();assert.notEqual(await button.evaluate(n=>getComputedStyle(n).outlineStyle),'none');
   }
   await create.evaluate(n=>n.disabled=true);assert.equal(await create.evaluate(n=>getComputedStyle(n).cursor),'not-allowed');assert.ok(Number(await create.evaluate(n=>getComputedStyle(n).opacity))<1);await create.evaluate(n=>n.disabled=false);
   await create.click();await page.locator('#consumerCreateModal').waitFor({state:'visible'});
   await page.click('[data-consumer-create]');assert.match(await page.locator('#consumerCreateStatus').innerText(),/名稱/);
   await page.selectOption('#consumerBoardProject',project);await page.fill('#consumerBoardName',consumerName);
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
   const qaTask=(await db.query("insert into board_tasks(board_instance_id,workspace_id,work_code,title,status) values($1,$2,$3,'任意 Consumer 工作卡','not_started') returning id",[id,rows.find(w=>w.workspace_key==='todo').id,prefix+'-001'])).rows[0];
   const adoption=(await db.query("select consumer_adoptions from module_releases where module_id='c'")).rows[0].consumer_adoptions;assert.ok(JSON.stringify(adoption).includes(id));
   const nav=page.locator(`[data-zhuge-shared-navigation] a[href*="${id}"]`);
   const assertNavigationPlacement=async()=>{
    await nav.waitFor({state:'visible'});
    assert.equal(await nav.count(),1,'Consumer has exactly one Navigation entry');
    assert.equal(await nav.locator('.side-item-label').innerText(),consumerName,'primary label is Board name only');
    const placement=await nav.evaluate(node=>{
     const section=node.closest('[data-nav-group]');
     let parent=node.previousElementSibling;
     while(parent&&parent.classList.contains('side-item-child'))parent=parent.previousElementSibling;
     return {group:section.dataset.navGroup,child:node.classList.contains('side-item-child'),parent:parent?.dataset.sharedNavItem||''};
    });
    if(project){
     if(project==='worklog') assert.deepEqual(placement,{group:'camp',child:true,parent:'worklog'});
     else assert.deepEqual(placement,{group:'investment-consumers',child:true,parent:''});
     assert.equal(await page.locator(`[data-nav-group="consumer-boards"] a[href*="${id}"]`).count(),0,'assigned Consumer is not duplicated in applied boards');
    }else{
     assert.equal(placement.group,'consumer-boards');
     assert.equal(placement.child,false);
     assert.match(await page.locator('[data-nav-group="consumer-boards"]').innerText(),/套用的看板/);
    }
   };
   await assertNavigationPlacement();
   if(project==='investment'){
    await page.evaluate(()=>{window.ZhugeTemplateAdoptionRuntime.isCreator=false;window.ZhugeSharedNavigation.refresh();});
    await nav.waitFor({state:'detached'});
    assert.equal(await page.locator('[data-nav-group="investment-consumers"] a').count(),0,'hidden Investment assignment has no floating child');
    await page.evaluate(()=>{window.ZhugeTemplateAdoptionRuntime.isCreator=true;window.ZhugeSharedNavigation.refresh();});
    await assertNavigationPlacement();
   }
   await page.locator("#consumerCreateModal [data-consumer-create-close]").first().click();
   await nav.click();await page.waitForURL('**/*boardInstanceId='+id);await page.locator('[data-workspace-id]').first().waitFor();assert.equal(await page.locator('[data-workspace-id]').count(),4);
   await page.reload();await page.locator('[data-workspace-id]').first().waitFor();assert.equal(await page.locator('[data-workspace-id]').count(),4);
   await assertNavigationPlacement();
   assert.equal(await page.locator('[data-c-operational-motherboard]:visible').count(),0,'Generic Consumer never exposes the full Mother governance panel');
   assert.equal(await page.locator('#canonicalCTemplatePreview').isVisible(),false);
   assert.equal(await page.locator('[data-board-nav="board"]').innerText(),'📋 看板');
   assert.equal(await page.locator('[data-board-nav="board"]').getAttribute('title'),'看板');
   assert.equal(await page.locator('[data-board-nav="board"]').getAttribute('aria-label'),'看板');
   assert.equal(await page.locator('[data-board-create-card]').isVisible(),true);
   assert.equal(await page.locator('[data-board-create-workspace]').isVisible(),true);
   const card=page.locator(`[data-task-id="${qaTask.id}"]`);await card.waitFor({state:'visible'});await card.click();
   await page.locator('[data-shared-task-drawer-panel]').waitFor({state:'visible'});
   await page.locator('[data-shared-task-drawer-close]').last().click();
   const workflow=page.locator('[data-board-nav="workflow-settings"]');await workflow.waitFor({state:'visible'});await workflow.click();
   await page.locator('[data-workflow-studio-canvas]').waitFor({state:'visible'});
   await page.locator('[data-workflow-close]').click();
   await page.setViewportSize({width:390,height:844});
   assert.equal(await page.locator('[data-c-operational-motherboard]:visible').count(),0,'Mobile Consumer keeps governance hidden');
   assert.equal(await page.locator('[data-workspace-id]').count(),4);
   assert.equal(await card.isVisible(),true,'Mobile still renders Shared cards');
   const retainedBefore=await identitySnapshot(db,id);
   const originalIdentity=retainedBefore.board_instances[0];
   for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
    await page.setViewportSize(viewport);
    // Follow the existing shared Management destination and use its real component.
    await page.goto(origin+'/modules/worklog/?app=1&workspace=management');
    const active=page.locator(`[data-template-runtime-entry="consumer-${id}"]`);
    await active.waitFor({state:'visible'});await active.locator('summary').first().click();
    assert.equal(await active.locator('.template-runtime-observability-name strong').innerText(),consumerName);
    const archive=active.locator('[data-board-lifecycle="archive"]');await archive.waitFor({state:'visible'});
    const archiveCount=calls.filter(c=>c.name==='board_instance_archive').length;
    await archive.dblclick();
    await page.locator(`[data-archived-board="${id}"]`).waitFor({state:'visible'});
    await active.waitFor({state:'detached'});
    assert.equal(calls.filter(c=>c.name==='board_instance_archive').length,archiveCount+1,'double click produces one transition');
    await page.locator(`[data-shared-nav-item="consumer-board:${id}"]`).waitFor({state:'detached'});
    assert.equal(await page.locator(`[data-template-site-map] code:text-is("${id}")`).count(),0);
    const archivedPage=await browser.newPage({viewport});archivedPage.setDefaultTimeout(10000);
    await archivedPage.goto(origin+'/app/Board/template-preview/?templateView=board&boardInstanceId='+id);
    await archivedPage.getByRole('heading',{name:'此看板已封存',exact:true}).waitFor({state:'visible'});
    assert.equal(await archivedPage.locator('[data-workspace-id]').count(),0);
    assert.equal(await archivedPage.locator('[data-task-id]').count(),0);
    assert.equal((await db.query('select active from board_instances where id=$1',[id])).rows[0].active,false,'direct URL cannot restore');
    await archivedPage.close();
    const restoredCount=calls.filter(c=>c.name==='board_instance_restore').length;
    const restore=page.locator(`[data-archived-board="${id}"] [data-board-lifecycle="restore"]`);
    await restore.dblclick();await active.waitFor({state:'visible'});
    await page.locator(`[data-archived-board="${id}"]`).waitFor({state:'detached'});
    assert.equal(calls.filter(c=>c.name==='board_instance_restore').length,restoredCount+1);
    await assertNavigationPlacement();
    const reopened=await browser.newPage({viewport});reopened.setDefaultTimeout(10000);
    await reopened.goto(origin+'/app/Board/template-preview/?templateView=board&boardInstanceId='+id);
    await reopened.locator(`[data-task-id="${qaTask.id}"]`).waitFor({state:'visible'});
    assert.equal(await reopened.locator('[data-workspace-id]').count(),4);await reopened.close();
   }
   const retainedAfter=await identitySnapshot(db,id);
   const lifecycleKeys=['active','archived_at','archived_by','archive_origin','updated_at'];
   const unchanged=r=>Object.fromEntries(Object.entries(r).filter(([k])=>!lifecycleKeys.includes(k)));
   assert.deepEqual(unchanged(retainedAfter.board_instances[0]),unchanged(originalIdentity));
   for(const key of Object.keys(retainedBefore).filter(k=>k!=='board_instances'))assert.deepEqual(retainedAfter[key],retainedBefore[key],key+' retained');
   assert.deepEqual(errors,[]);await page.close();
  });
 }
});
