-- Universal Board Contract
--
-- One registry and one immutable board_instance_id isolate every Board
-- consumer.  Existing ai_board/worktodo application_scope values remain
-- compatibility data only; this migration neither recreates nor migrates
-- business rows or their UUIDs.

begin;

create table if not exists public.board_instances (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) > 0),
  task_code_prefix text not null unique check (task_code_prefix ~ '^[A-Z][A-Z0-9]{1,15}$'),
  template_key text not null default 'c' check (length(btrim(template_key)) > 0),
  authorization_mode text not null check (authorization_mode in ('engineering', 'owner')),
  owner_uuid uuid references auth.users(id) on delete restrict,
  legacy_application_scope text unique,
  is_template_instance boolean not null default false,
  next_task_number integer not null default 0 check (next_task_number >= 0),
  active boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint board_instances_owner_mode_check check (
    (authorization_mode = 'engineering' and owner_uuid is null)
    or (authorization_mode = 'owner' and owner_uuid is not null)
  )
);

create unique index if not exists board_instances_one_template_instance_idx
  on public.board_instances (template_key)
  where is_template_instance;

alter table public.board_instances enable row level security;
revoke all on public.board_instances from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.board_instances from authenticated;
grant select on public.board_instances to authenticated;

-- Stable registry rows for compatibility consumers.  They are selected by
-- their existing scope solely for this one-time non-destructive backfill.
insert into public.board_instances (
  name, task_code_prefix, template_key, authorization_mode, owner_uuid,
  legacy_application_scope, is_template_instance
)
select 'AI Board', 'TASK', 'c', 'engineering', null, 'ai_board', false
where not exists (
  select 1 from public.board_instances where legacy_application_scope = 'ai_board'
);

insert into public.board_instances (
  name, task_code_prefix, template_key, authorization_mode, owner_uuid,
  legacy_application_scope, is_template_instance
)
select '工作待辦', 'WLTK', 'c', 'owner', t.owner_uuid, 'worktodo', false
from (
  select owner_uuid
  from public.board_tasks
  where application_scope = 'worktodo' and owner_uuid is not null
  group by owner_uuid
  order by count(*) desc, owner_uuid
  limit 1
) t
where not exists (
  select 1 from public.board_instances where legacy_application_scope = 'worktodo'
);

-- The live WorkTodo data must have exactly one owner before its registry can
-- be created.  Failing here is intentional: an ambiguous owner needs PM
-- review, not a guessed authorization context.
do $$
begin
  if not exists (select 1 from public.board_instances where legacy_application_scope = 'worktodo') then
    raise exception using errcode = 'P0001', message = 'Universal Board Contract requires one existing WorkTodo owner';
  end if;
end $$;

alter table public.board_workspaces
  add column if not exists board_instance_id uuid;
alter table public.board_tasks
  add column if not exists board_instance_id uuid;

-- Existing WorkTodo scope triggers deliberately reject ad-hoc updates outside
-- their controlled RPC.  This transaction backfills only the new immutable
-- foreign key, then restores the exact existing trigger before continuing.
alter table public.board_workspaces disable trigger trg_enforce_worktodo_workspace_scope;
alter table public.board_tasks disable trigger trg_enforce_board_task_scope;

update public.board_workspaces workspace
set board_instance_id = instance.id
from public.board_instances instance
where workspace.board_instance_id is null
  and workspace.application_scope = instance.legacy_application_scope;

update public.board_tasks task
set board_instance_id = instance.id
from public.board_instances instance
where task.board_instance_id is null
  and task.application_scope = instance.legacy_application_scope;

alter table public.board_tasks enable trigger trg_enforce_board_task_scope;
alter table public.board_workspaces enable trigger trg_enforce_worktodo_workspace_scope;

