const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const {chromium} = require('playwright');
const {fixtureURL, resolveBrowserExecutable} = require('./browser-executable');
const root = path.resolve(__dirname, '..');

for (const viewport of [{width:1440,height:900},{width:390,height:844},{width:844,height:390}]) {
 test(`Office route and approved login return at ${viewport.width}x${viewport.height} (isolated shell)`, async t => {
  const browser = await chromium.launch({executablePath:resolveBrowserExecutable(),args:['--no-sandbox','--disable-dev-shm-usage']});
  t.after(()=>browser.close());
  const page = await browser.newPage({viewport});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  // Only the scene is isolated; actual root, furniture, shared navigation and return source execute.
  await page.route('**/pixel-office/index.html',route=>route.fulfill({contentType:'text/html',body:'<main>SCENE_FIXTURE_ONLY</main>'}));
  await page.goto(await fixtureURL(path.join(root,'index.html')));
  const rack=page.locator('.zgf-rack');await rack.waitFor();
  assert.equal(await page.locator('#zgf-trophy-board').count(),0);
  assert.equal(await page.evaluate(()=>Object.isFrozen(window.ZhugeOfficeAwards)),true);
  const origin=new URL(page.url()).origin;
  assert.equal(await rack.locator('[data-zgf-work=taskflow]').getAttribute('href'),origin+'/labs/taskflow/');
  assert.equal(await rack.locator('[data-zgf-work=apps]').getAttribute('href'),origin+'/labs/taskflow/');
  const clock=rack.locator('[data-zgf-work=login]');
  const login=new URL(await clock.getAttribute('href'));
  assert.equal(login.searchParams.get('officeReturn'),'1');
  assert.equal(await clock.getAttribute('target'),null,'login intent stays in current browsing context');
  for(const link of await rack.locator('a').all()) {
   const size=await link.boundingBox();assert.ok(size.width>=44 && size.height>=44,JSON.stringify(size));
   assert.ok(size.x>=0 && size.x+size.width<=viewport.width,JSON.stringify(size));
   assert.equal(new URL(await link.getAttribute('href')).origin,origin);
  }
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.addScriptTag({path:path.join(root,'labs/taskflow/taskflow-post-login.js')});
  const result=await page.evaluate(({login})=>{
   const helper=window.ZhugeTaskFlowPostLogin;const values=new Map();
   const storage={getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)};
   helper.capture(new URL(login),storage,1000);
   const navigations=[];const location={href:login,replace:url=>navigations.push(url)};
   const denied=helper.complete({authenticated:true,accessApproved:false,runtimeReady:true,location,storage,now:1001});
   const approved=helper.complete({authenticated:true,accessApproved:true,runtimeReady:true,location,storage,now:1002});
   const replay=helper.complete({authenticated:true,accessApproved:true,runtimeReady:true,location,storage,now:1003});
   return {denied,approved,replay,navigations};
  },{login:login.href});
  assert.deepEqual(result,{denied:false,approved:true,replay:false,navigations:[origin+'/']});
  await page.addScriptTag({path:path.join(root,'shared/components/zhuge-navigation.js')});
  const map=await page.evaluate(()=>window.ZhugeSharedNavigation.siteMap('/'));
  for(const entry of map){assert.equal(entry.runtime,'NOT_RUNTIME_VERIFIED');if(['hr','travel'].includes(entry.id))assert.equal(entry.href,null);}
  const returnHtml=await page.evaluate(()=>window.ZhugeSharedNavigation.render({externalRoot:'/'}));
  assert.match(returnHtml,/aria-label="返回 Pixel Office"/);
  fs.mkdirSync(path.join(root,'tests/evidence/site-integration'),{recursive:true});
  await page.screenshot({path:path.join(root,`tests/evidence/site-integration/office-shell-${viewport.width}x${viewport.height}.png`)});
  assert.deepEqual(errors,[]);
  await page.goto(await fixtureURL(path.join(root,'docs/index.html')));
  await page.locator('.zgf-rack').waitFor();
  assert.equal(await page.locator('.zgf-rack [data-zgf-work=taskflow]').getAttribute('href'),origin+'/labs/taskflow/');
 });
}
