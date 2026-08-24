-- TASK-041 Phase 2 / General TASK attachments.
--
-- The table stores attachment metadata only. Binary content is kept in a
-- private Supabase Storage bucket and can only be prepared/completed through
-- the authenticated controlled RPCs below.  This is a Board adapter
-- capability, not a second Task model and not Engineering Artifact Registry.

begin;

-- A failed/partial attempt must never leave the Activity binding on a
-- parallel UUID identity.  The canonical Activity primary key is bigint.
do $$
declare
  activity_column_type text;
  has_non_null_activity boolean;
begin
  if to_regclass('public.board_task_attachments') is not null then
    select format_type(a.atttypid, a.atttypmod)
      into activity_column_type
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname = 'board_task_attachments'
      and a.attname = 'activity_id'
      and not a.attisdropped;

    if activity_column_type = 'uuid' then
      execute 'select exists (select 1 from public.board_task_attachments where activity_id is not null)'
        into has_non_null_activity;
      if has_non_null_activity then
        raise exception using
          errcode = '42804',
          message = 'Existing board_task_attachments.activity_id contains UUID values; manual canonical migration is required';
      end if;
      execute 'alter table public.board_task_attachments drop constraint if exists board_task_attachments_activity_id_fkey';
      execute 'alter table public.board_task_attachments alter column activity_id type bigint using null::bigint';
    elsif activity_column_type is null then
      execute 'alter table public.board_task_attachments add column activity_id bigint';
    elsif activity_column_type <> 'bigint' then
      raise exception using
        errcode = '42804',
        message = format('Unexpected board_task_attachments.activity_id type: %s', activity_column_type);
    end if;
  end if;
end
$$;

create table if not exists public.board_task_attachments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.board_tasks(id) on delete cascade,
  activity_id bigint references public.engineering_activity_log(id) on delete restrict,
  attachment_scope text not null default 'task',
  filename text not null,
  mime_type text not null,
  byte_size bigint not null,
  storage_bucket text not null default 'board-task-attachments',
  storage_path text not null unique,
  upload_status text not null default 'uploading',
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint board_task_attachment_scope_check
    check (attachment_scope in ('task', 'progress_note')),
  constraint board_task_attachment_filename_check
    check (length(btrim(filename)) > 0),
  constraint board_task_attachment_mime_check
    check (length(btrim(mime_type)) > 0),
  constraint board_task_attachment_size_check
    check (byte_size > 0 and byte_size <= 26214400),
  constraint board_task_attachment_bucket_check
    check (storage_bucket = 'board-task-attachments'),
  constraint board_task_attachment_status_check
    check (upload_status in ('uploading', 'ready')),
  constraint board_task_attachment_scope_activity_check
    check ((attachment_scope = 'task' and activity_id is null)
      or (attachment_scope = 'progress_note' and activity_id is not null))
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.board_task_attachments'::regclass
      and conname = 'board_task_attachments_activity_id_fkey'
  ) then
    alter table public.board_task_attachments
      add constraint board_task_attachments_activity_id_fkey
      foreign key (activity_id)
      references public.engineering_activity_log(id)
      on delete restrict;
  end if;
end
$$;

create index if not exists board_task_attachments_task_idx
  on public.board_task_attachments (task_id, created_at desc);
create index if not exists board_task_attachments_activity_idx
  on public.board_task_attachments (activity_id, created_at desc);

alter table public.board_task_attachments enable row level security;
drop policy if exists board_task_attachments_authenticated_select on public.board_task_attachments;
create policy board_task_attachments_authenticated_select
  on public.board_task_attachments
  for select to authenticated
  using (public.is_engineering_member());

revoke all on public.board_task_attachments from public, anon;
revoke insert, update, delete, truncate, references, trigger on public.board_task_attachments from authenticated;
grant select on public.board_task_attachments to authenticated;

do $$
begin
  if not exists (
    select 1 from storage.buckets where id = 'board-task-attachments'
  ) then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('board-task-attachments', 'board-task-attachments', false, 26214400);
  end if;
end
$$;

drop policy if exists board_task_attachment_storage_insert on storage.objects;
create policy board_task_attachment_storage_insert
  on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'board-task-attachments'
    and exists (
      select 1
      from public.board_task_attachments attachment
      where attachment.storage_bucket = storage.objects.bucket_id
        and attachment.storage_path = storage.objects.name
        and attachment.created_by = auth.uid()
        and attachment.upload_status = 'uploading'
    )
  );

drop policy if exists board_task_attachment_storage_select on storage.objects;
create policy board_task_attachment_storage_select
  on storage.objects
  for select to authenticated
  using (
    bucket_id = 'board-task-attachments'
    and public.is_engineering_member()
  );

-- No browser UPDATE/DELETE policy is created for Storage objects.  The
-- attachment capability is append-only in this phase; future removal needs
-- its own controlled lifecycle and audit decision.

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
as $function$
declare
  task_exists boolean;
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
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using errcode = '42501', message = 'Authenticated engineering owner is required';
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

  select exists(select 1 from public.board_tasks where id = p_task_id) into task_exists;
  if not task_exists then
    raise exception using errcode = 'P0002', message = 'Board task not found';
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
$function$;

create or replace function public.board_complete_task_attachment(
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
  where id = p_attachment_id
    and created_by = auth.uid()
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Attachment preparation not found';
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
  set upload_status = 'ready',
      completed_at = now()
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
$function$;

drop function if exists public.board_prepare_task_attachment(uuid, text, text, bigint, uuid);
revoke all on function public.board_prepare_task_attachment(uuid, text, text, bigint, bigint) from public;
revoke all on function public.board_complete_task_attachment(uuid) from public;
revoke execute on function public.board_prepare_task_attachment(uuid, text, text, bigint, bigint) from anon;
revoke execute on function public.board_complete_task_attachment(uuid) from anon;
grant execute on function public.board_prepare_task_attachment(uuid, text, text, bigint, bigint) to authenticated;
grant execute on function public.board_complete_task_attachment(uuid) to authenticated;

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'board_task_attachments'
  ) then
    alter publication supabase_realtime add table public.board_task_attachments;
  end if;
end
$$;

notify pgrst, 'reload schema';

commit;
