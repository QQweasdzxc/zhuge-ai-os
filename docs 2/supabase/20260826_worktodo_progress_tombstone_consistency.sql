-- Cleanup Batch 2 / PROG-003
--
-- Rebuild only the existing WorkTodo Progress Delete controlled RPC. This is
-- intentionally append-only: it does not modify history, schema, RLS, FK,
-- Storage, grants, or any AI Board / Legacy WorkLog function. CREATE OR
-- REPLACE retains the existing function ACL; the body below preserves the
-- current signature, SECURITY DEFINER setting, authorization, and guards.

create or replace function public.worktodo_delete_task_progress_note(
  p_activity_id bigint
)
returns public.engineering_activity_log
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user uuid := auth.uid();
  v_old public.engineering_activity_log;
  v_row public.engineering_activity_log;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  select e.* into v_old
  from public.engineering_activity_log e
  where e.id = p_activity_id
    and e.entity_type = 'board_task'
    and e.activity_type = 'human_progress_note'
    and e.action in ('progress_note_created', 'progress_note_edited')
    and e.actor_id = v_user
    and exists (
      select 1 from public.board_tasks t
      where t.id::text = e.entity_id
        and t.application_scope = 'worktodo'
        and t.owner_uuid = v_user
    )
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'WorkTodo Progress Note not found';
  end if;
  if exists (
    select 1 from public.engineering_activity_log
    where revision_of = p_activity_id or tombstone_of = p_activity_id
  ) then
    raise exception using errcode = '55000', message = 'This WorkTodo Progress Note already has a newer lifecycle event';
  end if;
  if exists (
    select 1 from public.board_tasks
    where id::text = v_old.entity_id
      and status in ('completed', 'done', 'merged', 'cancelled')
  ) then
    raise exception using errcode = '55000', message = 'Archived WorkTodo is read-only';
  end if;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type, tombstone_of
  ) values (
    'board_task', v_old.entity_id, 'progress_note_deleted',
    jsonb_build_object('activity_id', v_old.id, 'note', v_old.note),
    jsonb_build_object('activity_id', v_old.id, 'deleted', true),
    'WorkTodo Progress Note withdrawn through the Shared Action Contract',
    v_user, 'human', 'QJC', 'system_activity', p_activity_id
  ) returning * into v_row;
  return v_row;
end;
$function$;
