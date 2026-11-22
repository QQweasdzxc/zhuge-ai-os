'use strict';
const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),assert=require('node:assert/strict');
const root=process.env.ERP_BROWSER_ROOT||path.resolve(__dirname,'..');
const out=process.env.ERP_BROWSER_OUTPUT||fs.mkdtempSync(require('os').tmpdir()+'/erp-ux4-');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'/usr/bin/google-chrome',args:['--no-sandbox']});
 try{for(const width of [320,390,820,1440]){
  const page=await browser.newPage({viewport:{width,height:850}});let networkWrites=0;const errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',async route=>{
   if(route.request().method()!=='GET'){networkWrites++;return route.abort();}
   const relative=new URL(route.request().url()).pathname;
   let file=path.join(root,relative.endsWith('/')?relative+'index.html':relative);
   if(process.env.ERP_MINIFIED_DIR&&relative.endsWith('.js')){const built=path.join(process.env.ERP_MINIFIED_DIR,relative);if(fs.existsSync(built))file=built;}
   if(!fs.existsSync(file)||!fs.statSync(file).isFile())return route.fulfill({body:''});
   if(/\.(svg|png|jpg|jpeg|woff2?)$/.test(file))return route.fulfill({path:file});let body=fs.readFileSync(file,'utf8');
   if(file.endsWith('erp-auth.js'))body='window.uxIdentity={email:"fixture@example.invalid",access_token:"isolated-fixture",expires_at:4102444800};window.uxAuthStatus="ready";window.ErpAuth={state:()=>({status:uxAuthStatus,error:"isolated auth error",identity:uxIdentity}),ready:Promise.resolve(true)};';
   if(file.endsWith('erp-data.js'))body=body.replace(/const DATA_BACKEND\s*=\s*"sheets"/,'const DATA_BACKEND="mock"').replace(/isMock:\s*DATA_BACKEND\s*===\s*"mock"/,'isMock:false')+';window.uxSync={pending:0,unsynced:0,lastSync:"2026-11-22T01:00:00Z"};ZgErpData.store.syncStatus=()=>uxSync;ZgErpData.store.init=async()=>{};ZgErpData.store.seatReady=true;ZgErpData.store.seatRows=[];ZgErpData.store.loadSeatMap=async()=>[];';
   if(file.endsWith('erp-app.js')){const task=(body.match(/if\(([\w$]+)\?\.uncertain&&!\1\.verifiedResult&&/)||[])[1];assert(task,'inbound task binding in source or compiled artifact');body=body.replace(/\}\)\(\);\s*$/,';window.uxAudit={S,render,refreshSyncBadge,refreshVersionBadge,seatUI,setInboundTask:value=>'+task+'=value};})();');}
   return route.fulfill({body,contentType:file.endsWith('.js')?'application/javascript':file.endsWith('.css')?'text/css':file.endsWith('.json')?'application/json':'text/html'});
  });
  await page.goto('https://fixture.invalid/ZG-ERP/');await page.waitForFunction(()=>window.uxAudit);
  await page.evaluate(()=>{
   const st=ZgErpData.store,d=st.state();d.sites=[{name:'台北重北',zones:['10F']}];d.sessions=[];d.records=[];const map={schema:1,width:300,height:180,seats:[{number:26,ref:'A1',x:30,y:30,w:80,h:80},{number:27,ref:'B1',x:150,y:30,w:80,h:80}],cells:[{ref:'A1',x:30,y:30,w:80,h:80,text:'26',fill:'#e5f4ef',ink:'#111111',fontSize:18,border:{}},{ref:'B1',x:150,y:30,w:80,h:80,text:'27',fill:'#e5f4ef',ink:'#111111',fontSize:18,border:{}}]};st.seatRows=d.seatRows=[['p','part','UX-MAP','台北重北','10F','','',JSON.stringify({text:JSON.stringify(map)}),'',''],['m','map','UX-MAP','台北重北','10F','','',JSON.stringify({parts:['p']}),'','']];
   d.assets.forEach(a=>{a.site='台北重北';a.zone='10F';});
   Object.assign(uxAudit.S,{booting:false,mode:'phone',screen:'start',site:'台北重北',zone:'10F',scanCity:'台北',sharedMessage:'',setupRestored:false,statusDetailsOpen:false});
   uxAudit.render();uxAudit.refreshSyncBadge();
   const mark=document.createElement('div');mark.textContent='237 候選 · 隔離資料，非正式保存';mark.className='ux-fixture-label';mark.style.cssText='position:fixed;top:0;left:0;right:0;z-index:9999;text-align:center;font:12px sans-serif;background:#fff1b0;color:#111;padding:4px';document.body.append(mark);
  });
  assert.match(await page.locator('#erp-status-summary').innerText(),/已登入.*資料讀取/);
  assert.equal(await page.locator('#erp-status-details').getAttribute('open'),null);
  assert.equal(await page.locator('#erp-sync-badge').isVisible(),false);
  const primary=page.locator('.screen>[data-a=goal-seat]');
  assert.equal(await primary.isVisible(),true);const box=await primary.boundingBox();assert(box.y+box.height<650,'primary position action above fold');
  assert(await primary.evaluate(e=>!!(e.compareDocumentPosition(document.querySelector('.goal-setup'))&Node.DOCUMENT_POSITION_FOLLOWING)));
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow');
  await page.screenshot({path:out+'/mobile-start-'+width+'.png',fullPage:true});
  await page.locator('#erp-status-details>summary').click();await page.waitForFunction(()=>uxAudit.S.statusDetailsOpen===true);
  assert.equal(await page.locator('#erp-version-badge').isVisible(),true);
  assert.equal(await page.locator('[data-a=shared-refresh]').isVisible(),true);
  await page.evaluate(()=>uxAudit.render());assert.equal(await page.locator('#erp-status-details').evaluate(e=>e.open),true);
  await page.screenshot({path:out+'/details-'+width+'.png',fullPage:true});
  await page.locator('#erp-status-details>summary').click();
  for(const [key,status,copy]of[['pending',{pending:2,unsynced:0},/同步中.*2/],['uncertain',{pending:0,unsynced:1},/保存結果待查.*不要重送/]]){
   await page.evaluate(status=>{Object.assign(uxSync,status);uxAudit.refreshSyncBadge();},status);
   assert.equal(await page.locator('#erp-status-details').evaluate(e=>e.open),false);assert.match(await page.locator('#erp-sync-badge').innerText(),copy);await page.locator('#erp-status-details>summary').click();assert.equal(await page.locator('#erp-sync-badge').isVisible(),true);assert(await page.locator('#erp-sync-badge').evaluate(e=>e.getBoundingClientRect().top>=document.querySelector('.erp-statusbar').getBoundingClientRect().bottom));await page.locator('#erp-status-details>summary').click();
   await page.screenshot({path:out+'/'+key+'-'+width+'.png',fullPage:true});
  }
  await page.evaluate(()=>{uxAudit.setInboundTask({uncertain:true,verifiedResult:false});uxAudit.refreshSyncBadge();});assert.match(await page.locator('#erp-sync-badge').innerText(),/入庫保存結果待查/);
  await page.evaluate(()=>{uxAudit.setInboundTask(null);Object.assign(uxSync,{pending:0,unsynced:0});uxAudit.S.newerVersion=true;uxAudit.S.manifest={build:'isolated-new-build'};uxAudit.refreshSyncBadge();});
  assert.equal(await page.locator('#erp-update-badge').isVisible(),true);assert.match(await page.locator('#erp-update-badge').innerText(),/已有新版本/);
  await page.evaluate(()=>{uxIdentity.expires_at=1;uxAudit.render();uxAudit.refreshSyncBadge();});
  assert.match(await page.locator('#erp-status-summary').innerText(),/工作階段已過期/);assert.equal(await page.locator('[role=alert]').getByText('重新登入 TRQN').isVisible(),true);
  await page.screenshot({path:out+'/expired-update-'+width+'.png',fullPage:true});
  await page.evaluate(()=>{uxIdentity.expires_at=4102444800;uxAuthStatus='error';uxAudit.render();uxAudit.refreshSyncBadge();});assert.match(await page.locator('body').innerText(),/isolated auth error/);
  await page.evaluate(()=>{uxAuthStatus='ready';uxAudit.S.newerVersion=false;uxAudit.S.sharedMessage='隔離測試：共同資料讀取失敗，尚未更新';uxAudit.S.scanSetupErr='隔離測試：請確認目前設定';uxAudit.render();uxAudit.refreshSyncBadge();});
  assert.equal(await page.locator('.erp-shared-message').isVisible(),true);assert.match(await page.locator('.screen').innerText(),/請確認目前設定/);
  assert(await page.locator('.screen .warn').first().evaluate(e=>!!(e.compareDocumentPosition(document.querySelector('.screen>[data-a=goal-seat]'))&Node.DOCUMENT_POSITION_FOLLOWING)));
  await page.evaluate(()=>{uxAudit.S.sharedMessage='';uxAudit.S.scanSetupErr='';uxAudit.render();});
  await page.locator('.screen>[data-a=goal-seat]').click();assert.equal(await page.locator('.location-steps').isVisible(),true);assert.equal(await page.locator('.location-steps [aria-current=step]').count(),1);
  assert.equal(await page.evaluate(()=>ZgErpData.store.state().sessions.length),0,'choosing position does not start a round');
  await page.screenshot({path:out+'/location-'+width+'.png',fullPage:true});
  await page.evaluate(()=>{Object.assign(uxAudit.S,{mode:'pc',dtab:'dash',workspaceMore:false});uxAudit.render();});
  if(width>700){
   assert.equal(await page.locator('.workspace-nav').isVisible(),false);assert.equal(await page.locator('.dside').isVisible(),true);
   for(const key of ['dash','geo','assets','inbound','zones','map','diff','legacy'])assert.equal(await page.locator('.dside [data-a=dtab][data-v='+key+']').isVisible(),true);
   assert.equal(await page.locator('#erp-draft-card').count(),1);
   await page.locator('.dside [data-v=assets]').click();assert.equal(await page.locator('.dside [aria-current=page]').getAttribute('data-v'),'assets');
   await page.locator('.dside [data-v=dash]').click();
   await page.screenshot({path:out+'/desktop-overview-'+width+'.png',fullPage:true});
   await page.locator('.dside [data-a=workspace-scan]').click();assert.equal(await page.locator('.screen>[data-a=goal-seat]').isVisible(),true);assert.equal(await page.locator('.workspace-nav').isVisible(),true);
  }else{assert.equal(await page.locator('.workspace-nav').isVisible(),true);await page.locator('[data-a=workspace-more]').first().click();assert.equal(await page.locator('[data-a=workspace-manage]').count(),7);assert.equal(await page.locator('#erp-draft-card').count(),1);}
  await page.evaluate(()=>document.documentElement.dataset.theme='dark');
  await page.screenshot({path:out+'/dark-'+width+'.png',fullPage:true});
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow at end');assert.equal(networkWrites,0);assert.deepEqual(errors,[]);
  fs.writeFileSync(out+'/audit-'+width+'.json',JSON.stringify({width,networkWrites,errors,states:['normal','details','pending','uncertain','inbound-unknown','new-version','expired-auth','auth-error','shared-read-error','setup-warning','location-no-write','desktop-navigation','mobile-navigation','dark']},null,2));
  console.log('UX4',width,'PASS, 14 states, no network writes');await page.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
