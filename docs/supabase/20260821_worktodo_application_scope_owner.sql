-- Shared Task Data Layer: WorkTodo Application Scope + Owner UUID.
--
-- Scope: public.board_tasks remains the only new WorkTodo task table. Existing
-- AI Board rows are classified as ai_board. WorkTodo rows are classified as
-- worktodo and are visible only to their authenticated owner.
-- This migration intentionally does not update or delete legacy user_tasks or
-- work_journal_entries rows.

begin;

alter table public.board_tasks
  add column if not exists application_scope text not null default 'ai_board',
  add column if not exists owner_uuid uuid references auth.users(id) on delete cascade;

alter table public.board_workspaces
  add column if not exists application_scope text not null default 'ai_board',
  add column if not exists owner_uuid uuid references auth.users(id) on delete cascade;

alter table public.board_tasks
  drop constraint if exists board_tasks_application_scope_ck,
  drop constraint if exists board_tasks_worktodo_owner_ck,
  drop constraint if exists board_tasks_work_code_format_chk;

alter table public.board_tasks
  add constraint board_tasks_application_scope_ck
    check (application_scope in ('ai_board', 'worktodo')),
  add constraint board_tasks_worktodo_owner_ck
    check (application_scope = 'ai_board' or owner_uuid is not null),
  add constraint board_tasks_work_code_format_chk
    check (
      (application_scope = 'ai_board' and work_code ~ '^TASK-[0-9]{3,}$')
      or (application_scope = 'worktodo' and work_code ~ '^WLTK-[0-9]{3,}$')
    );

alter table public.board_workspaces
  drop constraint if exists board_workspaces_application_scope_ck;

alter table public.board_workspaces
  add constraint board_workspaces_application_scope_ck
    check (application_scope in ('ai_board', 'worktodo'));

create index if not exists board_tasks_scope_owner_idx
  on public.board_tasks (application_scope, owner_uuid, updated_at);

create index if not exists board_tasks_scope_workspace_idx
  on public.board_tasks (application_scope, workspace_id, created_at);

create index if not exists board_workspaces_scope_sort_idx
  on public.board_workspaces (application_scope, sort_order, created_at);

create sequence if not exists public.worktodo_wltk_seq as bigint start with 1 increment by 1;

create or replace function public.allocate_board_task_work_code()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
declare
  next_no bigint;
begin
  if new.application_scope = 'worktodo' then
    if new.work_code is null or btrim(new.work_code) = '' then
      perform pg_advisory_xact_lock(hashtext('public.board_tasks.work_code.worktodo'));
      select nextval('public.worktodo_wltk_seq') into next_no;
      new.work_code := 'WLTK-' || lpad(next_no::text, 3, '0');
    elsif new.work_code !~ '^WLTK-[0-9]{3,}$' then
      raise exception using errcode = '22023', message = 'WorkTodo work_code must use canonical WLTK-NNN format';
    end if;
  else
    if new.work_code is null or btrim(new.work_code) = '' then
      perform pg_advisory_xact_lock(hashtext('public.board_tasks.work_code.ai_board'));
      select coalesce(max((substring(work_code from 'TASK-([0-9]+)'))::int), 0) + 1
        into next_no
      from public.board_tasks
      where application_scope = 'ai_board'
        and work_code ~ '^TASK-[0-9]+$';
      new.work_code := 'TASK-' || lpad(next_no::text, 3, '0');
    elsif new.work_code !~ '^TASK-[0-9]{3,}$' then
      raise exception using errcode = '22023', message = 'AI Board work_code must use canonical TASK-NNN format';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.enforce_board_task_scope()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    if new.application_scope = 'worktodo'
      and (auth.uid() is null or new.owner_uuid is distinct from auth.uid()) then
      raise exception using errcode = '42501', message = 'WorkTodo owner_uuid must equal auth.uid()';
    end if;
    if new.application_scope = 'ai_board' and new.owner_uuid is not null then
      raise exception using errcode = '22023', message = 'AI Board tasks cannot set WorkTodo owner_uuid';
    end if;
    return new;
  end if;

  if old.application_scope = 'worktodo'
    and (auth.uid() is null or old.owner_uuid is distinct from auth.uid()) then
    raise exception using errcode = '42501', message = 'WorkTodo task is owned by another UUID';
  end if;

  if tg_op = 'UPDATE' then
    if new.application_scope is distinct from old.application_scope
      or new.owner_uuid is distinct from old.owner_uuid then
      raise exception using errcode = '42501', message = 'Task Application Scope and Owner UUID are immutable';
    end if;
    if new.application_scope = 'worktodo'
      and (auth.uid() is null or new.owner_uuid is distinct from auth.uid()) then
      raise exception using errcode = '42501', message = 'WorkTodo task update requires the owning UUID';
    end if;
    return new;
  end if;

  return old;
