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
  for(const width of [390,1440]) {
   for(const theme of ["light","dark"]) {
   const page=await browser.newPage({viewport:{width,height:1000}});const errors=[],remote=[];
   page.on('pageerror',e=>errors.push(e.message));await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():(remote.push(route.request().url()),route.abort()));
   await page.clock.setFixedTime(new Date(fixtureNow));
   await page.goto(origin+'/tests/investment/closeout-runtime-fixture.html?entry=off&write=off');
   await page.locator('[data-investment-simple-overview]').waitFor();
   await page.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
   const result=await page.locator('.investment-realized-summary').evaluateAll(nodes=>nodes.map(n=>{const c=getComputedStyle(n);return {color:c.color,background:c.backgroundColor,number:getComputedStyle(n.querySelector('strong')).color,note:getComputedStyle(n.querySelector('small')).color};}));
   function luminance(s){const values=s.match(/[\d.]+/g).slice(0,3).map(Number);const rgb=values.map(v=>{if(!s.startsWith('color(srgb'))v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;}
   function ratio(a,b){a=luminance(a);b=luminance(b);return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);}
   for(const row of result)for(const text of [row.color,row.number,row.note])assert(ratio(text,row.background)>=4.5,JSON.stringify({theme,width,row,ratio:ratio(text,row.background)}));
   assert.equal(result.length,2);
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await page.screenshot({path:path.join(evidenceDir,'contrast-'+theme+'-'+width+'.png'),fullPage:true});
   console.log(JSON.stringify({width,theme,result}));
   await page.close();
   }
  }
  console.log('PASS light/dark 390/1440: both currency summaries text/number/note contrast >=4.5 with actual shared theme stack; no horizontal overflow');
 } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exit(1)});
