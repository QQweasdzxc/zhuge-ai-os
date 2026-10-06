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
 {name:'Investment-Board',entry:'app/Board/investment/index.html',investment:true,links:true},
 {name:'Investment-Module',entry:'modules/investment/index.html',investment:true},
 {name:'AI-Board',entry:'app/Board/ai/index.html'},
 {name:'WorkTodo',entry:'app/Board/worktodo/index.html'},
 {name:'WorkLog-Management-Console',entry:'modules/worklog/index.html',worklog:true},
 {name:'Lab',entry:'labs/investment/index.html',lab:true}
];
function styles(entry) {
 return [...new Set([...read(entry).matchAll(/["']([^"']+\.css(?:\?[^"']*)?)["']/g)].map(m=>m[1]))].filter(file=>!/^http/.test(file)).map(file=>`<link rel="stylesheet" href="${fixturePath(path.resolve(ROOT,path.dirname(entry),file.split('?')[0]))}">`).join('\n');
}
function fixture(item) {
 let body;
 if(item.investment) body=`<main class="zhuge-module-shell investment-module-shell">${shell.renderPrimaryNavigation({activePage:'portfolio'},{asLinks:item.links,hrefFor:i=>'#'+i.route+(i.focus?'/'+i.focus:'')})}${shell.renderToolNavigation({activePage:'portfolio'},{asLinks:item.links,hrefFor:i=>'#'+i.route})}<section id="investmentPage"></section></main>`;
 else if(item.worklog) body=`<main class="zhuge-module-shell workspace-shell workspace-worklog">${wlContext.workspaceTabs()}${wlContext.mobileWorklogTabs()}<section id="mobile-worklog-time">工時</section><section id="mobile-worklog-suggestions">建議</section></main>`;
 else if(item.lab) body=read(item.entry).match(/<nav class="mobile-nav[\s\S]*?<\/nav>/)[0];
 else body=read(item.entry).match(/<body[^>]*>([\s\S]*?)<\/body>/)[1].replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'');
 const script=file=>`<script src="${fixturePath(path.join(ROOT,file))}"></script>`;
 // Actual markup/renderers + formal stylesheet order, with no business writers.
 return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles(item.entry)}<style>body{margin:0;padding:16px}main,.main,.app{max-width:100%;min-width:0}.zhuge-module-shell{display:block;padding:0}.zhuge-functional-tabs{max-width:100%}</style>${body}
 ${script('shared/components/zhuge-functional-tabs.js')}
 ${item.name==='GAS'?`<script>window.VendorSheetService={VendorSheetService:class{async list(){return [{vendorId:'qa-vendor',vendorName:'QA Vendor',businessCategory:['採購'],company:'QA'}];}async create(){throw Error('QA does not write');}async update(){throw Error('QA does not write');}}};document.querySelector('[data-procurement-panel="board"] [data-board-main-view]').textContent='Isolated Board projection';</script>`+script('app/Board/procurement/procurement-tabs.js')+script('app/Board/procurement/vendor-list.js'):''}
 <script>
 const state={boardIsTemplate:${item.mother===true},workflowCapability:{capabilities:{settings:true}}};
 ${mountWorkflowTab}
 ${['C-Mother','Arbitrary-Generic','GAS','AI-Board','WorkTodo'].includes(item.name)?'ensureWorkflowSettingsTab();':''}
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
 let baseline;
 try {
  for(const item of cases) {
   const file=path.join(dir,item.name+'.html');fs.writeFileSync(file,fixture(item));
   const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(await fixtureURL(file));await page.waitForSelector('[data-ready]');
   for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
    await page.setViewportSize(viewport);
    const rows=page.locator('.zhuge-functional-tabs:visible');
    if(item.lab&&viewport.width===1280){assert.equal(await rows.count(),0,'Lab sidebar is navigation, not a desktop tab row');continue;}
    assert.ok(await rows.count()>0,item.name+' has its Functional Tabs');
    for(let r=0;r<await rows.count();r++){
     const row=rows.nth(r),tabs=row.locator('.zhuge-functional-tab');const first=tabs.first();
     const actual=await geometry(first);if(!baseline)baseline=actual;assert.deepEqual(actual,baseline,item.name+' '+viewport.width+' geometry');
     assert.equal(Number.parseFloat(actual.height),44);assert.equal(actual.fontSize,'14px');assert.equal(actual.gap,'7px');
     const icon=first.locator('[data-functional-tab-icon]');if(await icon.count())assert.equal(await icon.first().evaluate(n=>getComputedStyle(n).width),'18px');
     const rowStyle=await row.evaluate(n=>{const s=getComputedStyle(n);return {background:s.backgroundColor,radius:s.borderRadius,divider:s.borderBottomWidth,wrap:s.flexWrap,display:s.display,gap:s.gap};});
     assert.deepEqual(rowStyle,{background:'rgba(0, 0, 0, 0)',radius:'0px',divider:'1px',wrap:'nowrap',display:'flex',gap:'8px'});
     await first.focus();assert.equal(await first.evaluate(n=>getComputedStyle(n).outlineWidth),'2px');
     const inactive=tabs.nth(Math.min(1,(await tabs.count())-1));
     await page.mouse.move(0,0);await inactive.evaluate(n=>{n.classList.remove('active','is-active');n.removeAttribute('aria-current');});
     await page.waitForTimeout(10);
     assert.equal(await inactive.evaluate(n=>getComputedStyle(n).backgroundColor),'rgba(0, 0, 0, 0)');
     await inactive.evaluate(n=>n.classList.add('active'));await page.waitForTimeout(10);
     const activeStyle=await inactive.evaluate(n=>{const s=getComputedStyle(n);return [s.backgroundColor,s.borderBottomColor,s.color];});
     assert.ok(activeStyle[0]!=='rgba(0, 0, 0, 0)');assert.deepEqual(await geometry(inactive),baseline);
     // Overflow uses the same authority, including future/arbitrary labels.
     await row.evaluate(n=>{n.querySelectorAll('.zhuge-functional-tab').forEach(t=>t.classList.remove('active','is-active'));for(let i=0;i<12;i++){const t=n.querySelector('.zhuge-functional-tab').cloneNode(true);t.removeAttribute('id');t.textContent='任意功能 '+i;t.classList.remove('active','is-active');n.appendChild(t);}n.querySelector('.zhuge-functional-tab:last-child').classList.add('active');});
     await page.waitForTimeout(20);
     assert.equal(await row.evaluate(n=>n.scrollWidth>n.clientWidth),true);
     const visibility=await row.evaluate(n=>{const t=n.querySelector('.zhuge-functional-tab:last-child'),a=t.getBoundingClientRect(),b=n.getBoundingClientRect();return a.left>=b.left-1&&a.right<=b.right+1;});assert.equal(visibility,true,item.name+' active tab scrolls into view');
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
    await page.click('[data-mobile-worklog-tab="suggestions"]');assert.equal(await page.locator('[data-mobile-worklog-tab="suggestions"]').getAttribute('aria-current'),'page');
   }
   await page.close();
  }
 }finally{await browser.close();fs.rmSync(dir,{recursive:true,force:true});}
});
