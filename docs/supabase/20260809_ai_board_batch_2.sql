-- AI Board Development Batch #2
--
-- Approved scope: authenticated human Board read, controlled workflow writes,
-- AI actor audit, structured checklist items, and Realtime publication.
-- This migration is intentionally idempotent. It does not create GPT/Co auth
-- users and it does not change the engineering_members human role vocabulary.

begin;

-- ---------------------------------------------------------------------------
-- AI Actor audit metadata
-- ---------------------------------------------------------------------------
alter table public.engineering_activity_log
  add column if not exists actor_type text,
  add column if not exists actor_label text;

update public.engineering_activity_log
set actor_type = coalesce(actor_type, case when actor_id is null then 'legacy' else 'legacy' end),
    actor_label = coalesce(actor_label, 'Legacy')
where actor_type is null or actor_label is null;

alter table public.engineering_activity_log
  alter column actor_type set default 'legacy',
  alter column actor_type set not null,
  alter column actor_label set default 'Legacy',
  alter column actor_label set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'engineering_activity_log_actor_type_check'
  ) then
    alter table public.engineering_activity_log
      add constraint engineering_activity_log_actor_type_check
      check (actor_type in ('human', 'ai', 'system', 'legacy'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'engineering_activity_log_actor_label_check'
  ) then
    alter table public.engineering_activity_log
      add constraint engineering_activity_log_actor_label_check
      check (actor_label in ('QJC', 'GPT', 'Co', 'System', 'Legacy'));
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Structured checklist model
-- ---------------------------------------------------------------------------
create table if not exists public.engineering_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.board_tasks(id) on delete cascade,
  checklist_type text not null,
  stage text not null,
  item_key text not null,
  label text not null,
  required boolean not null default true,
  state text not null default 'not_verified',
  checked_by uuid references auth.users(id),
  checked_at timestamptz,
  evidence_note text,
  evidence_ref text,
  sort_order integer not null default 0,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint engineering_checklist_type_check
    check (checklist_type in ('task_acceptance', 'batch_regression', 'artifact_release')),
  constraint engineering_checklist_stage_check
    check (stage in ('co', 'gpt', 'qjc')),
  constraint engineering_checklist_state_check
    check (state in ('not_verified', 'pass', 'fail', 'na')),
  constraint engineering_checklist_item_key_check
    check (length(trim(item_key)) > 0),
  constraint engineering_checklist_label_check
    check (length(trim(label)) > 0),
  constraint engineering_checklist_unique_item
    unique (task_id, checklist_type, stage, item_key, version)
);

alter table public.engineering_checklist_items enable row level security;

drop policy if exists engineering_checklist_read on public.engineering_checklist_items;
create policy engineering_checklist_read
  on public.engineering_checklist_items
  for select to authenticated
  using (public.is_engineering_member());

-- No direct client INSERT/UPDATE/DELETE policy is created. All writes go
-- through the controlled functions below.

-- ---------------------------------------------------------------------------
-- Board RLS boundary
-- ---------------------------------------------------------------------------
alter table public.board_tasks enable row level security;
alter table public.engineering_activity_log enable row level security;

drop policy if exists board_tasks_delete on public.board_tasks;
drop policy if exists board_tasks_insert on public.board_tasks;
drop policy if exists board_tasks_update on public.board_tasks;
drop policy if exists board_tasks_select on public.board_tasks;
drop policy if exists board_tasks_authenticated_select on public.board_tasks;

create policy board_tasks_authenticated_select
  on public.board_tasks
  for select to authenticated
  using (public.is_engineering_member());

revoke all on public.board_tasks from anon;
revoke insert, update, delete on public.board_tasks from authenticated;
grant select on public.board_tasks to authenticated;

revoke all on public.engineering_activity_log from anon;
revoke insert, update, delete on public.engineering_activity_log from authenticated;
grant select on public.engineering_activity_log to authenticated;

revoke all on public.engineering_checklist_items from anon;
revoke insert, update, delete on public.engineering_checklist_items from authenticated;
grant select on public.engineering_checklist_items to authenticated;