end;
$$;

drop trigger if exists trg_enforce_board_task_scope on public.board_tasks;
create trigger trg_enforce_board_task_scope
before insert or update or delete on public.board_tasks
for each row execute function public.enforce_board_task_scope();

create or replace function public.enforce_worktodo_workspace_scope()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.application_scope = 'worktodo' then
    raise exception using errcode = '42501', message = 'WorkTodo system workspaces are not editable through AI Board RPCs';
  end if;
  if tg_op = 'UPDATE' then
    return new;
  end if;
  return old;
end;
$$;

drop trigger if exists trg_enforce_worktodo_workspace_scope on public.board_workspaces;
create trigger trg_enforce_worktodo_workspace_scope
before update or delete on public.board_workspaces
for each row execute function public.enforce_worktodo_workspace_scope();

insert into public.board_workspaces (
  workspace_key, name, sort_order, active, application_scope, owner_uuid
) values
  ('worktodo-todo', '待開始', 10, true, 'worktodo', null),
  ('worktodo-inprogress', '進行中', 20, true, 'worktodo', null),
  ('worktodo-waiting-reply', '等待回覆', 30, true, 'worktodo', null),
  ('worktodo-waiting-acceptance', '等待驗收', 40, true, 'worktodo', null),
  ('worktodo-blocked', '阻塞', 50, true, 'worktodo', null),
  ('worktodo-completed', '完成', 60, true, 'worktodo', null)
on conflict (workspace_key) do update
set name = excluded.name,
    sort_order = excluded.sort_order,
    active = true,
    application_scope = 'worktodo',
    owner_uuid = null,
    updated_at = now();

alter table public.board_tasks enable row level security;
alter table public.board_workspaces enable row level security;
alter table public.board_task_checklist_items enable row level security;
alter table public.board_task_attachments enable row level security;
alter table public.engineering_activity_log enable row level security;

drop policy if exists board_tasks_authenticated_select on public.board_tasks;
create policy board_tasks_authenticated_select
on public.board_tasks for select to authenticated
using (
  (application_scope = 'ai_board' and is_engineering_member())
  or (application_scope = 'worktodo' and owner_uuid = (select auth.uid()))
);

drop policy if exists board_tasks_worktodo_insert on public.board_tasks;
create policy board_tasks_worktodo_insert
on public.board_tasks for insert to authenticated
with check (
  application_scope = 'worktodo'
  and owner_uuid = (select auth.uid())
);

drop policy if exists board_tasks_worktodo_update on public.board_tasks;
create policy board_tasks_worktodo_update
on public.board_tasks for update to authenticated
using (
  application_scope = 'worktodo'
  and owner_uuid = (select auth.uid())
)
with check (
  application_scope = 'worktodo'
  and owner_uuid = (select auth.uid())
);

drop policy if exists board_tasks_worktodo_delete on public.board_tasks;
create policy board_tasks_worktodo_delete
on public.board_tasks for delete to authenticated
using (
  application_scope = 'worktodo'
  and owner_uuid = (select auth.uid())
);

drop policy if exists board_workspaces_authenticated_select on public.board_workspaces;
create policy board_workspaces_authenticated_select
on public.board_workspaces for select to authenticated
using (application_scope = 'ai_board' and is_engineering_member());

drop policy if exists board_workspaces_worktodo_select on public.board_workspaces;
create policy board_workspaces_worktodo_select
on public.board_workspaces for select to authenticated
using (
  application_scope = 'worktodo'
  and (owner_uuid is null or owner_uuid = (select auth.uid()))
);

drop policy if exists board_task_checklist_authenticated_select on public.board_task_checklist_items;
create policy board_task_checklist_authenticated_select
on public.board_task_checklist_items for select to authenticated
using (
  (is_engineering_member() and exists (
    select 1 from public.board_tasks t
    where t.id = task_id and t.application_scope = 'ai_board'
  ))
  or exists (
    select 1 from public.board_tasks t
    where t.id = task_id
      and t.application_scope = 'worktodo'
      and t.owner_uuid = (select auth.uid())
  )
);

