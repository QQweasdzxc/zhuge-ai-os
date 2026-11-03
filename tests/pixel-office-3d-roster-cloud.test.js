'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const Members = require('../labs/pixel-office-3d/members');
const A = '00000000-0000-4000-8000-000000000001';
const B = '00000000-0000-4000-8000-000000000002';
const root = path.resolve(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261102024755_office_member_roster.sql'), 'utf8');
async function database() {
  const db = new PGlite();
  await db.exec(`create schema auth; create role anon; create role authenticated;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${A}'),('${B}');
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated;`);
  await db.exec(migration);
  return db;
}
async function asUser(db, owner, sql, params = []) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner || '']);
  await db.exec(`set role ${owner ? 'authenticated' : 'anon'}`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
}
test('real migration SQL: own CRUD, foreign SELECT/INSERT/UPDATE/DELETE, owner reassignment and anonymous rejection', async t => {
  const db = await database(); t.after(() => db.close());
  await asUser(db,A,'insert into office_member_roster(owner,names) values($1,$2)',[A,['Fixture A']]);
  assert.deepEqual((await asUser(db,A,'select names from office_member_roster')).rows[0].names,['Fixture A']);
  assert.equal((await asUser(db,B,'select * from office_member_roster')).rows.length,0);
  for (const sql of ['update office_member_roster set names=array[\'Intruder\'] returning *','delete from office_member_roster returning *']) {
    assert.equal((await asUser(db,B,sql)).rows.length,0);
  }
  await assert.rejects(asUser(db,B,'insert into office_member_roster(owner,names) values($1,$2)',[A,['Intruder']]), e => e.code === '42501');
  await assert.rejects(asUser(db,A,'update office_member_roster set owner=$1',[B]),e=>e.code==='42501');
  for (const sql of ['select * from office_member_roster',`insert into office_member_roster(owner) values('${B}')`, 'update office_member_roster set names=\'{}\'', 'delete from office_member_roster']) {
    await assert.rejects(asUser(db,null,sql),e=>e.code==='42501');
  }
  // authenticated role with no subject cannot bypass RLS either.
  await db.exec("set role authenticated; select set_config('request.jwt.claim.sub','',false)");
  assert.equal((await db.query('select * from office_member_roster')).rows.length,0);
  await assert.rejects(db.query('insert into office_member_roster(owner) values($1)',[B]),e=>e.code==='42501');
  await db.exec('reset role');
  await asUser(db,A,'update office_member_roster set names=$1',[['Fixture renamed']]);
  assert.deepEqual((await asUser(db,A,'select names from office_member_roster')).rows[0].names,['Fixture renamed']);
  await db.exec(fs.readFileSync(path.join(root,'labs/pixel-office-3d/sql/office_member_roster_postflight.sql'),'utf8'));
  await asUser(db,A,'delete from office_member_roster');
  assert.equal((await asUser(db,A,'select * from office_member_roster')).rows.length,0);
  await db.exec(fs.readFileSync(path.join(root,'labs/pixel-office-3d/sql/office_member_roster_rollback.sql'),'utf8'));
  assert.equal((await db.query("select to_regclass('public.office_member_roster') value")).rows[0].value,null);
});
// HTTP-shaped adapter executes every roster operation under the actual RLS
// policies. It is not a hosted PostgREST or GoTrue replacement claim.
function transport(db, { fail = () => false, beforeWrite = async () => {} } = {}) {
  return async (url, init = {}) => {
    const u = new URL(url), method = init.method || 'GET';
    const auth = init.headers.Authorization;
    const owner = auth === 'Bearer fixture-A' ? A : auth === 'Bearer fixture-B' ? B : null;
    assert.equal(init.credentials,'omit');
    assert.equal(init.headers.apikey,'public-fixture-key');
    if (fail(method)) return {ok:false,status:503};
    let result;
    const reply = (status, rows) => ({ok:status<300,status,json:async()=>rows});
    try {
      if (method === 'GET') result = await asUser(db,owner,'select owner,names,updated_at::text from office_member_roster where owner=$1',[u.searchParams.get('owner').slice(3)]);
      else {
        await beforeWrite();
        const body = JSON.parse(init.body);
        result = method === 'POST'
          ? await asUser(db,owner,'insert into office_member_roster(owner,names) values($1,$2) returning owner,names,updated_at::text',[body.owner,body.names])
          : await asUser(db,owner,'update office_member_roster set names=$1 where owner=$2 and updated_at=$3 returning owner,names,updated_at::text',[body.names,u.searchParams.get('owner').slice(3),u.searchParams.get('updated_at').slice(3)]);
      }
      return reply(200,result.rows);
    } catch(e) { return reply(e.code==='23505'?409:403,[]); }
  };
}
const config = {supabaseUrl:'https://fixture.test',supabaseAnonKey:'public-fixture-key'};
function device(db, local, options = {}) {
  const map = new Map(local === undefined ? [] : [[Members.KEY,JSON.stringify(local)]]);
  const storage = {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
  let token = 'fixture-A'; const states=[];
  const sync = Members.createSync({storage,getToken:()=>token,getAuth:async()=>token?{token,owner:token==='fixture-A'?A:B}:null,
    fetchImpl:transport(db,options),config,onChange:s=>states.push(s)});
  return {sync,map,states,setToken:t=>{token=t;}};
}
for (const [label,cloud,local,expected] of [
  ['cloud empty',[],['Fixture A','Fixture A','Fixture B'],['Fixture A','Fixture B']],
  ['both present',['Fixture A','Fixture B'],['Fixture B','Fixture C'],['Fixture A','Fixture B','Fixture C']],
  ['local empty',['Fixture A'],[],['Fixture A']],
  ['same roster',['Fixture A'],['Fixture A'],['Fixture A']],
  ['no legacy key',['Fixture A'],undefined,['Fixture A']],
]) test(`migration executes against RLS: ${label}`,async t=>{
  const db=await database();t.after(()=>db.close());
  if(cloud.length) await asUser(db,A,'insert into office_member_roster(owner,names) values($1,$2)',[A,cloud]);
  const d=device(db,local);
  assert.deepEqual(await d.sync.sync(),expected);
  if(local?.length) assert.equal(d.map.has(Members.KEY),false);
  assert.deepEqual((await asUser(db,A,'select names from office_member_roster')).rows[0]?.names||[],expected);
  await d.sync.save(['Fixture edited']);
  assert.deepEqual(await d.sync.sync(),['Fixture edited']);
  assert.equal(d.map.has(Members.KEY),!!(local && !local.length));
});
test('failed writes/invalid confirmation preserve legacy key and do not publish edits; retry migrates',async t=>{
  const db=await database();t.after(()=>db.close());let fail=true;
  const d=device(db,['Fixture A'],{fail:method=>fail&&method!=='GET'});
  await assert.rejects(d.sync.sync());
  assert.deepEqual(JSON.parse(d.map.get(Members.KEY)),['Fixture A']);assert.deepEqual(d.sync.visible(),[]);
  assert.equal(d.states.at(-1).status,'error');
  fail=false;await d.sync.sync();assert.equal(d.map.has(Members.KEY),false);
  fail=true;await assert.rejects(d.sync.save(['Unsaved']));assert.deepEqual(d.sync.visible(),['Fixture A']);
});
test('signed out never reads roster or writes local data; logout preserves pending migration and hides prior account',async t=>{
  const db=await database();t.after(()=>db.close());const d=device(db,['Legacy']);d.setToken(null);
  assert.deepEqual(await d.sync.sync(),[]);assert.equal(d.states.at(-1).pending,true);
  await assert.rejects(d.sync.save(['Unsaved']));assert.deepEqual(JSON.parse(d.map.get(Members.KEY)),['Legacy']);
  d.setToken('fixture-A');await d.sync.sync();d.setToken('fixture-B');assert.deepEqual(d.sync.visible(),[]);
  assert.deepEqual(await d.sync.sync(),[]);d.setToken(null);assert.deepEqual(d.sync.visible(),[]);
});
test('overflow retains every legacy name; concurrent local mutation/account switch cannot clear pending copy',async t=>{
  const db=await database();t.after(()=>db.close());
  await asUser(db,A,'insert into office_member_roster(owner,names) values($1,$2)',[A,Array.from({length:24},(_,i)=>`Fixture ${i}`)]);
  const full=device(db,['Legacy']);await assert.rejects(full.sync.sync());assert.ok(full.map.has(Members.KEY));
  assert.equal(full.states.at(-1).code,'roster-full');
  await asUser(db,A,'delete from office_member_roster');
  const legacyOverflow=device(db,Array.from({length:25},(_,i)=>`Legacy ${i}`));
  await assert.rejects(legacyOverflow.sync.sync());assert.equal(JSON.parse(legacyOverflow.map.get(Members.KEY)).length,25);
  let d=device(db,['Legacy'],{beforeWrite:async()=>d.map.set(Members.KEY,JSON.stringify(['New legacy']))});
  await assert.rejects(d.sync.sync());assert.deepEqual(JSON.parse(d.map.get(Members.KEY)),['New legacy']);
  d=device(db,['Legacy'],{beforeWrite:async()=>d.setToken('fixture-B')});
  await assert.rejects(d.sync.sync());assert.ok(d.map.has(Members.KEY));assert.deepEqual(d.sync.visible(),[]);
});
test('concurrent device update is merged after conditional-write conflict, never silently overwritten',async t=>{
  const db=await database();t.after(()=>db.close());
  await asUser(db,A,'insert into office_member_roster(owner,names) values($1,$2)',[A,['Cloud']]);let once=true;
  const d=device(db,['Legacy'],{beforeWrite:async()=>{
    if(once){once=false;await asUser(db,A,'update office_member_roster set names=$1',[['Cloud','Other device']]);}
  }});
  assert.deepEqual(await d.sync.sync(),['Cloud','Other device','Legacy']);assert.equal(d.map.has(Members.KEY),false);
});
test('browser login chain + mobile migration + desktop round trip run through real RLS SQL',async t=>{
  const {chromium}=require('playwright');
  const {resolveBrowserExecutable,fixtureURL}=require('./browser-executable');
  const db=await database();t.after(()=>db.close());
  const browser=await chromium.launch({executablePath:resolveBrowserExecutable(),args:['--no-sandbox','--disable-dev-shm-usage']});t.after(()=>browser.close());
  let failWrites=true,refreshes=0,verifiedUsers=0,restWrites=0;
  const rest=transport(db,{fail:m=>failWrites&&m!=='GET'});
  const mobile=await browser.newContext({viewport:{width:390,height:844}});
  const desktop=await browser.newContext({viewport:{width:1440,height:900}});
  const url=await fixtureURL(path.join(root,'labs/pixel-office-3d/index.html'));
  async function pageFor(context,seed) {
    const page=await context.newPage();
    await page.route('**/*',async route=>{
      const request=route.request(),u=new URL(request.url());
      if(u.hostname==='127.0.0.1') {
        if(u.pathname.endsWith('/events')) return route.fulfill({status:200,contentType:'text/event-stream',body:'data: {"sessions":[]}\n\n'});
        return route.continue();
      }
      const headers=request.headers();
      const reply=(status,body)=>route.fulfill({status,contentType:'application/json',body:JSON.stringify(body)});
      if(u.pathname==='/auth/v1/token') {
        assert.equal(JSON.parse(request.postData()).refresh_token,'fixture-refresh');refreshes++;
        return reply(200,{access_token:'fixture-A',refresh_token:'fixture-refresh-rotated',expires_in:3600});
      }
      if(u.pathname==='/auth/v1/user') {
        assert.equal(headers.authorization,'Bearer fixture-A');verifiedUsers++;
        return reply(200,{id:A});
      }
      if(u.pathname==='/rest/v1/office_member_roster') {
        assert.ok(headers.apikey);assert.equal(headers.authorization,'Bearer fixture-A');
        if(request.method()!=='GET') restWrites++;
        const response=await rest(request.url(),{method:request.method(),body:request.postData(),credentials:'omit',headers:{apikey:'public-fixture-key',Authorization:headers.authorization}});
        return reply(response.status,response.ok?await response.json():{});
      }
      return route.abort();
    });
    if(seed) await page.addInitScript(seed=>{
      if(seed.legacy) localStorage.setItem('zhuge.office.members',JSON.stringify(seed.legacy));
      if(seed.auth) localStorage.setItem('zhuge_ai_os_google_auth_session_v1',JSON.stringify(seed.auth));
    },seed);
    await page.goto(url);
    return page;
  }
  const phone=await pageFor(mobile,{legacy:['Fixture Mobile','Fixture Mobile']});
  await phone.waitForFunction(()=>document.querySelector('#memberSyncStatus').textContent.includes('未同步'));
  assert.equal(await phone.locator('#memberNames').isDisabled(),true);
  assert.equal(restWrites,0);
  // Google OAuth itself is external. Exercise the existing Google->Supabase
  // persisted session boundary and real shared refresh code, with fixture tokens.
  await phone.evaluate(()=>localStorage.setItem('zhuge_ai_os_google_auth_session_v1',JSON.stringify({access_token:'expired-fixture',refresh_token:'fixture-refresh',expires_at:Date.now()-1000})));
  await phone.reload();
  await phone.waitForFunction(()=>document.querySelector('#memberSyncStatus').textContent.includes('同步失敗'));
  assert.equal(await phone.evaluate(()=>localStorage.getItem('zhuge.office.members')),JSON.stringify(['Fixture Mobile','Fixture Mobile']));
  failWrites=false;
  await phone.locator('#memberSyncRetry').evaluate(el=>el.click());
  await phone.waitForFunction(()=>document.querySelector('#memberSyncStatus').textContent==='已同步至本人帳號');
  assert.equal(await phone.evaluate(()=>localStorage.getItem('zhuge.office.members')),null);
  assert.deepEqual((await asUser(db,A,'select names from office_member_roster')).rows[0].names,['Fixture Mobile']);
  const pc=await pageFor(desktop,{auth:{access_token:'fixture-A',expires_at:Date.now()+3600000}});
  await pc.waitForFunction(()=>document.querySelector('#memberNames').value==='Fixture Mobile');
  async function edit(page,names) {
    await page.locator('#memberNames').evaluate((el,names)=>{el.value=names;el.dispatchEvent(new Event('change',{bubbles:true}));},names);
    await page.waitForFunction(()=>document.querySelector('#memberSyncStatus').textContent==='已同步至本人帳號');
  }
  await edit(pc,'Fixture Desktop');
  await phone.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await phone.waitForFunction(()=>document.querySelector('#memberNames').value==='Fixture Desktop');
  await edit(phone,'Fixture Both');
  await pc.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await pc.waitForFunction(()=>document.querySelector('#memberNames').value==='Fixture Both');
  // Logout immediately removes cloud names and disables edits; no local cache.
  await phone.evaluate(()=>{localStorage.removeItem('zhuge_ai_os_google_auth_session_v1');window.dispatchEvent(new StorageEvent('storage',{key:'zhuge_ai_os_google_auth_session_v1'}));});
  await phone.waitForFunction(()=>document.querySelector('#memberNames').disabled&&document.querySelector('#memberNames').value==='');
  assert.equal(await phone.evaluate(()=>localStorage.getItem('zhuge.office.members')),null);
  assert.equal(refreshes,1);assert.ok(verifiedUsers>=5);assert.ok(restWrites>=4);
});
test('unconfirmed cloud response cannot remove legacy; failed reads preserve it; cap is enforced by SQL',async t=>{
  const db=await database();t.after(()=>db.close());
  const d=device(db,['Legacy'],{fail:()=>true});await assert.rejects(d.sync.sync());assert.ok(d.map.has(Members.KEY));
  const map=new Map([[Members.KEY,'["Legacy"]']]);
  const sync=Members.createSync({storage:{getItem:k=>map.get(k),removeItem:k=>map.delete(k)},getToken:()=> 'fixture-A',getAuth:async()=>({owner:A,token:'fixture-A'}),config,
    fetchImpl:async(url,init)=>({ok:true,status:200,json:async()=>init.method?[{owner:A,names:['Different'],updated_at:'2026-01-01'}]:[]})});
  await assert.rejects(sync.sync());assert.ok(map.has(Members.KEY));assert.deepEqual(sync.visible(),[]);
  await assert.rejects(asUser(db,A,'insert into office_member_roster(owner,names) values($1,$2)',[A,Array.from({length:25},(_,i)=>`Fixture ${i}`)]),e=>e.code==='23514');
});
