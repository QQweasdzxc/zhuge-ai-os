const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');
const {resolveBrowserExecutable} = require('./browser-executable');
const root = path.resolve(__dirname,'..');
const url = 'https://qqweasdzxc.github.io/zhuge-ai-os/labs/taskflow/access-management/';
test('TEST DATA: cards, keyboard, filters, confirmation, errors and identity revalidation; all requests intercepted',async()=>{
 const browser=await chromium.launch({executablePath:resolveBrowserExecutable(),headless:true,args:['--no-sandbox']});
 try {
 const context=await browser.newContext();const page=await context.newPage();let creator=true,paused=false,fail=false,empty=false,network=false;
 const writes=[],errors=[];page.on('pageerror',e=>errors.push(e.message));
 const rows=[
 {applicant_user_id:'u1',display_name:'TEST DATA 管理者',email:'creator@example.invalid',status:'APPROVED',enabled:true,bootstrap:true,is_creator:true},
 {applicant_user_id:'u2',display_name:'TEST DATA 林小新',email:'new@example.invalid',status:'PENDING',enabled:false,submitted_at:'2026-11-08T14:00:00Z',reason:'TEST DATA 新人申請。'.repeat(30)},
 {applicant_user_id:'u3',display_name:'TEST DATA 王同事',email:'member@example.invalid',status:'APPROVED',enabled:true,bootstrap:true},
 {applicant_user_id:'u4',display_name:'TEST DATA 陳同事',email:'disabled@example.invalid',status:'REJECTED',enabled:false,access_disabled:true,review_note:'TEST DATA 最近決定備註 <img src=x onerror=alert(1)>'}
 ];
 await context.route('**/*',async route=>{
 const u=new URL(route.request().url());
 if(u.origin==='https://qqweasdzxc.github.io'){let file=u.pathname.replace(/^\/zhuge-ai-os\//,'');if(file.endsWith('/'))file+='index.html';return route.fulfill({path:path.join(root,file)});}
 assert.equal(u.origin,'https://lenpbbhwxyyfwgvjcozf.supabase.co');
 if(u.pathname==='/auth/v1/user')return route.fulfill({json:{id:'u1',email:'creator@example.invalid'}});
 const name=u.pathname.split('/').pop();
 if(name==='resolve_creator_capability')return route.fulfill({json:{is_creator:creator,user_id:'u1'}});
 if(name==='app_access_review_paused')return route.fulfill({json:paused});
 if(name==='list_app_access_applications'){if(network)return route.abort();return route.fulfill({json:empty?[]:rows});}
 if(name==='set_app_access_user_enabled'){
 const args=route.request().postDataJSON();writes.push(args);
 if(fail)return route.fulfill({status:500,json:{message:'TEST DATA failure'}});
 const row=rows.find(r=>r.applicant_user_id===args.p_applicant_user_id);row.enabled=args.p_enabled;row.access_disabled=!args.p_enabled;row.status=args.p_enabled?'APPROVED':'REJECTED';row.review_note=args.p_note;return route.fulfill({json:{enabled:args.p_enabled}});
 }
 throw new Error('Unexpected RPC '+name);
 });
 await page.addInitScript(()=>localStorage.setItem('zhuge_ai_os_google_auth_session_v1',JSON.stringify({access_token:'TEST-ONLY',expires_at:Date.now()/1000+3600})));
 await page.goto(url);await page.locator('.card').nth(3).waitFor();
 assert.equal(await page.locator('.card.pending').count(),1);assert.equal(await page.locator('.card img').count(),0);assert.equal(writes.length,0);
 assert.equal(await page.getByRole('switch',{name:'TEST DATA 管理者：允許使用'}).isDisabled(),true);
 await page.getByRole('button',{name:'待審核 (1)',exact:true}).click();assert.equal(await page.locator('.card').count(),1);
 let sw=page.getByRole('switch',{name:/林小新/});await sw.focus();await page.keyboard.press('Space');await page.getByRole('button',{name:'取消',exact:true}).click();assert.equal(writes.length,0);
 await sw.click();await page.locator('#review-note').fill('TEST DATA 歡迎加入');await page.getByRole('button',{name:'確認變更',exact:true}).click();await page.getByText('存取設定已更新。',{exact:true}).waitFor();
 assert.equal(writes[0].p_enabled,true);assert.equal(writes[0].p_note,'TEST DATA 歡迎加入');assert.ok(writes[0].p_idempotency_key);
 await page.getByRole('button',{name:/全部 \(/}).click();sw=page.getByRole('switch',{name:/林小新/});assert.equal(await sw.getAttribute('aria-checked'),'true');
 fail=true;await sw.click();await page.getByRole('button',{name:'確認變更',exact:true}).click();await page.getByText(/更新未確認/).waitFor();assert.equal(await sw.getAttribute('aria-checked'),'true');
 fail=false;await sw.click();await page.getByRole('button',{name:'確認變更',exact:true}).click();await page.getByText('存取設定已更新。',{exact:true}).waitFor();assert.equal(writes.at(-1).p_enabled,false);
 await sw.click();await page.getByRole('button',{name:'確認變更',exact:true}).click();await page.getByText('存取設定已更新。',{exact:true}).waitFor();assert.equal(await sw.getAttribute('aria-checked'),'true');
 // Reset fixture exclusively inside this test for readable desktop/mobile evidence.
 rows[1].status='PENDING';rows[1].enabled=false;rows[1].access_disabled=false;
 await page.getByRole('button',{name:'重新確認',exact:true}).click();await page.locator('.card.pending').waitFor();
 const evidence=process.env.ZG71_EVIDENCE_DIR||path.join(root,'tests/evidence/zg71');fs.mkdirSync(evidence,{recursive:true});
 await page.setViewportSize({width:1440,height:1100});await page.screenshot({path:path.join(evidence,'TEST-DATA-desktop.png'),fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:path.join(evidence,'TEST-DATA-mobile.png'),fullPage:true});
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 await sw.click();creator=false;await page.getByRole('button',{name:'確認變更',exact:true}).click();await page.getByText('無權限',{exact:true}).waitFor();assert.equal(await page.locator('.card').count(),0);assert.equal(writes.length,4);
 creator=true;empty=true;await page.getByRole('button',{name:'重新確認',exact:true}).click();await page.getByText('目前沒有申請紀錄',{exact:true}).waitFor();
 empty=false;network=true;await page.getByRole('button',{name:'重新確認',exact:true}).click();await page.getByText(/無法載入/).waitFor();assert.equal(await page.locator('.card').count(),0);
 assert.deepEqual(errors,[]);await context.close();
 } finally {await browser.close();}
});