drop policy if exists board_task_checklist_worktodo_insert on public.board_task_checklist_items;
create policy board_task_checklist_worktodo_insert
on public.board_task_checklist_items for insert to authenticated
with check (exists (
  select 1 from public.board_tasks t
  where t.id = task_id and t.application_scope = 'worktodo' and t.owner_uuid = (select auth.uid())
));

drop policy if exists board_task_checklist_worktodo_update on public.board_task_checklist_items;
create policy board_task_checklist_worktodo_update
on public.board_task_checklist_items for update to authenticated
using (exists (
  select 1 from public.board_tasks t
  where t.id = task_id and t.application_scope = 'worktodo' and t.owner_uuid = (select auth.uid())
))
with check (exists (
  select 1 from public.board_tasks t
  where t.id = task_id and t.application_scope = 'worktodo' and t.owner_uuid = (select auth.uid())
));

drop policy if exists board_task_checklist_worktodo_delete on public.board_task_checklist_items;
create policy board_task_checklist_worktodo_delete
on public.board_task_checklist_items for delete to authenticated
using (exists (
  select 1 from public.board_tasks t
  where t.id = task_id and t.application_scope = 'worktodo' and t.owner_uuid = (select auth.uid())
));

drop policy if exists board_task_attachments_authenticated_select on public.board_task_attachments;
create policy board_task_attachments_authenticated_select
on public.board_task_attachments for select to authenticated
using (
  (is_engineering_member() and exists (
    select 1 from public.board_tasks t
    where t.id = task_id and t.application_scope = 'ai_board'
  ))
  or exists (
    select 1 from public.board_tasks t
    where t.id = task_id
      and t.application_scope = 'worktodo'
      and t.owner_uuid = (select auth.uid())
  )
);

drop policy if exists engineering_activity_read on public.engineering_activity_log;
create policy engineering_activity_read
on public.engineering_activity_log for select to authenticated
using (
  is_engineering_member()
  or exists (
    select 1 from public.board_tasks t
    where t.application_scope = 'worktodo'
      and t.owner_uuid = (select auth.uid())
      and t.id::text = entity_id
      and entity_type = 'board_task'
  )
);

create or replace function public.worktodo_workspace_key(p_status text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case lower(trim(coalesce(p_status, 'not_started')))
    when 'not_started' then 'worktodo-todo'
    when 'in_progress' then 'worktodo-inprogress'
    when 'waiting_reply' then 'worktodo-waiting-reply'
    when 'waiting_acceptance' then 'worktodo-waiting-acceptance'
    when 'blocked' then 'worktodo-blocked'
    when 'completed' then 'worktodo-completed'
    else null
  end;
$$;

create or replace function public.worktodo_create_task(
  p_title text,
  p_summary text default null,
  p_status text default 'not_started',
  p_usage_scenario text default null
)
returns public.board_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_status text := lower(trim(coalesce(p_status, 'not_started')));
  v_workspace_id uuid;
  v_task public.board_tasks;
begin
  if v_user is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  if nullif(btrim(p_title), '') is null then raise exception using errcode = '22023', message = 'WorkTodo task title is required'; end if;
  if public.worktodo_workspace_key(v_status) is null then raise exception using errcode = '22023', message = 'Unsupported WorkTodo status'; end if;

  select id into v_workspace_id
  from public.board_workspaces
  where application_scope = 'worktodo'
    and workspace_key = public.worktodo_workspace_key(v_status)
    and active = true;
  if v_workspace_id is null then raise exception using errcode = 'P0002', message = 'WorkTodo workspace is unavailable'; end if;

  insert into public.board_tasks (
    application_scope, owner_uuid, title, summary, status, workspace_id,
    source_workspace, domain, usage_scenario, created_by, created_at, updated_at
  ) values (
    'worktodo', v_user, btrim(p_title), nullif(btrim(coalesce(p_summary, '')), ''),
    v_status, v_workspace_id, 'worktodo', 'worktodo',
    nullif(btrim(coalesce(p_usage_scenario, '')), ''), v_user, now(), now()
  ) returning * into v_task;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_task.id::text, 'worktodo_task_created', to_jsonb(v_task),
    'WorkTodo task created through the authenticated owner path',
    v_user, 'human', 'WorkTodo', 'system_activity'
  );

  return v_task;
