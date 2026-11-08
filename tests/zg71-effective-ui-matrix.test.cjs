const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {execFileSync}=require('node:child_process');const {chromium}=require('playwright');const {resolveBrowserExecutable}=require('./browser-executable');
test('48 real SQL decisions equal rendered switch aria-checked',async()=>{
 const testEnv={...process.env};delete testEnv.NODE_TEST_CONTEXT;
 execFileSync(process.execPath,['--test','tests/zg71-app-access-sql.test.js'],{cwd:path.resolve(__dirname,'..'),env:testEnv});
 const cases=JSON.parse(fs.readFileSync('/tmp/zg71-matrix/result.json','utf8'));
 const browser=await chromium.launch({executablePath:resolveBrowserExecutable(),headless:true,args:['--no-sandbox']});
 try{const page=await browser.newPage();let group=[];let active=false,paused=false;
 await page.route('**/*',async route=>{
 const u=new URL(route.request().url());
 if(u.hostname==='fixture.invalid'){let file=u.pathname;if(file.endsWith('/'))file+='index.html';return route.fulfill({path:path.join(__dirname,'..',file)});}
 if(u.pathname==='/auth/v1/user')return route.fulfill({json:{id:'creator-test'}});
 const name=u.pathname.split('/').pop();
 if(name==='resolve_creator_capability')return route.fulfill({json:{is_creator:true,user_id:'creator-test'}});
 if(name==='resolve_app_access')return route.fulfill({json:{access_model_active:active}});
 if(name==='app_access_review_paused')return route.fulfill({json:paused});
 if(name==='list_app_access_applications')return route.fulfill({json:group.map(c=>c.card)});
 throw new Error('Unexpected network: '+u);
 });
 await page.addInitScript(()=>localStorage.setItem('zhuge_ai_os_google_auth_session_v1',JSON.stringify({access_token:'TEST',expires_at:Date.now()/1000+3600})));
 for(const cutoff of [false,true])for(const pause of [false,true]){
 active=cutoff;paused=pause;group=cases.filter(c=>c.cutoff===cutoff&&c.pause===pause);
 await page.goto('https://fixture.invalid/labs/taskflow/access-management/');await page.locator('.card').nth(11).waitFor();
 for(let i=0;i<group.length;i++)assert.equal(await page.locator('.card').nth(i).getByRole('switch').getAttribute('aria-checked'),String(group[i].backend),JSON.stringify(group[i]));
 if(cutoff&&pause)assert.ok(await page.getByText('既有成員保留使用；新加入者需你開啟。個別 Off 會被擋。',{exact:true}).count());
 }
 }finally{await browser.close();}
});
