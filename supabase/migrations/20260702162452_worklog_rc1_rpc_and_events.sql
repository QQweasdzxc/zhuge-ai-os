create table if not exists public.worklog_source_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  role text not null default 'purchase',
  source_type text not null,
  event_key text not null,
  event_date date not null,
  title text not null,
  suggested_hours numeric not null default 0,
  quantity numeric default 1,
  evidence jsonb not null default '{}'::jsonb,
  raw_payload jsonb not null default '{}'::jsonb,
  status text not null default 'candidate',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, source_type, event_key)
);

create or replace function public.worklog_rc1_update_entry_qq(
  p_id uuid,
  p_work_datetime timestamptz,
  p_title text,
  p_task_name text default null,
  p_estimated_hours numeric default 1
)
returns public.worklog_entries
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := 'ac5afcc7-f045-41a9-8827-eaf085a04c0d'::uuid;
  v_row public.worklog_entries;
begin
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
$$;

grant execute on function public.worklog_rc1_update_entry_qq(uuid,timestamptz,text,text,numeric) to anon, authenticated;

create or replace function public.worklog_rc1_delete_entry_qq(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := 'ac5afcc7-f045-41a9-8827-eaf085a04c0d'::uuid;
begin
  delete from public.worklog_entries where id = p_id and user_id = v_user_id;
  return true;
end;
$$;

grant execute on function public.worklog_rc1_delete_entry_qq(uuid) to anon, authenticated;

create or replace function public.worklog_rc1_upsert_source_event_qq(
  p_source_type text,
  p_event_key text,
  p_event_date date,
  p_title text,
  p_suggested_hours numeric,
  p_quantity numeric default 1,
  p_evidence jsonb default '{}'::jsonb,
  p_raw_payload jsonb default '{}'::jsonb
)
returns public.worklog_source_events
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := 'ac5afcc7-f045-41a9-8827-eaf085a04c0d'::uuid;
  v_row public.worklog_source_events;
begin
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
$$;

grant execute on function public.worklog_rc1_upsert_source_event_qq(text,text,date,text,numeric,numeric,jsonb,jsonb) to anon, authenticated;

create or replace function public.worklog_rc1_list_source_events_qq(p_days integer default 40)
returns table(id uuid, source_type text, event_key text, event_date date, title text, suggested_hours numeric, quantity numeric, evidence jsonb, status text, created_at timestamptz)
language sql
security definer
set search_path = public
as $$
  select id, source_type, event_key, event_date, title, suggested_hours, quantity, evidence, status, created_at
  from public.worklog_source_events
  where user_id='ac5afcc7-f045-41a9-8827-eaf085a04c0d'::uuid
    and event_date >= current_date - make_interval(days => greatest(1, least(p_days, 40)))
  order by event_date desc, source_type, event_key;
$$;

grant execute on function public.worklog_rc1_list_source_events_qq(integer) to anon, authenticated;