end;
$$;

create or replace function public.worktodo_update_task(
  p_task_id uuid,
  p_patch jsonb
)
returns public.board_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_old public.board_tasks;
  v_task public.board_tasks;
  v_status text;
  v_workspace_id uuid;
begin
  if v_user is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then raise exception using errcode = '22023', message = 'WorkTodo task patch must be a JSON object'; end if;
  if exists (
    select 1 from jsonb_object_keys(p_patch) as key(name)
    where key.name not in ('title', 'summary', 'status', 'usage_scenario')
  ) then raise exception using errcode = '22023', message = 'Unsupported WorkTodo task field'; end if;

  select * into v_old
  from public.board_tasks
  where id = p_task_id and application_scope = 'worktodo' and owner_uuid = v_user
  for update;
  if not found then raise exception using errcode = '42501', message = 'WorkTodo task is not editable by the current user'; end if;

  v_status := case when p_patch ? 'status' then lower(trim(coalesce(p_patch->>'status', ''))) else v_old.status end;
  if public.worktodo_workspace_key(v_status) is null then raise exception using errcode = '22023', message = 'Unsupported WorkTodo status'; end if;

  select id into v_workspace_id
  from public.board_workspaces
  where application_scope = 'worktodo'
    and workspace_key = public.worktodo_workspace_key(v_status)
    and active = true;
  if v_workspace_id is null then raise exception using errcode = 'P0002', message = 'WorkTodo workspace is unavailable'; end if;

  update public.board_tasks
  set title = case when p_patch ? 'title' then nullif(btrim(p_patch->>'title'), '') else title end,
      summary = case when p_patch ? 'summary' then nullif(btrim(coalesce(p_patch->>'summary', '')), '') else summary end,
      status = v_status,
      workspace_id = v_workspace_id,
      usage_scenario = case when p_patch ? 'usage_scenario' then nullif(btrim(coalesce(p_patch->>'usage_scenario', '')), '') else usage_scenario end,
      updated_at = now()
  where id = v_old.id
  returning * into v_task;

  if nullif(btrim(v_task.title), '') is null then raise exception using errcode = '22023', message = 'WorkTodo task title is required'; end if;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_task.id::text, 'worktodo_task_updated',
    jsonb_build_object('title', v_old.title, 'summary', v_old.summary, 'status', v_old.status, 'workspace_id', v_old.workspace_id, 'usage_scenario', v_old.usage_scenario),
    jsonb_build_object('title', v_task.title, 'summary', v_task.summary, 'status', v_task.status, 'workspace_id', v_task.workspace_id, 'usage_scenario', v_task.usage_scenario),
    'WorkTodo task updated through the authenticated owner path',
    v_user, 'human', 'WorkTodo', 'system_activity'
  );

  return v_task;
end;
$$;

create or replace function public.worktodo_delete_task(p_task_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_task public.board_tasks;
begin
  if v_user is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  select * into v_task
  from public.board_tasks
  where id = p_task_id and application_scope = 'worktodo' and owner_uuid = v_user
  for update;
  if not found then raise exception using errcode = '42501', message = 'WorkTodo task is not deletable by the current user'; end if;
  delete from public.board_tasks where id = v_task.id;
  return jsonb_build_object('deleted_id', v_task.id, 'work_code', v_task.work_code, 'owner_uuid', v_user);
end;
$$;

create or replace function public.worktodo_add_task_progress_note(
  p_task_id uuid,
  p_note text
)
returns public.engineering_activity_log
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_row public.engineering_activity_log;
begin
  if v_user is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  if nullif(btrim(p_note), '') is null then raise exception using errcode = '22023', message = 'Progress note cannot be empty'; end if;
  if not exists (
    select 1 from public.board_tasks
    where id = p_task_id and application_scope = 'worktodo' and owner_uuid = v_user
  ) then raise exception using errcode = '42501', message = 'WorkTodo task is not available to the current user'; end if;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, note, actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', p_task_id::text, 'progress_note_created', btrim(p_note),
    v_user, 'human', 'WorkTodo', 'human_progress_note'
  ) returning * into v_row;
  return v_row;
end;
$$;

