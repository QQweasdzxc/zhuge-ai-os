-- Transform the existing QAT C-board instance into the official Investment IVTK view.
-- QAT-001 remains historical data in an archived workspace; it is not renamed,
-- renumbered, copied, or presented as Investment data.

begin;

do $function$
declare
  v_instance public.board_instances%rowtype;
  v_stocks public.board_workspaces%rowtype;
  v_watchlist public.board_workspaces%rowtype;
  v_qat_task_count integer;
begin
  select * into v_instance
  from public.board_instances
  where name = 'QA 測試看板'
    and task_code_prefix = 'QAT'
    and template_key = 'c'
    and is_template_instance = false
    and active = true
  order by created_at
  limit 1
  for update;

  if not found then
    raise exception using errcode = 'P0002', message = 'INVESTMENT_IVTK_QAT_INSTANCE_REQUIRED';
  end if;

  if exists (
    select 1
    from public.board_instances
    where active = true
      and template_key = 'c'
      and upper(task_code_prefix) = 'IVTK'
      and id <> v_instance.id
  ) then
    raise exception using errcode = '23505', message = 'INVESTMENT_IVTK_INSTANCE_ALREADY_EXISTS';
  end if;

  select * into v_stocks
  from public.board_workspaces
  where board_instance_id = v_instance.id
    and workspace_key = 'qat-in-progress'
    and active = true
  order by sort_order
  limit 1
  for update;

  select * into v_watchlist
  from public.board_workspaces
  where board_instance_id = v_instance.id
    and workspace_key = 'qat-acceptance'
    and active = true
  order by sort_order
  limit 1
  for update;

  if v_stocks.id is null or v_watchlist.id is null then
    raise exception using errcode = 'P0002', message = 'INVESTMENT_IVTK_EMPTY_WORKSPACES_REQUIRED';
  end if;

  if exists (
    select 1 from public.board_tasks
    where workspace_id in (v_stocks.id, v_watchlist.id)
      and archived_at is null
  ) then
    raise exception using errcode = '23514', message = 'INVESTMENT_IVTK_TARGET_WORKSPACES_MUST_BE_EMPTY';
  end if;

  select count(*) into v_qat_task_count
  from public.board_tasks
  where board_instance_id = v_instance.id
    and work_code = 'QAT-001';

  if v_qat_task_count <> 1 then
    raise exception using errcode = '23514', message = 'INVESTMENT_IVTK_QAT001_EXPECTED_ONCE';
  end if;

  -- Archive the old QAT workspace set.  This keeps disposable QA history
  -- recoverable and prevents QAT-001 from entering either Investment view.
  update public.board_workspaces
  set active = false,
      archived_at = coalesce(archived_at, now()),
      updated_at = now()
  where board_instance_id = v_instance.id;

  update public.board_workspaces
  set workspace_key = 'ivtk-stocks',
      name = '股票投資',
      sort_order = 10,
      active = true,
      archived_at = null,
      updated_at = now()
  where id = v_stocks.id;

  update public.board_workspaces
  set workspace_key = 'ivtk-watchlist',
      name = '觀察名單',
      sort_order = 20,
      active = true,
      archived_at = null,
      updated_at = now()
  where id = v_watchlist.id;

  -- QAT-001 keeps QAT-001 identity and remains attached to the archived
  -- qat-todo workspace.  The first Investment projection therefore allocates
  -- IVTK-001 independently.
  update public.board_instances
  set name = '投資戰情板',
      task_code_prefix = 'IVTK',
      -- The shared allocator increments before assigning the candidate.
      -- Zero therefore makes the first Investment projection IVTK-001.
      next_task_number = 0,
      updated_at = now()
  where id = v_instance.id;
end;
$function$;

commit;
