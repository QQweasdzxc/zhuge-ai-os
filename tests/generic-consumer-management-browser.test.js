const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { resolveBrowserExecutable, fixtureURL } = require('./browser-executable');

// Isolated read fixtures; real BoardReadService normalization and Management
// rendering run in Chromium. No Production connection or writable RPC exists.
const rows = [
  { id: 'fixture-cloud', name: '雲間協作', task_code_prefix: 'GAS', project_assignment: 'worklog' },
  { id: 'fixture-ridge', name: '遠山筆記', task_code_prefix: 'IVTK', project_assignment: 'investment' },
  { id: 'fixture-garden', name: '晨光研究', task_code_prefix: 'MDTK', project_assignment: null },
].map(row => ({ template_key: 'c', is_template_instance: false, active: true, ...row }));
rows.push(rows[0]);
rows.push({ id: 'fixture-unknown', name: 'Do not infer', task_code_prefix: 'MDTK', template_key: 'c', active: true });

test('Generic Consumer Management renders one canonical name/entry across Desktop and Mobile surfaces', async t => {
  const executablePath = resolveBrowserExecutable();
  assert.ok(executablePath, 'real Chromium required');
  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'generic-management-'));
  t.after(async () => { await browser.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  const fixture = path.join(directory, 'management.html');
  fs.writeFileSync(fixture, `<!doctype html><html lang="zh-Hant"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/shared/theme/zhuge-shell.css"><link rel="stylesheet" href="/modules/worklog/worklog.css"><div id="management"></div>
<script src="/shared/board/board-read-service.js"></script>
<script>
const rows=${JSON.stringify(rows)}; window.readCalls=[];
window.getSharedSessionSnapshot=()=>({isAuthenticated:true});
const gateway={select:async(table,query)=>{if(table!=='board_instances')throw Error('Unexpected table');readCalls.push({table,query});const id=new URLSearchParams(query).get('id');return id?rows.filter(row=>row.id===id.slice(3)):rows;},rpc:async(name,args)=>{if(name!=='board_c_authority_conformance_check')throw Error('Writable RPC forbidden');readCalls.push({name,args});return {board_instance_id:args.p_board_instance_id,overall:{status:'healthy',gap_count:0},feature:{shared_runtime:'module-c-golden-master-runtime'},source:{consumer_data_scope:'board-instance-owned'},authority:{cloud_writer:'controlled-security-definer-rpc+private-core'}};}};
window.ZhugeSupabaseGateway={createDataGateway:()=>gateway};
const adopted={status:'adopted',moduleVersion:'fixture-version',build:'fixture-build'};
window.ZhugeModulePublishService={read:async()=>({publishedVersion:'fixture-version',publishedBuild:'fixture-build',consumers:Object.fromEntries(rows.filter(row=>row.is_template_instance===false).map(row=>[row.id,adopted]))}),hasPendingDevelopment:()=>false};
window.ZhugeTemplateAdoptionPolicy={TEMPLATES:{board:{id:'board',code:'C',label:'看板',description:'Shared'}},PAGE_REGISTRY:{}};
window.ZhugeTemplateAdoptionRuntime={policy:{status:'resolved'},service:{isTemplateEnabled:()=>false}};
</script><script src="/shared/components/template-management-center.js"></script><script>
const paint=()=>{document.getElementById('management').innerHTML=ZhugeTemplateManagementCenter.render();};paint();
const timer=setInterval(()=>{paint();if(document.querySelector('[data-template-runtime-status="resolved"]')){clearInterval(timer);window.fixtureReady=true;}},20);
</script></html>`);
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport });
    try {
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto(await fixtureURL(fixture));
      await page.waitForFunction(() => window.fixtureReady === true);
      assert.equal(await page.locator('[data-template-runtime-entry]').count(), 3, 'three Generic Boards; Shared Service filters unresolved identity and duplicate is removed');
      for (const row of rows.slice(0, 3)) {
        const card = page.locator(`[data-template-runtime-entry="consumer-${row.id}"]`);
        assert.equal(await card.locator('.template-runtime-observability-name strong').innerText(), row.name);
        await card.locator('summary').first().click();
        assert.ok((await card.innerText()).includes(`/app/Board/template-preview/?templateView=board&boardInstanceId=${row.id}`));
        const names = await page.locator('[data-template-site-map] .template-site-map-node-label strong').allTextContents();
        assert.equal(names.filter(name => name === row.name).length, 1);
        assert.equal(await page.locator('[data-template-release-summary] .template-management-release-consumer strong').getByText(row.name, {exact:true}).count(), 1);
        assert.equal(await page.locator(`[data-template-management-row="${row.id}-board"] .template-management-consumer`).textContent(), row.name);
      }
      assert.equal(await page.locator('[data-template-runtime-entry="unknown-fixture-unknown"]').count(), 0, 'Shared Service rejects unresolved rows');
      assert.equal(await page.getByText('Do not infer', {exact:true}).count(), 0);
      assert.equal(await page.getByText('其他 C 看板', {exact:true}).count(), 0);
      assert.deepEqual(errors, []);
      const calls = await page.evaluate(() => readCalls);
      assert.ok(calls.every(call => !call.name || call.name === 'board_c_authority_conformance_check'));
      assert.ok(!calls.some(call => call.args?.p_board_instance_id === 'fixture-unknown'), 'unresolved identity cannot claim checker evidence');
    } finally { await page.close(); }
  }
});
