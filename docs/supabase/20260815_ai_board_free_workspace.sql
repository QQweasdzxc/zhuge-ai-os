-- AI Board Free Workspace Board
--
-- The Board workspace is a Cloud-persisted presentation position.  It is not
-- an engineering status, assignee, or PM acceptance field.  Existing
-- board_tasks.status / assignee and their controlled workflow RPC remain
-- authoritative for engineering governance.

begin;

create table if not exists public.board_workspaces (
  id uuid primary key default gen_random_uuid(),
  workspace_key text,
  name text not null,
  sort_order integer not null default 0,
  active boolean not null default true,
  archived_at timestamptz,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint board_workspaces_name_check check (length(btrim(name)) > 0),
  constraint board_workspaces_sort_order_check check (sort_order >= 0),
  constraint board_workspaces_active_archive_check check (active or archived_at is not null),
  constraint board_workspaces_workspace_key_key unique (workspace_key)
);

create unique index if not exists board_workspaces_active_name_idx
  on public.board_workspaces (lower(btrim(name)))
  where active = true;

insert into public.board_workspaces (workspace_key, name, sort_order, active)
values
  ('todo', '待辦', 10, true),
  ('co', 'Co區', 20, true),
  ('gpt', 'GPT區', 30, true),
  ('qjc', 'QJC驗證', 40, true),
  ('done', '已完工', 50, true)
on conflict (workspace_key) do nothing;

alter table public.board_tasks
  add column if not exists workspace_id uuid;

update public.board_tasks as task
set workspace_id = workspace.id
from public.board_workspaces as workspace
where task.workspace_id is null
  and workspace.workspace_key = case
    when task.status = 'inprogress' then 'co'
    when task.status = 'qa' and upper(coalesce(task.assignee, '')) = 'GPT' then 'gpt'
    when task.status = 'qa' and upper(coalesce(task.assignee, '')) = 'QJC' then 'qjc'
    when task.status = 'qa' then 'qjc'
    when task.status in ('done', 'merged', 'cancelled') then 'done'
    else 'todo'
  end
  and workspace.active = true;

do $$
begin
  if not exists (
    select 1
    from public.board_tasks
    where workspace_id is null
  ) then
    alter table public.board_tasks
      alter column workspace_id set not null;
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'board_tasks_workspace_id_fkey'
      and conrelid = 'public.board_tasks'::regclass
  ) then
    alter table public.board_tasks
      add constraint board_tasks_workspace_id_fkey
      foreign key (workspace_id) references public.board_workspaces(id)
      on delete restrict;
  end if;
end $$;

create index if not exists board_tasks_workspace_id_idx
  on public.board_tasks (workspace_id, created_at);

alter table public.board_workspaces enable row level security;
drop policy if exists board_workspaces_authenticated_select on public.board_workspaces;
create policy board_workspaces_authenticated_select
  on public.board_workspaces
  for select to authenticated
  using (public.is_engineering_member());

revoke all on public.board_workspaces from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.board_workspaces from authenticated;
grant select on public.board_workspaces to authenticated;

create or replace function public.board_create_workspace(
  p_name text
)
returns public.board_workspaces
language plpgsql
security definer
set search_path = public
as $$
declare
  name_value text := btrim(coalesce(p_name, ''));
  next_order integer;
  saved_workspace public.board_workspaces;
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
  end if;
  if length(name_value) = 0 then
    raise exception using errcode = '22023', message = 'Workspace name is required';
  end if;

  select coalesce(max(sort_order), 0) + 10
    into next_order
  from public.board_workspaces
  where active = true;

  insert into public.board_workspaces (
    name, sort_order, active, created_by, updated_by, created_at, updated_at
  ) values (
    name_value, next_order, true, auth.uid(), auth.uid(), now(), now()
  ) returning * into saved_workspace;

  return saved_workspace;
end;
$$;

create or replace function public.board_rename_workspace(
  p_workspace_id uuid,
  p_name text
)
returns public.board_workspaces
language plpgsql
security definer
set search_path = public
as $$
declare
  name_value text := btrim(coalesce(p_name, ''));
  saved_workspace public.board_workspaces;
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
  end if;
  if p_workspace_id is null or length(name_value) = 0 then
    raise exception using errcode = '22023', message = 'Workspace id and name are required';
  end if;

  update public.board_workspaces
  set name = name_value,
      updated_by = auth.uid(),
      updated_at = now()
  where id = p_workspace_id
    and active = true
  returning * into saved_workspace;

  if not found then
    raise exception using errcode = 'P0002', message = 'Active workspace not found';
  end if;
  return saved_workspace;
end;
$$;