do $$
begin
  if exists (select 1 from public.board_workspaces where board_instance_id is null)
     or exists (select 1 from public.board_tasks where board_instance_id is null) then
    raise exception using errcode = 'P0001', message = 'Universal Board Contract backfill left an unassigned Board row';
  end if;
end $$;

alter table public.board_workspaces
  alter column board_instance_id set not null,
  add constraint board_workspaces_board_instance_id_fkey
    foreign key (board_instance_id) references public.board_instances(id) on delete restrict;
alter table public.board_tasks
  alter column board_instance_id set not null,
  add constraint board_tasks_board_instance_id_fkey
    foreign key (board_instance_id) references public.board_instances(id) on delete restrict;

-- A task workspace must belong to the same immutable board instance.
alter table public.board_tasks drop constraint if exists board_tasks_workspace_id_fkey;
alter table public.board_workspaces drop constraint if exists board_workspaces_workspace_key_key;
alter table public.board_workspaces
  add constraint board_workspaces_instance_workspace_key_key unique (board_instance_id, workspace_key),
  add constraint board_workspaces_id_instance_key unique (id, board_instance_id);
alter table public.board_tasks
  add constraint board_tasks_workspace_instance_fkey
    foreign key (workspace_id, board_instance_id)
    references public.board_workspaces (id, board_instance_id)
    on delete restrict;

create index if not exists board_workspaces_board_instance_sort_idx
  on public.board_workspaces (board_instance_id, active, sort_order);
create index if not exists board_tasks_board_instance_workspace_idx
  on public.board_tasks (board_instance_id, workspace_id, created_at);

-- New generic Board rows intentionally have no legacy application scope.
alter table public.board_tasks alter column application_scope drop not null;
alter table public.board_tasks alter column application_scope drop default;
alter table public.board_workspaces alter column application_scope drop not null;
alter table public.board_workspaces alter column application_scope drop default;
alter table public.board_tasks drop constraint if exists board_tasks_application_scope_ck;
alter table public.board_tasks drop constraint if exists board_tasks_work_code_format_chk;
alter table public.board_tasks drop constraint if exists board_tasks_worktodo_owner_ck;
alter table public.board_workspaces drop constraint if exists board_workspaces_application_scope_check;

-- Board identity is immutable even for SECURITY DEFINER RPC callers.
create or replace function public.board_instance_identity_immutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.board_instance_id is distinct from new.board_instance_id then
    raise exception using errcode = '22023', message = 'board_instance_id is immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists board_tasks_board_instance_identity_immutable on public.board_tasks;
create trigger board_tasks_board_instance_identity_immutable
before update on public.board_tasks
for each row execute function public.board_instance_identity_immutable();
drop trigger if exists board_workspaces_board_instance_identity_immutable on public.board_workspaces;
create trigger board_workspaces_board_instance_identity_immutable
before update on public.board_workspaces
for each row execute function public.board_instance_identity_immutable();

