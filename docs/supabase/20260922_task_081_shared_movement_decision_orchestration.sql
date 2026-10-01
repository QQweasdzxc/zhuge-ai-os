-- TASK-081 Shared Module C movement decision orchestration
--
-- The consumer/runtime submits only task + target workspace.  This canonical
-- C authority reads the card binding, bound workflow definition, published
-- workflow pointer, and target workspace, then routes atomically to the
-- existing normal C transition or the existing detach+move contract.
-- No consumer may decide detach by workspace name, status, assignee, or flag.

begin;

create or replace function public.board_c_move_workspace_decision_v1(
  p_task_id uuid,
  p_target_workspace_id uuid,
  p_decision_note text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
declare
  v_task public.board_tasks%rowtype;
  v_instance public.board_instances%rowtype;
  v_target_workspace public.board_workspaces%rowtype;
  v_definition public.board_workflow_definitions%rowtype;
  v_current_step public.board_workflow_steps%rowtype;
  v_target_step public.board_workflow_steps%rowtype;
  v_workflow_state public.board_instance_workflow_state%rowtype;
  v_existing private.board_workflow_action_idempotency%rowtype;
  v_response jsonb;
  v_route text;
  v_hash text := md5(concat_ws('|', 'move_workspace_decision', p_task_id::text, p_target_workspace_id::text, coalesce(p_decision_note, '')));
  v_inner_idempotency_key text := case
    when p_idempotency_key is null then null
    else p_idempotency_key || ':module-c-movement'
  end;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = '工作區決定需要登入身分；卡片未變更。';
  end if;

  if p_idempotency_key is not null then
    select *
      into v_existing
      from private.board_workflow_action_idempotency
     where idempotency_key = p_idempotency_key
       and expires_at > now();
    if found then
      if v_existing.request_hash <> v_hash then
        raise exception using errcode = '40001', message = 'Shared movement idempotency key was reused for different input.';
      end if;
      return v_existing.response;
    end if;
  end if;

  select *
    into v_task
    from public.board_tasks
   where id = p_task_id
   for update;
  if not found or not public.board_task_can_write(p_task_id) then
    raise exception using errcode = '42501', message = '目前登入身分沒有此卡片的管理權限；卡片未變更。';
  end if;
  if v_task.archived_at is not null then
    raise exception using errcode = '42501', message = '封存卡片不可移動；卡片未變更。';
  end if;

  select *
    into v_instance
    from public.board_instances
   where id = v_task.board_instance_id
     and active = true
     and template_key = 'c'
   for share;
  if not found then
    raise exception using errcode = '55000', message = '此卡片不屬於啟用中的 Module C Board；卡片未變更。';
  end if;

  select *
    into v_target_workspace
    from public.board_workspaces
   where id = p_target_workspace_id
     and board_instance_id = v_task.board_instance_id
     and active = true
     and archived_at is null
   for share;
  if not found then
    raise exception using errcode = '22023', message = '目標工作區不是此 Board Instance 的合法工作區；卡片未變更。';
  end if;

  if (v_task.workflow_version_id is null) <> (v_task.current_workflow_step_id is null) then
    raise exception using errcode = '55000', message = '卡片流程綁定不完整；Shared Movement Authority 已安全停止，卡片未變更。';
  end if;

  if v_task.workflow_version_id is null then
    -- Optional Workflow: the existing C v2 reconciler owns the legal move,
    -- completion designation, policy, audit, and idempotency.
    v_route := 'unbound';
  else
    -- Read the card binding and the Board Instance's published pointer.  The
    -- card's verified definition remains authoritative for a legacy/retired
    -- binding; the published pointer is read to preserve the full evidence
    -- boundary without guessing from UI labels or status fields.
    select *
      into v_definition
      from public.board_workflow_definitions
     where id = v_task.workflow_version_id
       and board_instance_id = v_task.board_instance_id
       and status in ('published', 'retired');
    if not found then
      raise exception using errcode = '55000', message = '目前卡片的 Published Workflow binding 無法驗證；卡片未變更。';
    end if;

    select *
      into v_current_step
      from public.board_workflow_steps
     where id = v_task.current_workflow_step_id
       and workflow_version_id = v_definition.id;
    if not found then
      raise exception using errcode = '55000', message = '目前卡片的 Workflow Step binding 無法驗證；卡片未變更。';
    end if;

    select *
      into v_workflow_state
      from public.board_instance_workflow_state
     where board_instance_id = v_task.board_instance_id;

    select *
      into v_target_step
      from public.board_workflow_steps
     where workflow_version_id = v_definition.id
       and workspace_id = p_target_workspace_id;

    if found then
      v_route := 'bound_normal';
    else
      -- A bound card leaving its bound Workflow's legal step workspaces must
      -- use the existing canonical detach+move contract.  The consumer does
      -- not pass a detach flag and cannot bypass this decision.
      v_route := 'bound_detach';
    end if;
  end if;

  if v_route = 'bound_detach' then
    select public.board_c_detach_workflow_and_move_task_v1(
      p_task_id,
      p_target_workspace_id,
      p_decision_note,
      v_inner_idempotency_key
    ) into v_response;
  else
    select public.board_c_reconcile_workspace_decision_v2(
      p_task_id,
      p_target_workspace_id,
      p_decision_note,
      v_inner_idempotency_key
    ) into v_response;
  end if;

  v_response := v_response || jsonb_build_object(
    'movement_authority', 'module-c-shared',
    'decision_route', v_route,
    'published_workflow_version_id', v_workflow_state.published_workflow_version_id
  );

  if p_idempotency_key is not null then
    insert into private.board_workflow_action_idempotency (
      idempotency_key, action_type, board_instance_id, task_id,
      request_hash, response, status
    ) values (
      p_idempotency_key,
      'workspace_decision_router',
      v_task.board_instance_id,
      v_task.id,
      v_hash,
      v_response,
      'completed'
    );
  end if;

  return v_response;
end;
$function$;

comment on function public.board_c_move_workspace_decision_v1(uuid, uuid, text, text) is
  'Canonical Module C movement decision authority. Reads card binding, published workflow evidence, and target workspace, then routes to normal movement, optional unbound movement, or board_c_detach_workflow_and_move_task_v1.';

revoke all on function public.board_c_move_workspace_decision_v1(uuid, uuid, text, text) from public, anon;
grant execute on function public.board_c_move_workspace_decision_v1(uuid, uuid, text, text) to authenticated;

notify pgrst, 'reload schema';

commit;
