const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { resolveBrowserExecutable, fixtureURL, fixturePath } = require('./browser-executable');
const ROOT=path.resolve(__dirname,'..');
function fixture(scope) {
  let html=fs.readFileSync(path.join(__dirname,'ai-board-batch-2-browser.html'),'utf8');
  const end=html.indexOf('</script>',html.indexOf('src="../shared/components/golden-master-runtime.js"'))+'</script>'.length;
  html=html.slice(0,end);
  const boardId='10000000-0000-4000-8000-000000000001';
  const prefix=scope==='c'?'mdtk':scope==='worktodo'?'worktodo':scope==='procurement'?'gas':'';
  html='<meta name="viewport" content="width=device-width,initial-scale=1">'+html;
  html=html.replace('<div class="main">','<div class="app workspace-app"><div class="main"><div data-zhuge-shared-header data-title="Local QA Board" data-description="Module C 工作資訊"></div>');
  html=html.replace('<section class="board-shell">','<section class="board-shell" data-board-main-view>');
  const css=fs.readFileSync(path.join(ROOT,'app/Board/ai/index.html'),'utf8').match(/<link\b[^>]*rel="stylesheet"[^>]*>/g).join('\n').replaceAll('../../../shared/','../shared/');
  html=html.replace('<link rel="stylesheet"',css+'\n<link rel="stylesheet"');
  const start=html.indexOf('  const mockWorkspaces = [');
  const serviceEnd=html.indexOf('</script>',start);
  const script=`
  const boardId=${JSON.stringify(boardId)}, scope=${JSON.stringify(scope)}, prefix=${JSON.stringify(prefix)};
  const real=window.ZhugeBoardReadService;
  const stored=JSON.parse(sessionStorage.getItem('workspace-lifecycle-qa')||'null');
  const fixtureState=stored||{workspaces:[
    {id:'20000000-0000-4000-8000-000000000001',board_instance_id:boardId,workspace_key:prefix?prefix+'-todo':'todo',name:'待辦',sort_order:10,active:true,application_scope:scope},
    {id:'20000000-0000-4000-8000-000000000002',board_instance_id:boardId,workspace_key:prefix?prefix+'-custom-e2e':'',name:'TASK-081-E2E-20260922',sort_order:20,active:true,application_scope:scope},
    {id:'20000000-0000-4000-8000-000000000003',board_instance_id:boardId,workspace_key:prefix?prefix+'-completed':'completed',name:'完成',sort_order:30,active:true,application_scope:scope},
    {id:'20000000-0000-4000-8000-000000000004',board_instance_id:boardId,workspace_key:prefix?prefix+'-custom-empty':'',name:'空工作區',sort_order:40,active:true,application_scope:scope}
  ],tasks:[{id:'30000000-0000-4000-8000-000000000079',work_code:'TASK-079',title:'Retained history',status:'done',archived_at:scope==='worktodo'?'2026-09-22T15:07:30Z':null,workspace_id:'20000000-0000-4000-8000-000000000002',board_instance_id:boardId}],calls:[],loads:0};
  const persist=()=>sessionStorage.setItem('workspace-lifecycle-qa',JSON.stringify(fixtureState));
  const find=id=>fixtureState.workspaces.find(w=>w.id===id);
  const gateway={
    select:async(table)=>table==='board_instances'?[{id:boardId,name:'Local QA Board',active:true,template_key:'c',task_code_prefix:prefix.toUpperCase()||'TASK'}]:table==='board_workspaces'?fixtureState.workspaces:[],
    rpc:async(name,payload)=>{
      fixtureState.calls.push({name,payload});
      const w=find(payload.p_workspace_id);
      if(name==='board_instance_archive_workspace'){
        if(payload.p_board_instance_id!==boardId) throw Error('Wrong board scope');
        const counts=real.projectWorkspaceTaskCounts(fixtureState.tasks.map(real.normalizeTask),w.id);
        if(counts.current) throw Error('此工作區仍有進行中的卡片，請先處理目前工作。');
        w.active=false;w.archived_at=new Date().toISOString();persist();return {workspace:w};
      }
      if(name==='board_instance_restore_workspace'){
        if(payload.p_board_instance_id!==boardId) throw Error('Wrong board scope');
        w.active=true;w.archived_at=null;if(payload.p_name)w.name=payload.p_name;persist();return {workspace:w};
      }
      if(name==='board_instance_list_archived_workspaces')return fixtureState.workspaces.filter(w=>!w.active&&w.archived_at).map(w=>{const c=real.projectWorkspaceTaskCounts(fixtureState.tasks.map(real.normalizeTask),w.id);return {...w,counts:{current:c.current,history:c.history,retained_total:c.retained,history_codes:c.historyCodes}};}).filter(w=>w.counts.retained_total>0);
      if(name==='board_instance_delete_workspace'){w.active=false;w.archived_at=new Date().toISOString();persist();return {empty_workspace:true,moved_task_count:0};}
      return {};
    }
  };
  const instanceService=real.createInstanceService({gateway,boardInstanceId:boardId});
  const service={...instanceService,
    load:async()=>{fixtureState.loads++;persist();return {workspaces:fixtureState.workspaces.map(real.normalizeWorkspace),tasks:fixtureState.tasks.map(real.normalizeTask),principles:[],systemMaps:[],boardInstanceId:boardId,boardName:'Local QA Board',isTemplateInstance:scope==='c'};},
    workflow:null,subscribe:async()=>()=>{},getAuthorityConformance:async()=>null,
    createWorkspace:async()=>({}),createTask:async(input)=>{fixtureState.calls.push({name:'local-create-task',payload:input});const row={id:'30000000-0000-4000-8000-000000000080',work_code:'QA-CARD',title:input.title,status:'ready',workspace_id:input.workspaceId,board_instance_id:boardId};fixtureState.tasks.push(row);persist();return row;}
  };
  if(scope==='ai_board'&&!stored){
    fixtureState.workspaces.push({id:'20000000-0000-4000-8000-000000000006',board_instance_id:boardId,workspace_key:'done',name:'Legacy history',sort_order:60,active:true,application_scope:scope});
    fixtureState.tasks.push({id:'30000000-0000-4000-8000-000000000082',work_code:'QA-HISTORY',title:'Legacy history retained',status:'done',workspace_id:'20000000-0000-4000-8000-000000000006',board_instance_id:boardId});
    persist();
  }
  window.lifecycleFixture=fixtureState;
  window.ZhugeBoardReadService={...real,createInstanceService:()=>service,createWorkflowCapability:()=>null,resolveOrProvisionPersonalWorkTodo:async()=>({boardInstanceId:boardId})};
`;
  html=html.slice(0,start)+script+html.slice(serviceEnd);
  html=html.replace('<script>\n  let session', '<script src="../shared/board/board-read-service.js"></script>\n<script>\n  let session');
  html=html.replace('<script src="../shared/components/golden-master-runtime.js">','<script src="../shared/components/zhuge-shell.js"></script><script>ZhugeSharedShell.mountHeader(document.querySelector("[data-zhuge-shared-header]"),{title:"Local QA Board",description:"Module C 工作資訊",identity:{displayName:"PM",email:"pm@example.test"},showNavigationMenu:true,actionMarkup:ZhugeGoldenMaster.renderHeaderActions({applicationScope:scope})});document.querySelector(".zhuge-module-shell").dataset.sharedNavigationActive="true";if(scope==="c")document.body.dataset.templatePageId="template-c";</script><script src="../shared/components/golden-master-runtime.js">');
  return html.replaceAll('../shared/',fixturePath(path.join(ROOT,'shared'))+'/');
}
test('Mobile compact actions and Workspace archive/restore use Shared C across AI, WorkTodo, GAS and C Mother', async t=>{
  const executable=resolveBrowserExecutable()||chromium.executablePath();assert.ok(fs.existsSync(executable),'Real Chromium required');
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'zhuge-lifecycle-browser-'));
  const browser=await chromium.launch({executablePath:executable,headless:true,args:['--no-sandbox']});
  t.after(async()=>{await browser.close();fs.rmSync(dir,{recursive:true,force:true});});
  for(const scope of ['ai_board','worktodo','procurement','c']){
    const file=path.join(dir,scope+'.html');fs.writeFileSync(file,fixture(scope));const url=await fixtureURL(file);
    const query=scope==='worktodo'?'?consumer=worktodo-new':scope==='procurement'?'?consumer=worklog-procurement':scope==='c'?'?boardInstanceId=10000000-0000-4000-8000-000000000001':'';
    const page=await browser.newPage({viewport:{width:390,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.route('**/*',route=>route.request().url().startsWith(new URL(url).origin+'/')?route.continue():route.abort());
    await page.goto(url+query);
    const ws='20000000-0000-4000-8000-000000000002';
    const column=page.locator(`[data-workspace-id="${ws}"]`);await column.waitFor();
    if(scope!=='procurement'){
      if (!await page.locator('[data-board-create-menu]').count()) throw new Error(scope+' missing actions '+await page.locator('[data-zhuge-shared-header]').evaluate(n=>n.outerHTML)+' errors '+JSON.stringify(errors));
      await page.click('[data-board-create-menu]');
      for(const selector of ['[data-board-create-card]','[data-board-create-workspace]']){
        const box=await page.locator(selector).boundingBox();assert.ok(box.width>=44&&box.height>=44);
      }
      await page.click('[data-board-create-card]');assert.equal(await page.locator('#addCardModal').evaluate(n=>getComputedStyle(n).display),'grid');
      await page.fill('#taskTitle','Local menu creation');await page.click('[data-golden-master-create-card]');
      await page.waitForFunction(()=>lifecycleFixture.calls.some(c=>c.name==='local-create-task'));
      assert.equal(await page.locator('#addCardModal').getAttribute('aria-hidden'),'true');
      await page.click('[data-board-create-menu]');await page.click('[data-board-create-workspace]');
      assert.equal(await page.locator('#workspaceCreateDrawer').getAttribute('aria-hidden'),'false');
      await page.locator('#workspaceCreateDrawer [data-workspace-drawer-close]').first().click();
      await page.click('[data-board-create-menu]');await page.keyboard.press('Escape');
      assert.equal(await page.locator('[data-board-create-menu]').getAttribute('aria-expanded'),'false');
    }
    const currentColumn=page.locator('[data-workspace-id="20000000-0000-4000-8000-000000000001"]');
    if(scope!=='procurement'){
      await currentColumn.locator('[data-workspace-menu]').click();
      assert.equal(await page.locator('[data-workspace-action="archive"]').isDisabled(),true,scope+' current archive '+JSON.stringify(await page.evaluate(()=>lifecycleFixture.tasks)));
      await page.click('[data-workspace-action="delete"]');
      assert.match(await page.locator('#workspaceLifecycleBody').innerText(),/進行中的卡片/);
      assert.equal(await page.locator('[data-workspace-lifecycle-confirm]').count(),0);
      await page.locator('#workspaceLifecycleActions [data-workspace-lifecycle-close]').click();
    }
    page.once('dialog',async dialog=>{assert.match(dialog.message(),/系統保留工作區與操作紀錄/);await dialog.accept();});
    const emptyColumn=page.locator('[data-workspace-id="20000000-0000-4000-8000-000000000004"]');
    await emptyColumn.locator('[data-workspace-menu]').click();await page.click('[data-workspace-action="delete"]');
    await emptyColumn.waitFor({state:'detached'});
    assert.equal(await page.evaluate(()=>lifecycleFixture.workspaces.find(w=>w.id.endsWith('000000000004')).active),false);
    const geometry=await page.locator('.zhuge-shared-header').evaluate(n=>({height:n.getBoundingClientRect().height,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth}));
    assert.ok(geometry.height<=116,`${scope} header ${geometry.height}`);assert.equal(geometry.overflow,false);
    const loads=await page.evaluate(()=>lifecycleFixture.loads);
    await page.click('.board-header-status-menu > summary');
    assert.equal(await page.evaluate(()=>lifecycleFixture.loads),loads,'Tools status trigger is not refresh');
    await page.click('#refreshBoardBtn');await page.waitForFunction(n=>lifecycleFixture.loads>n,loads);
    await column.locator('[data-workspace-menu]').click();await page.click('[data-workspace-action="delete"]');
    await page.locator('#workspaceLifecycleDialog').waitFor({state:'visible'});
    assert.match(await page.locator('#workspaceLifecycleBody').innerText(),/沒有進行中的卡片.*1 張歷史卡（TASK-079）.*完整保留/s);
    await page.click('[data-workspace-history]');assert.equal(await page.locator('#archiveTaskList [data-work-code="TASK-079"]').count(),1);
    await page.locator('#archiveDrawer [data-archive-close]').click();
    await column.locator('[data-workspace-menu]').click();await page.click('[data-workspace-action="archive"]');
    for(const selector of ['#workspaceLifecycleDialog button','#workspaceArchiveDrawer button']){
      const controls=await page.locator(selector).all();
      for(const control of controls) if(await control.isVisible()){const box=await control.boundingBox();assert.ok(box.width>=44&&box.height>=44,selector);}
    }
    await page.click('[data-workspace-lifecycle-confirm]');await column.waitFor({state:'detached'});
    await page.reload();await page.waitForSelector('[data-workspace-header]');assert.equal(await column.count(),0);
    await page.click('.board-header-status-menu > summary');await page.click('[data-board-open-workspace-archive]');
    const row=page.locator(`[data-archived-workspace-id="${ws}"]`);await row.waitFor();assert.match(await row.innerText(),/封存時間.*歷史卡 1.*保留總數 1/s);
    assert.equal(await page.locator('#archiveDrawer').getAttribute('aria-hidden'),'true','Workspace management is separate from card history');
    await row.locator('[data-workspace-restore]').click();
    const beforeRestore=await page.evaluate(()=>lifecycleFixture.calls.filter(c=>c.name==='board_instance_restore_workspace').length);
    await page.fill('#workspaceRestoreName','');await page.click('[data-workspace-lifecycle-confirm]');
    await page.waitForFunction(()=>document.querySelector('[data-workspace-lifecycle-error]')?.textContent==='請輸入工作區名稱。');
    assert.equal(await page.evaluate(()=>lifecycleFixture.calls.filter(c=>c.name==='board_instance_restore_workspace').length),beforeRestore);
    await page.fill('#workspaceRestoreName','TASK-081-E2E-20260922');await page.click('[data-workspace-lifecycle-confirm]');await column.waitFor();
    assert.equal(await page.evaluate(()=>lifecycleFixture.tasks[0].workspace_id),ws);
    assert.equal(await page.evaluate(()=>lifecycleFixture.tasks[0].work_code),'TASK-079');
    assert.match(await column.locator('[data-workspace-count-summary]').innerText(),/目前卡 0.*歷史卡 1.*保留總數 1/s);
    await page.locator('#workspaceArchiveDrawer [data-workspace-archive-close]').click();
    if(scope==='ai_board'){
      const legacy=page.locator('[data-workspace-id="20000000-0000-4000-8000-000000000006"]');
      await legacy.locator('[data-workspace-menu]').click();
      assert.equal(await page.locator('[data-workspace-action="delete"]').isDisabled(),true,'Historical delete protection remains');
      assert.equal(await page.locator('[data-workspace-action="archive"]').isDisabled(),false,'Reversible archive must not inherit the historical hard-delete restriction');
      await page.click('[data-workspace-action="archive"]');await page.click('[data-workspace-lifecycle-confirm]');await legacy.waitFor({state:'detached'});
      assert.equal(await page.evaluate(()=>lifecycleFixture.tasks.find(t=>t.work_code==='QA-HISTORY').workspace_id),'20000000-0000-4000-8000-000000000006');
    }
    await page.setViewportSize({width:1440,height:900});
    if(scope!=='procurement'){
      assert.equal(await page.locator('[data-board-create-menu]').isVisible(),false);
      assert.equal(await page.locator('[data-board-create-card]').isVisible(),true);
      assert.equal(await page.locator('[data-board-create-workspace]').isVisible(),true);
    }
    assert.deepEqual(errors,[],scope);await page.close();
  }
});
