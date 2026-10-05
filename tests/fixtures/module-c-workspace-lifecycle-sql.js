const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');
const read=file=>fs.readFileSync(path.join(__dirname,'../..',file),'utf8');
const authority=read('docs/supabase/20260910_c_workflow_capability_v2.sql');
function fn(source, name) {
  const start = source.indexOf(`create or replace function ${name}(`);
  assert.ok(start >= 0, name);
  return source.slice(start, source.indexOf('$function$;', source.indexOf('as $function$', start)) + '$function$;'.length);
}
const owner = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const board = '10000000-0000-4000-8000-000000000001';
const foreignBoard = '10000000-0000-4000-8000-000000000002';
const todo = '20000000-0000-4000-8000-000000000001';
const history = '20000000-0000-4000-8000-000000000002';
const completed = '20000000-0000-4000-8000-000000000003';
const empty = '20000000-0000-4000-8000-000000000004';
const foreignWorkspace = '20000000-0000-4000-8000-000000000005';
const task = '30000000-0000-4000-8000-000000000079';
async function fixture(published = true) {
  const db = new PGlite();
  await db.exec(`
    create schema auth; create schema private; create role anon; create role authenticated;
    create table private.board_c_consumer_provision_idempotency(idempotency_key text primary key,request_hash text,board_instance_id uuid,response jsonb,status text,expires_at timestamptz default now()+interval '24 hours');
    create table private.module_c_completion_archive_policies(policy_identity text default 'local-policy',policy_source text default 'local-qa',policy_key text,policy_version int,status text,archive_delay_seconds int);insert into private.module_c_completion_archive_policies(policy_key,policy_version,status,archive_delay_seconds) values ('completion_archive',2,'published',86400);
    create table module_releases(module_id text primary key,published_version text,published_build text,source_commit text,source_fingerprint text,published_at timestamptz,consumer_adoptions jsonb,updated_at timestamptz);
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${owner}'), ('${other}');
    create table app_users(auth_user_id uuid,role text);insert into app_users values ('${owner}','owner');
    create function is_app_access_approved() returns boolean language plpgsql stable as $$ begin return auth.uid() is not null; end $$;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.uid', true),'')::uuid $$;
    select set_config('request.uid','${owner}',false);
    create table board_instances(id uuid primary key default gen_random_uuid(), active boolean not null default true, owner_uuid uuid, legacy_application_scope text, name text default 'Local QA', template_key text default 'c', authorization_mode text default 'owner', task_code_prefix text default 'QA',is_template_instance boolean default false,created_by uuid,updated_at timestamptz default now());
    insert into board_instances(id,owner_uuid) values ('${board}','${owner}'),('${foreignBoard}','${other}');
    create function board_instance_can_write(id uuid) returns boolean language sql stable security definer as $$ select exists(select 1 from board_instances b where b.id=$1 and owner_uuid=auth.uid() and active) $$;
    create function board_instance_can_read(id uuid) returns boolean language sql stable security definer as $$ select board_instance_can_write($1) $$;
    create table board_workspaces(id uuid primary key default gen_random_uuid(), board_instance_id uuid references board_instances, workspace_key text not null,
      name text not null, sort_order integer not null, active boolean not null default true, archived_at timestamptz,
      application_scope text default 'c', owner_uuid uuid, created_by uuid references auth.users,
      created_at timestamptz default now(), updated_at timestamptz default now(), updated_by uuid references auth.users);
    create table board_tasks(id uuid primary key default gen_random_uuid(), workspace_id uuid references board_workspaces on delete restrict,
      board_instance_id uuid references board_instances, work_code text, title text, status text, summary text, assignee text, usage_scenario text, application_scope text, owner_uuid uuid, created_by uuid, completion_at timestamptz,
      archive_due_at timestamptz, archived_at timestamptz, workflow_version_id uuid, current_workflow_step_id uuid);
    create table engineering_activity_log(id uuid primary key default gen_random_uuid(), entity_type text, entity_id text, action text,
      before_data jsonb, after_data jsonb, note text, actor_id uuid, actor_type text, actor_label text, activity_type text);
    create table retained_attachments(id uuid primary key default gen_random_uuid(), task_id uuid references board_tasks, object_key text);
    insert into board_workspaces(id,board_instance_id,workspace_key,name,sort_order) values
      ('${todo}','${board}','todo','待辦',10), ('${history}','${board}','custom-e2e','TASK-081-E2E-20260922',20),
      ('${completed}','${board}','completed','完成',30), ('${empty}','${board}','empty','空工作區',40),
      ('${foreignWorkspace}','${foreignBoard}','custom','另一個看板',10);
    insert into board_tasks(id,workspace_id,board_instance_id,work_code,title,status) values
      ('${task}','${history}','${board}','TASK-079','Historical owner','done');
    insert into retained_attachments(task_id,object_key) values ('${task}','unchanged-evidence');
  `);
  await db.exec(authority.slice(authority.indexOf('create table if not exists public.board_workflow_definitions'), authority.indexOf('create table if not exists public.board_workflow_adoptions')));
  await db.exec('alter table board_tasks add foreign key(workflow_version_id) references board_workflow_definitions on delete restrict; alter table board_tasks add foreign key(current_workflow_step_id) references board_workflow_steps on delete restrict;');
  await db.exec(authority.slice(authority.indexOf('create table if not exists private.board_workflow_action_idempotency'),authority.indexOf('alter table public.board_workflow_definitions enable')));
  await db.exec('drop index board_workflow_one_initial_step_idx; drop index board_workflow_one_completion_step_idx;');
  for (const name of ['private.board_workflow_snapshot', 'public.board_c_workflow_save_draft', 'public.board_c_workflow_validate_draft']) await db.exec(fn(authority, name));
  await db.exec(fn(read('docs/supabase/20260910_c_workflow_publish_state_fix.sql'), 'public.board_c_workflow_publish'));
  await db.exec(fn(read('docs/supabase/20260913_c_completion_archive_optional_workflow.sql'), 'private.board_c_completion_archive_designation'));
  await db.exec(read('docs/supabase/20260915_c_workspace_delete_populated_fail_closed.sql'));
  await db.exec(fn(read('supabase/migrations/20261002193217_task_35_module_c_workspace_ordering_authority.sql'),'public.enforce_worktodo_workspace_scope'));
  await db.exec('create trigger trg_enforce_worktodo_workspace_scope before update or delete on board_workspaces for each row execute function enforce_worktodo_workspace_scope();');
  await db.exec(read('supabase/migrations/20261003213137_module_c_workspace_archive_restore_lifecycle.sql'));
  await db.exec(fn(read('docs/supabase/20260914_c_shared_create_workflow_resolution.sql'), 'private.board_c_resolve_workflow_create_state'));
  await db.exec(`create function private.board_workflow_role_label(role_key text) returns text language sql immutable as $$ select upper($1) $$;`);
  await db.exec(fn(read('docs/supabase/20260922_task_081_optional_workflow.sql'), 'public.enforce_module_c_workflow_invariant'));
  await db.exec('create trigger task_workflow_guard before insert or update on board_tasks for each row execute function enforce_module_c_workflow_invariant();');
  const creatorSource=read('docs/supabase/20260828_universal_board_contract.sql');
  const creatorStart=creatorSource.indexOf('create or replace function public.board_create_instance(');
  await db.exec(creatorSource.slice(creatorStart,creatorSource.indexOf('$$;',creatorSource.indexOf('as $$',creatorStart))+3));
  await db.exec(`insert into module_releases(module_id,published_version,published_build,source_commit,source_fingerprint,published_at,consumer_adoptions) values ('c','0.9.0-alpha.9.13','20260915-1707','retained-source','retained-fingerprint',now(),'{}');`);
  await db.exec(read('supabase/migrations/20261004025202_module_c_workspace_step_task_create_lifecycle.sql'));
  if (published) {
    const workspaces = (await db.query('select * from board_workspaces where board_instance_id=$1 order by sort_order',[board])).rows;
    const steps = workspaces.map(w => ({workspace_id:w.id, step_key:w.workspace_key, name:w.id===todo?'PM custom phase':w.name, sort_order:w.sort_order, role_key:'co',status_key:w.id===history?'done':'ready',is_initial:false,is_completion:false}));
    const edges = [{transition_key:'todo-history',from_step_key:'todo',to_step_key:'custom-e2e',allowed_roles:['pm']}, {transition_key:'todo-complete',from_step_key:'todo',to_step_key:'completed',allowed_roles:['pm']}];
    const gates = [{gate_key:'retained-gate',step_key:'custom-e2e',name:'Historical confirmation'}, {gate_key:'active-gate',step_key:'todo',name:'Existing confirmation'}];
    const evidence = [{gate_key:'retained-gate',evidence_key:'retained-evidence',label:'History',source_kind:'artifact'}, {gate_key:'active-gate',evidence_key:'active-evidence',label:'Active',source_kind:'artifact'}];
    const saved = (await db.query('select board_c_workflow_save_draft($1,$2,null,$3::jsonb,$4::jsonb,$5::jsonb,$6::jsonb) result',[board,'Local QA',JSON.stringify(steps),JSON.stringify(edges),JSON.stringify(gates),JSON.stringify(evidence)])).rows[0].result;
    await db.query('select board_c_workflow_publish($1)',[saved.workflow.id]);
    await db.query("update board_tasks set workflow_version_id=$1,current_workflow_step_id=$2,assignee=private.board_workflow_role_label('co') where id=$3",[saved.workflow.id,saved.workflow.steps.find(s=>s.workspace_id===history).id,task]);
  }
  return db;
}
module.exports={fixture,fn,read,owner,other,board,foreignBoard,todo,history,completed,empty,foreignWorkspace,task};
