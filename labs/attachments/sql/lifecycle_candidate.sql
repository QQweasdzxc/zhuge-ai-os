-- REVIEW CANDIDATE ONLY. Not included in automatic application migrations.
-- Install with a separately approved database owner; preserves attachment identity
-- and user metadata while writing only the existing deletion tombstone fields after
-- Storage confirms a physical delete. Never changes Storage owners/grants/buckets.
begin;
create schema if not exists attachment_lifecycle;
revoke all on schema attachment_lifecycle from public, anon, authenticated;
create table attachment_lifecycle.config (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 enabled_at timestamptz,
 taskflow_max_file_bytes bigint not null default 50000000 check(taskflow_max_file_bytes between 1 and 50000000),
 capacity_bytes bigint not null default 1000000000 check(capacity_bytes > 0)
);
insert into attachment_lifecycle.config(singleton) values(true);
create table attachment_lifecycle.cards (
 module text not null check(module in ('taskflow','board','worktodo')),
 card_id uuid not null, completed_at timestamptz, generation uuid not null default gen_random_uuid(),
 primary key(module,card_id)
);
create table attachment_lifecycle.objects (
 module text not null, attachment_id uuid not null, card_id uuid,
 bucket text not null check(bucket in ('taskflow-attachments','board-task-attachments')),
 object_key text not null check(object_key <> '' and object_key !~ '(^|/)\.\.(/|$)'),
 filename text not null, byte_size bigint not null check(byte_size > 0),
 state text not null default 'ready' check(state in ('uploading','ready','deleting','deleted')),
 delete_token uuid, delete_generation uuid, deleted_at timestamptz, delete_reason text,
 primary key(module,attachment_id), unique(bucket,object_key)
);
create index attachment_lifecycle_due on attachment_lifecycle.cards(completed_at) where completed_at is not null;
create index attachment_lifecycle_owner on attachment_lifecycle.objects(module,card_id,state);
create index attachment_lifecycle_retry on attachment_lifecycle.objects(state) where state='deleting';
create table attachment_lifecycle.audit (
 id bigint generated always as identity primary key, module text not null,
 attachment_id uuid not null, action text not null, actor uuid,
 happened_at timestamptz not null default clock_timestamp()
);
alter table attachment_lifecycle.config enable row level security;
alter table attachment_lifecycle.cards enable row level security;
alter table attachment_lifecycle.objects enable row level security;
alter table attachment_lifecycle.audit enable row level security;

-- Shared storage also contains unrelated consumers. Preserve their behavior.
create function attachment_lifecycle.board_module(p_id uuid) returns text
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
 select case
   when b.id is not null and b.legacy_application_scope='worktodo'
        and coalesce(t.application_scope,'c') in ('c','board','worktodo') then 'worktodo'
   when b.id is not null and b.legacy_application_scope='ai_board'
        and coalesce(t.application_scope,'c') in ('c','board','ai_board') then 'board'
   when b.id is null and t.application_scope='worktodo' then 'worktodo'
   when b.id is null and t.application_scope in ('ai_board','board') then 'board'
   else null end
 from public.board_tasks t left join public.board_instances b on b.id=t.board_instance_id
 where t.id=p_id and coalesce(b.task_code_prefix,'')<>'IVTK'
$$;

