-- TASK-074 Runtime QA prerequisite: restore the existing canonical GPT workspace.
--
-- This is intentionally idempotent and scoped to the existing canonical AI
-- Board instance/workspace. It does not create, delete, rename, or rebuild a
-- workspace, and it does not modify any task/card row.

begin;

do $function$
declare
  v_board_instance_id constant uuid := '74ff1127-ab98-4543-8f69-872e5d92fd33';
  v_gpt_workspace_id constant uuid := '073de6c6-c013-45ad-9d48-3013dc313466';
  v_board public.board_instances%rowtype;
  v_gpt public.board_workspaces%rowtype;
  v_active_gpt_count integer;
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

  select count(*) into v_active_gpt_count
  from public.board_workspaces
  where board_instance_id = v_board_instance_id
    and workspace_key = 'gpt'
    and active = true;

  if v_active_gpt_count > 1
     or (v_active_gpt_count = 1 and v_gpt.active = false) then
    raise exception using
      errcode = '23514',
      message = 'TASK-074 canonical GPT workspace invariant would be violated';
  end if;

  update public.board_workspaces
  set active = true
  where id = v_gpt_workspace_id
    and active = false;

  select count(*) into v_active_gpt_count
  from public.board_workspaces
  where board_instance_id = v_board_instance_id
    and workspace_key = 'gpt'
    and active = true;

  if v_active_gpt_count <> 1 then
    raise exception using
      errcode = '23514',
      message = 'TASK-074 canonical GPT workspace activation did not produce exactly one active workspace';
  end if;
end;
$function$;

commit;
