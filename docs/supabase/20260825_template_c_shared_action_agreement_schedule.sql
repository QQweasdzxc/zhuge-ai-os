-- Template C Shared Action Contract + WorkTodo Agreement Schedule.
--
-- This file is a controlled migration proposal for the PM-approved Candidate.
-- It must be applied through the existing Supabase migration/review process;
-- the Candidate build itself does not execute Cloud DDL or RPCs.

begin;

-- -------------------------------------------------------------------------
-- Agreement Schedule: WorkTodo domain data only.
-- due_date remains a separate Task field and is intentionally not backfilled.
-- -------------------------------------------------------------------------

alter table public.board_tasks
  add column if not exists agreement_mode text,
  add column if not exists agreement_start_date date,
  add column if not exists agreement_end_date date;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.board_tasks'::regclass
      and conname = 'board_tasks_agreement_schedule_ck'
  ) then
    alter table public.board_tasks
      add constraint board_tasks_agreement_schedule_ck
      check (
        (agreement_mode is null and agreement_start_date is null and agreement_end_date is null)
        or (agreement_mode = 'single' and agreement_start_date is not null and agreement_end_date is null)
        or (agreement_mode = 'period' and agreement_start_date is not null
          and agreement_end_date is not null and agreement_end_date >= agreement_start_date)
      );
  end if;
end
$$;

comment on column public.board_tasks.agreement_mode is
  'WorkTodo external agreement schedule discriminator: single or period; NULL means unset.';
comment on column public.board_tasks.agreement_start_date is
  'WorkTodo Agreement Date for single mode, or inclusive period start for period mode.';
comment on column public.board_tasks.agreement_end_date is
  'WorkTodo Agreement Period inclusive end; NULL for single mode or unset.';

-- -------------------------------------------------------------------------
-- WorkTodo Progress lifecycle: engineering_activity_log is the canonical
-- source. This path never reads, writes, or tombstones work_journal_entries.
-- -------------------------------------------------------------------------

create or replace function public.worktodo_edit_task_progress_note(
  p_activity_id bigint,
  p_note text
)
returns public.engineering_activity_log
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user uuid := auth.uid();
  v_note text := btrim(coalesce(p_note, ''));
  v_old public.engineering_activity_log;
  v_row public.engineering_activity_log;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if p_activity_id is null or length(v_note) = 0 then
    raise exception using errcode = '22023', message = 'Activity id and progress note are required';
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

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type, revision_of
  ) values (
    'board_task', v_old.entity_id, 'progress_note_edited',
    jsonb_build_object('activity_id', v_old.id, 'note', v_old.note),
    jsonb_build_object('activity_id', v_old.id, 'note', v_note),
    v_note, v_user, 'human', 'QJC', 'human_progress_note', p_activity_id
  ) returning * into v_row;
  return v_row;
end;
$function$;

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
    v_user, 'human', 'QJC', 'human_progress_note', p_activity_id
  ) returning * into v_row;
  return v_row;
end;
$function$;

-- -------------------------------------------------------------------------
-- AI Board Progress Attachment lifecycle. General TASK attachment RPCs stay
-- strict and continue to reject attachment_scope = progress_note.
-- -------------------------------------------------------------------------

create or replace function public.board_request_delete_progress_attachment(
  p_attachment_id uuid
)
returns public.board_task_attachments
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user uuid := auth.uid();
  v_old public.board_task_attachments;
  v_row public.board_task_attachments;
  v_activity public.engineering_activity_log;
  v_status text;
