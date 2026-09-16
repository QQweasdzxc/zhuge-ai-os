-- TASK-040 Scope Extension: Specific Task Claim
--
-- This is an additive continuation path for a PM/Governance-selected TASK
-- that is already eligible for the normal Co queue. It reuses the existing
-- private claim ledger, lease bounds, idempotency rules, actor boundary, and
-- audit contract; it does not bypass queue eligibility or create a second
-- lifecycle.
--
-- Contract:
--   ready + Co + canonical Co workspace + no active Claim
--     -> one active Co Claim for the requested TASK
--     -> status inprogress / assignee Co
--     -> one task_claimed_specific audit row
--
-- The target is selected by the controlled orchestration request, never by
-- client-side state. The target TASK is locked before eligibility is checked.
-- A retry with the same actor/idempotency key returns the original result.
-- A different key cannot claim a TASK that already has an active Claim.
--
-- Rollback design (not executed here): disable the Edge operation, restore the
-- preceding Edge source, then drop only this RPC. Existing claim rows, audit
-- evidence, and canonical task data are never rewritten during rollback.

begin;

create or replace function public.board_claim_specific_task(
  p_task_id uuid,
  p_idempotency_key text,
  p_actor_label text default 'Co',
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
  v_co_workspace public.board_workspaces%rowtype;
  v_claim private.board_task_claims%rowtype;
  v_existing_claim private.board_task_claims%rowtype;
  v_active_claim private.board_task_claims%rowtype;
  v_claimed_task public.board_tasks%rowtype;
  v_now timestamptz := now();
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
begin
  if coalesce(auth.role(), '') <> 'service_role' or p_actor_label <> 'Co' then
    raise exception using errcode = '42501',
      message = 'Specific Co Claim requires the controlled service path';
  end if;
  if p_task_id is null or v_key is null or length(v_key) < 8 or length(v_key) > 200 then
    raise exception using errcode = '22023',
      message = 'TASK and a bounded idempotency key are required';
  end if;
  if p_lease_seconds < 60 or p_lease_seconds > 86400 then
    raise exception using errcode = '22023',
      message = 'Claim lease must be between 60 and 86400 seconds';
  end if;

  -- Serialize concurrent retries that use the same actor/idempotency key.
  -- The task row lock below independently serializes different keys targeting
  -- the same TASK; the partial unique index remains the final database guard.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_key, 0));

  select *
    into v_task
  from public.board_tasks
  where id = p_task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Board TASK not found';
  end if;
  if coalesce(v_task.application_scope, '') <> 'ai_board'
     or v_task.board_instance_id is null then
    raise exception using errcode = '42501',
      message = 'Specific Co Claim is limited to AI Board TASKs';
  end if;

  select *
    into v_instance
  from public.board_instances
  where id = v_task.board_instance_id
    and active = true
  for share;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Active Board instance not found';
  end if;
  if coalesce(v_instance.task_code_prefix, '') <> 'TASK'
     or coalesce(v_instance.legacy_application_scope, '') <> 'ai_board' then
    raise exception using errcode = '42501',
      message = 'Specific Co Claim is limited to the canonical AI Board';
  end if;

  select *
    into v_co_workspace
  from public.board_workspaces
  where board_instance_id = v_task.board_instance_id
    and active = true
    and workspace_key = 'co'
  order by sort_order asc, created_at asc
  limit 1;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Canonical Co workspace is missing';
  end if;

  -- Same-key retries are idempotent even after the claim has been completed
  -- by Developer QA Handoff. A key cannot be rebound to another TASK.
  select *
    into v_existing_claim
  from private.board_task_claims
  where actor_label = 'Co'
    and idempotency_key = v_key
  for update;
  if found then
    if v_existing_claim.task_id <> v_task.id
       or v_existing_claim.board_instance_id <> v_task.board_instance_id then
      raise exception using errcode = '23505',
        message = 'Specific Claim idempotency key is already bound to another TASK or Board instance';
    end if;

    return jsonb_build_object(
      'success', true,
      'claimed', v_existing_claim.state in ('active', 'completed'),
      'idempotent', true,
      'claim', jsonb_build_object(
        'id', v_existing_claim.id,
        'task_id', v_existing_claim.task_id,
        'board_instance_id', v_existing_claim.board_instance_id,
        'actor_label', v_existing_claim.actor_label,
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

  if v_task.status <> 'ready'
     or v_task.assignee <> 'Co'
     or v_task.archived_at is not null
     or v_task.workspace_id is distinct from v_co_workspace.id then
    raise exception using errcode = '55000',
      message = 'TASK is not eligible for a Specific Co Claim; it must be ready, assigned to Co, unarchived, and in the canonical Co workspace';
  end if;

  -- The task row lock serializes different idempotency keys targeting the
  -- same TASK. The partial unique index remains the final database guard.
  select *
    into v_active_claim
  from private.board_task_claims
  where task_id = v_task.id
    and state = 'active'
  for update;
  if found then
    raise exception using errcode = '40901',
      message = 'TASK already has an active Cloud Claim';
  end if;

  update public.board_tasks
  set status = 'inprogress',
      assignee = 'Co',
      workspace_id = v_co_workspace.id,
      updated_at = v_now
  where id = v_task.id
  returning * into v_claimed_task;

  insert into private.board_task_claims (
    task_id, board_instance_id, actor_label, idempotency_key,
    state, claimed_at, lease_expires_at, created_at, updated_at
  ) values (
    v_claimed_task.id, v_claimed_task.board_instance_id, 'Co', v_key,
    'active', v_now, v_now + make_interval(secs => p_lease_seconds), v_now, v_now
  )
  returning * into v_claim;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_claimed_task.id::text, 'task_claimed_specific',
    jsonb_build_object(
      'status', v_task.status,
      'assignee', v_task.assignee,
      'workspace_id', v_task.workspace_id
    ),
    jsonb_build_object(
      'status', v_claimed_task.status,
      'assignee', v_claimed_task.assignee,
      'workspace_id', v_claimed_task.workspace_id,
      'claim_id', v_claim.id,
      'lease_expires_at', v_claim.lease_expires_at,
      'lifecycle', 'co_specific_claim'
    ),
    'Co claimed the PM-selected executable TASK through the authoritative Cloud Specific Claim path',
    null, 'ai', 'Co', 'system_activity'
  );

  return jsonb_build_object(
    'success', true,
    'claimed', true,
    'idempotent', false,
    'claim', jsonb_build_object(
      'id', v_claim.id,
      'task_id', v_claim.task_id,
      'board_instance_id', v_claim.board_instance_id,
      'actor_label', v_claim.actor_label,
      'claim_token', v_claim.claim_token,
      'state', v_claim.state,
      'claimed_at', v_claim.claimed_at,
      'lease_expires_at', v_claim.lease_expires_at
    ),
    'task', to_jsonb(v_claimed_task)
  );
end;
$function$;

revoke all on function public.board_claim_specific_task(uuid, text, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.board_claim_specific_task(uuid, text, text, integer) to service_role;

comment on function public.board_claim_specific_task(uuid, text, text, integer) is
  'TASK-040 controlled Specific Co Claim; only eligible ready/Co tasks in the canonical Co workspace may be claimed.';

commit;
