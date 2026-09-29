-- Corrective migration for the WorkTodo shared progress-note write path.
--
-- `engineering_activity_log.actor_label` is a controlled actor vocabulary.
-- WorkTodo is an application scope, not an actor label, so this RPC must use
-- the authenticated QJC actor label already used by the shared human-write
-- contract.

begin;

create or replace function public.worktodo_add_task_progress_note(
  p_task_id uuid,
  p_note text
)
returns public.engineering_activity_log
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user uuid := auth.uid();
  v_row public.engineering_activity_log;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if nullif(btrim(p_note), '') is null then
    raise exception using errcode = '22023', message = 'Progress note cannot be empty';
  end if;

  if not exists (
    select 1
    from public.board_tasks
    where id = p_task_id
      and application_scope = 'worktodo'
      and owner_uuid = v_user
  ) then
    raise exception using errcode = '42501', message = 'WorkTodo task is not available to the current user';
  end if;

  insert into public.engineering_activity_log (
    entity_type,
    entity_id,
    action,
    note,
    actor_id,
    actor_type,
    actor_label,
    activity_type
  ) values (
    'board_task',
    p_task_id::text,
    'progress_note_created',
    btrim(p_note),
    v_user,
    'human',
    'QJC',
    'human_progress_note'
  )
  returning * into v_row;

  return v_row;
end;
$function$;

revoke all on function public.worktodo_add_task_progress_note(uuid, text) from public, anon;
grant execute on function public.worktodo_add_task_progress_note(uuid, text) to authenticated;

notify pgrst, 'reload schema';

commit;