begin
  if v_user is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'Authenticated engineering owner is required';
  end if;
  select * into v_old
  from public.board_task_attachments
  where id = p_attachment_id and created_by = v_user
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Progress attachment not found';
  end if;
  if v_old.attachment_scope <> 'progress_note' or v_old.activity_id is null then
    raise exception using errcode = '22023', message = 'Only progress-note attachments can be removed here';
  end if;
  if v_old.upload_status <> 'ready' then
    raise exception using errcode = '55000', message = 'Only completed attachments can be removed';
  end if;
  select * into v_activity
  from public.engineering_activity_log
  where id = v_old.activity_id
    and entity_type = 'board_task'
    and activity_type = 'human_progress_note'
    and entity_id = v_old.task_id::text;
  if not found then
    raise exception using errcode = 'P0002', message = 'Progress activity binding is invalid';
  end if;
  select status into v_status from public.board_tasks where id = v_old.task_id and application_scope = 'ai_board';
  if v_status is null then
    raise exception using errcode = 'P0002', message = 'AI Board task not found';
  end if;
  if v_status in ('done', 'completed', 'merged', 'cancelled') then
    raise exception using errcode = '55000', message = 'Archived TASK is read-only';
  end if;
  if v_old.deletion_status = 'deleted' then return v_old; end if;

  update public.board_task_attachments
  set deletion_status = 'deleting'
  where id = p_attachment_id
  returning * into v_row;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_row.task_id::text, 'progress_attachment_delete_requested',
    to_jsonb(v_old), to_jsonb(v_row),
    'AI Board progress attachment removal requested through the Shared Attachment Contract',
    v_user, 'human', 'QJC', 'system_activity'
  );
  return v_row;
end;
$function$;

create or replace function public.board_finalize_delete_progress_attachment(
  p_attachment_id uuid
)
returns public.board_task_attachments
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user uuid := auth.uid();
  v_old public.board_task_attachments;
  v_row public.board_task_attachments;
begin
  if v_user is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'Authenticated engineering owner is required';
  end if;
  select * into v_old from public.board_task_attachments
  where id = p_attachment_id and created_by = v_user
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'Progress attachment not found'; end if;
  if v_old.attachment_scope <> 'progress_note' or v_old.activity_id is null then
    raise exception using errcode = '22023', message = 'Only progress-note attachments can be finalized here';
  end if;
  if v_old.deletion_status = 'deleted' then return v_old; end if;
  if v_old.deletion_status <> 'deleting' then
    raise exception using errcode = '55000', message = 'Progress attachment removal was not requested through the controlled path';
  end if;
  if exists (select 1 from storage.objects where bucket_id = v_old.storage_bucket and name = v_old.storage_path) then
    raise exception using errcode = '55000', message = 'Attachment binary still exists in controlled Storage';
  end if;
  update public.board_task_attachments
  set deletion_status = 'deleted', deleted_at = now(), deleted_by = v_user
  where id = p_attachment_id
  returning * into v_row;
  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_row.task_id::text, 'progress_attachment_deleted',
    to_jsonb(v_old), to_jsonb(v_row),
    'AI Board progress attachment removed through controlled Storage and read-back',
    v_user, 'human', 'QJC', 'system_activity'
  );
  return v_row;
end;
$function$;

create or replace function public.board_cancel_delete_progress_attachment(
  p_attachment_id uuid
)
returns public.board_task_attachments
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user uuid := auth.uid();
  v_old public.board_task_attachments;
  v_row public.board_task_attachments;
begin
  if v_user is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'Authenticated engineering owner is required';
  end if;
  select * into v_old from public.board_task_attachments
  where id = p_attachment_id and created_by = v_user
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'Progress attachment not found'; end if;
  if v_old.attachment_scope <> 'progress_note' or v_old.activity_id is null then
    raise exception using errcode = '22023', message = 'Only progress-note attachments can be cancelled here';
  end if;
  if v_old.deletion_status <> 'deleting' then return v_old; end if;
  update public.board_task_attachments set deletion_status = 'active'
  where id = p_attachment_id returning * into v_row;
  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_row.task_id::text, 'progress_attachment_delete_cancelled',
    to_jsonb(v_old), to_jsonb(v_row),
    'AI Board progress attachment removal cancelled; binary and metadata remain active',
    v_user, 'human', 'QJC', 'system_activity'
  );
  return v_row;
end;
$function$;

