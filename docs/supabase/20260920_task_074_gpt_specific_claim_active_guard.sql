-- TASK-074 GPT Specific Task Claim active-guard correction
--
-- This is the targeted counterpart to board_claim_specific_task.  It reuses
-- the canonical private claim ledger, the same actor/lease/idempotency rules,
-- and the published Module C workflow resolver.  It does not change the
-- queue-wide GPT Claim and does not create another Task or Claim system.
--
-- planning: ready/Co/todo -> qa/GPT/gpt
-- review:   qa/GPT/gpt -> qa/GPT/gpt (claim only)
--
-- A target is locked before eligibility is evaluated.  An expired GPT claim
-- is closed in the same transaction; an expired planning claim returns the
-- target to the canonical Co queue before a new targeted claim is evaluated.

begin;

create or replace function public.board_claim_specific_gpt_task(
  p_task_id uuid,
  p_idempotency_key text,
  p_stage text default 'planning',
  p_actor_label text default 'GPT',
  p_lease_seconds integer default 900
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_task public.board_tasks%rowtype;
  v_instance public.board_instances%rowtype;
  v_todo_workspace public.board_workspaces%rowtype;
  v_gpt_workspace public.board_workspaces%rowtype;
  v_claim private.board_task_claims%rowtype;
  v_existing_claim private.board_task_claims%rowtype;
  v_active_claim private.board_task_claims%rowtype;
  v_claimed_task public.board_tasks%rowtype;
  v_requeued_task public.board_tasks%rowtype;
  v_binding record;
  v_now timestamptz := now();
  v_key text := nullif(pg_catalog.btrim(coalesce(p_idempotency_key, '')), '');
  v_stage text := lower(pg_catalog.btrim(coalesce(p_stage, 'planning')));
  v_purpose text;
begin
  if coalesce(auth.role(), '') <> 'service_role' or p_actor_label <> 'GPT' then
    raise exception using errcode = '42501',
      message = 'Specific GPT Claim requires the controlled GPT service path';
  end if;
  if p_task_id is null
     or v_key is null
     or pg_catalog.length(v_key) < 8
     or pg_catalog.length(v_key) > 200 then
    raise exception using errcode = '22023',
      message = 'TASK and a bounded idempotency key are required';
  end if;
  if v_stage not in ('planning', 'review') then
    raise exception using errcode = '22023',
      message = 'Specific GPT Claim stage must be planning or review';
  end if;
  if p_lease_seconds < 60 or p_lease_seconds > 86400 then
    raise exception using errcode = '22023',
      message = 'Claim lease must be between 60 and 86400 seconds';
  end if;
  v_purpose := case when v_stage = 'planning' then 'gpt_planning' else 'gpt_review' end;

  -- Same-key retries are serialized independently from different keys.  The
  -- task row lock below serializes competing target-specific keys.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.concat('GPT:specific:', p_task_id::text, ':', v_key), 0
    )
  );

  select *
    into v_task
    from public.board_tasks
   where id = p_task_id
   for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Board TASK not found';
  end if;
  if coalesce(v_task.application_scope, '') <> 'ai_board'
     or v_task.board_instance_id is null then
    raise exception using errcode = '42501',
      message = 'Specific GPT Claim is limited to AI Board TASKs';
  end if;

  select *
    into v_instance
    from public.board_instances
   where id = v_task.board_instance_id
     and active = true
   for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'Active Board instance not found';
  end if;
  if coalesce(v_instance.task_code_prefix, '') <> 'TASK'
     or coalesce(v_instance.legacy_application_scope, '') <> 'ai_board' then
    raise exception using errcode = '42501',
      message = 'Specific GPT Claim is limited to the canonical AI Board';
  end if;

  select *
    into v_existing_claim
    from private.board_task_claims
   where actor_label = 'GPT'
     and idempotency_key = v_key
   for update;
  if found then
    if v_existing_claim.task_id <> v_task.id
       or v_existing_claim.board_instance_id <> v_task.board_instance_id
       or v_existing_claim.claim_purpose <> v_purpose then
      raise exception using errcode = '23505',
        message = 'Specific GPT Claim idempotency key is already bound to another TASK, Board instance, or stage';
    end if;
    return jsonb_build_object(
      'success', true,
      'claimed', v_existing_claim.state in ('active', 'completed'),
      'idempotent', true,
      'stage', v_stage,
      'claim', jsonb_build_object(
        'id', v_existing_claim.id,
        'task_id', v_existing_claim.task_id,
        'board_instance_id', v_existing_claim.board_instance_id,
        'actor_label', v_existing_claim.actor_label,
        'claim_purpose', v_existing_claim.claim_purpose,
        'claim_token', v_existing_claim.claim_token,
        'state', v_existing_claim.state,
        'claimed_at', v_existing_claim.claimed_at,
        'lease_expires_at', v_existing_claim.lease_expires_at,
        'released_at', v_existing_claim.released_at,
        'release_reason', v_existing_claim.release_reason
      ),
      'task', to_jsonb(v_task)
    );
  end if;

  select *
    into v_todo_workspace
    from public.board_workspaces
   where board_instance_id = v_task.board_instance_id
     and active = true
     and workspace_key = 'todo'
   order by sort_order asc, created_at asc
   limit 1;
  select *
    into v_gpt_workspace
    from public.board_workspaces
   where board_instance_id = v_task.board_instance_id
     and active = true
     and workspace_key = 'gpt'
   order by sort_order asc, created_at asc
   limit 1;
  if v_todo_workspace.id is null or v_gpt_workspace.id is null then
    raise exception using errcode = 'P0002',
      message = 'Canonical GPT and Todo workspaces are required';
  end if;

  -- Targeted expiry/recovery is deliberately limited to the requested TASK.
  -- Planning expiry returns it to the same canonical Co queue; review expiry
  -- closes the lease without inventing a Co transition.
  select *
    into v_active_claim
    from private.board_task_claims
   where task_id = v_task.id
     and actor_label = 'GPT'
     and state = 'active'
   for update;
  if found and v_active_claim.lease_expires_at <= v_now then
    if v_active_claim.claim_purpose = 'gpt_planning'
       and v_task.status = 'qa'
       and v_task.assignee = 'GPT'
       and v_task.workspace_id = v_gpt_workspace.id then
      update public.board_tasks
         set status = 'ready',
             assignee = 'Co',
             workspace_id = v_todo_workspace.id,
             updated_at = v_now
       where id = v_task.id
       returning * into v_requeued_task;
      v_task := v_requeued_task;
    end if;

    update private.board_task_claims
       set state = 'expired',
           released_at = coalesce(released_at, v_now),
           release_reason = coalesce(release_reason, 'lease_expired'),
           updated_at = v_now
     where id = v_active_claim.id
     returning * into v_active_claim;

    insert into public.engineering_activity_log (
      entity_type, entity_id, action, before_data, after_data, note,
      actor_id, actor_type, actor_label, activity_type
    ) values (
      'board_task', v_task.id::text, 'task_gpt_specific_claim_expired',
      jsonb_build_object(
        'claim_id', v_active_claim.id,
        'claim_purpose', v_active_claim.claim_purpose,
        'status', case when v_requeued_task.id is not null then 'qa' else v_task.status end,
        'assignee', case when v_requeued_task.id is not null then 'GPT' else v_task.assignee end,
        'workspace_id', case when v_requeued_task.id is not null then v_gpt_workspace.id else v_task.workspace_id end
      ),
      jsonb_build_object(
        'claim_id', v_active_claim.id,
        'claim_state', 'expired',
        'claim_purpose', v_active_claim.claim_purpose,
        'returned_to_co_queue', v_requeued_task.id is not null,
        'status', v_task.status,
        'assignee', v_task.assignee,
        'workspace_id', v_task.workspace_id,
        'lifecycle', 'gpt_specific_claim_expired'
      ),
      'GPT Specific Claim lease expired through the canonical AI Board claim ledger',
      null, 'system', 'System', 'system_activity'
    );
    v_active_claim := null;
    v_requeued_task := null;
  end if;

  -- A non-expired target claim wins before stage eligibility, so a competing key
  -- receives the canonical active-claim conflict instead of a generic stage error.
  if v_active_claim.id is not null then
    raise exception using errcode = '40901', message = 'TASK already has an active Cloud Claim';
  end if;

  if v_stage = 'planning' then
    if v_task.status <> 'ready'
       or v_task.assignee <> 'Co'
       or v_task.archived_at is not null
       or v_task.workspace_id is distinct from v_todo_workspace.id then
      raise exception using errcode = '55000',
        message = 'TASK is not eligible for a Specific GPT planning Claim; it must be ready, assigned to Co, unarchived, and in the canonical Todo workspace';
    end if;
  else
    if v_task.status <> 'qa'
       or v_task.assignee <> 'GPT'
       or v_task.archived_at is not null
       or v_task.workspace_id is distinct from v_gpt_workspace.id then
      raise exception using errcode = '55000',
        message = 'TASK is not eligible for a Specific GPT review Claim; it must be qa, assigned to GPT, unarchived, and in the canonical GPT workspace';
    end if;
  end if;

  select *
    into v_active_claim
    from private.board_task_claims
   where task_id = v_task.id
     and state = 'active'
   for update;
  if found then
    raise exception using errcode = '40901', message = 'TASK already has an active Cloud Claim';
  end if;

  -- Resolve the target workspace through the existing published C workflow.
  -- The targeted claim may not invent or preserve a stale workflow binding.
  select *
    into v_binding
    from private.board_c_resolve_workflow_create_state(
      v_task.board_instance_id,
      v_gpt_workspace.id,
      null
    );
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Canonical GPT workflow binding is missing';
  end if;
  if v_binding.workflow_status <> 'qa'
     or v_binding.workflow_assignee <> 'GPT' then
    raise exception using errcode = '55000',
      message = 'Canonical GPT workflow binding is not qa/GPT';
  end if;

  if v_stage = 'planning' then
    update public.board_tasks
       set status = v_binding.workflow_status,
           assignee = v_binding.workflow_assignee,
           workspace_id = v_gpt_workspace.id,
           workflow_version_id = v_binding.workflow_version_id,
           current_workflow_step_id = v_binding.current_workflow_step_id,
           updated_at = v_now
     where id = v_task.id
     returning * into v_claimed_task;
  else
    if v_task.workflow_version_id is distinct from v_binding.workflow_version_id
       or v_task.current_workflow_step_id is distinct from v_binding.current_workflow_step_id then
      raise exception using errcode = '55000',
        message = 'TASK workflow binding is stale for a Specific GPT review Claim';
    end if;
    v_claimed_task := v_task;
  end if;

  insert into private.board_task_claims (
    task_id, board_instance_id, actor_label, claim_purpose, idempotency_key,
    claim_token, state, claimed_at, lease_expires_at, created_at, updated_at
  ) values (
    v_claimed_task.id, v_claimed_task.board_instance_id, 'GPT', v_purpose, v_key,
    gen_random_uuid(), 'active', v_now,
    v_now + pg_catalog.make_interval(secs => p_lease_seconds), v_now, v_now
  ) returning * into v_claim;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_claimed_task.id::text, 'task_gpt_claimed_specific',
    jsonb_build_object(
      'status', v_task.status,
      'assignee', v_task.assignee,
      'workspace_id', v_task.workspace_id,
      'workflow_version_id', v_task.workflow_version_id,
      'current_workflow_step_id', v_task.current_workflow_step_id
    ),
    jsonb_build_object(
      'status', v_claimed_task.status,
      'assignee', v_claimed_task.assignee,
      'workspace_id', v_claimed_task.workspace_id,
      'workflow_version_id', v_claimed_task.workflow_version_id,
      'current_workflow_step_id', v_claimed_task.current_workflow_step_id,
      'claim_id', v_claim.id,
      'claim_purpose', v_claim.claim_purpose,
      'stage', v_stage,
      'idempotency_key', v_key,
      'lease_expires_at', v_claim.lease_expires_at,
      'lifecycle', case when v_stage = 'planning'
        then 'gpt_specific_claim_for_planning'
        else 'gpt_specific_claim_for_review' end
    ),
    'GPT acquired the selected TASK through the canonical Specific Claim path',
    null, 'ai', 'GPT', 'system_activity'
  );

  return jsonb_build_object(
    'success', true,
    'claimed', true,
    'idempotent', false,
    'stage', v_stage,
    'claim', jsonb_build_object(
      'id', v_claim.id,
      'task_id', v_claim.task_id,
      'board_instance_id', v_claim.board_instance_id,
      'actor_label', v_claim.actor_label,
      'claim_purpose', v_claim.claim_purpose,
      'claim_token', v_claim.claim_token,
      'state', v_claim.state,
      'claimed_at', v_claim.claimed_at,
      'lease_expires_at', v_claim.lease_expires_at
    ),
    'task', to_jsonb(v_claimed_task)
  );
end;
$function$;

revoke all on function public.board_claim_specific_gpt_task(uuid, text, text, text, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.board_claim_specific_gpt_task(uuid, text, text, text, integer)
  to service_role;

comment on function public.board_claim_specific_gpt_task(uuid, text, text, text, integer) is
  'TASK-074 targeted GPT Claim; active claims fail closed before competing stage eligibility.';

commit;
