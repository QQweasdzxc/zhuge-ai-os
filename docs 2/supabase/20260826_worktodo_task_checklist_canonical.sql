-- Template C WorkTodo Checklist canonical-path authorization convergence.
--
-- Read-only preflight confirmed that board_task_checklist_items, its existing
-- authenticated grants, and its WorkTodo owner RLS policies already exist.
-- This migration is intentionally limited to replacing the authorization
-- guard in the three existing Board Checklist RPCs. It does not alter tables,
-- RLS, Storage, legacy RPCs, or any other Task Domain.
--
-- IMPORTANT: This file is a Candidate migration artifact. It has not been
-- applied to Supabase in this turn.

begin;

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
  task_row public.board_tasks;
  saved_item public.board_task_checklist_items;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authenticated user is required';
  end if;
  if p_task_id is null or length(label_value) = 0 then
    raise exception using errcode = '22023', message = 'Task id and checklist label are required';
  end if;
  if coalesce(p_sort_order, 0) < 0 then
    raise exception using errcode = '22023', message = 'Checklist sort order must be non-negative';
  end if;

  select * into task_row
  from public.board_tasks
  where id = p_task_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Board task not found';
  end if;

  if task_row.application_scope = 'ai_board' then
    if not public.is_engineering_member(array['owner']) then
      raise exception using errcode = '42501', message = 'Authenticated engineering owner is required';
    end if;
  elsif task_row.application_scope = 'worktodo' then
    if task_row.owner_uuid is distinct from auth.uid() then
      raise exception using errcode = '42501', message = 'Authenticated WorkTodo owner is required';
    end if;
  else
    raise exception using errcode = '42501', message = 'Unsupported Board task application scope';
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
  task_row public.board_tasks;
  saved_item public.board_task_checklist_items;
  label_value text;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authenticated user is required';
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

  select * into task_row
  from public.board_tasks
  where id = current_item.task_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Board task not found';
  end if;

  if task_row.application_scope = 'ai_board' then
    if not public.is_engineering_member(array['owner']) then
      raise exception using errcode = '42501', message = 'Authenticated engineering owner is required';
    end if;
  elsif task_row.application_scope = 'worktodo' then
    if task_row.owner_uuid is distinct from auth.uid() then
      raise exception using errcode = '42501', message = 'Authenticated WorkTodo owner is required';
    end if;
  else
    raise exception using errcode = '42501', message = 'Unsupported Board task application scope';
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
  task_row public.board_tasks;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authenticated user is required';
  end if;
  if p_item_id is null then
    raise exception using errcode = '22023', message = 'Checklist item id is required';
  end if;

  select * into current_item
  from public.board_task_checklist_items
  where id = p_item_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Checklist item not found';
  end if;

  select * into task_row
  from public.board_tasks
  where id = current_item.task_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'Board task not found';
  end if;

  if task_row.application_scope = 'ai_board' then
    if not public.is_engineering_member(array['owner']) then
      raise exception using errcode = '42501', message = 'Authenticated engineering owner is required';
    end if;
  elsif task_row.application_scope = 'worktodo' then
    if task_row.owner_uuid is distinct from auth.uid() then
      raise exception using errcode = '42501', message = 'Authenticated WorkTodo owner is required';
    end if;
  else
    raise exception using errcode = '42501', message = 'Unsupported Board task application scope';
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

commit;