-- ---------------------------------------------------------------------------
-- Controlled task transition
-- ---------------------------------------------------------------------------
create or replace function public.board_transition_task(
  p_task_id uuid,
  p_target_status text,
  p_target_assignee text,
  p_actor_type text default 'human',
  p_actor_label text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_row public.board_tasks%rowtype;
  actor_id_value uuid;
  actor_type_value text := lower(trim(coalesce(p_actor_type, 'human')));
  actor_label_value text;
  target_status_value text := lower(trim(coalesce(p_target_status, '')));
  target_assignee_value text := trim(coalesce(p_target_assignee, ''));
  allowed_transition boolean := false;
begin
  if target_status_value not in ('ready', 'inprogress', 'qa', 'done') then
    raise exception using errcode = '22023', message = 'Unsupported Board status';
  end if;
  if target_assignee_value not in ('QJC', 'GPT', 'Co') then
    raise exception using errcode = '22023', message = 'Unsupported workflow assignee';
  end if;

  if actor_type_value = 'human' then
    if auth.uid() is null or not public.is_engineering_member(array['owner']) then
      raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
    end if;
    actor_id_value := auth.uid();
    actor_label_value := 'QJC';
  elsif actor_type_value = 'ai' then
    if coalesce(auth.role(), '') <> 'service_role' then
      raise exception using errcode = '42501', message = 'AI workflow actors require the controlled service path';
    end if;
    if p_actor_label not in ('GPT', 'Co') then
      raise exception using errcode = '22023', message = 'Unsupported AI workflow actor';
    end if;
    actor_id_value := null;
    actor_label_value := p_actor_label;
  else
    raise exception using errcode = '22023', message = 'Unsupported actor type';
  end if;

  select * into current_row
  from public.board_tasks
  where id = p_task_id
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'Board task not found';
  end if;

  -- Owner QJC may operate the approved workflow from the authenticated UI.
  -- AI actors may only execute their own bounded handoff operations.
  allowed_transition :=
    actor_label_value = 'QJC'
    and (
      (current_row.status = 'ready' and target_status_value = 'inprogress' and target_assignee_value = 'Co')
      or (current_row.status = 'inprogress' and target_status_value = 'qa' and target_assignee_value = 'GPT')
      or (current_row.status = 'qa' and target_status_value = 'qa' and target_assignee_value = 'QJC')
      or (current_row.status = 'qa' and target_status_value = 'inprogress' and target_assignee_value = 'Co')
      or (current_row.status = 'qa' and target_status_value = 'done' and target_assignee_value = 'QJC')
    )
    or (actor_label_value = 'Co' and (
      (current_row.status = 'ready' and target_status_value = 'inprogress' and target_assignee_value = 'Co')
      or (current_row.status = 'inprogress' and target_status_value = 'qa' and target_assignee_value = 'GPT')
      or (current_row.status = 'qa' and target_status_value = 'inprogress' and target_assignee_value = 'Co')
    ))
    or (actor_label_value = 'GPT' and (
      (current_row.status = 'qa' and target_status_value = 'qa' and target_assignee_value = 'QJC')
      or (current_row.status = 'qa' and target_status_value = 'inprogress' and target_assignee_value = 'Co')
    ));

  if not allowed_transition then
    raise exception using errcode = '42501', message = 'Workflow transition is not permitted';
  end if;

  update public.board_tasks
  set status = target_status_value,
      assignee = target_assignee_value,
      updated_at = now()
  where id = p_task_id;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label
  ) values (
    'board_task', p_task_id::text, 'workflow_transition',
    jsonb_build_object('status', current_row.status, 'assignee', current_row.assignee),
    jsonb_build_object('status', target_status_value, 'assignee', target_assignee_value),
    p_note, actor_id_value, actor_type_value, actor_label_value
  );

  return jsonb_build_object(
    'success', true,
    'task_id', p_task_id,
    'status', target_status_value,
    'assignee', target_assignee_value,
    'actor_type', actor_type_value,
    'actor_label', actor_label_value
  );
end;
$$;

