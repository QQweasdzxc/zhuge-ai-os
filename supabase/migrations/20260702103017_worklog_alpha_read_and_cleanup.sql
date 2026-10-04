create or replace function public.worklog_alpha_list_qq(
  p_days integer default 40
)
returns table (
  id uuid,
  work_datetime timestamptz,
  title text,
  note text,
  estimated_hours numeric,
  status text,
  source text,
  created_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    e.id,
    e.work_datetime,
    e.title,
    e.note,
    e.estimated_hours,
    e.status,
    e.source,
    e.created_at
  from public.worklog_entries e
  where e.user_id = 'ac5afcc7-f045-41a9-8827-eaf085a04c0d'::uuid
    and e.work_datetime >= now() - make_interval(days => greatest(1, least(p_days, 40)))
  order by e.work_datetime desc;
$$;

grant execute on function public.worklog_alpha_list_qq(integer) to anon, authenticated;

create or replace function public.worklog_alpha_cleanup_qq()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  delete from public.worklog_entries
  where user_id = 'ac5afcc7-f045-41a9-8827-eaf085a04c0d'::uuid
    and work_datetime < now() - interval '40 days';
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

grant execute on function public.worklog_alpha_cleanup_qq() to anon, authenticated;

comment on function public.worklog_alpha_list_qq(integer) is 'Alpha-only WorkLog list function for QQ testing. Returns last 40 days max.';
comment on function public.worklog_alpha_cleanup_qq() is 'Alpha-only WorkLog cleanup function for QQ testing. Deletes entries older than 40 days.';