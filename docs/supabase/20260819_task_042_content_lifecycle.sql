-- TASK-042 / Shared Task content lifecycle extensions.
--
-- This migration keeps the existing Board data model and append-only
-- engineering_activity_log.  Title edits, attachment removal, and Human
-- Progress Note revisions are all authenticated owner-only controlled paths.
-- Storage binaries are removed through the Storage API, never by SQL DML.

begin;

-- Attachment removal is a two-step tombstone lifecycle.  The row remains
-- auditable while the Storage API removes the binary between the two RPCs.
alter table public.board_task_attachments
  add column if not exists deletion_status text not null default 'active',
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users(id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.board_task_attachments'::regclass
      and conname = 'board_task_attachments_deletion_status_check'
  ) then
    alter table public.board_task_attachments
      add constraint board_task_attachments_deletion_status_check
      check (deletion_status in ('active', 'deleting', 'deleted'));
  end if;
end
$$;

create index if not exists board_task_attachments_active_task_idx
  on public.board_task_attachments (task_id, created_at desc)
  where deletion_status = 'active' and upload_status = 'ready';

-- Activity revisions remain in the same canonical append-only log.  The
-- self-references are bigint because engineering_activity_log.id is bigint.
alter table public.engineering_activity_log
  add column if not exists revision_of bigint,
  add column if not exists tombstone_of bigint;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.engineering_activity_log'::regclass
      and conname = 'engineering_activity_log_revision_of_fkey'
  ) then
    alter table public.engineering_activity_log
      add constraint engineering_activity_log_revision_of_fkey
      foreign key (revision_of)
      references public.engineering_activity_log(id)
      on delete restrict;
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.engineering_activity_log'::regclass
      and conname = 'engineering_activity_log_tombstone_of_fkey'
  ) then
    alter table public.engineering_activity_log
      add constraint engineering_activity_log_tombstone_of_fkey
      foreign key (tombstone_of)
      references public.engineering_activity_log(id)
      on delete restrict;
  end if;
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.engineering_activity_log'::regclass
      and conname = 'engineering_activity_log_revision_target_check'
  ) then
    alter table public.engineering_activity_log
      add constraint engineering_activity_log_revision_target_check
      check (revision_of is null or tombstone_of is null);
  end if;
end
$$;

create index if not exists engineering_activity_log_revision_idx
  on public.engineering_activity_log (revision_of, created_at desc)
  where revision_of is not null;
create index if not exists engineering_activity_log_tombstone_idx
  on public.engineering_activity_log (tombstone_of, created_at desc)
  where tombstone_of is not null;

-- Keep direct table writes closed.  The existing SELECT policy remains broad
-- enough for audit/read-back; the Board adapter filters deleted attachments.
revoke insert, update, delete on public.board_task_attachments from authenticated;
revoke insert, update, delete on public.engineering_activity_log from authenticated;
grant select on public.board_task_attachments to authenticated;
grant select on public.engineering_activity_log to authenticated;

-- A Storage delete is only possible after the controlled request RPC marks the
-- matching metadata row as deleting.  The binary operation itself still uses
-- the official Storage API from the shared gateway.
drop policy if exists board_task_attachment_storage_delete on storage.objects;
create policy board_task_attachment_storage_delete
  on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'board-task-attachments'
    and exists (
      select 1
      from public.board_task_attachments attachment
      where attachment.storage_bucket = storage.objects.bucket_id
        and attachment.storage_path = storage.objects.name
        and attachment.created_by = auth.uid()
        and attachment.deletion_status = 'deleting'
    )
  );

create or replace function public.board_update_task_title(
  p_task_id uuid,
  p_title text
)
returns public.board_tasks
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  title_value text := nullif(btrim(coalesce(p_title, '')), '');
  current_task public.board_tasks;
  saved_task public.board_tasks;
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'Authenticated engineering owner is required';
  end if;
  if p_task_id is null or title_value is null then
    raise exception using errcode = '22023', message = 'Task id and title are required';
  end if;
  if length(title_value) > 300 then
    raise exception using errcode = '22023', message = 'Task title must be 300 characters or fewer';
  end if;

  select * into current_task
  from public.board_tasks
  where id = p_task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Board task not found';
  end if;
  if current_task.status in ('done', 'merged', 'cancelled') then
    raise exception using errcode = '55000', message = 'Archived TASK is read-only';
  end if;

  update public.board_tasks
  set title = title_value,
      updated_at = now()
  where id = p_task_id
  returning * into saved_task;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', p_task_id::text, 'task_title_updated',
    jsonb_build_object('title', current_task.title),
    jsonb_build_object('title', saved_task.title),
    'TASK title updated through the authenticated controlled path',
    auth.uid(), 'human', 'QJC', 'system_activity'
  );

  return saved_task;
