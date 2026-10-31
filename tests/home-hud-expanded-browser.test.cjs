'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { stripTypeScriptTypes } = require('node:module');
const { chromium } = require('playwright');
const { fixtureURL, resolveBrowserExecutable } = require('./browser-executable');
const root = path.resolve(__dirname, '..');
const ui = 'integrations/habblaud/overrides/client/src/ui/';
// Run the production HUD, stripping only types/imports; scene and read-only
// data adapters are replaced by deterministic fixtures, without network calls.
const source = stripTypeScriptTypes(fs.readFileSync(path.join(root, ui+'zhuge-hud.ts'), 'utf8'))
  .replace(/^import .*;$/gm, '').replace(/^export /gm, '');
const setup = `
const isFreshStatus=()=>true;
const ZHUGE_CAST=[{id:'fixture',name:'Fixture',duty:'QA',intro:'QA'}];
const ZHUGE_FAMILY_RESIDENTS=[];
const WEATHER_CITIES=[{id:'fixture',name:'Fixture'}];
const toWeatherVisualContract=()=>({condition:'unknown',dayNight:'unknown',temperatureC:null,precipitationMm:null,precipitation:'unknown',sun:{timezone:'Asia/Taipei'}});
const state={freshness:'unknown',condition:'unknown',typhoonWarning:{status:'unknown'},strongWind:{status:'unknown'}};
window.statusFixture={project_name:'Fixture',overall_status:'healthy',updated_at:new Date().toISOString(),blocked_items:[],next_actions:[],active_modules:[],recent_prs:[]};
mountZhugeWeatherControl({getCity:()=>WEATHER_CITIES[0],getState:()=>state,selectCity:()=>{},subscribe:()=>()=>{}});
window.refreshHud=()=>mountZhugeHud(window.statusFixture);
refreshHud();`;
for (const width of [1440,390]) test(`home HUD preserves panel state and manual collapse at ${width}`, async () => {
  const browser=await chromium.launch({executablePath:resolveBrowserExecutable()||undefined,headless:true,args:['--no-sandbox']});
  try {
    const page=await browser.newPage({viewport:{width,height:1000}});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(await fixtureURL(path.join(root,'index.html')));
    // Isolate the real HUD from the iframe's scene/auth/runtime.
    await page.setContent('<meta name="viewport" content="width=device-width,initial-scale=1">');
    await page.addStyleTag({content:fs.readFileSync(path.join(root,ui+'zhuge-hud.css'),'utf8')});
    await page.clock.install();
    await page.evaluate(()=>localStorage.clear());
    await page.addScriptTag({content:source+'\n'+setup});
    const hud=page.locator('#zhuge-aios-hud');
    if(width===390) await hud.getByRole('button',{name:'展開辦公室資訊',exact:true}).click();
    const entries=['📋 專案狀態','開啟角色名冊（含家人與黑灰色小貓）','查看唯讀天氣與日夜資料','經典報表'];
    async function expanded(){
      assert.equal(await hud.getAttribute('data-open'),'true');
      for(const name of entries) assert.equal(await hud.getByRole(name==='經典報表'?'link':'button',{name,exact:true}).isVisible(),true,name);
      assert.equal(await hud.getByRole('button',{name:'收合辦公室資訊',exact:true}).getAttribute('aria-expanded'),'true');
    }
    for(const name of ['🙋 0 項待裁示',...entries.slice(0,3)]) {
      await hud.getByRole('button',{name,exact:true}).click();
      await page.clock.fastForward(8000);
      const panel=page.locator(name==='查看唯讀天氣與日夜資料'?'#zhuge-weather-panel':'#zhuge-decision-panel');
      await panel.getByRole('button',{name:'關閉',exact:true}).click();
      assert.equal(await panel.isVisible(),false);
      await expanded();
      await page.evaluate(()=>refreshHud());
      await expanded();
    }
    await hud.getByRole('button',{name:'收合辦公室資訊',exact:true}).click();
    assert.equal(await hud.getAttribute('data-open'),'false');
    assert.equal(await hud.getByRole('link',{name:'經典報表'}).isVisible(),false);
    // The remaining decision control must not expand a manually compact HUD.
    await hud.getByRole('button',{name:'🙋 0 項待裁示',exact:true}).click();
    await page.locator('#zhuge-decision-panel').getByRole('button',{name:'關閉',exact:true}).click();
    await page.clock.fastForward(16000);
    await page.evaluate(()=>refreshHud());
    assert.equal(await hud.getAttribute('data-open'),'false');
    await hud.getByRole('button',{name:'展開辦公室資訊',exact:true}).click();
    await expanded();
    assert.deepEqual(errors,[]);
  } finally {await browser.close();}
});
