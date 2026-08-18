-- TASK-041 Phase 3 / Progress Note attachment adapter path.
--
-- Reuses board_task_attachments and engineering_activity_log.  It does not
-- create a Notes table or alter the append-only Human Progress Note meaning.

begin;

create or replace function public.board_prepare_progress_note_attachment(
  p_activity_id uuid,
  p_filename text,
  p_mime_type text,
  p_byte_size bigint
)
returns public.board_task_attachments
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  task_id_value uuid;
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'Authenticated engineering owner is required';
  end if;

  select task.id into task_id_value
  from public.engineering_activity_log activity
  join public.board_tasks task
    on task.id::text = activity.entity_id
  where activity.id = p_activity_id
    and activity.entity_type = 'board_task'
    and activity.activity_type = 'human_progress_note';

  if task_id_value is null then
    raise exception using errcode = 'P0002', message = 'Human Progress Note not found';
  end if;

  return public.board_prepare_task_attachment(
    task_id_value,
    p_filename,
    p_mime_type,
    p_byte_size,
    p_activity_id
  );
end;
$function$;

revoke all on function public.board_prepare_progress_note_attachment(uuid, text, text, bigint) from public;
revoke execute on function public.board_prepare_progress_note_attachment(uuid, text, text, bigint) from anon;
grant execute on function public.board_prepare_progress_note_attachment(uuid, text, text, bigint) to authenticated;

comment on function public.board_prepare_progress_note_attachment(uuid, text, text, bigint) is
  'Prepare an authenticated Progress Note attachment using the existing append-only activity and Board attachment paths.';

notify pgrst, 'reload schema';

commit;