-- WorkTodo owns the `completed` value. Board cards use their native `done`
-- status, plus a completion step only when the registered C workflow marks
-- that exact current step as complete. This does not infer completion from a
-- generic `completed` string on an unrelated or unbound task.
create function attachment_lifecycle.board_is_complete(p_id uuid,p_status text,p_step uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
 select case
   when attachment_lifecycle.board_module(p_id)='worktodo' then lower(coalesce(p_status,''))='completed'
   when attachment_lifecycle.board_module(p_id)='board' then lower(coalesce(p_status,''))='done'
     or (p_step is not null and exists(select 1 from public.board_workflow_steps s where s.id=p_step and s.is_completion))
   else false end
$$;

-- Includes unmanaged buckets and counts reserved uploads once. Never removes
-- existing objects to make room. Every reservation takes this same lock.
create function attachment_lifecycle.used_bytes() returns bigint
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
declare actual_bytes numeric; reserved_bytes numeric;
begin
 if exists(select 1 from storage.objects where coalesce(metadata->>'size','') !~ '^[0-9]+$') then
   raise exception using errcode='53100',message='storage size metadata unavailable; capacity is fail-closed';
 end if;
 select coalesce(sum((metadata->>'size')::numeric),0) into actual_bytes from storage.objects;
 select coalesce(sum(o.byte_size),0) into reserved_bytes from attachment_lifecycle.objects o
   where o.state <> 'deleted' and not exists(select 1 from storage.objects s
     where s.bucket_id=o.bucket and s.name=o.object_key);
 if actual_bytes+reserved_bytes > 9223372036854775807 then
   raise exception using errcode='53100',message='storage usage exceeds measurable capacity';
 end if;
 return (actual_bytes+reserved_bytes)::bigint;
end $$;

create function attachment_lifecycle.reserve(p_module text,p_id uuid,p_card uuid,p_bucket text,p_key text,p_name text,p_size bigint,p_state text)
returns void language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare c attachment_lifecycle.cards; cfg attachment_lifecycle.config;
begin
 select * into cfg from attachment_lifecycle.config where singleton;
 if not cfg.enabled then return; end if;
 if p_size > (case when p_module='taskflow' then cfg.taskflow_max_file_bytes else least(cfg.taskflow_max_file_bytes,26214400) end) then raise exception using errcode='22023',message='attachment exceeds configured file cap'; end if;
 -- Lock order matches status triggers. Lock the actual parent to serialize
 -- attachment INSERT/link with concurrent completion, including first upload.
 if p_card is not null then
   if p_module='taskflow' then perform 1 from taskflow.issue where id=p_card for update;
   else perform 1 from public.board_tasks where id=p_card for update; end if;
   select * into c from attachment_lifecycle.cards where module=p_module and card_id=p_card for update;
   if not found then raise exception 'attachment parent is untracked'; end if;
   if c.completed_at is not null then raise exception using errcode='23514',message='completed cards cannot receive attachments'; end if;
 end if;
 perform pg_advisory_xact_lock(450072);
 if attachment_lifecycle.used_bytes()+p_size > cfg.capacity_bytes then
   raise exception using errcode='53100',message='attachment storage capacity exhausted';
 end if;
 insert into attachment_lifecycle.objects(module,attachment_id,card_id,bucket,object_key,filename,byte_size,state)
 values(p_module,p_id,p_card,p_bucket,p_key,p_name,p_size,p_state);
end $$;

create function attachment_lifecycle.track_card() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare m text; done boolean; old_time timestamptz;
begin
 if not (select enabled from attachment_lifecycle.config where singleton) then return new; end if;
 if tg_table_schema='taskflow' then
   m:='taskflow';
   select category='done' into done from taskflow.issue_status where key=new.status and workspace_id=new.workspace_id;
 else
   m:=attachment_lifecycle.board_module(new.id); if m is null then return new; end if;
   done:=attachment_lifecycle.board_is_complete(new.id,new.status,new.current_workflow_step_id);
 end if;
 select completed_at into old_time from attachment_lifecycle.cards where module=m and card_id=new.id for update;
 if found and (old_time is not null)=coalesce(done,false) then return new; end if;
 -- An irreversible Storage call can already be in flight. Claims are possible
 -- only AFTER 72h; pre-72h reopen always succeeds and cancels the timer.
 if exists(select 1 from attachment_lifecycle.objects where module=m and card_id=new.id and state='deleting') then
   raise exception 'attachment deletion in progress; retry after cleanup recovery';
 end if;
 insert into attachment_lifecycle.cards(module,card_id,completed_at)
 values(m,new.id,case when done then clock_timestamp() end)
 on conflict(module,card_id) do update set completed_at=excluded.completed_at,generation=gen_random_uuid();
 return new;
end $$;
create trigger attachment_lifecycle_board_status after insert or update of status,current_workflow_step_id on public.board_tasks
 for each row execute function attachment_lifecycle.track_card();
create trigger attachment_lifecycle_taskflow_status after insert or update of status on taskflow.issue
 for each row execute function attachment_lifecycle.track_card();

create function attachment_lifecycle.board_object() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare m text;
begin
 if not (select enabled from attachment_lifecycle.config where singleton) then return new; end if;
 m:=attachment_lifecycle.board_module(new.task_id); if m is null then return new; end if;
 if tg_op='INSERT' then
   perform attachment_lifecycle.reserve(m,new.id,new.task_id,new.storage_bucket,new.storage_path,new.filename,new.byte_size,
     case when new.upload_status='ready' then 'ready' else 'uploading' end);
 elsif new.task_id is distinct from old.task_id or new.storage_path<>old.storage_path or new.storage_bucket<>old.storage_bucket or new.byte_size<>old.byte_size then
   raise exception 'attachment ownership and object identity are immutable';
 elsif new.upload_status='ready' and old.upload_status<>'ready' then
   perform 1 from public.board_tasks where id=new.task_id for update;
   if exists(select 1 from attachment_lifecycle.cards where module=m and card_id=new.task_id and completed_at is not null) then
     raise exception 'completed cards cannot receive attachments';
   end if;
   update attachment_lifecycle.objects set state='ready' where module=m and attachment_id=new.id and state='uploading';
 end if;
 return new;
end $$;
create trigger attachment_lifecycle_board_object before insert or update on public.board_task_attachments
 for each row execute function attachment_lifecycle.board_object();

-- Activation is a separate, explicit DBA action. Historical completed cards
-- start at activation, never at their original completion or upload time.
create function attachment_lifecycle.activate() returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare activated timestamptz:=clock_timestamp();
begin
 lock table public.board_tasks,taskflow.issue,public.board_task_attachments,taskflow.attachment in share row exclusive mode;
 if (select enabled from attachment_lifecycle.config where singleton) then raise exception 'already active'; end if;
 insert into attachment_lifecycle.cards(module,card_id,completed_at)
 select attachment_lifecycle.board_module(id),id,case when attachment_lifecycle.board_is_complete(id,status,current_workflow_step_id) then activated end
 from public.board_tasks where attachment_lifecycle.board_module(id) is not null;
 insert into attachment_lifecycle.cards(module,card_id,completed_at)
 select 'taskflow',i.id,case when s.category='done' then activated end from taskflow.issue i join taskflow.issue_status s on s.key=i.status and s.workspace_id=i.workspace_id;
 insert into attachment_lifecycle.objects(module,attachment_id,card_id,bucket,object_key,filename,byte_size,state)
 select attachment_lifecycle.board_module(t.id),a.id,a.task_id,a.storage_bucket,a.storage_path,a.filename,a.byte_size,
 case when a.upload_status='ready' then 'ready' else 'uploading' end
 from public.board_task_attachments a join public.board_tasks t on t.id=a.task_id where coalesce(a.deletion_status,'active')<>'deleted' and attachment_lifecycle.board_module(t.id) is not null;
 -- Only THIS private bucket. Legacy local rows are preserved, never guessed.
 insert into attachment_lifecycle.objects(module,attachment_id,card_id,bucket,object_key,filename,byte_size)
 select 'taskflow',a.id,coalesce(a.issue_id,c.issue_id),'taskflow-attachments',split_part(a.url,'/storage/v1/object/authenticated/taskflow-attachments/',2),a.filename,a.size_bytes
 from taskflow.attachment a left join taskflow.comment c on c.id=a.comment_id
 where a.url like '%/storage/v1/object/authenticated/taskflow-attachments/%';
 update attachment_lifecycle.config set enabled=true,enabled_at=activated where singleton;
end $$;

create function attachment_lifecycle.can_read(p_module text,p_id uuid) returns boolean
language sql stable security definer set search_path = pg_catalog, pg_temp as $$
 select auth.uid() is not null and case when p_module='taskflow' then exists(
   select 1 from taskflow.attachment a join taskflow.member m on m.workspace_id=a.workspace_id
   where a.id=p_id and m.user_id=auth.uid()) else exists(
   select 1 from public.board_task_attachments a join public.board_tasks t on t.id=a.task_id where a.id=p_id and
   (case when t.board_instance_id is not null then public.board_instance_can_read(t.board_instance_id)
    when t.application_scope='worktodo' then t.owner_uuid=auth.uid() else public.is_engineering_member() end)) end
$$;

-- All public RPCs below explicitly authenticate and authorize. Object paths
-- and cross-workspace attachment existence are never revealed on denial.
create function public.attachment_access(p_module text,p_id uuid,p_intent text default 'preview') returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare o attachment_lifecycle.objects; completed timestamptz; ttl integer:=60;
begin
 if p_module='board' and exists(select 1 from public.board_task_attachments a where a.id=p_id and attachment_lifecycle.board_module(a.task_id) is null) and attachment_lifecycle.can_read('board',p_id) then return jsonb_build_object('enabled',false); end if;
 if p_module='board' then select attachment_lifecycle.board_module(t.id) into p_module from public.board_task_attachments a join public.board_tasks t on t.id=a.task_id where a.id=p_id; end if;
 if not (attachment_lifecycle.can_read(p_module,p_id) or (p_module='taskflow' and p_intent='verify' and exists(select 1 from attachment_lifecycle.objects pending join taskflow.member m on m.workspace_id=split_part(pending.object_key,'/',2)::uuid where pending.module=p_module and pending.attachment_id=p_id and pending.state='uploading' and m.user_id=auth.uid()))) then raise exception using errcode='42501',message='attachment unavailable'; end if;
 if not (select enabled from attachment_lifecycle.config where singleton) then return jsonb_build_object('enabled',false); end if;
 if p_intent is null or p_intent not in ('preview','download','verify') then raise exception 'invalid attachment intent'; end if;
 select * into o from attachment_lifecycle.objects where module=p_module and attachment_id=p_id;
 if not found or (o.state<>'ready' and not (p_intent='verify' and o.state='uploading')) then raise exception 'attachment unavailable'; end if;
 select completed_at into completed from attachment_lifecycle.cards where module=p_module and card_id=o.card_id;
 if completed is not null then
   if clock_timestamp()>=completed+interval '72 hours' then raise exception 'attachment expired'; end if;
   if p_intent='preview' and clock_timestamp()>=completed+interval '24 hours' then raise exception 'preview expired; download is available'; end if;
   ttl:=least(ttl,greatest(0,floor(extract(epoch from (completed+case when p_intent='preview' then interval '24 hours' else interval '72 hours' end-clock_timestamp())))::integer));
 end if;
 if ttl<1 then raise exception 'attachment capability expired'; end if;
 return jsonb_build_object('enabled',true,'bucket',o.bucket,'key',o.object_key,'filename',o.filename,'ttl',ttl);
end $$;

-- Service-only native media redemption rechecks CURRENT membership and policy;
-- the user and intent are authenticated by the gateway's HMAC capability.
create function public.attachment_redeem(p_module text,p_id uuid,p_user uuid,p_intent text) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
 perform set_config('request.jwt.claim.sub',p_user::text,true);
 return public.attachment_access(p_module,p_id,p_intent);
end $$;
create function public.attachment_status(p_module text,p_id uuid) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare result jsonb; resolved text;
begin
 if p_module='board' then
   select attachment_lifecycle.board_module(t.id) into resolved
   from public.board_task_attachments a join public.board_tasks t on t.id=a.task_id where a.id=p_id;
   if not found then raise exception 'attachment unavailable'; end if;
   if resolved is null then
     if attachment_lifecycle.can_read('board',p_id) then return jsonb_build_object('enabled',false); end if;
     raise exception using errcode='42501',message='attachment unavailable';
   end if;
   p_module:=resolved;
 end if;
 if not attachment_lifecycle.can_read(p_module,p_id) then raise exception using errcode='42501',message='attachment unavailable'; end if;
 if not (select enabled from attachment_lifecycle.config where singleton) then return jsonb_build_object('enabled',false); end if;
 select jsonb_build_object(
   'state',o.state,'card_id',o.card_id,'completed_at',c.completed_at,
   'preview_available',c.completed_at is null or clock_timestamp()<c.completed_at+interval '24 hours',
   'download_available',c.completed_at is null or clock_timestamp()<c.completed_at+interval '72 hours',
   'delete_due_at',c.completed_at+interval '72 hours') into result
 from attachment_lifecycle.objects o left join attachment_lifecycle.cards c using(module,card_id)
 where o.module=p_module and o.attachment_id=p_id;
 if result is null then return jsonb_build_object('enabled',false); end if;
 return result||jsonb_build_object('enabled',true,'module',p_module);
end $$;
create function public.attachment_capacity() returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare used bigint; cap bigint; items jsonb; breakdown jsonb; scheduled bigint; last_outcome jsonb;
begin
 if auth.uid() is null or not public.is_engineering_member(array['owner']) then raise exception using errcode='42501',message='owner required'; end if;
 used:=attachment_lifecycle.used_bytes(); select capacity_bytes into cap from attachment_lifecycle.config where singleton;
 select coalesce(jsonb_agg(to_jsonb(r)),'[]') into items from (
   select o.module,o.attachment_id,o.card_id,o.filename,o.byte_size,o.state,c.completed_at,
     case when o.module='taskflow' then (select title from taskflow.issue where id=o.card_id) else (select title from public.board_tasks where id=o.card_id) end as card_title,
     c.completed_at+interval '72 hours' as delete_due_at
   from attachment_lifecycle.objects o left join attachment_lifecycle.cards c using(module,card_id)
   where o.state<>'deleted' and attachment_lifecycle.can_read(o.module,o.attachment_id) order by o.byte_size desc,o.attachment_id limit 100) r;
 select coalesce(jsonb_object_agg(module,bytes),'{}') into breakdown from (
   select o.module,sum(o.byte_size) as bytes from attachment_lifecycle.objects o where o.state<>'deleted' group by o.module
 ) totals;
 breakdown:=breakdown||jsonb_build_object('other',greatest(0,used-coalesce((select sum(byte_size) from attachment_lifecycle.objects where state<>'deleted'),0)));
 select coalesce(sum(o.byte_size),0) into scheduled from attachment_lifecycle.objects o join attachment_lifecycle.cards c using(module,card_id) where c.completed_at is not null and o.state<>'deleted';
 select to_jsonb(a) into last_outcome from attachment_lifecycle.audit a order by id desc limit 1;
 return jsonb_build_object('breakdown',breakdown,'scheduled_release_bytes',scheduled,'last_cleanup',last_outcome,'used_bytes',used,'capacity_bytes',cap,'warning',case when used*100>=cap*90 then 90 when used*100>=cap*70 then 70 else 0 end,'items',items);
end $$;

-- Service-only claim; SQL time is authoritative, never a client supplied clock.
-- Sticky claims survive crashes. Retry the same immutable key/token; do not
-- reset them on a lease timeout while a Storage delete might be in flight.
create function public.attachment_claim_expired() returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare c attachment_lifecycle.cards; o attachment_lifecycle.objects;
begin
 if not (select enabled from attachment_lifecycle.config where singleton) then return null; end if;
 select * into o from attachment_lifecycle.objects where state='deleting' order by attachment_id for update skip locked limit 1;
 if found then return to_jsonb(o); end if;
 select cards.* into c from attachment_lifecycle.cards cards
 where completed_at<=clock_timestamp()-interval '72 hours'
 and exists(select 1 from attachment_lifecycle.objects x where x.module=cards.module and x.card_id=cards.card_id and x.state='ready')
 order by completed_at for update skip locked limit 1;
 if not found then return null; end if;
 select * into o from attachment_lifecycle.objects where module=c.module and card_id=c.card_id and state='ready' for update skip locked limit 1;
 if not found then return null; end if;
 update attachment_lifecycle.objects set state='deleting',delete_token=gen_random_uuid(),delete_generation=c.generation,delete_reason='expired' where module=o.module and attachment_id=o.attachment_id returning * into o;
 insert into attachment_lifecycle.audit(module,attachment_id,action) values(o.module,o.attachment_id,'delete_claimed');
 return to_jsonb(o);
end $$;
create function public.attachment_finish_delete(p_module text,p_id uuid,p_token uuid) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare actor_id uuid;
begin
 update attachment_lifecycle.objects set state='deleted',deleted_at=clock_timestamp()
 where module=p_module and attachment_id=p_id and state='deleting' and delete_token=p_token;
 if not found then return; end if;
 if p_module in ('board','worktodo') then
   select actor into actor_id from attachment_lifecycle.audit
    where module=p_module and attachment_id=p_id and action='manual_delete_confirmed'
    order by id desc limit 1;
   update public.board_task_attachments set deletion_status='deleted',deleted_at=clock_timestamp(),deleted_by=actor_id
    where id=p_id and coalesce(deletion_status,'active')<>'deleted';
 end if;
 insert into attachment_lifecycle.audit(module,attachment_id,action) values(p_module,p_id,'object_deleted');
end $$;
create function public.attachment_record_failure(p_module text,p_id uuid,p_token uuid) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
 if exists(select 1 from attachment_lifecycle.objects where module=p_module and attachment_id=p_id and state='deleting' and delete_token=p_token) then
   insert into attachment_lifecycle.audit(module,attachment_id,action) values(p_module,p_id,'delete_failed');
 end if;
end $$;
create function public.attachment_request_delete(p_module text,p_id uuid,p_confirm boolean) returns jsonb
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare o attachment_lifecycle.objects; parent uuid;
begin
 if p_module='board' and exists(select 1 from public.board_task_attachments a where a.id=p_id and attachment_lifecycle.board_module(a.task_id) is null) and attachment_lifecycle.can_read('board',p_id) then return jsonb_build_object('enabled',false); end if;
 if p_module='board' then select attachment_lifecycle.board_module(t.id) into p_module from public.board_task_attachments a join public.board_tasks t on t.id=a.task_id where a.id=p_id; end if;
 if p_confirm is not true or auth.uid() is null or not attachment_lifecycle.can_read(p_module,p_id) or not (
   public.is_engineering_member(array['owner']) or
   (p_module<>'taskflow' and exists(select 1 from public.board_task_attachments a join public.board_tasks t on t.id=a.task_id where a.id=p_id and
     (case when t.board_instance_id is not null then public.board_instance_can_write(t.board_instance_id) else t.owner_uuid=auth.uid() end))) or
   (p_module='taskflow' and exists(select 1 from taskflow.attachment a join taskflow.member m on m.workspace_id=a.workspace_id where a.id=p_id and m.user_id=auth.uid() and (m.role in ('owner','admin') or a.uploader_id=auth.uid())))
 ) then
   raise exception using errcode='42501',message='confirmed owner action required'; end if;
 if not (select enabled from attachment_lifecycle.config where singleton) then return jsonb_build_object('enabled',false); end if;
 select card_id into parent from attachment_lifecycle.objects where module=p_module and attachment_id=p_id;
 perform 1 from attachment_lifecycle.cards where module=p_module and card_id=parent for update;
 update attachment_lifecycle.objects set state='deleting',delete_token=coalesce(delete_token,gen_random_uuid()),delete_reason='manual'
 where module=p_module and attachment_id=p_id and state in ('ready','deleting') returning * into o;
 if not found then raise exception 'attachment unavailable'; end if;
 insert into attachment_lifecycle.audit(module,attachment_id,action,actor) values(p_module,p_id,'manual_delete_confirmed',auth.uid());
 return to_jsonb(o);
end $$;

create function public.attachment_reserve_taskflow(p_id uuid,p_card uuid,p_workspace uuid,p_key text,p_name text,p_size bigint) returns void
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
begin
 if auth.uid() is null or not exists(select 1 from taskflow.member where workspace_id=p_workspace and user_id=auth.uid()) then
   raise exception using errcode='42501',message='attachment unavailable'; end if;
 if p_card is not null and not exists(select 1 from taskflow.issue where id=p_card and workspace_id=p_workspace) then raise exception 'invalid parent'; end if;
 if p_key !~ ('^workspaces/'||p_workspace::text||'/'||p_id::text||'\.[A-Za-z0-9]+$') then raise exception 'invalid object key'; end if;
 perform attachment_lifecycle.reserve('taskflow',p_id,p_card,'taskflow-attachments',p_key,p_name,p_size,'uploading');
end $$;
create function attachment_lifecycle.taskflow_object() returns trigger
language plpgsql security definer set search_path = pg_catalog, pg_temp as $$
declare parent uuid; o attachment_lifecycle.objects;
begin
 if not (select enabled from attachment_lifecycle.config where singleton) then return new; end if;
 parent:=new.issue_id;
 if new.comment_id is not null then select issue_id into parent from taskflow.comment where id=new.comment_id; end if;
 if tg_op='UPDATE' and new.url<>old.url then raise exception 'attachment object identity is immutable'; end if;
 if parent is not null then
   perform 1 from taskflow.issue where id=parent for update;
   if exists(select 1 from attachment_lifecycle.cards where module='taskflow' and card_id=parent and completed_at is not null) and
     (tg_op='INSERT' or parent is distinct from old.issue_id) then raise exception 'completed cards cannot receive attachments'; end if;
 end if;
 select * into o from attachment_lifecycle.objects where module='taskflow' and attachment_id=new.id for update;
 if tg_op='INSERT' and new.url like '%/storage/v1/object/authenticated/taskflow-attachments/%' then
   if not found or o.state<>'uploading' or o.byte_size<>new.size_bytes or
     o.object_key<>split_part(new.url,'/storage/v1/object/authenticated/taskflow-attachments/',2) then raise exception 'attachment upload reservation required'; end if;
   update attachment_lifecycle.objects set state='ready',card_id=parent where module='taskflow' and attachment_id=new.id;
 elsif tg_op='UPDATE' then
   update attachment_lifecycle.objects set card_id=parent where module='taskflow' and attachment_id=new.id and state in ('ready','uploading');
 end if;
 return new;
end $$;
create trigger attachment_lifecycle_taskflow_object before insert or update on taskflow.attachment
 for each row execute function attachment_lifecycle.taskflow_object();
-- Restrictive policies supplement, never replace existing workspace/owner ACLs.
-- Browser object SELECT is closed while active; intent-aware signing happens
-- only in the authenticated gateway. Storage DELETE must also use the gateway.
create function public.attachment_storage_permit(p_bucket text,p_name text,p_write boolean) returns boolean
language plpgsql stable security definer set search_path = pg_catalog, pg_temp as $$
begin
 if not (select enabled from attachment_lifecycle.config where singleton) then return true; end if;
 if p_bucket not in ('taskflow-attachments','board-task-attachments') then return true; end if;
 if not exists(select 1 from attachment_lifecycle.objects where bucket=p_bucket and object_key=p_name) then
   return p_bucket='board-task-attachments' and exists(select 1 from public.board_task_attachments a where a.storage_bucket=p_bucket and a.storage_path=p_name and attachment_lifecycle.board_module(a.task_id) is null);
 end if;
 if not p_write then return false; end if;
 return exists(select 1 from attachment_lifecycle.objects o left join attachment_lifecycle.cards c using(module,card_id)
   where o.bucket=p_bucket and o.object_key=p_name and o.state='uploading' and c.completed_at is null);
end $$;
-- These managed-schema policy statements are delivered separately for the
-- approved Dashboard authority, not run by taskflow_migrator/runtime.

revoke all on all tables in schema attachment_lifecycle from public,anon,authenticated;
revoke execute on all functions in schema attachment_lifecycle from public,anon,authenticated;
revoke all on function public.attachment_access(text,uuid,text),public.attachment_capacity(),public.attachment_status(text,uuid),public.attachment_request_delete(text,uuid,boolean),public.attachment_claim_expired(),public.attachment_finish_delete(text,uuid,uuid),public.attachment_record_failure(text,uuid,uuid),public.attachment_redeem(text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.attachment_access(text,uuid,text),public.attachment_capacity(),public.attachment_status(text,uuid),public.attachment_request_delete(text,uuid,boolean) to authenticated;
grant execute on function public.attachment_claim_expired(),public.attachment_finish_delete(text,uuid,uuid),public.attachment_record_failure(text,uuid,uuid),public.attachment_redeem(text,uuid,uuid,text) to service_role;
revoke all on function public.attachment_reserve_taskflow(uuid,uuid,uuid,text,text,bigint),public.attachment_storage_permit(text,text,boolean) from public,anon,authenticated;
grant execute on function public.attachment_reserve_taskflow(uuid,uuid,uuid,text,text,bigint),public.attachment_storage_permit(text,text,boolean) to authenticated;
commit;