create or replace function public.worktodo_migrate_task(p_work_code text)
returns public.board_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_source public.user_tasks;
  v_task public.board_tasks;
  v_existing public.board_tasks;
  v_workspace_id uuid;
  v_status text;
  v_journal_count integer;
begin
  if v_user is null then raise exception using errcode = '42501', message = 'Authentication required'; end if;
  select * into v_source
  from public.user_tasks
  where work_code = btrim(p_work_code)
    and user_uuid = v_user
    and deleted_at is null
  for share;
  if not found then raise exception using errcode = 'P0002', message = 'WorkTodo source task is not available to the current user'; end if;
  if nullif(btrim(v_source.note), '') is null then raise exception using errcode = '22023', message = 'Migration requires a WorkTodo task note'; end if;

  select count(*) into v_journal_count
  from public.work_journal_entries
  where task_uuid = v_source.id
    and user_uuid = v_user
    and lifecycle_status = 'active'
    and entry_type in ('progress', 'completion', 'note')
    and nullif(btrim(content), '') is not null;
  if v_journal_count = 0 then raise exception using errcode = '22023', message = 'Migration requires at least one WorkTodo progress journal'; end if;

  select * into v_existing
  from public.board_tasks
  where application_scope = 'worktodo' and work_code = v_source.work_code;
  if found then
    if v_existing.owner_uuid is distinct from v_user then raise exception using errcode = '42501', message = 'WorkTodo work_code is owned by another UUID'; end if;
    return v_existing;
  end if;

  v_status := lower(trim(coalesce(v_source.status, 'not_started')));
  if public.worktodo_workspace_key(v_status) is null then raise exception using errcode = '22023', message = 'WorkTodo source status has no approved workspace mapping'; end if;
  select id into v_workspace_id
  from public.board_workspaces
  where application_scope = 'worktodo'
    and workspace_key = public.worktodo_workspace_key(v_status)
    and active = true;
  if v_workspace_id is null then raise exception using errcode = 'P0002', message = 'WorkTodo workspace mapping is unavailable'; end if;

  insert into public.board_tasks (
    application_scope, owner_uuid, work_code, title, summary, status,
    workspace_id, source_workspace, domain, usage_scenario,
    created_by, created_at, updated_at
  ) values (
    'worktodo', v_user, v_source.work_code, v_source.title, v_source.note, v_status,
    v_workspace_id, 'worktodo', 'worktodo', nullif(btrim(coalesce(v_source.usage_scenario, '')), ''),
    v_user, coalesce(v_source.created_at, now()), now()
  ) returning * into v_task;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, after_data, note,
    actor_id, actor_type, actor_label, activity_type, created_at
  )
  select
    'board_task', v_task.id::text, 'progress_note_created',
    jsonb_build_object(
      'source_work_journal_id', j.id,
      'source_task_uuid', j.task_uuid,
      'status', j.status,
      'progress', j.progress,
      'migrated_from', 'worktodo'
    ),
    btrim(j.content), coalesce(j.created_by, v_user), 'human', 'WorkTodo',
    'human_progress_note', coalesce(j.created_at, now())
  from public.work_journal_entries j
  where j.task_uuid = v_source.id
    and j.user_uuid = v_user
    and j.lifecycle_status = 'active'
    and j.entry_type in ('progress', 'completion', 'note')
    and nullif(btrim(j.content), '') is not null
  order by j.created_at asc, j.id asc;

  return v_task;
end;
$$;

revoke all on function public.worktodo_create_task(text, text, text, text) from public, anon;
grant execute on function public.worktodo_create_task(text, text, text, text) to authenticated;
revoke all on function public.worktodo_update_task(uuid, jsonb) from public, anon;
grant execute on function public.worktodo_update_task(uuid, jsonb) to authenticated;
revoke all on function public.worktodo_delete_task(uuid) from public, anon;
grant execute on function public.worktodo_delete_task(uuid) to authenticated;
revoke all on function public.worktodo_add_task_progress_note(uuid, text) from public, anon;
grant execute on function public.worktodo_add_task_progress_note(uuid, text) to authenticated;
revoke all on function public.worktodo_migrate_task(text) from public, anon;
grant execute on function public.worktodo_migrate_task(text) to authenticated;

revoke all on function public.worktodo_workspace_key(text) from public, anon;
grant execute on function public.worktodo_workspace_key(text) to authenticated;

commit;
