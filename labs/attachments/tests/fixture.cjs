const fs=require('node:fs');const {PGlite}=require('@electric-sql/pglite');
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',card='33333333-3333-4333-8333-333333333333',boardCard='33333333-3333-4333-8333-333333333334',workflowCard='33333333-3333-4333-8333-333333333335',unboundCard='33333333-3333-4333-8333-333333333336',investmentCard='33333333-3333-4333-8333-333333333337',genericCompletedCard='33333333-3333-4333-8333-333333333338',aiInstance='66666666-6666-4666-8666-666666666666',worktodoInstance='77777777-7777-4777-8777-777777777777',workflowStep='88888888-8888-4888-8888-888888888888',ordinaryStep='88888888-8888-4888-8888-888888888889',workspace='44444444-4444-4444-8444-444444444444',id='018f0000-0000-7000-8000-000000000001',boardId='018f0000-0000-7000-8000-000000000002',workflowId='018f0000-0000-7000-8000-000000000003',worktodoManualId='018f0000-0000-7000-8000-000000000004',boardAutoId='018f0000-0000-7000-8000-000000000005';
const fixtureSQL=`create role anon;create role authenticated;create role service_role;
create schema auth;create schema storage;create schema taskflow;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function public.is_engineering_member(roles text[] default array['owner']) returns boolean language sql stable as $$select auth.uid()='${owner}'::uuid$$;
create function public.board_instance_can_read(id uuid) returns boolean language sql stable as $$select auth.uid()='${owner}'::uuid$$;
create function public.board_instance_can_write(id uuid) returns boolean language sql stable as $$select auth.uid()='${owner}'::uuid$$;
create table storage.objects(bucket_id text,name text,metadata jsonb);
create table public.board_instances(id uuid,legacy_application_scope text,task_code_prefix text);
create table public.board_workflow_steps(id uuid primary key,is_completion boolean not null default false);
create table public.board_tasks(id uuid primary key,application_scope text,status text,owner_uuid uuid,board_instance_id uuid,current_workflow_step_id uuid,title text default 'card');
create table public.board_task_attachments(id uuid primary key,task_id uuid,storage_bucket text,storage_path text,filename text,byte_size bigint,upload_status text,deletion_status text,deleted_at timestamptz,deleted_by uuid);
create table taskflow.issue_status(id uuid,key text,workspace_id uuid,category text);
create table taskflow.issue(id uuid primary key,workspace_id uuid,status text,title text default 'fixture');
create table taskflow.member(workspace_id uuid,user_id uuid,role text default 'owner');
create table taskflow.comment(id uuid,issue_id uuid);
create table taskflow.attachment(id uuid primary key,issue_id uuid,comment_id uuid,workspace_id uuid,url text,filename text,size_bytes bigint,uploader_id uuid);
grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
insert into taskflow.issue_status values(gen_random_uuid(),'finished','${workspace}','done'),(gen_random_uuid(),'todo','${workspace}','unstarted');
insert into taskflow.member(workspace_id,user_id) values('${workspace}','${owner}');
insert into board_instances values('${aiInstance}','ai_board','TASK'),('${worktodoInstance}','worktodo','WLTK'),(gen_random_uuid(),'investment','IVTK');
insert into board_workflow_steps values('${workflowStep}',true),('${ordinaryStep}',false);
insert into board_tasks(id,application_scope,status,owner_uuid,board_instance_id,current_workflow_step_id) values
 ('${card}','worktodo','completed','${owner}','${worktodoInstance}',null),
 ('${boardCard}','ai_board','done','${owner}','${aiInstance}',null),
 ('${workflowCard}',null,'completed','${owner}','${aiInstance}','${workflowStep}'),
 ('${unboundCard}',null,'completed','${owner}',null,null),
 ('${investmentCard}','c','completed','${owner}',(select id from board_instances where legacy_application_scope='investment'),null),
 ('${genericCompletedCard}','ai_board','completed','${owner}','${aiInstance}','${ordinaryStep}');
insert into taskflow.issue(id,workspace_id,status) values('${card}','${workspace}','finished');
insert into board_task_attachments values('${id}','${card}','board-task-attachments','${card}/${id}/a.pdf','a.pdf',10,'ready','active');
insert into board_task_attachments values('${worktodoManualId}','${card}','board-task-attachments','${card}/${worktodoManualId}/manual.pdf','manual.pdf',14,'ready','active');
insert into board_task_attachments values('${boardId}','${boardCard}','board-task-attachments','${boardCard}/${boardId}/b.pdf','b.pdf',11,'ready','active');
insert into board_task_attachments values('${boardAutoId}','${boardCard}','board-task-attachments','${boardCard}/${boardAutoId}/auto.pdf','auto.pdf',15,'ready','active');
insert into board_task_attachments values('${workflowId}','${workflowCard}','board-task-attachments','${workflowCard}/${workflowId}/c.pdf','c.pdf',12,'ready','active');
insert into board_task_attachments values(gen_random_uuid(),'${unboundCard}','board-task-attachments','${unboundCard}/unbound.pdf','unbound.pdf',13,'ready','active');
set request.jwt.claim.sub='${owner}';`;
async function fixture(){const db=new PGlite();await db.exec(fixtureSQL);
await db.exec(fs.readFileSync('labs/attachments/sql/lifecycle_candidate.sql','utf8'));await db.exec('select attachment_lifecycle.activate()');return db;}

module.exports={fixture,fixtureSQL,owner,other,card,boardCard,workflowCard,unboundCard,investmentCard,genericCompletedCard,aiInstance,worktodoInstance,workflowStep,ordinaryStep,workspace,id,boardId,workflowId,worktodoManualId,boardAutoId};
