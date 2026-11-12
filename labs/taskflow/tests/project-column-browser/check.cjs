const assert=require('node:assert/strict'),{spawn}=require('node:child_process'),fs=require('node:fs'),path=require('node:path');
const root=process.env.TF_NATIVE_ROOT||'/tmp/tf-project-source';
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
(async()=>{const log=fs.openSync('/tmp/tf-order-vite.log','w');const server=spawn('pnpm',['exec','vite','--host','127.0.0.1','--port','4312'],{cwd:path.join(root,'apps/ui-lab'),stdio:['ignore',log,log]});let browser;try{
 for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:4312/order.html')).ok)break;}catch{}await new Promise(r=>setTimeout(r,100));}
 browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{}),args:['--no-sandbox']});
 for(const width of [320,390,1280]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:4312/order.html');await page.waitForSelector('[data-taskflow-column-handle="todo"]');
 const order=()=>page.locator('[data-taskflow-column]').evaluateAll(xs=>xs.map(x=>x.dataset.taskflowColumn));
 const before=await order();assert.deepEqual(before,['backlog','todo','in_progress','in_review','blocked','done']);
 // Actual mouse pointer drag on real BoardColumn; narrow viewports use the settings controls below.
 if(width===1280){const a=await page.locator('[data-taskflow-column-handle="todo"]').boundingBox(),b=await page.locator('[data-taskflow-column-handle="in_progress"]').boundingBox();await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(b.x+b.width/2,b.y+b.height/2,{steps:20});await page.mouse.up();}
 else{await page.getByRole('button',{name:'專案狀態',exact:true}).click();await page.getByRole('button',{name:'將「待辦」欄向後移',exact:true}).click();await page.getByRole('button',{name:'完成',exact:true}).click();}
 await page.waitForFunction(()=>window.fixtureWrites.length===1);await page.waitForFunction(()=>document.querySelectorAll('[data-taskflow-column]')[1]?.getAttribute('data-taskflow-column')==='in_progress');assert.equal((await order())[2],'todo');
 assert.deepEqual(await page.evaluate(()=>window.fixtureCards),[{id:'original-card',status:'todo'}]);
 await page.reload();await page.waitForSelector('[data-taskflow-column-handle="todo"]');assert.equal((await order())[1],'in_progress');
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('fixture-pref:11111111-1111-4111-8111-111111111111')));assert.equal(saved.prefs.unrelated,'keep');assert.deepEqual(saved.prefs.taskflow_hidden_statuses,['cancelled']);
 await page.screenshot({path:`/downloads/tf-project-order-board-${width}.png`});
 await page.getByRole('button',{name:'專案狀態',exact:true}).click();const dialog=page.getByRole('dialog');await dialog.waitFor();const text=await dialog.innerText();assert.ok(!/Backlog|In Progress|In Review|Cancelled/.test(text));for(const word of ['待規劃','待辦','進行中','稽核中'])assert.ok(text.includes(word));
 const bounds=await dialog.boundingBox();assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width+1);await page.screenshot({path:`/downloads/tf-project-order-settings-${width}.png`});await page.getByRole('button',{name:'完成',exact:true}).click();
 // A rejected preference write leaves the visual order unchanged.
 await page.evaluate(()=>window.fixtureFailSave=true);await page.locator('[data-taskflow-column-handle="todo"]').focus();await page.keyboard.press('ArrowLeft');await page.getByText('無法儲存專案狀態設定，請再試一次。',{exact:true}).waitFor();assert.equal((await order())[1],'in_progress');
 await page.getByRole('button',{name:'切換專案',exact:true}).click();await page.waitForFunction(()=>document.querySelector('[data-testid="project"]').textContent.startsWith('2222'));await page.waitForSelector('[data-taskflow-column-handle="todo"]');assert.deepEqual(await order(),before);
 assert.deepEqual(errors,[]);await page.close();
 }
 console.log('PASS: real BoardColumn pointer drag; 320/390/1280 controls+Traditional Chinese; reopened order; second Project unchanged; rejected save unchanged; cards untouched');
}finally{if(browser)await browser.close();server.kill('SIGTERM');await new Promise(r=>server.on('close',r));}})().catch(e=>{console.error(e);process.exitCode=1});
