-- TASK-041 Phase 1 / Shared task capabilities for the AI Board adapter.
--
-- Due Date and General Checklist are product-work capabilities.  They are
-- deliberately separate from WorkLog's date model and from
-- engineering_checklist_items, which remains Engineering Evidence.

begin;

alter table public.board_tasks
  add column if not exists due_date date;

comment on column public.board_tasks.due_date is
  'AI Board general task due date. It is not an engineering status, PM acceptance, or WorkLog calendar field.';

create table if not exists public.board_task_checklist_items (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.board_tasks(id) on delete cascade,
  label text not null,
  completed boolean not null default false,
  sort_order integer not null default 0,
  created_by uuid not null references auth.users(id),
  updated_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint board_task_checklist_label_check check (length(btrim(label)) > 0),
  constraint board_task_checklist_sort_order_check check (sort_order >= 0)
);

create index if not exists board_task_checklist_task_order_idx
  on public.board_task_checklist_items (task_id, sort_order, created_at);

alter table public.board_task_checklist_items enable row level security;
drop policy if exists board_task_checklist_authenticated_select on public.board_task_checklist_items;
create policy board_task_checklist_authenticated_select
  on public.board_task_checklist_items
  for select to authenticated
  using (public.is_engineering_member());

revoke all on public.board_task_checklist_items from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.board_task_checklist_items from authenticated;
grant select on public.board_task_checklist_items to authenticated;

create or replace function public.board_update_task_due_date(
  p_task_id uuid,
  p_due_date date default null
)
returns public.board_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  current_task public.board_tasks;
  saved_task public.board_tasks;
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'Authenticated engineering owner is required';
  end if;

  select * into current_task
  from public.board_tasks
  where id = p_task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Board task not found';
  end if;

  update public.board_tasks
  set due_date = p_due_date,
      updated_at = now()
  where id = p_task_id
  returning * into saved_task;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', p_task_id::text, 'task_due_date_updated',
    jsonb_build_object('due_date', current_task.due_date),
    jsonb_build_object('due_date', saved_task.due_date),
    'General TASK due date updated through the authenticated controlled path',
    auth.uid(), 'human', 'QJC', 'system_activity'
  );

  return saved_task;
end;
$function$;

create or replace function public.board_add_task_checklist_item(
  p_task_id uuid,
  p_label text,
  p_sort_order integer default 0
)
returns public.board_task_checklist_items
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  label_value text := btrim(coalesce(p_label, ''));
  task_exists boolean;
  saved_item public.board_task_checklist_items;
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'Authenticated engineering owner is required';
  end if;
  if p_task_id is null or length(label_value) = 0 then
    raise exception using errcode = '22023', message = 'Task id and checklist label are required';
  end if;
  if coalesce(p_sort_order, 0) < 0 then
    raise exception using errcode = '22023', message = 'Checklist sort order must be non-negative';
  end if;

  select exists(select 1 from public.board_tasks where id = p_task_id) into task_exists;
  if not task_exists then
    raise exception using errcode = 'P0002', message = 'Board task not found';
  end if;

  insert into public.board_task_checklist_items (
    task_id, label, completed, sort_order, created_by, updated_by
  ) values (
    p_task_id, label_value, false, coalesce(p_sort_order, 0), auth.uid(), auth.uid()
  ) returning * into saved_item;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', p_task_id::text, 'task_checklist_item_created', to_jsonb(saved_item),
    'General TASK checklist item created', auth.uid(), 'human', 'QJC', 'system_activity'
  );

  return saved_item;
end;
$function$;

create or replace function public.board_update_task_checklist_item(
  p_item_id uuid,
  p_label text default null,
  p_completed boolean default null,
  p_sort_order integer default null
)
returns public.board_task_checklist_items
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  current_item public.board_task_checklist_items;
  saved_item public.board_task_checklist_items;
  label_value text;
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'Authenticated engineering owner is required';
  end if;
  if p_item_id is null then
    raise exception using errcode = '22023', message = 'Checklist item id is required';
  end if;
  if p_label is not null and length(btrim(p_label)) = 0 then
    raise exception using errcode = '22023', message = 'Checklist label cannot be empty';
  end if;
  if p_sort_order is not null and p_sort_order < 0 then
    raise exception using errcode = '22023', message = 'Checklist sort order must be non-negative';
  end if;

  select * into current_item
  from public.board_task_checklist_items
  where id = p_item_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Checklist item not found';
  end if;

  label_value := coalesce(nullif(btrim(p_label), ''), current_item.label);
  update public.board_task_checklist_items
  set label = label_value,
      completed = coalesce(p_completed, current_item.completed),
      sort_order = coalesce(p_sort_order, current_item.sort_order),
      updated_by = auth.uid(),
      updated_at = now()
  where id = p_item_id
  returning * into saved_item;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', saved_item.task_id::text, 'task_checklist_item_updated',
    to_jsonb(current_item), to_jsonb(saved_item),
    'General TASK checklist item updated', auth.uid(), 'human', 'QJC', 'system_activity'
  );

  return saved_item;
end;
$function$;

create or replace function public.board_delete_task_checklist_item(
  p_item_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  current_item public.board_task_checklist_items;
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'Authenticated engineering owner is required';
  end if;

  select * into current_item
  from public.board_task_checklist_items
  where id = p_item_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Checklist item not found';
  end if;

  delete from public.board_task_checklist_items where id = p_item_id;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', current_item.task_id::text, 'task_checklist_item_deleted',
    to_jsonb(current_item), 'General TASK checklist item deleted',
    auth.uid(), 'human', 'QJC', 'system_activity'
  );

  return jsonb_build_object('success', true, 'item_id', p_item_id);
end;
$function$;

revoke all on function public.board_update_task_due_date(uuid, date) from public;
revoke all on function public.board_add_task_checklist_item(uuid, text, integer) from public;
revoke all on function public.board_update_task_checklist_item(uuid, text, boolean, integer) from public;
revoke all on function public.board_delete_task_checklist_item(uuid) from public;
revoke execute on function public.board_update_task_due_date(uuid, date) from anon;
revoke execute on function public.board_add_task_checklist_item(uuid, text, integer) from anon;
revoke execute on function public.board_update_task_checklist_item(uuid, text, boolean, integer) from anon;
revoke execute on function public.board_delete_task_checklist_item(uuid) from anon;
grant execute on function public.board_update_task_due_date(uuid, date) to authenticated;
grant execute on function public.board_add_task_checklist_item(uuid, text, integer) to authenticated;
grant execute on function public.board_update_task_checklist_item(uuid, text, boolean, integer) to authenticated;
grant execute on function public.board_delete_task_checklist_item(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'board_task_checklist_items'
  ) then
    alter publication supabase_realtime add table public.board_task_checklist_items;
  end if;
end
$$;

notify pgrst, 'reload schema';

commit;
