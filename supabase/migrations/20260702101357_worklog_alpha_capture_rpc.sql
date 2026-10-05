create or replace function public.worklog_alpha_capture_qq(
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
$$;

grant execute on function public.worklog_alpha_capture_qq(timestamptz, text, text, numeric) to anon, authenticated;

comment on function public.worklog_alpha_capture_qq(timestamptz, text, text, numeric)
is 'Alpha-only WorkLog capture function for QQ testing. Replace with auth.uid based write before multi-user release.';