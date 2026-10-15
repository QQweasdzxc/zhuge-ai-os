const fs=require('node:fs');const {PGlite}=require('@electric-sql/pglite');
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',card='33333333-3333-4333-8333-333333333333',workspace='44444444-4444-4444-8444-444444444444',id='018f0000-0000-7000-8000-000000000001';
const fixtureSQL=`create role anon;create role authenticated;create role service_role;
create schema auth;create schema storage;create schema taskflow;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function public.is_engineering_member(roles text[] default array['owner']) returns boolean language sql stable as $$select auth.uid()='${owner}'::uuid$$;
create function public.board_instance_can_read(id uuid) returns boolean language sql stable as $$select auth.uid()='${owner}'::uuid$$;
create function public.board_instance_can_write(id uuid) returns boolean language sql stable as $$select auth.uid()='${owner}'::uuid$$;
create table storage.objects(bucket_id text,name text,metadata jsonb);
create table public.board_instances(id uuid,legacy_application_scope text,task_code_prefix text);
create table public.board_tasks(id uuid primary key,application_scope text,status text,owner_uuid uuid,board_instance_id uuid,title text default 'card');
create table public.board_task_attachments(id uuid primary key,task_id uuid,storage_bucket text,storage_path text,filename text,byte_size bigint,upload_status text,deletion_status text);
create table taskflow.issue_status(id uuid,key text,workspace_id uuid,category text);
create table taskflow.issue(id uuid primary key,workspace_id uuid,status text,title text default 'fixture');
create table taskflow.member(workspace_id uuid,user_id uuid,role text default 'owner');
create table taskflow.comment(id uuid,issue_id uuid);
create table taskflow.attachment(id uuid primary key,issue_id uuid,comment_id uuid,workspace_id uuid,url text,filename text,size_bytes bigint,uploader_id uuid);
grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
insert into taskflow.issue_status values(gen_random_uuid(),'finished','${workspace}','done'),(gen_random_uuid(),'todo','${workspace}','unstarted');
insert into taskflow.member(workspace_id,user_id) values('${workspace}','${owner}');
insert into board_tasks(id,application_scope,status,owner_uuid) values('${card}','worktodo','done','${owner}');
insert into taskflow.issue(id,workspace_id,status) values('${card}','${workspace}','finished');
insert into board_task_attachments values('${id}','${card}','board-task-attachments','${card}/${id}/a.pdf','a.pdf',10,'ready','active');
set request.jwt.claim.sub='${owner}';`;
async function fixture(){const db=new PGlite();await db.exec(fixtureSQL);
await db.exec(fs.readFileSync('labs/attachments/sql/lifecycle_candidate.sql','utf8'));await db.exec('select attachment_lifecycle.activate()');return db;}

module.exports={fixture,fixtureSQL,owner,other,card,workspace,id};
