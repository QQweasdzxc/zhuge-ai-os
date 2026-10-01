-- WorkTodo Attachment Canonicalization
-- Scope: extend the existing Board Attachment Contract with the formal
-- WorkTodo owner branch. Legacy WorkTodo attachment tables, RPCs, bucket,
-- WorkLog routes, and data are intentionally preserved.

create or replace function public.board_prepare_task_attachment(
  p_task_id uuid,
  p_filename text,
  p_mime_type text,
  p_byte_size bigint,
  p_activity_id bigint default null
)
returns public.board_task_attachments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  task_exists boolean;
  task_authorized boolean;
  activity_is_valid boolean;
  attachment_id_value uuid := gen_random_uuid();
  safe_filename text := regexp_replace(
    left(btrim(coalesce(p_filename, '')), 180),
    '[^A-Za-z0-9._-]',
    '_',
    'g'
  );
  scope_value text := case when p_activity_id is null then 'task' else 'progress_note' end;
  path_value text;
  saved_attachment public.board_task_attachments;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authenticated owner is required';
  end if;
  if p_task_id is null or length(btrim(coalesce(p_filename, ''))) = 0 then
    raise exception using errcode = '22023', message = 'Task id and filename are required';
  end if;
  if length(btrim(coalesce(p_mime_type, ''))) = 0 then
    raise exception using errcode = '22023', message = 'Attachment MIME type is required';
  end if;
  if p_byte_size is null or p_byte_size <= 0 or p_byte_size > 26214400 then
    raise exception using errcode = '22023', message = 'Attachment size must be between 1 byte and 25 MB';
  end if;
  if safe_filename = '' then
    safe_filename := 'attachment';
  end if;

  select exists(
    select 1 from public.board_tasks where id = p_task_id
  ) into task_exists;
  if not task_exists then
    raise exception using errcode = 'P0002', message = 'Board task not found';
  end if;

  select exists(
    select 1
    from public.board_tasks task
    where task.id = p_task_id
      and (
        (task.application_scope = 'ai_board' and public.is_engineering_member(array['owner']))
        or (task.application_scope = 'worktodo' and task.owner_uuid = auth.uid())
      )
  ) into task_authorized;
  if not task_authorized then
    raise exception using errcode = '42501', message = 'Authenticated owner is not authorized for this Board task';
  end if;

  if p_activity_id is not null then
    select exists(
      select 1
      from public.engineering_activity_log
      where id = p_activity_id
        and entity_type = 'board_task'
        and entity_id = p_task_id::text
        and activity_type = 'human_progress_note'
    ) into activity_is_valid;
    if not activity_is_valid then
      raise exception using errcode = '22023', message = 'Progress note attachment must reference a note on the same TASK';
    end if;
  end if;

  path_value := format('%s/%s/%s', p_task_id::text, attachment_id_value::text, safe_filename);

  insert into public.board_task_attachments (
    id, task_id, activity_id, attachment_scope, filename, mime_type, byte_size,
    storage_bucket, storage_path, upload_status, created_by
  ) values (
    attachment_id_value, p_task_id, p_activity_id, scope_value,
    left(btrim(p_filename), 180), btrim(p_mime_type), p_byte_size,
    'board-task-attachments', path_value, 'uploading', auth.uid()
  ) returning * into saved_attachment;

  return saved_attachment;
end;
$$;

create or replace function public.board_prepare_progress_note_attachment(
  p_activity_id bigint,
  p_filename text,
  p_mime_type text,
  p_byte_size bigint
)
returns public.board_task_attachments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  task_id_value uuid;
  task_scope text;
  task_owner uuid;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authenticated owner is required';
  end if;

  select task.id, task.application_scope, task.owner_uuid
    into task_id_value, task_scope, task_owner
  from public.engineering_activity_log activity
  join public.board_tasks task
    on task.id::text = activity.entity_id
  where activity.id = p_activity_id
    and activity.entity_type = 'board_task'
    and activity.activity_type = 'human_progress_note';

  if task_id_value is null then
    raise exception using errcode = 'P0002', message = 'Human Progress Note not found';
  end if;
  if not (
    (task_scope = 'ai_board' and public.is_engineering_member(array['owner']))
    or (task_scope = 'worktodo' and task_owner = auth.uid())
  ) then
    raise exception using errcode = '42501', message = 'Authenticated owner is not authorized for this Board task';
  end if;

  return public.board_prepare_task_attachment(
    task_id_value,
    p_filename,
    p_mime_type,
    p_byte_size,
    p_activity_id
  );
end;
$$;

