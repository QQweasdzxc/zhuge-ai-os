-- Scoped release blocker closure; preserves historical SQL and existing pending chain.
-- Module C canonical attachment metadata: display name + note.
-- Shared by every C consumer; storage object path/name remains unchanged.
begin;

-- Existing compatibility API is retired; formal consumers use the instance lifecycle.
create or replace function public.board_create_workspace(p_name text)
returns public.board_workspaces
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception using errcode = '42501',
    message = 'Legacy Workspace create is retired; use the canonical Board Instance lifecycle';
end;
$function$;
revoke all on function public.board_create_workspace(text) from public, anon, authenticated, service_role;


alter table public.board_task_attachments
  add column if not exists display_name text,
  add column if not exists note text;

create or replace function public.board_update_task_attachment_metadata(
  p_attachment_id uuid,
  p_display_name text default null,
  p_note text default null
)
returns public.board_task_attachments
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := auth.uid();
  v_row public.board_task_attachments;
begin
  if v_actor is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_row from public.board_task_attachments where id = p_attachment_id and deletion_status = 'active' for update;
  if not found then raise exception 'ATTACHMENT_NOT_FOUND'; end if;
  if not public.board_task_can_write(v_row.task_id) then
    raise exception using errcode = '42501', message = 'Parent Task write authorization is required';
  end if;

  -- Definer writes must check the existing parent Task writer authority explicitly.
  if p_display_name is not null and length(btrim(p_display_name)) = 0 then raise exception 'DISPLAY_NAME_REQUIRED'; end if;

  update public.board_task_attachments
     set display_name = case when p_display_name is null then display_name else nullif(btrim(p_display_name), filename) end,
         note = case when p_note is null then note else nullif(btrim(p_note), '') end
   where id = p_attachment_id
   returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.board_update_task_attachment_metadata(uuid,text,text) from public, anon, authenticated, service_role;
grant execute on function public.board_update_task_attachment_metadata(uuid,text,text) to authenticated;

-- Retain legacy WorkLog signatures/data, with authenticated owner authorization.
CREATE OR REPLACE FUNCTION public.worklog_alpha_capture_qq(p_work_datetime timestamp with time zone, p_title text, p_task_name text DEFAULT NULL::text, p_estimated_hours numeric DEFAULT 1)
 RETURNS worklog_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := 'ac5afcc7-f045-41a9-8827-eaf085a04c0d'::uuid;
  v_row public.worklog_entries;
begin
  if auth.uid() is null or auth.uid() <> 'ac5afcc7-f045-41a9-8827-eaf085a04c0d'::uuid then
    raise exception using errcode = '42501', message = 'WorkLog authenticated owner authorization is required';
  end if;
  insert into public.worklog_entries (
    user_id,
    work_datetime,
    title,
    note,
    source,
    status,
    estimated_hours
  ) values (
    v_user_id,
    p_work_datetime,
    p_title,
    nullif(p_task_name,''),
    'chrome_extension',
    'logged',
    p_estimated_hours
  )
  returning * into v_row;

  return v_row;
end;
$function$;

revoke all on function public.worklog_alpha_capture_qq(timestamptz,text,text,numeric) from public, anon, authenticated, service_role;
grant execute on function public.worklog_alpha_capture_qq(timestamptz,text,text,numeric) to authenticated;

CREATE OR REPLACE FUNCTION public.worklog_alpha_cleanup_qq()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_count integer;
begin
  if auth.uid() is null or auth.uid() <> 'ac5afcc7-f045-41a9-8827-eaf085a04c0d'::uuid then
    raise exception using errcode = '42501', message = 'WorkLog authenticated owner authorization is required';
  end if;
  delete from public.worklog_entries
  where user_id = 'ac5afcc7-f045-41a9-8827-eaf085a04c0d'::uuid
    and work_datetime < now() - interval '40 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;

revoke all on function public.worklog_alpha_cleanup_qq() from public, anon, authenticated, service_role;
grant execute on function public.worklog_alpha_cleanup_qq() to authenticated;

