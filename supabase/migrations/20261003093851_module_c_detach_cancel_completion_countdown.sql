-- Fix the existing detach writer only. No scheduler, RLS or API changes.
-- Function-only migration: does not backfill TASK-079 or any retained row.
-- Production application requires separate PM authorization.
begin;

create or replace function public.board_c_detach_workflow_and_move_task_v1(
  p_task_id uuid,
  p_target_workspace_id uuid,
  p_reason text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
declare
  v_task public.board_tasks%rowtype;
  v_before jsonb;
  v_instance public.board_instances%rowtype;
  v_target_workspace public.board_workspaces%rowtype;
  v_definition public.board_workflow_definitions%rowtype;
  v_current_step public.board_workflow_steps%rowtype;
  v_hash text := md5(concat_ws('|', 'workflow_detach_move', p_task_id::text, p_target_workspace_id::text, coalesce(p_reason, '')));
  v_existing private.board_workflow_action_idempotency%rowtype;
  v_response jsonb;
  v_now timestamptz := clock_timestamp();
  v_target_is_completion boolean;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Workflow detach requires an authenticated actor; card was not changed.';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing
      from private.board_workflow_action_idempotency
     where idempotency_key = p_idempotency_key
       and expires_at > now();
    if found then
      if v_existing.request_hash <> v_hash then
        raise exception using errcode = '40001', message = 'Workflow detach idempotency key was reused for different input.';
      end if;
      return v_existing.response;
    end if;
  end if;

  select * into v_task
    from public.board_tasks
   where id = p_task_id
   for update;
  if not found or not public.board_task_can_write(p_task_id) then
    raise exception using errcode = '42501', message = 'Current actor cannot move this card; card was not changed.';
  end if;
  if v_task.archived_at is not null then
    raise exception using errcode = '42501', message = 'Archived cards cannot be detached or moved.';
  end if;
  if v_task.workflow_version_id is null or v_task.current_workflow_step_id is null then
    raise exception using errcode = '55000', message = 'Card is already unbound; use the canonical optional-workflow move contract.';
  end if;

  if exists (
    select 1
      from private.board_task_claims claim
     where claim.task_id = v_task.id
       and claim.released_at is null
       and claim.lease_expires_at > now()
  ) then
    raise exception using errcode = '42501', message = 'Active task lease must be released before workflow detach.';
  end if;

  select * into v_instance
    from public.board_instances
   where id = v_task.board_instance_id
     and active = true
     and template_key = 'c'
   for share;
  if not found then
    raise exception using errcode = '55000', message = 'Card is not owned by an active Module C Board.';
  end if;

  select * into v_target_workspace
    from public.board_workspaces
   where id = p_target_workspace_id
     and board_instance_id = v_task.board_instance_id
     and active = true
     and archived_at is null
   for share;
  if not found then
    raise exception using errcode = '22023', message = 'Target workspace is not a legal active workspace for this Board Instance.';
  end if;

  select d.* into v_definition
    from public.board_workflow_definitions d
   where d.id = v_task.workflow_version_id
     and d.board_instance_id = v_task.board_instance_id
     and d.status in ('published', 'retired');
  if not found then
    raise exception using errcode = '55000', message = 'Current workflow definition cannot be verified; card was not changed.';
  end if;
  select s.* into v_current_step
    from public.board_workflow_steps s
   where s.id = v_task.current_workflow_step_id
     and s.workflow_version_id = v_definition.id;
  if not found then
    raise exception using errcode = '55000', message = 'Current workflow step cannot be verified; card was not changed.';
  end if;

  -- Reuse the canonical stable-key completion designation. A detach move
  -- outside Completion cancels its countdown; completion_at stays evidence.
  v_target_is_completion := coalesce(
    (private.board_c_completion_archive_designation(v_task.board_instance_id)->>'workspace_id')::uuid = p_target_workspace_id,
    false
  );
  v_before := to_jsonb(v_task);
  perform set_config('zhuge.module_c_workflow_mode', 'detach', true);
  update public.board_tasks
     set workspace_id = p_target_workspace_id,
         workflow_version_id = null,
         current_workflow_step_id = null,
         archive_due_at = case when v_target_is_completion then archive_due_at else null end,
         updated_at = v_now
   where id = v_task.id
   returning * into v_task;
  perform set_config('zhuge.module_c_workflow_mode', '', true);

  v_response := jsonb_build_object(
    'contract', 'module-c-lifecycle-acceptance-v2',
    'action', 'workflow-detach-workspace-decision',
    'task_id', v_task.id,
    'workflow_version_id', null,
    'workflow', 'not_configured',
    'workflow_optional', true,
    'workflow_bound', false,
    'source_workflow_version_id', v_definition.id,
    'source_step_id', v_current_step.id,
    'source_workspace_id', v_before->>'workspace_id',
    'target_workspace_id', v_task.workspace_id,
    'status', v_task.status,
    'assignee', v_task.assignee,
    'completion_at_preserved', v_task.completion_at,
    'archive_due_at', v_task.archive_due_at,
    'completion_countdown_cancelled', not v_target_is_completion
  );

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_task.id::text, 'workflow_detached_workspace_decision',
    v_before, v_response, nullif(btrim(p_reason), ''),
    auth.uid(), 'human', 'PM', 'system_activity'
  );

  if p_idempotency_key is not null then
    insert into private.board_workflow_action_idempotency (
      idempotency_key, action_type, board_instance_id, task_id,
      request_hash, response, status
    ) values (
      p_idempotency_key, 'workflow_detach_move', v_task.board_instance_id,
      v_task.id, v_hash, v_response, 'completed'
    );
  end if;
  return v_response;
end;
$function$;

comment on function public.board_c_detach_workflow_and_move_task_v1(uuid, uuid, text, text) is
  'Canonical C detach/unbind plus workspace move; preserves Completion evidence, cancels the countdown outside Completion and requires authenticated task write authority.';

revoke all on function public.board_c_detach_workflow_and_move_task_v1(uuid, uuid, text, text) from public, anon;
grant execute on function public.board_c_detach_workflow_and_move_task_v1(uuid, uuid, text, text) to authenticated;


notify pgrst, 'reload schema';
commit;
