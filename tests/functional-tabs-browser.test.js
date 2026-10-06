const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const {chromium} = require('playwright');
const {fixtureURL,fixturePath,resolveBrowserExecutable} = require('./browser-executable');
const ROOT = path.join(__dirname,'..');
const read = file => fs.readFileSync(path.join(ROOT,file),'utf8');
const shell = require('../modules/investment/components/module-shell');
const worklog = read('modules/worklog/worklog-app.js');
const runtime = read('shared/components/golden-master-runtime.js');
const mountWorkflowTab = runtime.slice(runtime.indexOf('  function ensureWorkflowSettingsTab()'),runtime.indexOf('\n  function closeWorkflowSettings()',runtime.indexOf('  function ensureWorkflowSettingsTab()')));
function functionSource(source,name) {
 const start=source.indexOf('function '+name+'('); const end=source.indexOf('\nfunction ',start+10); return source.slice(start,end);
}
const wlContext={activeWorkspace:'worklog',openTabs:['worklog','sync','management'],workspaceDef:id=>({icon:'▦',label:({worklog:'工作紀錄',sync:'控制台',management:'管理功能'})[id]}),makeSuggestions:()=>[],mobileWorklogTab:'time'};
vm.createContext(wlContext);vm.runInContext(functionSource(worklog,'workspaceTabs')+'\n'+functionSource(worklog,'mobileWorklogTabs'),wlContext);
const cases=[
 {name:'C-Mother',entry:'app/Board/template-preview/index.html',mother:true},
 {name:'Arbitrary-Generic',entry:'app/Board/template-preview/index.html',mother:false},
 {name:'GAS',entry:'app/Board/procurement/index.html'},
 {name:'Investment-Board',entry:'app/Board/investment/index.html',investment:true,links:true,stack:true},
 {name:'Investment-Module',entry:'modules/investment/index.html',investment:true},
 {name:'AI-Board',entry:'app/Board/ai/index.html'},
 {name:'WorkTodo',entry:'app/Board/worktodo/index.html'},
 {name:'WorkLog-Management-Console',entry:'modules/worklog/index.html',worklog:true},
 {name:'Lab',entry:'labs/investment/index.html',lab:true}
];
const STYLE_FIELDS=['fontFamily','fontSize','fontWeight','lineHeight','height','minHeight','paddingTop','paddingRight','paddingBottom','paddingLeft','marginTop','marginRight','marginBottom','marginLeft','columnGap','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','borderRadius','borderColor','borderBottomColor','backgroundColor','color','textDecoration','whiteSpace','cursor'];
function styles(entry) {
 return [...new Set([...read(entry).matchAll(/["']([^"']+\.css(?:\?[^"']*)?)["']/g)].map(m=>m[1]))].filter(file=>!/^http/.test(file)).map(file=>`<link rel="stylesheet" href="${fixturePath(path.resolve(ROOT,path.dirname(entry),file.split('?')[0]))}">`).join('\n');
}
function fixture(item) {
 const header=`<div id="zhugeSharedHeader" class="zhuge-shared-header workspace-shell-header"><div class="zhuge-shared-header-main"><div class="zhuge-shared-header-copy"><h1>共用頁首</h1><p>測試頁面 Header</p></div></div><div class="zhuge-shared-header-right"><div class="zhuge-shared-identity"><span class="zhuge-shared-identity-dot is-authenticated"></span><span class="zhuge-shared-identity-copy"><strong>QA User</strong><small>signed in</small></span></div></div></div>`;
 let body;
 if(item.investment) body=`<main class="zhuge-module-shell investment-module-shell zhuge-functional-tabs-layout" ${item.stack?'data-zhuge-page-rhythm="stacked-tabs"':''}>${header}${item.stack?'<div class="zhuge-functional-tabs-stack">':''}${shell.renderPrimaryNavigation({activePage:'portfolio'},{asLinks:item.links,hrefFor:i=>'#'+i.route+(i.focus?'/'+i.focus:''),actionsMarkup:shell.renderToolNavigation({activePage:'portfolio'},{asLinks:item.links,hrefFor:i=>'#'+i.route})})}${item.stack?'</div>':''}${item.links?'<div class="workspace-canvas"><nav class="workspace-subnav zhuge-functional-tabs" aria-label="Board 次導覽"><button class="zhuge-functional-tab active" type="button">Board</button><button class="zhuge-functional-tab" type="button">流程設定</button></nav>':''}<section id="${item.links?'investmentBoardView':'investmentPage'}" ${item.links?'data-board-main-view':''} class="${item.links?'':'zhuge-functional-tabs-content'}"></section>${item.links?'</div>':''}</main>`;
 else if(item.worklog) body=`<main class="zhuge-module-shell workspace-shell workspace-worklog zhuge-functional-tabs-layout">${header}${wlContext.workspaceTabs()}<div class="workspace-canvas">${wlContext.mobileWorklogTabs()}<section id="mobile-worklog-time">工時</section><section id="mobile-worklog-suggestions">建議</section></div></main>`;
 else if(item.lab) {
  const source=read(item.entry), actualHeader=source.match(/<header class="topbar zhuge-functional-tabs-header">[\s\S]*?<\/header>/)[0], actualMobileTabs=source.match(/<nav class="mobile-nav zhuge-functional-tabs"[\s\S]*?<\/nav>/)[0], actualContent=source.match(/<section id="view-root" class="view-root zhuge-functional-tabs-content"[\s\S]*?<\/section>/)[0];
  body=`<main class="main-area zhuge-functional-tabs-layout">${actualHeader}${actualMobileTabs}${actualContent}</main>`;
 }
 else body=read(item.entry).match(/<body[^>]*>([\s\S]*?)<\/body>/)[1].replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
 const script=file=>`<script src="${fixturePath(path.join(ROOT,file))}"></script>`;
 // Actual markup/renderers + formal stylesheet order, with no business writers.
 return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles(item.entry)}<style>body{margin:0;padding:16px}main,.main,.app{max-width:100%;min-width:0}.zhuge-module-shell{display:block;padding:0}.zhuge-functional-tabs{max-width:100%}</style>${body}
 ${script('shared/components/zhuge-functional-tabs.js')}
 ${item.name==='GAS'?`<script>window.VendorSheetService={VendorSheetService:class{async list(){return [{vendorId:'qa-vendor',vendorName:'QA Vendor',businessCategory:['採購'],company:'QA'}];}async create(){throw Error('QA does not write');}async update(){throw Error('QA does not write');}}};document.querySelector('[data-procurement-panel="board"] [data-board-main-view]').textContent='Isolated Board projection';</script>`+script('app/Board/procurement/procurement-tabs.js')+script('app/Board/procurement/vendor-list.js'):''}
 <script>
 const state={boardIsTemplate:${item.mother===true},workflowCapability:{capabilities:{settings:true}}};
 document.querySelectorAll('[data-zhuge-shared-header]').forEach(node=>{node.classList.add('zhuge-shared-header');node.innerHTML=${JSON.stringify(header.slice(header.indexOf('>')+1,header.lastIndexOf('</div>')))};});
 ${mountWorkflowTab}
 ${['C-Mother','Arbitrary-Generic','GAS','AI-Board','WorkTodo','Investment-Board'].includes(item.name)?'ensureWorkflowSettingsTab();':''}
 ${item.worklog?`let mobileWorklogTab='time';let route='worklog';const activateWorkspace=id=>{route=id;document.querySelectorAll('[data-activate-workspace]').forEach(tab=>tab.classList.toggle('active',tab.dataset.activateWorkspace===id));};${worklog.match(/document.querySelectorAll\("\[data-activate-workspace\]"\)\.forEach[^\n]+/)[0]}${worklog.slice(worklog.indexOf('  document.querySelectorAll("[data-mobile-worklog-tab]").forEach'),worklog.indexOf('  document.querySelectorAll("[data-action=add]")',worklog.indexOf('  document.querySelectorAll("[data-mobile-worklog-tab]").forEach')))}window.qaRoute=()=>route;`:''}
 ${item.investment&&!item.links?`document.querySelectorAll('[data-investment-route]').forEach(button=>button.onclick=()=>{document.querySelectorAll('[data-investment-route]').forEach(tab=>tab.classList.toggle('active',tab===button));document.getElementById('investmentPage').textContent=button.dataset.investmentRoute;});`:''}
 ZhugeFunctionalTabs.refresh();document.body.dataset.ready='true';
 </script>`;
}
const GEOMETRY=['height','paddingTop','paddingRight','paddingBottom','paddingLeft','fontSize','fontWeight','lineHeight','letterSpacing','gap','borderTopLeftRadius','borderTopRightRadius'];
async function geometry(tab) {return tab.evaluate((node,keys)=>Object.fromEntries(keys.map(key=>[key,getComputedStyle(node)[key]])),GEOMETRY);}
test('Functional Tabs: actual adopter markup/renderers share Desktop/Mobile geometry, focus and overflow',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'functional-tabs-qa-'));
 const browser=await chromium.launch({executablePath:resolveBrowserExecutable()||chromium.executablePath(),headless:true,args:['--no-sandbox']});
 const evidence=process.env.FUNCTIONAL_TABS_EVIDENCE_DIR;
 if(evidence)fs.mkdirSync(evidence,{recursive:true});
 let baseline, activeStyleBaseline, inactiveStyleBaseline, liveLayoutBaseline;
 try {
  for(const item of cases) {
   const file=path.join(dir,item.name+'.html');fs.writeFileSync(file,fixture(item));
   const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(await fixtureURL(file));await page.waitForSelector('[data-ready]');
   for(const viewport of [{width:1280,height:900},{width:390,height:844},{width:320,height:740}]){
    await page.setViewportSize(viewport);
    const rows=page.locator('.zhuge-functional-tabs:visible');
    if(item.lab&&viewport.width===1280){assert.equal(await rows.count(),0,'Lab sidebar is navigation, not a desktop tab row');continue;}
    assert.ok(await rows.count()>0,item.name+' has its Functional Tabs');
    for(let r=0;r<await rows.count();r++){
     const row=rows.nth(r),tabs=row.locator(':scope > .zhuge-functional-tab');const first=tabs.first();assert.equal(await row.evaluate(n=>n.tagName),'NAV',item.name+' canonical row tag');assert.equal(await row.evaluate(n=>[...n.children].filter(child=>child.classList.contains('zhuge-functional-tab')).length),await tabs.count(),item.name+' tabs are direct row children');
     const selected=row.locator('.zhuge-functional-tab.active,.zhuge-functional-tab.is-active,.zhuge-functional-tab[aria-selected="true"],.zhuge-functional-tab[aria-current="page"]').first();
     assert.ok(await selected.count(),item.name+' '+viewport.width+' selected tab required');
     const activeStyleSnapshot=await selected.evaluate((n,fields)=>Object.fromEntries(fields.map(key=>[key,getComputedStyle(n)[key]])),STYLE_FIELDS);
     if(!activeStyleBaseline)activeStyleBaseline=activeStyleSnapshot;else assert.deepEqual(activeStyleSnapshot,activeStyleBaseline,item.name+' active style '+viewport.width);
     const inactiveTab=row.locator('.zhuge-functional-tab:not(.active):not(.is-active):not([aria-selected="true"]):not([aria-current="page"])').first();
     if(await inactiveTab.count()){
      const inactiveStyle=await inactiveTab.evaluate((n,fields)=>Object.fromEntries(fields.map(key=>[key,getComputedStyle(n)[key]])),STYLE_FIELDS);
      if(!inactiveStyleBaseline)inactiveStyleBaseline=inactiveStyle;else assert.deepEqual(inactiveStyle,inactiveStyleBaseline,item.name+' inactive style '+viewport.width);
     }
     const actual=await geometry(first);if(!baseline)baseline=actual;assert.deepEqual(actual,baseline,item.name+' '+viewport.width+' geometry');
     assert.equal(Number.parseFloat(actual.height),44);assert.equal(actual.fontSize,'14px');assert.equal(actual.gap,'7px');
     const icon=first.locator('.zhuge-functional-tab-icon');assert.equal(await icon.count(),1);assert.equal(await icon.evaluate(n=>getComputedStyle(n).width),'18px');
     assert.deepEqual(await first.evaluate(n=>{const children=Array.from(n.children).map(child=>[child.tagName,child.className]);return {slots:children.slice(0,2),controls:children.slice(2)};}),{slots:[['SPAN','zhuge-functional-tab-icon'],['SPAN','zhuge-functional-tab-label']],controls:(await first.locator('.tab-close').count())?[['SPAN','tab-close']]:[]});
     const rowStyle=await row.evaluate(n=>{const s=getComputedStyle(n);return {background:s.backgroundColor,radius:s.borderRadius,divider:s.borderBottomWidth,wrap:s.flexWrap,display:s.display,gap:s.gap};});
     assert.deepEqual(rowStyle,{background:'rgba(0, 0, 0, 0)',radius:'0px',divider:'1px',wrap:'nowrap',display:'flex',gap:'8px'});
     if(r===0){
      const layout=await row.evaluate((n,isWorklog)=>{const shell=n.closest('.zhuge-functional-tabs-layout'),header=shell?.querySelector('.zhuge-shared-header,.workspace-shell-header,.zhuge-functional-tabs-header'),rect=x=>x?.getBoundingClientRect();const visible=x=>x.getClientRects().length&&!x.closest('.zhuge-functional-tabs-mobile-disclosure');const rows=[...shell.querySelectorAll('.zhuge-functional-tabs')].filter(visible);const firstRow=rows[0],stack=firstRow?.parentElement.classList.contains('zhuge-functional-tabs-stack')?firstRow.parentElement:null;const stackRows=stack?[...stack.querySelectorAll(':scope > .zhuge-functional-tabs')].filter(visible):[];const lastRow=stackRows.at(-1)||rows.at(-1),firstRect=rect(firstRow),headerRect=rect(header),lastRect=rect(lastRow);const content=stack?.nextElementSibling||lastRow?.nextElementSibling;const contentRect=rect(content);let stackGap=stack&&stackRows.length>1?rect(stackRows[1]).top-firstRect.bottom:null;if(isWorklog&&window.innerWidth<=767){const secondary=shell.querySelector('.zhuge-functional-tabs[data-functional-tabs-mobile-only]');if(secondary)stackGap=rect(secondary).top-firstRect.bottom;}return {headerToTabs:firstRect.top-headerRect.bottom,firstRowHeight:firstRect.height,lastRowToContent:contentRect.top-lastRect.bottom,stackGap};},item.worklog===true);
      assert.equal(layout.headerToTabs,12,item.name+' header-to-tabs exact');assert.equal(layout.firstRowHeight,45,item.name+' row exact height');assert.equal(layout.lastRowToContent,16,item.name+' tabs-to-content exact');
      if(layout.stackGap!==null)assert.equal(layout.stackGap,8,item.name+' secondary row stack gap exact');
      const sharedLayout={headerToTabs:layout.headerToTabs,firstRowHeight:layout.firstRowHeight,lastRowToContent:layout.lastRowToContent};
      if(!liveLayoutBaseline)liveLayoutBaseline=sharedLayout;else assert.deepEqual(sharedLayout,liveLayoutBaseline,item.name+' shared live layout '+viewport.width);
     }
     await first.focus();assert.equal(await first.evaluate(n=>getComputedStyle(n).outlineWidth),'2px');
     const inactive=tabs.nth(Math.min(1,(await tabs.count())-1));
     await page.mouse.move(0,0);await inactive.evaluate(n=>{n.classList.remove('active','is-active');n.removeAttribute('aria-current');});
     await page.waitForTimeout(10);
     assert.equal(await inactive.evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0)');
     await inactive.evaluate(n=>n.classList.add('active'));await page.waitForTimeout(10);
     const activeStyle=await inactive.evaluate(n=>{const s=getComputedStyle(n);return [s.backgroundColor,s.borderBottomColor,s.color];});
     assert.ok(activeStyle[0]!=='rgba(0, 0, 0, 0)');assert.deepEqual(await geometry(inactive),baseline);
     // Overflow uses the same authority, including future/arbitrary labels.
     await row.evaluate(n=>{n.querySelectorAll('.zhuge-functional-tab').forEach(t=>t.classList.remove('active','is-active'));for(let i=0;i<12;i++){const t=n.querySelector('.zhuge-functional-tab').cloneNode(true);t.removeAttribute('id');t.textContent='任意功能 '+i;t.classList.remove('active','is-active');n.appendChild(t);}n.querySelectorAll('.zhuge-functional-tab')[n.querySelectorAll('.zhuge-functional-tab').length-1].classList.add('active');window.ZhugeFunctionalTabs.refresh();});
     await page.waitForTimeout(20);
     assert.equal(await row.evaluate(n=>n.scrollWidth>n.clientWidth),true);
     const visibility=await row.evaluate(n=>{const t=[...n.querySelectorAll('.zhuge-functional-tab')].at(-1),a=t.getBoundingClientRect(),b=n.getBoundingClientRect();return {visible:a.left>=b.left&&a.right<=b.right,left:a.left,right:a.right,rowLeft:b.left,rowRight:b.right,scrollLeft:n.scrollLeft,scrollWidth:n.scrollWidth,clientWidth:n.clientWidth,html:n.outerHTML.slice(0,200)};});assert.equal(visibility.visible,true,item.name+' row'+r+' active tab scrolls into view with exact clipping bounds '+JSON.stringify(visibility));
     // Restore the original row before the next viewport/check.
     await row.evaluate(n=>{const tabs=[...n.querySelectorAll('.zhuge-functional-tab')];tabs.slice(-12).forEach(t=>t.remove());tabs[0].classList.add('active');});await page.waitForTimeout(10);
    }
    if(evidence)await page.screenshot({path:path.join(evidence,item.name+'-'+viewport.width+'.png'),fullPage:true});
   }
   assert.deepEqual(errors,[],item.name+' no runtime error');await page.close();
  }
 }finally{await browser.close();fs.rmSync(dir,{recursive:true,force:true});}
});
test('Functional Tabs preserve domain actions, link navigation, keyboard selection and disclosures',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'functional-tabs-actions-'));
 const browser=await chromium.launch({executablePath:resolveBrowserExecutable()||chromium.executablePath(),headless:true,args:['--no-sandbox']});
 try {
  for(const name of ['GAS','Investment-Board','Investment-Module','WorkLog-Management-Console']){
   const item=cases.find(c=>c.name===name),file=path.join(dir,name+'.html');fs.writeFileSync(file,fixture(item));
   const page=await browser.newPage({viewport:{width:390,height:844}});await page.goto(await fixtureURL(file));
   if(name==='GAS'){
    await page.click('[data-procurement-nav="vendors"]');assert.equal(await page.locator('[data-procurement-panel="vendors"]').isVisible(),true);assert.equal(await page.locator('[data-procurement-panel="board"]').isVisible(),false);
    await page.click('[data-procurement-nav="board"]');assert.equal(await page.locator('[data-procurement-panel="board"]').isVisible(),true);
    const tab=page.locator('[data-procurement-nav="board"]');await tab.focus();await page.keyboard.press('ArrowRight');assert.equal(await page.locator('[data-procurement-nav="vendors"]').evaluate(n=>document.activeElement===n),true);
    await page.keyboard.press('Enter');assert.equal(await page.locator('[data-procurement-nav="vendors"]').getAttribute('aria-selected'),'true');
   }else if(name.startsWith('Investment')){
    const nav=page.locator('.investment-primary-nav');assert.equal(await nav.getAttribute('role'),name==='Investment-Board'?'navigation':'tablist');
    await page.click('.investment-tool-nav-summary');assert.equal(await page.locator('.investment-tool-nav').getAttribute('open'),'');
    if(name==='Investment-Board'){
     await page.click('[data-investment-focus="research"]');assert.equal(new URL(page.url()).hash,'#overview/research');
     await page.click('[data-investment-focus="watchlist"]');assert.equal(new URL(page.url()).hash,'#portfolio/watchlist');
     await page.goBack();assert.equal(new URL(page.url()).hash,'#overview/research');await page.goForward();assert.equal(new URL(page.url()).hash,'#portfolio/watchlist');
    }else {await page.click('[data-investment-route="transactions"]');assert.equal(await page.locator('#investmentPage').innerText(),'transactions');}
   }else {
    await page.click('[data-activate-workspace="management"]');assert.equal(await page.evaluate(()=>qaRoute()),'management');
    await page.click('[data-activate-workspace="sync"]');assert.equal(await page.evaluate(()=>qaRoute()),'sync');
    await page.click('[data-mobile-worklog-tab="suggestions"]');assert.equal(await page.locator('[data-mobile-worklog-tab="suggestions"]').getAttribute('aria-selected'),'true');
   }
   await page.close();
  }
 }finally{await browser.close();fs.rmSync(dir,{recursive:true,force:true});}
});

test('Page Rhythm Authority enforces Type A/B/C spacing exactly at desktop and narrow mobile',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'page-rhythm-qa-'));
 const browser=await chromium.launch({executablePath:resolveBrowserExecutable()||chromium.executablePath(),headless:true,args:['--no-sandbox']});
 const href=file=>fixturePath(path.join(ROOT,file));
 const html=`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
 <link rel="stylesheet" href="${href('shared/theme/zhuge-shell.css')}">
 <link rel="stylesheet" href="${href('shared/theme/zhuge-functional-tabs.css')}">
 <style>body{margin:0;background:#07111f}.rhythm{width:100%;padding:0}.zhuge-functional-tabs-header{height:74px;min-height:74px}.zhuge-page-content-flow>section{height:20px}</style>
 <main class="rhythm zhuge-functional-tabs-layout" data-case="type-a"><header class="zhuge-shared-header zhuge-functional-tabs-header">Page</header><nav class="zhuge-functional-tabs"><button class="zhuge-functional-tab active">A</button></nav><section class="zhuge-functional-tabs-content">Content</section></main>
 <main class="rhythm zhuge-functional-tabs-layout" data-case="type-b"><header class="zhuge-shared-header zhuge-functional-tabs-header">Page</header><nav class="zhuge-functional-tabs"><button class="zhuge-functional-tab active">Primary</button></nav><nav class="zhuge-functional-tabs"><button class="zhuge-functional-tab active">Secondary</button></nav><section class="zhuge-functional-tabs-content zhuge-page-content-flow"><section data-context>Context</section><section data-major>Major</section></section></main>
 <main class="rhythm zhuge-page-rhythm-layout" data-case="type-c"><header class="zhuge-shared-header">Page</header><section data-first-content>Content</section></main>
 <script src="${href('shared/components/zhuge-functional-tabs.js')}"></script>`;
 try{
  const file=path.join(dir,'rhythm.html');fs.writeFileSync(file,html);const page=await browser.newPage({deviceScaleFactor:1});await page.goto(await fixtureURL(file));await page.waitForFunction(()=>document.querySelector('[data-case="type-b"] .zhuge-functional-tabs .zhuge-functional-tab')?.dataset.functionalTabNormalized==='true');
  for(const viewport of [{width:1440,height:900},{width:390,height:844},{width:320,height:740}]){
   await page.setViewportSize(viewport);
   const geometry=await page.evaluate(()=>{
    const measure=(root,header,tabs,content)=>{const rect=s=>root.querySelector(s).getBoundingClientRect();const h=rect(header),t=rect(tabs),c=rect(content);return {headerTabs:t.top-h.bottom,tabsContent:c.top-t.bottom,rowHeight:t.height};};
    const a=document.querySelector('[data-case="type-a"]'),b=document.querySelector('[data-case="type-b"]'),c=document.querySelector('[data-case="type-c"]');
    const br=[...b.querySelectorAll(':scope > .zhuge-functional-tabs')];const sections=b.querySelectorAll('[data-context],[data-major]');
    const r=s=>s.getBoundingClientRect();const bh=r(b.querySelector('.zhuge-functional-tabs-header')),b1=r(br[0]),b2=r(br[1]),bc=r(b.querySelector('.zhuge-functional-tabs-content'));
    return {a:measure(a,'.zhuge-functional-tabs-header','.zhuge-functional-tabs','.zhuge-functional-tabs-content'),b:{headerTabs:b1.top-bh.bottom,stack:b2.top-b1.bottom,tabsContent:bc.top-b2.bottom,rowHeight:b1.height},c:(()=>{const h=r(c.querySelector('header')),content=r(c.querySelector('[data-first-content]'));return content.top-h.bottom;})(),major:r(sections[1]).top-r(sections[0]).bottom};
   });
   assert.deepEqual(geometry,{a:{headerTabs:12,tabsContent:16,rowHeight:45},b:{headerTabs:12,stack:8,tabsContent:16,rowHeight:45},c:16,major:16},`Page Rhythm ${viewport.width}x${viewport.height}`);
  }
  await page.close();
 }finally{await browser.close();fs.rmSync(dir,{recursive:true,force:true});}
});
