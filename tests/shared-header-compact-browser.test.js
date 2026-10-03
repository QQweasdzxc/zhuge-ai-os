const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { fixtureURL, fixturePath, resolveBrowserExecutable } = require('./browser-executable');
const ROOT = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(ROOT, file), 'utf8');
const investmentShell = require('../modules/investment/components/module-shell');
const worklogSource = read('modules/worklog/worklog-app.js');
const worklogActions = worklogSource.slice(worklogSource.indexOf('function workTodoHeaderActions()'), worklogSource.indexOf('\nfunction header()',worklogSource.indexOf('function workTodoHeaderActions()')));

function styles(entry) {
  // Preserve formal stylesheet order, including WorkLog's dynamic appStyles.
  const source = read(entry);
  const paths = [...source.matchAll(/["']([^"']+\.css(?:\?[^"']*)?)["']/g)].map(match => match[1]);
  return [...new Set(paths)].filter(file => !/^https?:/.test(file))
    .map(file => `<link rel="stylesheet" href="${fixturePath(path.resolve(ROOT, path.dirname(entry), file.split('?')[0]))}">`).join('\n');
}
const cases = [
  ...['ai', 'worktodo', 'procurement', 'investment', 'template-preview'].map(key => ({ name: `Board/${key}`, entry: `app/Board/${key}/index.html`, scope: key === 'template-preview' ? 'c' : key === 'ai' ? 'ai_board' : key })),
  { name: 'Dashboard', entry: 'app/dashboard/index.html' },
  ...Object.entries(investmentShell.labels).map(([route, [label, icon]]) => ({ name: `Investment/${route}`, entry: 'modules/investment/index.html', title: `${icon} ${label}`, description: '投資模組｜查看持股與近期變化', investment: true })),
  ...[['worklog','工作紀錄'], ['tasks','工作待辦'], ['library','Knowledge'], ['sync','控制台'], ['management','管理功能'], ['settings','設定']].map(([route, label]) => ({ name: `WorkLog/${route}`, entry: 'modules/worklog/index.html', title: label, description: '工作模組｜管理工作資訊與每日進度', worklog: true }))
];
function fixture(item) {
  let body;
  if (item.investment) body = investmentShell.render({ activePage: item.name.split('/')[1] });
  else if (item.worklog) body = '<div class="zhuge-module-shell workspace-shell workspace-worklog"><aside class="os-sidebar"></aside><div class="app workspace-app"><div data-zhuge-shared-header></div></div></div>';
  else body = read(item.entry).match(/<body[^>]*>([\s\S]*?)<\/body>/i)[1].replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles(item.entry)}</head><body>${body}
  <script src="${fixturePath(path.join(ROOT, 'shared/components/zhuge-shell.js'))}"></script>
  <script src="${fixturePath(path.join(ROOT, 'shared/components/golden-master.js'))}"></script>
  <script>
    const target = document.querySelector('[data-zhuge-shared-header]');
    const info = ${JSON.stringify(item)};
    const activeWorkspace=info.name.split('/')[1];
    const headerWorkIdentityStatus=()=>'<button class="work-identity-header-status" type="button">工作身分</button>';
    ${worklogActions}
    const actions = info.scope ? ZhugeGoldenMaster.renderHeaderActions({applicationScope:info.scope, readOnly:info.scope==='procurement',canCreateConsumer:info.scope==='c'}) : info.worklog ? workTodoHeaderActions() : info.investment ? '<button class="btn" type="button">↻ 重新整理</button>' : '';
    // Isolate the actual header ancestor tree; business content is not part
    // of this geometry audit and no business/runtime script is loaded.
    let ancestor=target;
    while(ancestor.parentElement && !ancestor.parentElement.classList.contains('zhuge-module-shell')) {
      for(const sibling of [...ancestor.parentElement.children]) if(sibling!==ancestor) sibling.remove();
      ancestor=ancestor.parentElement;
    }
    ZhugeSharedShell.mountHeader(target,{title:info.title||target.dataset.title,description:info.description||target.dataset.description,identity:{displayName:'PM',email:'pm@example.test'},showNavigationMenu:true,actionMarkup:actions});
    document.querySelector('.zhuge-module-shell').dataset.sharedNavigationActive='true';
    document.body.dataset.headerReady='true';
  </script></body></html>`;
}

test('Shared Header compact geometry and usable controls across all formal adopters', async () => {
  const executable = resolveBrowserExecutable() || chromium.executablePath();
  assert.ok(fs.existsSync(executable), 'Real Chromium required');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhuge-header-qa-'));
  const browser = await chromium.launch({ executablePath: executable, headless: true, args: ['--no-sandbox'] });
  const results = [];
  if (process.env.HEADER_QA_EVIDENCE_DIR) fs.mkdirSync(process.env.HEADER_QA_EVIDENCE_DIR, {recursive:true});
  try {
    for (const item of cases) {
      const file = path.join(dir, item.name.replaceAll('/', '-') + '.html');
      fs.writeFileSync(file, fixture(item));
      const url = await fixtureURL(file);
      for (const width of [1440, 1024, 390, 320]) {
        const page = await browser.newPage({ viewport: { width, height: 1000 } });
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.route('**/*', route => route.request().url().startsWith(new URL(url).origin + '/') ? route.continue() : route.abort());
        await page.goto(url);
        await page.waitForSelector('[data-header-ready]');
        const metrics = await page.evaluate(() => {
          const header = document.querySelector('.zhuge-shared-header');
          const rect = header.getBoundingClientRect();
          const visible = node => { const box=node.getBoundingClientRect(); const css=getComputedStyle(node); return box.width>0 && box.height>0 && css.display!=='none' && css.visibility!=='hidden' && !node.closest('details:not([open]) .board-header-status-popover'); };
          return { height:rect.height,width:rect.width,scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,title:header.querySelector('h1').textContent,identity:header.querySelector('[data-shared-identity]').textContent,kicker:header.querySelector('.zhuge-shared-header-kicker')!==null,actions:header.querySelector('.zhuge-shared-header-actions')!==null,controls:[...header.querySelectorAll('button,summary')].filter(visible).map(node=>{const box=node.getBoundingClientRect();return {label:node.getAttribute('aria-label')||node.textContent,width:box.width,height:box.height};})};
        });
        results.push({adopter:item.name,viewport:width,...metrics});
        assert.deepEqual(errors, [], item.name);
        assert.equal(metrics.kicker, false);
        assert.ok(metrics.title.trim());
        assert.match(metrics.identity, /PM.*pm@example.test/);
        assert.equal(metrics.scrollWidth, metrics.clientWidth, `${item.name} overflow at ${width}`);
        if (width === 1440) assert.ok(metrics.height >= 72 && metrics.height <= 76, `${item.name} desktop height ${metrics.height}`);
        else if (metrics.actions) assert.ok(metrics.height >= 110 && metrics.height <= 116, `${item.name} narrow height ${metrics.height}`);
        else assert.ok(metrics.height >= 72 && metrics.height <= 76, `${item.name} header without actions height ${metrics.height}`);
        for (const control of metrics.controls) assert.ok(control.width >= 44 && control.height >= 44, `${item.name}/${width} touch target ${JSON.stringify(control)}`);
        if (item.scope) {
          const trigger = page.locator('.board-header-status-menu > summary');
          await trigger.scrollIntoViewIfNeeded();
          await trigger.click();
          const refresh = page.locator('.board-header-status-popover [data-golden-master-action="refresh"]');
          await refresh.click();
          const popup = await page.locator('.board-header-status-popover').boundingBox();
          assert.ok(popup.x >= 0 && popup.x+popup.width <= width && popup.y >= 0 && popup.y+popup.height <= 1000, `${item.name}/${width} tools popup clipped ${JSON.stringify(popup)}`);
        }
        if (process.env.HEADER_QA_EVIDENCE_DIR && [390,1440].includes(width)) {
          fs.mkdirSync(process.env.HEADER_QA_EVIDENCE_DIR,{recursive:true});
          await page.screenshot({path:path.join(process.env.HEADER_QA_EVIDENCE_DIR,`${item.name.replaceAll('/','-')}-${width}.png`)});
        }
        await page.close();
      }
    }
  } finally {
    await browser.close(); fs.rmSync(dir, {recursive:true,force:true});
    if (process.env.HEADER_QA_EVIDENCE_DIR) fs.writeFileSync(path.join(process.env.HEADER_QA_EVIDENCE_DIR, 'header-geometry.json'),JSON.stringify(results,null,2)+'\n');
  }
});


test('Shared Workspace counts expose hidden TASK-079 and block delete without a writer call', async () => {
  const executable = resolveBrowserExecutable() || chromium.executablePath();
  assert.ok(fs.existsSync(executable));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(),'zhuge-count-qa-'));
  let html = read('tests/ai-board-batch-2-browser.html');
  const end = html.indexOf('</script>',html.indexOf('src="../shared/components/golden-master-runtime.js"'))+'</script>'.length;
  html = html.slice(0,end);
  html = html.replaceAll('../shared/',fixturePath(path.join(ROOT,'shared'))+'/');
  html = html.replace('  const mockWorkspaces = [','  const mockWorkspaces = [{id:"ws-e2e",key:"task-custom-e2e",name:"TASK-081-E2E-20260922",active:true,sortOrder:60},');
  html = html.replace('  const mockTasks = [','  const mockTasks = [{id:"task-079",workCode:"TASK-079",title:"Retained QA card",workspaceId:"ws-e2e",status:"done",completionAt:"2026-09-21T15:07:30Z",archiveDueAt:"2026-09-22T15:07:30Z",archivedAt:null},');
  html = html.replace('    projectWorkspaceTaskCounts:', '    isArchiveTask: window.ZhugeBoardReadService.isArchiveTask,\n    deleteWorkspace: async () => {window.deleteWriterCalls++;},\n    projectWorkspaceTaskCounts:');
  html = html.replace('  let session = null;', '  window.deleteWriterCalls=0;\n  let session = null;');
  const file = path.join(dir,'counts.html'); fs.writeFileSync(file,html);
  const url = await fixtureURL(file);
  const browser = await chromium.launch({executablePath:executable,headless:true,args:['--no-sandbox']});
  try {
    const page = await browser.newPage();
    const errors=[]; page.on('pageerror',error=>errors.push(error.message));
    await page.route('**/*',route=>route.request().url().startsWith(new URL(url).origin+'/')?route.continue():route.abort());
    await page.goto(url);
    const column=page.locator('[data-workspace-id="ws-e2e"]');
    await column.waitFor();
    assert.match(await column.locator('[data-workspace-count-summary]').innerText(),/目前卡 0.*歷史卡 1.*保留總數 1/s);
    assert.equal(await column.locator('.taskcard').count(),0);
    await page.fill('#boardSearch','no-match');
    assert.match(await column.locator('[data-workspace-count-summary]').innerText(),/保留總數 1/);
    await column.locator('[data-workspace-menu]').click();
    await page.click('[data-workspace-action="delete"]');
    await page.waitForFunction(()=>document.getElementById('boardReadStatus')?.textContent.includes('TASK-079'));
    assert.match(await page.locator('#boardReadStatus').innerText(),/目前無進行中卡片.*1 張歷史卡（TASK-079）.*不能刪除/);
    assert.equal(await page.evaluate(()=>window.deleteWriterCalls),0);
    assert.deepEqual(errors,[]);
  } finally {await browser.close();fs.rmSync(dir,{recursive:true,force:true});}
});
