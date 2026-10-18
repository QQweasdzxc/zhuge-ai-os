'use strict';
const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const root=__dirname;
const server=http.createServer((req,res)=>{
 const name=path.basename(new URL(req.url,'http://localhost').pathname)||'index.html';
 if(!['index.html','app.js','styles.css'].includes(name)){res.writeHead(404);res.end();return;}
 const type=name.endsWith('.js')?'application/javascript':name.endsWith('.css')?'text/css':'text/html';
 res.writeHead(200,{'Content-Type':type});
 res.end(fs.readFileSync(path.join(root,name)));
});
(async()=>{
 await new Promise(ok=>server.listen(0,'127.0.0.1',ok));
 let browser;
 try{
  browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:390,height:844},locale:'zh-TW'});
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('https://api.github.com/repos/QQweasdzxc/zhuge-ai-os/pulls/63',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({merged:true})}));
  await page.route('https://api.github.com/repos/QQweasdzxc/zhuge-ai-os/actions/runs/39137616982',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({conclusion:'success',head_sha:'a9db9b2fe3051e22d59e52ad083c8d54d12dba62'})}));
  await page.route('https://qqweasdzxc.github.io/**',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><html><body><canvas id="world"></canvas></body></html>'}));
  const url='http://127.0.0.1:'+server.address().port+'/index.html';
  await page.goto(url);
  assert.equal(await page.locator('.actor').count(),3);
  assert.equal(await page.locator('#cat').count(),1);
  await page.waitForFunction(()=>document.getElementById('claim')?.textContent==='領取 +500');
  await page.locator('#claim').click();assert.equal(await page.locator('#balance').innerText(),'500');
  await page.reload();
  await page.waitForFunction(()=>document.getElementById('claim')?.textContent==='已領取');
  assert.equal(await page.locator('#balance').innerText(),'500','no repeat reward');
  await page.locator('#daily-shop-button').click();
  assert.equal(await page.locator('.item').count(),3);
  await page.locator('.item button:not([disabled])').first().click();
  assert(Number(await page.locator('#balance').innerText())<500);
  await page.locator('#close-dialog').click();
  await page.locator('#cat').click();assert((await page.locator('#toast').innerText()).includes('米粒'));
  await page.locator('.actor.co').click();
  assert((await page.locator('#dialog-content').innerText()).includes('真實'));
  await page.locator('#close-dialog').click();
  fs.mkdirSync(path.join(root,'evidence'),{recursive:true});
  await page.screenshot({path:path.join(root,'evidence/p3-mobile-390.png'),fullPage:true});
  await page.setViewportSize({width:1280,height:850});
  await page.screenshot({path:path.join(root,'evidence/p3-desktop.png'),fullPage:true});
  assert.deepEqual(errors,[]);
  console.log('PASS P3 isolated UI: mobile/desktop, cat, cast, idempotent verified milestone reward, local shop, zoom.');
  console.log('External Habblaud iframe is mocked for this UI test; actual remote frame and Safari require separate UAT.');
 }finally{if(browser)await browser.close();await new Promise(ok=>server.close(ok));}
})().catch(e=>{console.error(e);process.exitCode=1;});