revoke all on function public.board_transition_task(uuid, text, text, text, text, text) from public;
revoke execute on function public.board_transition_task(uuid, text, text, text, text, text) from anon;
grant execute on function public.board_transition_task(uuid, text, text, text, text, text) to authenticated;

create or replace function public.board_create_task(
  p_title text,
  p_summary text default null,
  p_priority text default null,
  p_actor_type text default 'human',
  p_actor_label text default null
)
returns public.board_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_type_value text := lower(trim(coalesce(p_actor_type, 'human')));
  actor_label_value text;
  actor_id_value uuid;
  created_task public.board_tasks;
begin
  if length(trim(coalesce(p_title, ''))) = 0 then
    raise exception using errcode = '22023', message = 'Task title is required';
  end if;
  if actor_type_value = 'human' then
    if auth.uid() is null or not public.is_engineering_member(array['owner']) then
      raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
    end if;
    actor_id_value := auth.uid();
    actor_label_value := 'QJC';
  elsif actor_type_value = 'ai' and coalesce(auth.role(), '') = 'service_role' and p_actor_label in ('GPT', 'Co') then
    actor_id_value := null;
    actor_label_value := p_actor_label;
  else
    raise exception using errcode = '42501', message = 'Task actor is not allowed';
  end if;

  insert into public.board_tasks (title, summary, priority, status, assignee, created_by, created_at, updated_at)
  values (trim(p_title), nullif(trim(coalesce(p_summary, '')), ''), nullif(trim(coalesce(p_priority, '')), ''), 'ready', 'Co', actor_id_value, now(), now())
  returning * into created_task;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, after_data, note, actor_id, actor_type, actor_label
  ) values (
    'board_task', created_task.id::text, 'task_created', to_jsonb(created_task),
    'Board task created', actor_id_value, actor_type_value, actor_label_value
  );

  -- Every newly created TASK receives its Development Contract immediately.
  -- This keeps Checklist a contract/evidence surface, not a PM-authored blank.
  insert into public.engineering_checklist_items (
    task_id, checklist_type, stage, item_key, label, required, sort_order, version
  ) values
    (created_task.id, 'task_acceptance', 'co', 'developer-qa',
      format('Co Developer QA：完成「%s」並附 Evidence', created_task.title), true, 10, 1),
    (created_task.id, 'task_acceptance', 'gpt', 'gpt-review',
      format('GPT Review：確認「%s」的 Scope、Architecture 與 Regression Evidence', created_task.title), true, 20, 1),
    (created_task.id, 'task_acceptance', 'qjc', 'pm-acceptance',
      format('QJC PM QA：依「%s」Acceptance Criteria 驗收並確認 Artifact／Build', created_task.title), true, 30, 1);

  return created_task;
end;
$$;

revoke all on function public.board_create_task(text, text, text, text, text) from public;
revoke execute on function public.board_create_task(text, text, text, text, text) from anon;
grant execute on function public.board_create_task(text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Checklist controlled operations
-- ---------------------------------------------------------------------------
create or replace function public.board_create_checklist_item(
  p_task_id uuid,
  p_checklist_type text,
  p_stage text,
  p_item_key text,
  p_label text,
  p_required boolean default true,
  p_sort_order integer default 0,
  p_actor_type text default 'human',
  p_actor_label text default null
)
returns public.engineering_checklist_items
language plpgsql
security definer
set search_path = public
as $$
declare
  actor_type_value text := lower(trim(coalesce(p_actor_type, 'human')));
  actor_label_value text;
  actor_id_value uuid;
  created_item public.engineering_checklist_items;
begin
  if p_checklist_type not in ('task_acceptance', 'batch_regression', 'artifact_release')
    or p_stage not in ('co', 'gpt', 'qjc') then
    raise exception using errcode = '22023', message = 'Invalid checklist type or stage';
  end if;

  if actor_type_value = 'human' then
    if auth.uid() is null or not public.is_engineering_member(array['owner']) then
      raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
    end if;
    actor_id_value := auth.uid();
    actor_label_value := 'QJC';
  elsif actor_type_value = 'ai' and coalesce(auth.role(), '') = 'service_role' and p_actor_label in ('GPT', 'Co') then
    actor_id_value := null;
    actor_label_value := p_actor_label;
  else
    raise exception using errcode = '42501', message = 'Checklist actor is not allowed';
  end if;

  insert into public.engineering_checklist_items (
    task_id, checklist_type, stage, item_key, label, required, sort_order
  ) values (
    p_task_id, p_checklist_type, p_stage, trim(p_item_key), trim(p_label), coalesce(p_required, true), coalesce(p_sort_order, 0)
  ) returning * into created_item;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, after_data, note, actor_id, actor_type, actor_label
  ) values (
    'engineering_checklist_item', created_item.id::text, 'checklist_item_created', to_jsonb(created_item),
    'Checklist item created', actor_id_value, actor_type_value, actor_label_value
  );
  return created_item;
