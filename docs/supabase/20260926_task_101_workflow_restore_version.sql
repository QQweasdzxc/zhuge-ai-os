-- TASK-101 Workflow Studio: canonical historical-version restore.
--
-- A historical definition is immutable.  Restore means "copy that exact
-- definition into the current Board Instance's new draft" and never means
-- rewriting or republishing the historical row.  The existing save-draft
-- RPC remains the only writer for workflow steps/transitions/gates.

begin;

create or replace function public.board_c_workflow_restore_version(
  p_board_instance_id uuid,
  p_source_workflow_version_id uuid,
  p_expected_draft_version_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
declare
  v_source public.board_workflow_definitions%rowtype;
  v_snapshot jsonb;
  v_steps jsonb;
  v_transitions jsonb;
  v_gates jsonb;
  v_evidence jsonb;
  v_saved jsonb;
  v_draft_id uuid;
  v_response jsonb;
  v_existing private.board_workflow_action_idempotency%rowtype;
  v_hash text := md5(concat_ws('|', p_board_instance_id::text, p_source_workflow_version_id::text, coalesce(p_expected_draft_version_id::text, '')));
begin
  if auth.uid() is null or not public.board_instance_can_write(p_board_instance_id) then
    raise exception using errcode = '42501', message = '只有子板 Owner／授權管理者可以回復流程版本。';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing
    from private.board_workflow_action_idempotency
    where idempotency_key = p_idempotency_key
      and expires_at > now();
    if found then
      if v_existing.request_hash <> v_hash then
        raise exception using errcode = '40001', message = '流程回復請求的 Idempotency Key 已用於不同內容。';
      end if;
      return v_existing.response;
    end if;
  end if;

  select * into v_source
  from public.board_workflow_definitions
  where id = p_source_workflow_version_id
    and board_instance_id = p_board_instance_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '找不到要回復的流程版本。';
  end if;
  if v_source.status not in ('published', 'retired') then
    raise exception using errcode = '55000', message = '只能從已發布或歷史版本建立回復草稿。';
  end if;

  v_snapshot := private.board_workflow_snapshot(v_source.id);
  if v_snapshot is null then
    raise exception using errcode = 'P0002', message = '流程版本內容不存在，未建立回復草稿。';
  end if;

  -- Convert the immutable snapshot's row ids back to the save-draft input
  -- contract's stable step keys.  The source version is never modified.
  select coalesce(jsonb_agg(jsonb_build_object(
    'step_key', step->>'step_key',
    'name', step->>'name',
    'sort_order', (step->>'sort_order')::integer,
    'role_key', step->>'role_key',
    'workspace_id', step->>'workspace_id',
    'status_key', step->>'status_key',
    'is_initial', coalesce((step->>'is_initial')::boolean, false),
    'is_completion', coalesce((step->>'is_completion')::boolean, false)
  ) order by (step->>'sort_order')::integer), '[]'::jsonb)
  into v_steps
  from jsonb_array_elements(coalesce(v_snapshot->'steps', '[]'::jsonb)) as item(step);

  if exists (
    select 1
    from jsonb_array_elements(coalesce(v_snapshot->'transitions', '[]'::jsonb)) as item(transition)
    where not exists (
      select 1 from jsonb_array_elements(coalesce(v_snapshot->'steps', '[]'::jsonb)) as source_step(step)
      where source_step.step->>'id' = item.transition->>'from_step_id'
    )
    or not exists (
      select 1 from jsonb_array_elements(coalesce(v_snapshot->'steps', '[]'::jsonb)) as target_step(step)
      where target_step.step->>'id' = item.transition->>'to_step_id'
    )
  ) then
    raise exception using errcode = '22023', message = '流程版本的連線無法對應到同版本階段，未建立回復草稿。';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'transition_key', transition->>'transition_key',
    'from_step_key', (
      select step->>'step_key'
      from jsonb_array_elements(coalesce(v_snapshot->'steps', '[]'::jsonb)) as from_item(step)
      where step->>'id' = transition->>'from_step_id'
      limit 1
    ),
    'to_step_key', (
      select step->>'step_key'
      from jsonb_array_elements(coalesce(v_snapshot->'steps', '[]'::jsonb)) as to_item(step)
      where step->>'id' = transition->>'to_step_id'
      limit 1
    ),
    'allowed_roles', coalesce(transition->'allowed_roles', '["pm"]'::jsonb),
    'requires_gate', coalesce((transition->>'requires_gate')::boolean, false)
  ) order by transition->>'transition_key'), '[]'::jsonb)
  into v_transitions
  from jsonb_array_elements(coalesce(v_snapshot->'transitions', '[]'::jsonb)) as item(transition);

  if exists (
    select 1
    from jsonb_array_elements(coalesce(v_snapshot->'gates', '[]'::jsonb)) as item(gate)
    where not exists (
      select 1 from jsonb_array_elements(coalesce(v_snapshot->'steps', '[]'::jsonb)) as gate_step(step)
      where step->>'id' = item.gate->>'step_id'
    )
  ) then
    raise exception using errcode = '22023', message = '流程版本的 Gate 無法對應到同版本階段，未建立回復草稿。';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'step_key', (
      select step->>'step_key'
      from jsonb_array_elements(coalesce(v_snapshot->'steps', '[]'::jsonb)) as gate_step(step)
      where step->>'id' = gate->>'step_id'
      limit 1
    ),
    'gate_key', gate->>'gate_key',
    'name', gate->>'name',
    'required', coalesce((gate->>'required')::boolean, true),
    'human_action_required', coalesce((gate->>'human_action_required')::boolean, false),
    'completion_role', coalesce(gate->>'completion_role', 'pm'),
    'failure_policy', coalesce(gate->>'failure_policy', 'stay'),
    'sort_order', coalesce((gate->>'sort_order')::integer, 0)
  ) order by coalesce((gate->>'sort_order')::integer, 0), gate->>'gate_key'), '[]'::jsonb)
  into v_gates
  from jsonb_array_elements(coalesce(v_snapshot->'gates', '[]'::jsonb)) as item(gate);

  select coalesce(jsonb_agg(jsonb_build_object(
    'gate_key', evidence->>'gate_key',
    'evidence_key', evidence->>'evidence_key',
    'label', evidence->>'label',
    'required', coalesce((evidence->>'required')::boolean, true),
    'source_kind', evidence->>'source_kind',
    'sort_order', coalesce((evidence->>'sort_order')::integer, 0)
  ) order by coalesce((evidence->>'sort_order')::integer, 0), evidence->>'evidence_key'), '[]'::jsonb)
  into v_evidence
  from jsonb_array_elements(coalesce(v_snapshot->'evidence_requirements', '[]'::jsonb)) as item(evidence);

  select public.board_c_workflow_save_draft(
    p_board_instance_id,
    v_snapshot->>'name',
    v_snapshot->>'description',
    v_steps,
    v_transitions,
    v_gates,
    v_evidence,
    p_expected_draft_version_id,
    case when p_idempotency_key is null then null else p_idempotency_key || ':save-draft' end
  ) into v_saved;

  v_draft_id := (v_saved #>> '{workflow,id}')::uuid;
  if v_draft_id is null then
    raise exception using errcode = 'XX000', message = '回復草稿未取得新流程版本，未完成回復。';
  end if;

  -- The standard save RPC establishes the ordinary latest-published lineage.
  -- Replace only the new draft's lineage with the explicit historical source.
  update public.board_workflow_definitions
  set based_on_workflow_version_id = v_source.id,
      updated_at = now()
  where id = v_draft_id
    and status = 'draft';

  v_response := jsonb_build_object(
    'contract', 'module-c-lifecycle-acceptance-v2',
    'action', 'restore-version-to-draft',
    'board_instance_id', p_board_instance_id,
    'restored_from_workflow_version_id', v_source.id,
    'workflow', private.board_workflow_snapshot(v_draft_id),
    'source_immutable', true
  );

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_workflow_definition', v_draft_id::text, 'workflow_version_restored_to_draft',
    jsonb_build_object('source_workflow_version_id', v_source.id),
    v_response,
    'C Mother historical workflow version restored as a new draft; source version remains immutable.',
    auth.uid(), 'human', 'PM', 'system_activity'
  );

  if p_idempotency_key is not null then
    insert into private.board_workflow_action_idempotency (
      idempotency_key, action_type, board_instance_id, request_hash, response, status
    ) values (
      p_idempotency_key, 'restore_version_to_draft', p_board_instance_id, v_hash, v_response, 'completed'
    );
  end if;
  return v_response;
end;
$function$;

revoke all on function public.board_c_workflow_restore_version(uuid, uuid, uuid, text) from public, anon;
grant execute on function public.board_c_workflow_restore_version(uuid, uuid, uuid, text) to authenticated;

commit;