create or replace function public.board_complete_task_attachment(p_attachment_id uuid)
returns public.board_task_attachments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_attachment public.board_task_attachments;
  saved_attachment public.board_task_attachments;
  task_authorized boolean;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authenticated owner is required';
  end if;

  select * into current_attachment
  from public.board_task_attachments
  where id = p_attachment_id
    and created_by = auth.uid()
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Attachment preparation not found';
  end if;

  select exists(
    select 1
    from public.board_tasks task
    where task.id = current_attachment.task_id
      and (
        (task.application_scope = 'ai_board' and public.is_engineering_member(array['owner']))
        or (task.application_scope = 'worktodo' and task.owner_uuid = auth.uid())
      )
  ) into task_authorized;
  if not task_authorized then
    raise exception using errcode = '42501', message = 'Authenticated owner is not authorized for this Board task';
  end if;
  if current_attachment.upload_status = 'ready' then
    return current_attachment;
  end if;

  if not exists (
    select 1
    from storage.objects
    where bucket_id = current_attachment.storage_bucket
      and name = current_attachment.storage_path
  ) then
    raise exception using errcode = 'P0001', message = 'Attachment upload is not present in controlled Storage';
  end if;

  update public.board_task_attachments
  set upload_status = 'ready', completed_at = now()
  where id = p_attachment_id
  returning * into saved_attachment;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', saved_attachment.task_id::text, 'task_attachment_added',
    to_jsonb(saved_attachment),
    case when saved_attachment.attachment_scope = 'progress_note'
      then 'Progress Note attachment added'
      else 'General TASK attachment added'
    end,
    auth.uid(), 'human', 'QJC', 'system_activity'
  );

  return saved_attachment;
end;
$$;

create or replace function public.board_request_delete_task_attachment(p_attachment_id uuid)
returns public.board_task_attachments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_attachment public.board_task_attachments;
  task_status text;
  task_authorized boolean;
  saved_attachment public.board_task_attachments;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authenticated owner is required';
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
  select exists(
    select 1
    from public.board_tasks task
    where task.id = current_attachment.task_id
      and (
        (task.application_scope = 'ai_board' and public.is_engineering_member(array['owner']))
        or (task.application_scope = 'worktodo' and task.owner_uuid = auth.uid())
      )
  ) into task_authorized;
  if not task_authorized then
    raise exception using errcode = '42501', message = 'Authenticated owner is not authorized for this Board task';
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
    to_jsonb(current_attachment), to_jsonb(saved_attachment),
    'General TASK attachment removal requested through the controlled lifecycle',
    auth.uid(), 'human', 'QJC', 'system_activity'
  );

  return saved_attachment;
end;
$$;

create or replace function public.board_finalize_delete_task_attachment(p_attachment_id uuid)
returns public.board_task_attachments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_attachment public.board_task_attachments;
  saved_attachment public.board_task_attachments;
  task_status text;
  task_authorized boolean;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authenticated owner is required';
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

  select status into task_status
  from public.board_tasks
  where id = current_attachment.task_id;
  if task_status is null then
    raise exception using errcode = 'P0002', message = 'Board task not found';
  end if;
  select exists(
    select 1
    from public.board_tasks task
    where task.id = current_attachment.task_id
      and (
        (task.application_scope = 'ai_board' and public.is_engineering_member(array['owner']))
        or (task.application_scope = 'worktodo' and task.owner_uuid = auth.uid())
      )
  ) into task_authorized;
  if not task_authorized then
    raise exception using errcode = '42501', message = 'Authenticated owner is not authorized for this Board task';
  end if;
  if exists (
    select 1 from storage.objects
    where bucket_id = current_attachment.storage_bucket
      and name = current_attachment.storage_path
  ) then
    raise exception using errcode = '55000', message = 'Attachment binary still exists in controlled Storage';
  end if;
  if task_status in ('done', 'merged', 'cancelled') then
    raise exception using errcode = '55000', message = 'Archived TASK is read-only';
  end if;

  update public.board_task_attachments
  set deletion_status = 'deleted', deleted_at = now(), deleted_by = auth.uid()
  where id = p_attachment_id
  returning * into saved_attachment;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', saved_attachment.task_id::text, 'task_attachment_deleted',
    to_jsonb(current_attachment), to_jsonb(saved_attachment),
    'General TASK attachment removed through the controlled Storage API and tombstone path',
    auth.uid(), 'human', 'QJC', 'system_activity'
  );

  return saved_attachment;
end;
$$;

create or replace function public.board_cancel_delete_task_attachment(p_attachment_id uuid)
returns public.board_task_attachments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_attachment public.board_task_attachments;
  saved_attachment public.board_task_attachments;
  task_authorized boolean;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Authenticated owner is required';
  end if;
  select * into current_attachment
  from public.board_task_attachments
  where id = p_attachment_id and created_by = auth.uid()
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Attachment not found';
  end if;
  select exists(
    select 1
    from public.board_tasks task
    where task.id = current_attachment.task_id
      and (
        (task.application_scope = 'ai_board' and public.is_engineering_member(array['owner']))
        or (task.application_scope = 'worktodo' and task.owner_uuid = auth.uid())
      )
  ) into task_authorized;
  if not task_authorized then
    raise exception using errcode = '42501', message = 'Authenticated owner is not authorized for this Board task';
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
$$;

