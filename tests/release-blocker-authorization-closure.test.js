const test = require('node:test');
const assert = require('node:assert/strict');
const { fixture, read, owner, other, task } = require('./fixtures/module-c-workspace-lifecycle-sql');

const migration = read('supabase/migrations/20261004114949_release_blocker_authorization_closure.sql');
const worklogOwner = 'ac5afcc7-f045-41a9-8827-eaf085a04c0d';
const attachment = '40000000-0000-4000-8000-000000000001';
const entry = '50000000-0000-4000-8000-000000000001';
const writers = [
  ['worklog_alpha_capture_qq(timestamptz,text,text,numeric)', "worklog_alpha_capture_qq(now(),'QA',null,1)"],
  ['worklog_alpha_cleanup_qq()', 'worklog_alpha_cleanup_qq()'],
  ['worklog_rc1_delete_entry_qq(uuid)', `worklog_rc1_delete_entry_qq('${entry}')`],
  ['worklog_rc1_update_entry_qq(uuid,timestamptz,text,text,numeric)', `worklog_rc1_update_entry_qq('${entry}',now(),'QA',null,1)`],
  ['worklog_rc1_upsert_source_event_qq(text,text,date,text,numeric,numeric,jsonb,jsonb)', "worklog_rc1_upsert_source_event_qq('qa','key',current_date,'QA',1,1,'{}','{}')"]
];

async function setup() {
  const db = await fixture(false);
  const source = read('docs/supabase/20260828_universal_board_contract.sql');
  const start = source.indexOf('create or replace function public.board_task_can_write(');
  await db.exec(source.slice(start, source.indexOf('$$;', source.indexOf('as $$', start)) + 3));
  await db.exec(`
    create role service_role;
    grant usage on schema public,auth to anon,authenticated,service_role;
    create table board_task_attachments(id uuid primary key,task_id uuid references board_tasks,filename text,
      object_path text,deletion_status text default 'active');
    insert into board_task_attachments values ('${attachment}','${task}','original.txt','retained/object','active');
    create table worklog_entries(id uuid primary key default gen_random_uuid(),user_id uuid,work_datetime timestamptz,
      title text,note text,source text,status text,estimated_hours numeric);
    create table worklog_source_events(id uuid primary key default gen_random_uuid(),user_id uuid,role text,source_type text,
      event_key text,event_date date,title text,suggested_hours numeric,quantity numeric,evidence jsonb,raw_payload jsonb,
      status text,updated_at timestamptz default now(),unique(user_id,source_type,event_key));
    insert into worklog_entries(id,user_id,work_datetime,title) values ('${entry}','${worklogOwner}',now(),'Retained');
  `);
  await db.exec(migration);
  return db;
}

test('legacy Workspace writer denies all client roles and cannot write even as its owner', async t => {
  const db = await setup(); t.after(() => db.close());
  const before = (await db.query('select * from board_workspaces order by id')).rows;
  for (const role of ['anon','authenticated','service_role']) {
    assert.equal((await db.query("select has_function_privilege($1,'board_create_workspace(text)','EXECUTE') allowed", [role])).rows[0].allowed, false);
    await db.exec(`set role ${role}`);
    await assert.rejects(() => db.query("select board_create_workspace('Bypass')"), e => e.code === '42501');
    await db.exec('reset role');
  }
  await assert.rejects(() => db.query("select board_create_workspace('Owner bypass')"), /Legacy Workspace create is retired/);
  assert.deepEqual((await db.query('select * from board_workspaces order by id')).rows, before);
});

test('attachment metadata uses parent Task authorization and preserves stored object ownership', async t => {
  const db = await setup(); t.after(() => db.close());
  const before = (await db.query('select * from board_task_attachments')).rows[0];
  assert.equal(before.display_name, null); assert.equal(before.note, null);
  await db.exec('set role authenticated');
  const renamed = (await db.query('select (board_update_task_attachment_metadata($1,$2,$3)).*', [attachment,'Readable name','Evidence note'])).rows[0];
  assert.equal(renamed.display_name,'Readable name'); assert.equal(renamed.note,'Evidence note');
  await db.exec('reset role');
  for (const actor of [other, null]) {
    await db.query("select set_config('request.uid',$1,false)", [actor || '']);
    await db.exec('set role authenticated');
    await assert.rejects(() => db.query('select board_update_task_attachment_metadata($1,$2,$3)', [attachment,'Forbidden','Forbidden']), /authorization|AUTH_REQUIRED/);
    await db.exec('reset role');
  }
  for (const role of ['anon','service_role']) {
    await db.exec(`set role ${role}`);
    await assert.rejects(() => db.query('select board_update_task_attachment_metadata($1)',[attachment]), e => e.code === '42501');
    await db.exec('reset role');
  }
  const after = (await db.query('select * from board_task_attachments')).rows[0];
  assert.deepEqual(after, renamed);
  for (const key of Object.keys(before).filter(k => !['display_name','note'].includes(k))) assert.deepEqual(after[key],before[key]);
  await db.query("select set_config('request.uid',$1,false)",[owner]);
});

test('five WorkLog writers deny anonymous, missing-session and foreign-owner writes', async t => {
  const db = await setup(); t.after(() => db.close());
  const before = (await db.query('select * from worklog_entries order by id')).rows;
  for (const [signature, call] of writers) {
    for (const role of ['anon','service_role']) {
      assert.equal((await db.query('select has_function_privilege($1,$2,\'EXECUTE\') allowed',[role,signature])).rows[0].allowed,false);
      await db.exec(`set role ${role}`);
      await assert.rejects(() => db.query(`select ${call}`),e => e.code === '42501');
      await db.exec('reset role');
    }
    for (const actor of [other,null]) {
      await db.query("select set_config('request.uid',$1,false)",[actor || '']);
      await db.exec('set role authenticated');
      await assert.rejects(() => db.query(`select ${call}`),e => e.code === '42501');
      await db.exec('reset role');
    }
  }
  assert.deepEqual((await db.query('select * from worklog_entries order by id')).rows,before);
  assert.equal((await db.query('select count(*)::int n from worklog_source_events')).rows[0].n,0);
});

test('authenticated fixed WorkLog owner retains capture/update/upsert/cleanup/delete capability', async t => {
  const db = await setup(); t.after(() => db.close());
  await db.query("select set_config('request.uid',$1,false)",[worklogOwner]);
  await db.exec('set role authenticated');
  const row = (await db.query("select (worklog_alpha_capture_qq(now(),'Captured','Task',2)).*")).rows[0];
  assert.equal(row.user_id,worklogOwner);
  const updated = (await db.query("select (worklog_rc1_update_entry_qq($1,now(),'Updated','Note',3)).*",[row.id])).rows[0];
  assert.equal(updated.title,'Updated'); assert.equal(updated.estimated_hours,'3');
  const event = (await db.query("select (worklog_rc1_upsert_source_event_qq('qa','key',current_date,'Event',1)).*")).rows[0];
  const retry = (await db.query("select (worklog_rc1_upsert_source_event_qq('qa','key',current_date,'Revised',2)).*")).rows[0];
  assert.equal(retry.id,event.id); assert.equal(retry.title,'Revised');
  assert.equal((await db.query('select worklog_alpha_cleanup_qq() n')).rows[0].n,0);
  assert.equal((await db.query('select worklog_rc1_delete_entry_qq($1) ok',[row.id])).rows[0].ok,true);
  await db.exec('reset role');
  assert.equal((await db.query('select count(*)::int n from worklog_entries where id=$1',[row.id])).rows[0].n,0);
});