end;
$function$;

revoke all on function public.board_update_task_title(uuid, text) from public;
revoke execute on function public.board_update_task_title(uuid, text) from anon;
grant execute on function public.board_update_task_title(uuid, text) to authenticated;

create or replace function public.board_request_delete_task_attachment(
  p_attachment_id uuid
)
returns public.board_task_attachments
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  current_attachment public.board_task_attachments;
  task_status text;
  saved_attachment public.board_task_attachments;
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'Authenticated engineering owner is required';
  end if;

  select * into current_attachment
  from public.board_task_attachments
  where id = p_attachment_id
    and created_by = auth.uid()
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Attachment not found';
  end if;
  if current_attachment.attachment_scope <> 'task' then
    raise exception using errcode = '22023', message = 'Only general TASK attachments can be removed here';
  end if;
  if current_attachment.upload_status <> 'ready' then
    raise exception using errcode = '55000', message = 'Only completed attachments can be removed';
  end if;
  if current_attachment.deletion_status = 'deleted' then
    return current_attachment;
  end if;

  select status into task_status
  from public.board_tasks
  where id = current_attachment.task_id;
  if task_status is null then
    raise exception using errcode = 'P0002', message = 'Board task not found';
  end if;
  if task_status in ('done', 'merged', 'cancelled') then
    raise exception using errcode = '55000', message = 'Archived TASK is read-only';
  end if;

  update public.board_task_attachments
  set deletion_status = 'deleting'
  where id = p_attachment_id
  returning * into saved_attachment;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', saved_attachment.task_id::text, 'task_attachment_delete_requested',
    to_jsonb(current_attachment),
    to_jsonb(saved_attachment),
    'General TASK attachment removal requested through the controlled lifecycle',
    auth.uid(), 'human', 'QJC', 'system_activity'
  );

  return saved_attachment;
end;
$function$;

create or replace function public.board_finalize_delete_task_attachment(
  p_attachment_id uuid
)
returns public.board_task_attachments
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  current_attachment public.board_task_attachments;
  saved_attachment public.board_task_attachments;
  task_status text;
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'Authenticated engineering owner is required';
  end if;

  select * into current_attachment
  from public.board_task_attachments
  where id = p_attachment_id
    and created_by = auth.uid()
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Attachment not found';
  end if;
  if current_attachment.deletion_status = 'deleted' then
    return current_attachment;
  end if;
  if current_attachment.deletion_status <> 'deleting' then
    raise exception using errcode = '55000', message = 'Attachment removal was not requested through the controlled path';
  end if;
  if exists (
    select 1 from storage.objects
    where bucket_id = current_attachment.storage_bucket
      and name = current_attachment.storage_path
  ) then
    raise exception using errcode = '55000', message = 'Attachment binary still exists in controlled Storage';
  end if;

  select status into task_status from public.board_tasks where id = current_attachment.task_id;
  if task_status in ('done', 'merged', 'cancelled') then
    raise exception using errcode = '55000', message = 'Archived TASK is read-only';
  end if;

  update public.board_task_attachments
  set deletion_status = 'deleted',
      deleted_at = now(),
      deleted_by = auth.uid()
  where id = p_attachment_id
  returning * into saved_attachment;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', saved_attachment.task_id::text, 'task_attachment_deleted',
    to_jsonb(current_attachment),
    to_jsonb(saved_attachment),
    'General TASK attachment removed through the controlled Storage API and tombstone path',
    auth.uid(), 'human', 'QJC', 'system_activity'
  );

  return saved_attachment;
end;
$function$;

create or replace function public.board_cancel_delete_task_attachment(
  p_attachment_id uuid
)
returns public.board_task_attachments
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  current_attachment public.board_task_attachments;
  saved_attachment public.board_task_attachments;
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'Authenticated engineering owner is required';
  end if;
  select * into current_attachment
  from public.board_task_attachments
  where id = p_attachment_id and created_by = auth.uid()
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Attachment not found';
  end if;
  if current_attachment.deletion_status <> 'deleting' then
    return current_attachment;
  end if;
  update public.board_task_attachments
  set deletion_status = 'active'
  where id = p_attachment_id
  returning * into saved_attachment;
  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', saved_attachment.task_id::text, 'task_attachment_delete_cancelled',
    to_jsonb(current_attachment), to_jsonb(saved_attachment),
    'General TASK attachment removal cancelled; binary and metadata remain active',
    auth.uid(), 'human', 'QJC', 'system_activity'
  );
  return saved_attachment;
