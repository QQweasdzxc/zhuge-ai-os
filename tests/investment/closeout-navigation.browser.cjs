const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const base=path.resolve(__dirname,'../..');
const evidenceDir=process.env.BROWSER_EVIDENCE_DIR||path.join(base,'tests/evidence/investment-closeout213');fs.mkdirSync(evidenceDir,{recursive:true});
(async()=>{
 const fixtureNow=Date.parse('2026-11-17T04:00:00Z');
 const source=JSON.parse(fs.readFileSync(path.join(__dirname,'daily-close-v4/evidence/twse-daily-live.json'))),tpex=JSON.parse(fs.readFileSync(path.join(__dirname,'daily-close-v4/evidence/tpex-daily-live.json')));
 const transport=require('./daily-close-v4/daily-snapshot-transport.cjs'),policy=require('./daily-close-v4/source-policy.cjs');
 const values={[policy.SOURCES.TWSE]:source,[policy.SOURCES.TPEX]:tpex,[transport.CALENDAR_URLS.TWSE]:JSON.parse(fs.readFileSync(path.join(__dirname,'daily-close-v4/evidence/calendar/twse-calendar-2026-live.json'))),[transport.CALENDAR_URLS.TPEX]:JSON.parse(fs.readFileSync(path.join(__dirname,'daily-close-v4/evidence/calendar/tpex-calendar-2026-live.json')))};
 const data=await transport.createDailySnapshotLoader({clock:()=>fixtureNow,fetchImpl:async u=>new Response(JSON.stringify(values[u]))})();
 const priceSource=structuredClone(source),priceTpex=structuredClone(tpex);
 const today=new Date(fixtureNow+8*3600000).toISOString().slice(0,10),prior=new Date(Date.parse(today+'T00:00:00Z')-86400000),priorDay=prior.toISOString().slice(0,10);
 for(const row of priceSource)row.Date=String(prior.getUTCFullYear()-1911)+String(prior.getUTCMonth()+1).padStart(2,'0')+String(prior.getUTCDate()).padStart(2,'0');
 for(const row of priceTpex)if('Date' in row)row.Date=priorDay;
 const pricedValues={...values,[policy.SOURCES.TWSE]:priceSource,[policy.SOURCES.TPEX]:priceTpex};
 const pricedData=await transport.createDailySnapshotLoader({clock:()=>fixtureNow,fetchImpl:async u=>new Response(JSON.stringify(pricedValues[u]))})();
 const server=http.createServer((q,r)=>{const u=new URL(q.url,'http://local');if(u.pathname==='/fixture-source-priced.json'){r.setHeader('Content-Type','application/json');r.end(JSON.stringify(pricedData));return;}if(u.pathname==='/fixture-source.json'){r.setHeader('Content-Type','application/json');r.end(JSON.stringify(data));return;}const p=path.resolve(base,'.'+u.pathname.replace(/^\/tests\/shared\//,'/shared/'));if(!p.startsWith(base+'/'))return r.writeHead(403).end();try{r.setHeader('Content-Type',p.endsWith('.js')?'text/javascript':p.endsWith('.css')?'text/css':p.endsWith('.svg')?'image/svg+xml':'text/html');r.end(fs.readFileSync(p));}catch{r.writeHead(404).end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const origin='http://127.0.0.1:'+server.address().port;
 const browser=await chromium.launch({executablePath:process.env.BROWSER_EXECUTABLE||'/usr/bin/google-chrome',args:['--no-sandbox']});
 try {
  for(const width of [320,390,1440]) {
   const page=await browser.newPage({viewport:{width,height:1000}});const errors=[],remote=[];
   page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():(remote.push(route.request().url()),route.abort()));
   await page.clock.setFixedTime(new Date(fixtureNow));
   await page.goto(origin+'/tests/investment/closeout-runtime-fixture.html?entry=off&write=off');
   const nav=id=>page.locator(width<900?`.j-dock [data-investment-route=${id}]`:`.j-header [data-investment-route=${id}]`);
   await page.locator('.j-dashboard').waitFor();
   assert.equal(await page.locator('[data-investment-receivable-panel]').count(),0);
   assert.match(await page.locator('.j-realized').first().innerText(),/2,200|2200/);
   assert.match(await page.locator('.j-dashboard').innerText(),/未實現/);
   await page.screenshot({path:path.join(evidenceDir,'stocks-'+width+'.png'),fullPage:true});
   await nav('overview').click();
   await page.locator('[data-investment-holdings-view=history]').click();
   assert.equal(await page.locator('.j-row').count(),1);
   await page.locator('.j-row').click();
   assert.equal(await page.locator('[data-investment-stock-action=sell]').count(),0);
   await page.screenshot({path:path.join(evidenceDir,'closed-'+width+'.png'),fullPage:true});
   await page.locator('[data-investment-stock-action=buy]').click();
   await page.locator('[data-investment-transaction-form]').waitFor();
   assert.equal(await page.locator('[name=symbol]').inputValue(),'CLOSED');
   assert.equal(await page.locator('[name=tradeType]').inputValue(),'BUY');
   assert.equal(await page.locator('[name=price]').inputValue(),'');
   assert.equal(await page.locator('[name=quantity]').inputValue(),'');
   assert((await page.locator('[name=idempotencyKey]').inputValue()).length>=8);
   await page.locator('.investment-ledger-details summary').click();
   assert.match(await page.locator('.investment-ledger-details').innerText(),/目前已讀取 200 筆/);
   await page.locator('[data-investment-transactions-more]').click();await page.waitForFunction(()=>document.querySelector('.investment-ledger-details')?.textContent.includes('400 筆'));
   await page.locator('.investment-ledger-details summary').click();await page.locator('[data-investment-transactions-more]').click();await page.waitForFunction(()=>document.querySelector('.investment-ledger-details')?.textContent.includes('405 筆'));
   assert.equal(await page.locator('[data-investment-transactions-more]').count(),0);
   await page.locator('.investment-ledger-details summary').click();await page.locator('[data-investment-transactions-all]').click();
   assert.equal(await page.locator('[data-investment-transaction-id]').count(),405);
   assert.equal(new Set(await page.locator('[data-investment-transaction-id]').evaluateAll(nodes=>nodes.map(n=>n.dataset.investmentTransactionId))).size,405);
   await page.locator('[aria-label="關閉並返回"]').click();
   await nav('receivables').click();
   await page.locator('[data-investment-receivable-panel]').waitFor();
   assert.match(await page.locator('#investmentPage').innerText(),/不表示所有專案已自動彙整或雙向同步/);
   await page.screenshot({path:path.join(evidenceDir,'receivables-'+width+'.png'),fullPage:true});
   await nav('tools').click();
   for(const label of ['匯入資料','投資策略','帳戶與設定','持股工作看板','全部交易紀錄','今日軍師','觀察股','個股研究','團軍師','市場情報'])assert.equal(await page.locator('.j-tools').getByRole('button',{name:label+' ›',exact:true}).count(),1,label);
   await page.screenshot({path:path.join(evidenceDir,'tools-'+width+'.png'),fullPage:true});
   for(const focus of ['today-focus','research','advisor','realtime']){
    await page.locator('.j-tools [data-investment-focus='+focus+']').click();assert.equal(await page.locator('[data-investment-section='+focus+']').count(),1,focus);
    await nav('tools').click();
   }
   await nav('overview').click();await page.locator('[data-investment-holdings-view=current]').click();
   await page.locator('.j-row').first().click();await page.locator('[data-investment-stock-action=sell]').click();
   assert.equal(await page.locator('[name=symbol]').inputValue(),'0050');assert.equal(await page.locator('[name=tradeType]').inputValue(),'SELL');
   assert.equal(await page.locator('.j-dock:visible').count(),0,'entry flow hides dock');
   await page.screenshot({path:path.join(evidenceDir,'sell-form-'+width+'.png'),fullPage:false});
   await page.goto(origin+'/tests/investment/closeout-runtime-fixture.html?entry=off&write=off&priced');
   await page.locator('.j-dashboard').waitFor();await page.waitForFunction(()=>document.querySelector('.j-dashboard')?.innerText.includes('12,345,600'));
   await nav('overview').click();await page.locator('.j-row').first().click();
   await page.screenshot({path:path.join(evidenceDir,'priced-expanded-'+width+'.png'),fullPage:true});
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'priced overflow');
   assert.deepEqual(await page.evaluate(()=>fixture.writes),[]);assert.deepEqual(errors,[]);assert.deepEqual(remote,[]);
   await page.close();

  }
  console.log('PASS 320/390/1440: confirmed dashboard and navigation, all tools reachable, history retained, realized and unrealized separated, buy/sell prefill without quantity/price guesses, 405-row stable cursor pagination without duplicate, no real writes or remote calls');
 } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exit(1)});
