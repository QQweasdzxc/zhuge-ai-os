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
const base = fs.readFileSync(path.join(root, 'supabase/migrations/20261102024755_office_member_roster.sql'), 'utf8');
const prefs = fs.readFileSync(path.join(root, 'supabase/migrations/20261103130000_office_member_roster_prefs.sql'), 'utf8');
async function database() {
  const db = new PGlite();
  await db.exec(`create schema auth; create role anon; create role authenticated;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${A}'),('${B}');
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema public,auth to anon,authenticated;`);
  await db.exec(base);
  await db.exec(prefs);
  return db;
}
async function asUser(db, owner, sql, params = []) {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [owner || '']);
  await db.exec(`set role ${owner ? 'authenticated' : 'anon'}`);
  try { return await db.query(sql, params); } finally { await db.exec('reset role'); }
}
// HTTP-shaped adapter (see pixel-office-3d-roster-cloud.test.js), widened for prefs.
function transport(db) {
  return async (url, init = {}) => {
    const u = new URL(url), method = init.method || 'GET';
    const auth = init.headers.Authorization;
    const owner = auth === 'Bearer fixture-A' ? A : auth === 'Bearer fixture-B' ? B : null;
    const reply = (status, rows) => ({ok:status<300,status,json:async()=>rows});
    try {
      let result;
      if (method === 'GET') result = await asUser(db,owner,'select owner,names,prefs,updated_at::text from office_member_roster where owner=$1',[u.searchParams.get('owner').slice(3)]);
      else {
        const body = JSON.parse(init.body);
        if (method === 'POST') {
          result = await asUser(db,owner,'insert into office_member_roster(owner,names,prefs) values($1,$2,$3) returning owner,names,prefs,updated_at::text',
            [body.owner,body.names || [],JSON.stringify(body.prefs || {})]);
        } else if (body.prefs !== undefined) {
          result = await asUser(db,owner,'update office_member_roster set prefs=$1 where owner=$2 and updated_at=$3 returning owner,names,prefs,updated_at::text',
            [JSON.stringify(body.prefs),u.searchParams.get('owner').slice(3),u.searchParams.get('updated_at').slice(3)]);
        } else {
          result = await asUser(db,owner,'update office_member_roster set names=$1 where owner=$2 and updated_at=$3 returning owner,names,prefs,updated_at::text',
            [body.names,u.searchParams.get('owner').slice(3),u.searchParams.get('updated_at').slice(3)]);
        }
      }
      return reply(200,result.rows);
    } catch(e) { return reply(e.code==='23505'?409:403,[]); }
  };
}
function device(db) {
  const map = new Map();
  const storage = {getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
  let token = 'fixture-A';
  const sync = Members.createSync({storage,getToken:()=>token,getAuth:async()=>token?{token,owner:token==='fixture-A'?A:B}:null,
    fetchImpl:transport(db),config:{supabaseUrl:'https://fixture.test',supabaseAnonKey:'public-fixture-key'}});
  return {sync,setToken:t=>{token=t;}};
}
test('real migration SQL: prefs defaults to empty object, rejects non-object, stays owner-only under RLS', async t => {
  const db = await database(); t.after(() => db.close());
  await asUser(db,A,'insert into office_member_roster(owner,names) values($1,$2)',[A,['Fixture A']]);
  assert.deepEqual((await asUser(db,A,'select prefs from office_member_roster')).rows[0].prefs,{});
  await assert.rejects(asUser(db,A,"update office_member_roster set prefs='[]'::jsonb"),e=>e.code==='23514');
  await assert.rejects(asUser(db,A,"update office_member_roster set prefs='\"female\"'::jsonb"),e=>e.code==='23514');
  await asUser(db,A,"update office_member_roster set prefs=$1",[JSON.stringify({'Fixture A':'female'})]);
  assert.equal((await asUser(db,B,'select prefs from office_member_roster')).rows.length,0);
  assert.equal((await asUser(db,B,"update office_member_roster set prefs='{}' returning *")).rows.length,0);
  await assert.rejects(asUser(db,null,'select prefs from office_member_roster'),e=>e.code==='42501');
});
test('parsePrefs keeps only female/male and tolerates garbage', () => {
  assert.deepEqual(Members.parsePrefs('{"x":"female","y":"male","z":"other","n":3}'),{x:'female',y:'male'});
  assert.deepEqual(Members.parsePrefs('not json'),{});
  assert.deepEqual(Members.parsePrefs(['female']),{});
  assert.deepEqual(Members.parsePrefs(null),{});
});
test('toSessions carries appearance, defaulting to auto', () => {
  const out = Members.toSessions(['Ann','Bo'],{Ann:'female',Bo:'weird'});
  assert.equal(out[0].appearance,'female');
  assert.equal(out[1].appearance,'auto');
});
test('saveAppearance persists under RLS, auto removes the override, invalid values never reach the network', async t => {
  const db = await database(); t.after(() => db.close());
  const d = device(db);
  await d.sync.save(['Fixture A','Fixture B']);
  await assert.rejects(d.sync.saveAppearance('Fixture A','weird'),e=>e.message==='bad-appearance');
  assert.deepEqual((await asUser(db,A,'select prefs from office_member_roster')).rows[0].prefs,{});
  await d.sync.saveAppearance('Fixture A','female');
  assert.deepEqual((await asUser(db,A,'select prefs from office_member_roster')).rows[0].prefs,{'Fixture A':'female'});
  assert.deepEqual(d.sync.appearance(),{'Fixture A':'female'});
  // Another account only ever writes its own row; A's prefs are untouched.
  d.setToken('fixture-B');
  await d.sync.saveAppearance('Fixture A','male');
  assert.deepEqual((await asUser(db,B,'select prefs from office_member_roster')).rows[0].prefs,{'Fixture A':'male'});
  assert.deepEqual((await asUser(db,A,'select prefs from office_member_roster')).rows[0].prefs,{'Fixture A':'female'});
  d.setToken('fixture-A');
  await d.sync.sync();
  await d.sync.saveAppearance('Fixture A','auto');
  assert.deepEqual((await asUser(db,A,'select prefs from office_member_roster')).rows[0].prefs,{});
});