create or replace function public.board_request_delete_progress_attachment(p_attachment_id uuid)
returns public.board_task_attachments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_old public.board_task_attachments;
  v_row public.board_task_attachments;
  v_activity public.engineering_activity_log;
  v_status text;
  v_scope text;
  v_owner uuid;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'Authenticated owner is required';
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
  select status, application_scope, owner_uuid
    into v_status, v_scope, v_owner
  from public.board_tasks
  where id = v_old.task_id;
  if v_status is null then
    raise exception using errcode = 'P0002', message = 'Board task not found';
  end if;
  if not (
    (v_scope = 'ai_board' and public.is_engineering_member(array['owner']))
    or (v_scope = 'worktodo' and v_owner = v_user)
  ) then
    raise exception using errcode = '42501', message = 'Authenticated owner is not authorized for this Board task';
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
    'Progress attachment removal requested through the Shared Attachment Contract',
    v_user, 'human', 'QJC', 'system_activity'
  );
  return v_row;
end;
$$;

create or replace function public.board_finalize_delete_progress_attachment(p_attachment_id uuid)
returns public.board_task_attachments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_old public.board_task_attachments;
  v_row public.board_task_attachments;
  v_scope text;
  v_owner uuid;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'Authenticated owner is required';
  end if;
  select * into v_old from public.board_task_attachments
  where id = p_attachment_id and created_by = v_user
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'Progress attachment not found'; end if;
  if v_old.attachment_scope <> 'progress_note' or v_old.activity_id is null then
    raise exception using errcode = '22023', message = 'Only progress-note attachments can be finalized here';
  end if;
  select application_scope, owner_uuid into v_scope, v_owner
  from public.board_tasks where id = v_old.task_id;
  if not (
    (v_scope = 'ai_board' and public.is_engineering_member(array['owner']))
    or (v_scope = 'worktodo' and v_owner = v_user)
  ) then
    raise exception using errcode = '42501', message = 'Authenticated owner is not authorized for this Board task';
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
    'Progress attachment removed through controlled Storage and read-back',
    v_user, 'human', 'QJC', 'system_activity'
  );
  return v_row;
end;
$$;

create or replace function public.board_cancel_delete_progress_attachment(p_attachment_id uuid)
returns public.board_task_attachments
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user uuid := auth.uid();
  v_old public.board_task_attachments;
  v_row public.board_task_attachments;
  v_scope text;
  v_owner uuid;
begin
  if v_user is null then
    raise exception using errcode = '42501', message = 'Authenticated owner is required';
  end if;
  select * into v_old from public.board_task_attachments
  where id = p_attachment_id and created_by = v_user
  for update;
  if not found then raise exception using errcode = 'P0002', message = 'Progress attachment not found'; end if;
  if v_old.attachment_scope <> 'progress_note' or v_old.activity_id is null then
    raise exception using errcode = '22023', message = 'Only progress-note attachments can be cancelled here';
  end if;
  select application_scope, owner_uuid into v_scope, v_owner
  from public.board_tasks where id = v_old.task_id;
  if not (
    (v_scope = 'ai_board' and public.is_engineering_member(array['owner']))
    or (v_scope = 'worktodo' and v_owner = v_user)
  ) then
    raise exception using errcode = '42501', message = 'Authenticated owner is not authorized for this Board task';
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
    'Progress attachment removal cancelled; binary and metadata remain active',
    v_user, 'human', 'QJC', 'system_activity'
  );
  return v_row;
end;
$$;

drop policy if exists board_task_attachment_storage_select on storage.objects;
create policy board_task_attachment_storage_select
on storage.objects
for select
to authenticated
using (
  bucket_id = 'board-task-attachments'
  and (
    public.is_engineering_member()
    or exists (
      select 1
      from public.board_task_attachments attachment
      join public.board_tasks task on task.id = attachment.task_id
      where attachment.storage_bucket = storage.objects.bucket_id
        and attachment.storage_path = storage.objects.name
        and task.application_scope = 'worktodo'
        and task.owner_uuid = auth.uid()
    )
  )
);

grant execute on function public.board_prepare_task_attachment(uuid, text, text, bigint, bigint) to authenticated;
grant execute on function public.board_prepare_progress_note_attachment(bigint, text, text, bigint) to authenticated;
grant execute on function public.board_complete_task_attachment(uuid) to authenticated;
grant execute on function public.board_request_delete_task_attachment(uuid) to authenticated;
grant execute on function public.board_finalize_delete_task_attachment(uuid) to authenticated;
grant execute on function public.board_cancel_delete_task_attachment(uuid) to authenticated;
grant execute on function public.board_request_delete_progress_attachment(uuid) to authenticated;
grant execute on function public.board_finalize_delete_progress_attachment(uuid) to authenticated;
grant execute on function public.board_cancel_delete_progress_attachment(uuid) to authenticated;
