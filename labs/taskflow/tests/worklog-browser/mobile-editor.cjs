const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {chromium, webkit} = require('./fixture-clock.cjs');
const output = path.resolve(process.env.WORKLOG_OUTPUT || 'test-results');
fs.mkdirSync(output, {recursive:true});
(async () => {
  const engine = process.env.WORKLOG_BROWSER === 'webkit' ? webkit : chromium;
  const browser = await engine.launch({headless:true, ...(engine === chromium ? {args:['--no-sandbox'], ...(process.env.CHROME_PATH ? {executablePath:process.env.CHROME_PATH} : {})} : {})});
  try {
    for (const width of [320,390,1280]) {
      const page = await browser.newPage({viewport:{width,height:844},timezoneId:'Asia/Taipei'});
      const errors=[]; page.on('pageerror', e=>errors.push(e.message));
      await page.goto('http://127.0.0.1:4177/native.html');
      await page.getByText('正在載入原有工時資料…').waitFor({state:'hidden'});
      if(width<1100) await page.getByRole('button',{name:'月曆',exact:true}).click();
      await page.getByRole('button',{name:'11月1日 0h',exact:true}).click();
      if(width<1100) await page.getByRole('button',{name:'我的工時 0',exact:true}).click();
      await page.getByRole('button',{name:'＋ 手動',exact:true}).click();
      const dialog=page.getByRole('dialog'); await dialog.waitFor();
      const close=await dialog.getByRole('button',{name:'關閉',exact:true}).boundingBox();
      assert.equal(close.width,44); assert.equal(close.height,44);
      const start=await dialog.getByLabel('開始時間',{exact:true}).boundingBox();
      const duration=await dialog.getByLabel('工時（小時）',{exact:true}).boundingBox();
      if(width<420) assert.ok(duration.y >= start.y+start.height, JSON.stringify({start,duration}));
      for (const bounds of [start,duration,close]) assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width+1,JSON.stringify(bounds));
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
      await page.screenshot({path:path.join(output,`tq6-editor-${engine.name()}-${width}.png`),fullPage:true});
      await dialog.getByRole('button',{name:'關閉',exact:true}).click();
      assert.equal(await page.getByRole('dialog').count(),0); assert.deepEqual(errors,[]);
      await page.close();
    }
    console.log(JSON.stringify({browser:engine.name(),widths:[320,390,1280],closeTarget44:true,timeInputsDoNotOverlap:true,noHorizontalOverflow:true,closeWorks:true}));
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