end;
$function$;

revoke all on function public.board_request_delete_task_attachment(uuid) from public;
revoke all on function public.board_finalize_delete_task_attachment(uuid) from public;
revoke all on function public.board_cancel_delete_task_attachment(uuid) from public;
revoke execute on function public.board_request_delete_task_attachment(uuid) from anon;
revoke execute on function public.board_finalize_delete_task_attachment(uuid) from anon;
revoke execute on function public.board_cancel_delete_task_attachment(uuid) from anon;
grant execute on function public.board_request_delete_task_attachment(uuid) to authenticated;
grant execute on function public.board_finalize_delete_task_attachment(uuid) to authenticated;
grant execute on function public.board_cancel_delete_task_attachment(uuid) to authenticated;

create or replace function public.board_edit_task_progress_note(
  p_activity_id bigint,
  p_note text
)
returns public.engineering_activity_log
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  note_value text := btrim(coalesce(p_note, ''));
  current_note public.engineering_activity_log;
  result_row public.engineering_activity_log;
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
  end if;
  if p_activity_id is null or length(note_value) = 0 then
    raise exception using errcode = '22023', message = 'Activity id and progress note are required';
  end if;
  select * into current_note
  from public.engineering_activity_log
  where id = p_activity_id
    and entity_type = 'board_task'
    and activity_type = 'human_progress_note'
    and action in ('progress_note_created', 'progress_note_edited')
    and actor_id = auth.uid()
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Editable Human Progress Note not found';
  end if;
  if exists (
    select 1 from public.engineering_activity_log
    where revision_of = p_activity_id or tombstone_of = p_activity_id
  ) then
    raise exception using errcode = '55000', message = 'This Human Progress Note already has a newer lifecycle event';
  end if;
  if exists (
    select 1 from public.board_tasks
    where id::text = current_note.entity_id
      and status in ('done', 'merged', 'cancelled')
  ) then
    raise exception using errcode = '55000', message = 'Archived TASK is read-only';
  end if;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type, revision_of
  ) values (
    'board_task', current_note.entity_id, 'progress_note_edited',
    jsonb_build_object('activity_id', current_note.id, 'note', current_note.note),
    jsonb_build_object('activity_id', current_note.id, 'note', note_value),
    note_value, auth.uid(), 'human', 'QJC', 'human_progress_note', p_activity_id
  ) returning * into result_row;
  return result_row;
end;
$function$;

create or replace function public.board_delete_task_progress_note(
  p_activity_id bigint
)
returns public.engineering_activity_log
language plpgsql
security definer
set search_path = public, pg_temp
as $function$
declare
  current_note public.engineering_activity_log;
  result_row public.engineering_activity_log;
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
  end if;
  select * into current_note
  from public.engineering_activity_log
  where id = p_activity_id
    and entity_type = 'board_task'
    and activity_type = 'human_progress_note'
    and action in ('progress_note_created', 'progress_note_edited')
    and actor_id = auth.uid()
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Deletable Human Progress Note not found';
  end if;
  if exists (
    select 1 from public.engineering_activity_log
    where revision_of = p_activity_id or tombstone_of = p_activity_id
  ) then
    raise exception using errcode = '55000', message = 'This Human Progress Note already has a newer lifecycle event';
  end if;
  if exists (
    select 1 from public.board_tasks
    where id::text = current_note.entity_id
      and status in ('done', 'merged', 'cancelled')
  ) then
    raise exception using errcode = '55000', message = 'Archived TASK is read-only';
  end if;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type, tombstone_of
  ) values (
    'board_task', current_note.entity_id, 'progress_note_deleted',
    jsonb_build_object('activity_id', current_note.id, 'note', current_note.note),
    jsonb_build_object('activity_id', current_note.id, 'deleted', true),
    'Human Progress Note withdrawn through the append-only tombstone path',
    auth.uid(), 'human', 'QJC', 'system_activity', p_activity_id
  ) returning * into result_row;
  return result_row;
end;
$function$;

revoke all on function public.board_edit_task_progress_note(bigint, text) from public;
revoke all on function public.board_delete_task_progress_note(bigint) from public;
revoke execute on function public.board_edit_task_progress_note(bigint, text) from anon;
revoke execute on function public.board_delete_task_progress_note(bigint) from anon;
grant execute on function public.board_edit_task_progress_note(bigint, text) to authenticated;
grant execute on function public.board_delete_task_progress_note(bigint) to authenticated;

notify pgrst, 'reload schema';

commit;
