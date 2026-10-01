-- TASK-074 Runtime QA prerequisite: restore the existing GPT workspace's
-- canonical runtime visibility.  The workspace was historically archived;
-- the new lifecycle requires the same existing row to be active and
-- unarchived.  No task/card row is changed and no workspace is created.

begin;

do $function$
declare
  v_board_instance_id constant uuid := '74ff1127-ab98-4543-8f69-872e5d92fd33';
  v_gpt_workspace_id constant uuid := '073de6c6-c013-45ad-9d48-3013dc313466';
  v_board public.board_instances%rowtype;
  v_gpt public.board_workspaces%rowtype;
  v_active_unarchived_count integer;
begin
  select * into v_board
  from public.board_instances
  where id = v_board_instance_id
    and active = true
  for share;

  if not found
     or coalesce(v_board.task_code_prefix, '') <> 'TASK'
     or coalesce(v_board.legacy_application_scope, '') <> 'ai_board' then
    raise exception using
      errcode = '42501',
      message = 'TASK-074 canonical AI Board instance is missing or invalid';
  end if;

  select * into v_gpt
  from public.board_workspaces
  where id = v_gpt_workspace_id
    and board_instance_id = v_board_instance_id
    and workspace_key = 'gpt'
  for update;

  if not found then
    raise exception using
      errcode = 'P0002',
      message = 'TASK-074 canonical GPT workspace is missing';
  end if;

  select count(*) into v_active_unarchived_count
  from public.board_workspaces
  where board_instance_id = v_board_instance_id
    and workspace_key = 'gpt'
    and active = true
    and archived_at is null
    and id <> v_gpt_workspace_id;

  if v_active_unarchived_count <> 0 then
    raise exception using
      errcode = '23514',
      message = 'TASK-074 canonical GPT workspace invariant would create a duplicate';
  end if;

  update public.board_workspaces
  set active = true,
      archived_at = null
  where id = v_gpt_workspace_id;

  select count(*) into v_active_unarchived_count
  from public.board_workspaces
  where board_instance_id = v_board_instance_id
    and workspace_key = 'gpt'
    and active = true
    and archived_at is null;

  if v_active_unarchived_count <> 1 then
    raise exception using
      errcode = '23514',
      message = 'TASK-074 canonical GPT workspace visibility did not produce exactly one active unarchived workspace';
  end if;
end;
$function$;

commit;