create or replace function public.board_reorder_workspaces(
  p_workspace_ids uuid[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  expected_count integer;
  supplied_count integer := coalesce(array_length(p_workspace_ids, 1), 0);
  distinct_count integer;
  workspace_id_value uuid;
  position_value integer := 0;
  ordered_ids jsonb := '[]'::jsonb;
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
  end if;
  if p_workspace_ids is null or supplied_count = 0 then
    raise exception using errcode = '22023', message = 'Workspace order is required';
  end if;

  select count(*) into expected_count
  from public.board_workspaces
  where active = true;

  select count(distinct id) into distinct_count
  from unnest(p_workspace_ids) as supplied(id);

  if supplied_count <> expected_count or distinct_count <> expected_count
     or exists (
       select 1
       from unnest(p_workspace_ids) as supplied(id)
       left join public.board_workspaces workspace on workspace.id = supplied.id
       where workspace.id is null or workspace.active = false
     ) then
    raise exception using errcode = '22023', message = 'Workspace order must include every active workspace exactly once';
  end if;

  foreach workspace_id_value in array p_workspace_ids loop
    position_value := position_value + 10;
    update public.board_workspaces
    set sort_order = position_value,
        updated_by = auth.uid(),
        updated_at = now()
    where id = workspace_id_value;
    ordered_ids := ordered_ids || jsonb_build_array(workspace_id_value);
  end loop;

  return jsonb_build_object('success', true, 'workspace_ids', ordered_ids);
end;
$$;

create or replace function public.board_move_task_workspace(
  p_task_id uuid,
  p_target_workspace_id uuid,
  p_note text default null
)
returns public.board_tasks
language plpgsql
security definer
set search_path = public
as $$
declare
  current_task public.board_tasks;
  target_workspace public.board_workspaces;
  current_workspace public.board_workspaces;
  moved_task public.board_tasks;
  note_value text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
  end if;
  if p_task_id is null or p_target_workspace_id is null then
    raise exception using errcode = '22023', message = 'Task id and target workspace are required';
  end if;

  select * into current_task
  from public.board_tasks
  where id = p_task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Board task not found';
  end if;
  if current_task.status in ('merged', 'cancelled') then
    raise exception using errcode = '42501', message = 'Terminal governance task cannot move workspace';
  end if;

  select * into target_workspace
  from public.board_workspaces
  where id = p_target_workspace_id
    and active = true;
  if not found then
    raise exception using errcode = 'P0002', message = 'Active target workspace not found';
  end if;

  select * into current_workspace
  from public.board_workspaces
  where id = current_task.workspace_id;

  if current_task.workspace_id = target_workspace.id then
    return current_task;
  end if;

  update public.board_tasks
  set workspace_id = target_workspace.id,
      updated_at = now()
  where id = p_task_id
  returning * into moved_task;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label
  ) values (
    'board_task', p_task_id::text, 'workspace_moved',
    jsonb_build_object(
      'workspace_id', current_task.workspace_id,
      'workspace_name', current_workspace.name,
      'status', current_task.status,
      'assignee', current_task.assignee
    ),
    jsonb_build_object(
      'workspace_id', moved_task.workspace_id,
      'workspace_name', target_workspace.name,
      'status', moved_task.status,
      'assignee', moved_task.assignee
    ),
    coalesce(note_value, 'AI Board workspace moved'),
    auth.uid(), 'human', 'QJC'
  );

  return moved_task;
end;
$$;

revoke all on function public.board_create_workspace(text) from public;
revoke all on function public.board_rename_workspace(uuid, text) from public;
revoke all on function public.board_reorder_workspaces(uuid[]) from public;
revoke all on function public.board_move_task_workspace(uuid, uuid, text) from public;
revoke execute on function public.board_create_workspace(text) from anon;
revoke execute on function public.board_rename_workspace(uuid, text) from anon;
revoke execute on function public.board_reorder_workspaces(uuid[]) from anon;
revoke execute on function public.board_move_task_workspace(uuid, uuid, text) from anon;
grant execute on function public.board_create_workspace(text) to authenticated;
grant execute on function public.board_rename_workspace(uuid, text) to authenticated;
grant execute on function public.board_reorder_workspaces(uuid[]) to authenticated;
grant execute on function public.board_move_task_workspace(uuid, uuid, text) to authenticated;

-- Keep the existing controlled TASK creation path compatible with the new
-- independent workspace position.  New cards begin in 待辦, while status and
-- assignee retain their existing engineering meaning.
create or replace function public.board_create_task(
  p_title text,
  p_summary text default null,
  p_usage_scenario text default null,
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
  todo_workspace_id uuid;
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

  select id into todo_workspace_id
  from public.board_workspaces
  where workspace_key = 'todo' and active = true;
  if todo_workspace_id is null then
    raise exception using errcode = 'P0001', message = 'Default 待辦 workspace is unavailable';
  end if;

  insert into public.board_tasks (
    title, summary, usage_scenario, priority, status, assignee,
    workspace_id, created_by, created_at, updated_at
  ) values (
    trim(p_title),
    nullif(trim(coalesce(p_summary, '')), ''),
    nullif(trim(coalesce(p_usage_scenario, '')), ''),
    nullif(trim(coalesce(p_priority, '')), ''),
    'ready', 'Co', todo_workspace_id, actor_id_value, now(), now()
  ) returning * into created_task;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, after_data, note,
    actor_id, actor_type, actor_label
  ) values (
    'board_task', created_task.id::text, 'task_created', to_jsonb(created_task),
    'Board task created', actor_id_value, actor_type_value, actor_label_value
  );

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

revoke all on function public.board_create_task(text, text, text, text, text, text) from public;
revoke execute on function public.board_create_task(text, text, text, text, text, text) from anon;
grant execute on function public.board_create_task(text, text, text, text, text, text) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'board_workspaces'
  ) then
    alter publication supabase_realtime add table public.board_workspaces;
  end if;
end $$;

notify pgrst, 'reload schema';

commit;