-- -------------------------------------------------------------------------
-- WorkTodo Agreement Schedule controlled write and explicit read-back.
-- -------------------------------------------------------------------------

create or replace function public.worktodo_set_agreement_schedule(
  p_task_id uuid,
  p_agreement_mode text,
  p_agreement_start_date date,
  p_agreement_end_date date
)
returns public.board_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  v_user uuid := auth.uid();
  v_mode text := nullif(lower(btrim(coalesce(p_agreement_mode, ''))), '');
  v_old public.board_tasks;
  v_task public.board_tasks;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;
  if v_mode is not null and v_mode not in ('single', 'period') then
    raise exception using errcode = '22023', message = 'Agreement mode must be single or period';
  end if;
  if v_mode is null and (p_agreement_start_date is not null or p_agreement_end_date is not null) then
    raise exception using errcode = '22023', message = 'Unset Agreement Schedule cannot contain dates';
  end if;
  if v_mode = 'single' and (p_agreement_start_date is null or p_agreement_end_date is not null) then
    raise exception using errcode = '22023', message = 'Single Agreement Schedule requires only one date';
  end if;
  if v_mode = 'period' and (p_agreement_start_date is null or p_agreement_end_date is null or p_agreement_end_date < p_agreement_start_date) then
    raise exception using errcode = '22023', message = 'Agreement Period requires an ordered start and end date';
  end if;

  select * into v_old from public.board_tasks
  where id = p_task_id and application_scope = 'worktodo' and owner_uuid = v_user
  for update;
  if not found then
    raise exception using errcode = '42501', message = 'WorkTodo task is not editable by the current user';
  end if;
  if v_old.status in ('completed', 'done', 'merged', 'cancelled') then
    raise exception using errcode = '55000', message = 'Archived WorkTodo is read-only';
  end if;

  update public.board_tasks
  set agreement_mode = v_mode,
      agreement_start_date = p_agreement_start_date,
      agreement_end_date = p_agreement_end_date,
      updated_at = now()
  where id = v_old.id
  returning * into v_task;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_task.id::text, 'worktodo_agreement_schedule_updated',
    jsonb_build_object('agreement_mode', v_old.agreement_mode, 'agreement_start_date', v_old.agreement_start_date, 'agreement_end_date', v_old.agreement_end_date),
    jsonb_build_object('agreement_mode', v_task.agreement_mode, 'agreement_start_date', v_task.agreement_start_date, 'agreement_end_date', v_task.agreement_end_date),
    'WorkTodo Agreement Schedule updated through the Shared Task Drawer Contract',
    v_user, 'human', 'QJC', 'system_activity'
  );
  return v_task;
end;
$function$;

revoke all on function public.worktodo_edit_task_progress_note(bigint, text) from public, anon;
revoke all on function public.worktodo_delete_task_progress_note(bigint) from public, anon;
revoke all on function public.board_request_delete_progress_attachment(uuid) from public, anon;
revoke all on function public.board_finalize_delete_progress_attachment(uuid) from public, anon;
revoke all on function public.board_cancel_delete_progress_attachment(uuid) from public, anon;
revoke all on function public.worktodo_set_agreement_schedule(uuid, text, date, date) from public, anon;
grant execute on function public.worktodo_edit_task_progress_note(bigint, text) to authenticated;
grant execute on function public.worktodo_delete_task_progress_note(bigint) to authenticated;
grant execute on function public.board_request_delete_progress_attachment(uuid) to authenticated;
grant execute on function public.board_finalize_delete_progress_attachment(uuid) to authenticated;
grant execute on function public.board_cancel_delete_progress_attachment(uuid) to authenticated;
grant execute on function public.worktodo_set_agreement_schedule(uuid, text, date, date) to authenticated;

comment on function public.worktodo_set_agreement_schedule(uuid, text, date, date) is
  'Controlled WorkTodo Agreement Schedule write; never falls back to due_date and never backfills existing due_date.';

notify pgrst, 'reload schema';

commit;