CREATE OR REPLACE FUNCTION public.worklog_rc1_delete_entry_qq(p_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := 'ac5afcc7-f045-41a9-8827-eaf085a04c0d'::uuid;
begin
  if auth.uid() is null or auth.uid() <> 'ac5afcc7-f045-41a9-8827-eaf085a04c0d'::uuid then
    raise exception using errcode = '42501', message = 'WorkLog authenticated owner authorization is required';
  end if;
  delete from public.worklog_entries where id = p_id and user_id = v_user_id;
  return true;
end;
$function$;

revoke all on function public.worklog_rc1_delete_entry_qq(uuid) from public, anon, authenticated, service_role;
grant execute on function public.worklog_rc1_delete_entry_qq(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.worklog_rc1_update_entry_qq(p_id uuid, p_work_datetime timestamp with time zone, p_title text, p_task_name text DEFAULT NULL::text, p_estimated_hours numeric DEFAULT 1)
 RETURNS worklog_entries
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := 'ac5afcc7-f045-41a9-8827-eaf085a04c0d'::uuid;
  v_row public.worklog_entries;
begin
  if auth.uid() is null or auth.uid() <> 'ac5afcc7-f045-41a9-8827-eaf085a04c0d'::uuid then
    raise exception using errcode = '42501', message = 'WorkLog authenticated owner authorization is required';
  end if;
  update public.worklog_entries
  set work_datetime = p_work_datetime,
      title = p_title,
      note = nullif(p_task_name,''),
      estimated_hours = p_estimated_hours,
      status = 'logged'
  where id = p_id and user_id = v_user_id
  returning * into v_row;
  return v_row;
end;
$function$;

revoke all on function public.worklog_rc1_update_entry_qq(uuid,timestamptz,text,text,numeric) from public, anon, authenticated, service_role;
grant execute on function public.worklog_rc1_update_entry_qq(uuid,timestamptz,text,text,numeric) to authenticated;

CREATE OR REPLACE FUNCTION public.worklog_rc1_upsert_source_event_qq(p_source_type text, p_event_key text, p_event_date date, p_title text, p_suggested_hours numeric, p_quantity numeric DEFAULT 1, p_evidence jsonb DEFAULT '{}'::jsonb, p_raw_payload jsonb DEFAULT '{}'::jsonb)
 RETURNS worklog_source_events
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user_id uuid := 'ac5afcc7-f045-41a9-8827-eaf085a04c0d'::uuid;
  v_row public.worklog_source_events;
begin
  if auth.uid() is null or auth.uid() <> 'ac5afcc7-f045-41a9-8827-eaf085a04c0d'::uuid then
    raise exception using errcode = '42501', message = 'WorkLog authenticated owner authorization is required';
  end if;
  if p_event_key is null or trim(p_event_key) = '' or p_event_date is null or p_title is null or trim(p_title) = '' then
    raise exception 'Invalid event payload';
  end if;
  if p_event_date < current_date - interval '40 days' then
    raise exception 'Event date is older than 40 days';
  end if;

  insert into public.worklog_source_events(user_id, role, source_type, event_key, event_date, title, suggested_hours, quantity, evidence, raw_payload, status)
  values(v_user_id, 'purchase', p_source_type, p_event_key, p_event_date, p_title, p_suggested_hours, p_quantity, coalesce(p_evidence,'{}'::jsonb), coalesce(p_raw_payload,'{}'::jsonb), 'candidate')
  on conflict(user_id, source_type, event_key)
  do update set event_date=excluded.event_date, title=excluded.title, suggested_hours=excluded.suggested_hours, quantity=excluded.quantity, evidence=excluded.evidence, raw_payload=excluded.raw_payload, status='candidate', updated_at=now()
  returning * into v_row;
  return v_row;
end;
$function$;

revoke all on function public.worklog_rc1_upsert_source_event_qq(text,text,date,text,numeric,numeric,jsonb,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.worklog_rc1_upsert_source_event_qq(text,text,date,text,numeric,numeric,jsonb,jsonb) to authenticated;

commit;