-- Generic access predicates.  They preserve the existing engineering/owner
-- model while allowing future board instances without per-prefix policy code.
create or replace function public.board_instance_can_read(p_board_instance_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select auth.uid() is not null and exists (
    select 1
    from public.board_instances instance
    where instance.id = p_board_instance_id
      and instance.active = true
      and (
        (instance.authorization_mode = 'engineering' and public.is_engineering_member())
        or (instance.authorization_mode = 'owner' and instance.owner_uuid = auth.uid())
      )
  );
$$;

create or replace function public.board_instance_can_write(p_board_instance_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select public.board_instance_can_read(p_board_instance_id);
$$;

create or replace function public.board_task_can_read(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.board_tasks task
    where task.id = p_task_id
      and public.board_instance_can_read(task.board_instance_id)
  );
$$;

create or replace function public.board_task_can_write(p_task_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.board_tasks task
    where task.id = p_task_id
      and public.board_instance_can_write(task.board_instance_id)
  );
$$;

revoke all on function public.board_instance_can_read(uuid) from public;
revoke all on function public.board_instance_can_write(uuid) from public;
revoke all on function public.board_task_can_read(uuid) from public;
revoke all on function public.board_task_can_write(uuid) from public;
grant execute on function public.board_instance_can_read(uuid) to authenticated;
grant execute on function public.board_instance_can_write(uuid) to authenticated;
grant execute on function public.board_task_can_read(uuid) to authenticated;
grant execute on function public.board_task_can_write(uuid) to authenticated;

create policy board_instances_generic_select
on public.board_instances for select to authenticated
using (public.board_instance_can_read(id));

-- Additive generic read policies preserve existing policy behavior while
-- making future registered instances visible through the same predicate.
create policy board_tasks_generic_instance_select
on public.board_tasks for select to authenticated
using (public.board_instance_can_read(board_instance_id));
create policy board_workspaces_generic_instance_select
on public.board_workspaces for select to authenticated
using (public.board_instance_can_read(board_instance_id));
create policy board_task_checklist_generic_instance_select
on public.board_task_checklist_items for select to authenticated
using (public.board_task_can_read(task_id));
create policy board_task_attachments_generic_instance_select
on public.board_task_attachments for select to authenticated
using (public.board_task_can_read(task_id));
create policy engineering_activity_generic_board_task_select
on public.engineering_activity_log for select to authenticated
using (
  entity_type = 'board_task'
  and entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  and public.board_task_can_read(entity_id::uuid)
);

-- The generic registry creation contract is owner-scoped.  It is not used to
-- create C's engineering-owned template instance; that deterministic seed is
-- intentionally deferred until Gate 1 passes.
create or replace function public.board_create_instance(
  p_name text,
  p_task_code_prefix text,
  p_template_key text default 'c'
)
returns public.board_instances
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_prefix text := upper(btrim(coalesce(p_task_code_prefix, '')));
  v_template text := lower(btrim(coalesce(p_template_key, 'c')));
  v_row public.board_instances;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'Authenticated board owner is required';
  end if;
  if length(v_name) = 0 or v_prefix !~ '^[A-Z][A-Z0-9]{1,15}$' or length(v_template) = 0 then
    raise exception using errcode = '22023', message = 'Board name, task-code prefix, and template key are required';
  end if;
  insert into public.board_instances (
    name, task_code_prefix, template_key, authorization_mode, owner_uuid, created_by
  ) values (
    v_name, v_prefix, v_template, 'owner', v_user, v_user
  ) returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.board_resolve_template_instance(p_template_key text)
returns public.board_instances
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select instance.*
  from public.board_instances instance
  where instance.template_key = lower(btrim(p_template_key))
    and instance.is_template_instance = true
    and public.board_instance_can_read(instance.id)
  limit 1;
$$;

create or replace function public.board_instance_create_workspace(
  p_board_instance_id uuid,
  p_name text,
  p_workspace_key text default null
)
returns public.board_workspaces
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_key text := nullif(btrim(coalesce(p_workspace_key, '')), '');
  v_order integer;
  v_row public.board_workspaces;
begin
  if v_user is null or not public.board_instance_can_write(p_board_instance_id) then
    raise exception using errcode = '42501', message = 'Authenticated board access is required';
  end if;
  if length(v_name) = 0 then
    raise exception using errcode = '22023', message = 'Workspace name is required';
  end if;
  if v_key is null then
    v_key := 'custom-' || replace(gen_random_uuid()::text, '-', '');
  end if;
  select coalesce(max(sort_order), 0) + 10 into v_order
  from public.board_workspaces
  where board_instance_id = p_board_instance_id and active = true;
  insert into public.board_workspaces (
    board_instance_id, workspace_key, name, sort_order, active,
    application_scope, owner_uuid, created_by, updated_by
  ) values (
    p_board_instance_id, v_key, v_name, v_order, true,
    null, v_user, v_user, v_user
  ) returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.board_instance_create_task(
  p_board_instance_id uuid,
  p_title text,
  p_summary text default null,
  p_status text default 'not_started',
  p_usage_scenario text default null,
  p_workspace_id uuid default null
)
returns public.board_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_instance public.board_instances;
  v_workspace public.board_workspaces;
  v_row public.board_tasks;
  v_number integer;
  v_title text := btrim(coalesce(p_title, ''));
begin
  if v_user is null or not public.board_instance_can_write(p_board_instance_id) then
    raise exception using errcode = '42501', message = 'Authenticated board access is required';
  end if;
  if length(v_title) = 0 then
    raise exception using errcode = '22023', message = 'Task title is required';
  end if;
  select * into v_instance from public.board_instances where id = p_board_instance_id for update;
  if not found or not v_instance.active then
    raise exception using errcode = 'P0002', message = 'Active board instance not found';
  end if;
  if p_workspace_id is not null then
    select * into v_workspace from public.board_workspaces
    where id = p_workspace_id and board_instance_id = p_board_instance_id and active = true;
  else
    select * into v_workspace from public.board_workspaces
    where board_instance_id = p_board_instance_id
      and workspace_key = lower(v_instance.task_code_prefix) || '-todo'
      and active = true
    order by sort_order limit 1;
  end if;
  if not found then
    raise exception using errcode = 'P0002', message = 'Active Board workspace is required';
  end if;
  update public.board_instances
  set next_task_number = next_task_number + 1, updated_at = now()
  where id = p_board_instance_id
  returning next_task_number into v_number;
  insert into public.board_tasks (
    board_instance_id, workspace_id, work_code, title, summary, status,
    usage_scenario, application_scope, owner_uuid, created_by
  ) values (
    p_board_instance_id, v_workspace.id,
    v_instance.task_code_prefix || '-' || lpad(v_number::text, 3, '0'),
    v_title, nullif(p_summary, ''), coalesce(nullif(p_status, ''), 'not_started'),
    nullif(p_usage_scenario, ''), null, v_user, v_user
  ) returning * into v_row;
  insert into public.engineering_activity_log (
    entity_type, entity_id, action, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_row.id::text, 'task_created', to_jsonb(v_row),
    'Board task created through the universal board contract',
    v_user, 'human', coalesce(v_user::text, 'authenticated'), 'system_activity'
  );
  return v_row;
end;
$$;

revoke all on function public.board_create_instance(text, text, text) from public;
revoke all on function public.board_resolve_template_instance(text) from public;
revoke all on function public.board_instance_create_workspace(uuid, text, text) from public;
revoke all on function public.board_instance_create_task(uuid, text, text, text, text, uuid) from public;
grant execute on function public.board_create_instance(text, text, text) to authenticated;
grant execute on function public.board_resolve_template_instance(text) to authenticated;
grant execute on function public.board_instance_create_workspace(uuid, text, text) to authenticated;
grant execute on function public.board_instance_create_task(uuid, text, text, text, text, uuid) to authenticated;

-- Generic storage read access for registered boards.  Existing AI/WorkTodo
-- policies remain additive compatibility policies through Gate 1.
create policy board_task_attachment_storage_generic_select
on storage.objects for select to authenticated
using (
  bucket_id = 'board-task-attachments'
  and exists (
    select 1
    from public.board_task_attachments attachment
    where attachment.storage_bucket = storage.objects.bucket_id
      and attachment.storage_path = storage.objects.name
      and public.board_task_can_read(attachment.task_id)
  )
);

-- Advance task counters without changing existing business rows.
update public.board_instances instance
set next_task_number = coalesce((
  select max((regexp_match(task.work_code, '-([0-9]+)$'))[1]::integer)
  from public.board_tasks task
  where task.board_instance_id = instance.id
), 0),
updated_at = now();

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'board_instances'
     ) then
    alter publication supabase_realtime add table public.board_instances;
  end if;
end $$;

commit;