end;
$$;

create or replace function public.board_update_checklist_item(
  p_item_id uuid,
  p_state text,
  p_evidence_note text default null,
  p_evidence_ref text default null,
  p_actor_type text default 'human',
  p_actor_label text default null
)
returns public.engineering_checklist_items
language plpgsql
security definer
set search_path = public
as $$
declare
  current_item public.engineering_checklist_items;
  updated_item public.engineering_checklist_items;
  actor_type_value text := lower(trim(coalesce(p_actor_type, 'human')));
  actor_label_value text;
  actor_id_value uuid;
begin
  if p_state not in ('not_verified', 'pass', 'fail', 'na') then
    raise exception using errcode = '22023', message = 'Invalid checklist state';
  end if;

  select * into current_item
  from public.engineering_checklist_items
  where id = p_item_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Checklist item not found';
  end if;

  if actor_type_value = 'human' then
    if auth.uid() is null or not public.is_engineering_member(array['owner']) then
      raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
    end if;
    actor_id_value := auth.uid();
    actor_label_value := 'QJC';
  elsif actor_type_value = 'ai' and coalesce(auth.role(), '') = 'service_role' and p_actor_label in ('GPT', 'Co') then
    if lower(p_actor_label) <> current_item.stage then
      raise exception using errcode = '42501', message = 'AI actor may only update its own checklist stage';
    end if;
    actor_id_value := null;
    actor_label_value := p_actor_label;
  else
    raise exception using errcode = '42501', message = 'Checklist actor is not allowed';
  end if;

  update public.engineering_checklist_items
  set state = p_state,
      checked_by = case when p_state = 'not_verified' then null else actor_id_value end,
      checked_at = case when p_state = 'not_verified' then null else now() end,
      evidence_note = p_evidence_note,
      evidence_ref = p_evidence_ref,
      updated_at = now()
  where id = p_item_id
  returning * into updated_item;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label
  ) values (
    'engineering_checklist_item', p_item_id::text, 'checklist_item_updated',
    to_jsonb(current_item), to_jsonb(updated_item), p_evidence_note,
    actor_id_value, actor_type_value, actor_label_value
  );
  return updated_item;
end;
$$;

revoke all on function public.board_create_checklist_item(uuid, text, text, text, text, boolean, integer, text, text) from public;
revoke all on function public.board_update_checklist_item(uuid, text, text, text, text, text) from public;
revoke execute on function public.board_create_checklist_item(uuid, text, text, text, text, boolean, integer, text, text) from anon;
revoke execute on function public.board_update_checklist_item(uuid, text, text, text, text, text) from anon;
grant execute on function public.board_create_checklist_item(uuid, text, text, text, text, boolean, integer, text, text) to authenticated;
grant execute on function public.board_update_checklist_item(uuid, text, text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Realtime publication
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'board_tasks'
  ) then
    alter publication supabase_realtime add table public.board_tasks;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'engineering_checklist_items'
  ) then
    alter publication supabase_realtime add table public.engineering_checklist_items;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'engineering_activity_log'
  ) then
    alter publication supabase_realtime add table public.engineering_activity_log;
  end if;
end $$;

commit;
