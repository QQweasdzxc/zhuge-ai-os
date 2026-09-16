-- TASK-040 Scope Extension: Expired Claim Targeted Reclaim
--
-- This is a generic, non-destructive continuation path for an already claimed
-- AI Board TASK. It only replaces the same TASK's expired Co lease after
-- Cloud-authoritative validation. It never requeues, rewrites, deletes, or
-- creates a board task, checklist item, workspace, or consumer record.
--
-- Contract:
--   active + expired Co claim + same inprogress/Co TASK
--     -> old claim closed as expired
--     -> one new active Co claim issued
--     -> one task_claim_reclaimed audit row
--
-- A retry with the same reclaim idempotency key returns the same replacement
-- claim. A stale claim that was already requeued by board_claim_next_task is
-- not reclaimable and fails truthfully; the caller must then use the normal
-- queue claim path.
--
-- Rollback design (not executed here): disable the Edge operation, restore
-- the preceding Edge source, then drop only this RPC. Existing claim rows,
-- audit evidence, and formal task data are never rewritten during rollback.

begin;

create or replace function public.board_reclaim_expired_task(
  p_task_id uuid,
  p_expired_claim_token uuid,
  p_idempotency_key text,
  p_lease_seconds integer default 900
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_instance public.board_instances%rowtype;
  v_task public.board_tasks%rowtype;
  v_co_workspace public.board_workspaces%rowtype;
  v_previous_claim private.board_task_claims%rowtype;
  v_existing_claim private.board_task_claims%rowtype;
  v_reclaimed_claim private.board_task_claims%rowtype;
  v_now timestamptz := now();
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501',
      message = 'Expired Claim reclaim requires the controlled service path';
  end if;
  if p_task_id is null or p_expired_claim_token is null
     or v_key is null or length(v_key) < 8 or length(v_key) > 200 then
    raise exception using errcode = '22023',
      message = 'TASK, expired Claim token, and a bounded idempotency key are required';
  end if;
  if p_lease_seconds < 60 or p_lease_seconds > 86400 then
    raise exception using errcode = '22023',
      message = 'Claim lease must be between 60 and 86400 seconds';
  end if;

  -- Serialize retries for the same reclaim operation. The target TASK is
  -- locked below so two different reclaim keys cannot replace the same lease.
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
      message = 'Expired Claim reclaim is limited to AI Board TASKs';
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
      message = 'Expired Claim reclaim is limited to the canonical AI Board';
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

  -- Same-key retries are accepted only when the existing claim is provably
  -- the replacement created by this RPC. A normal claim key must not be
  -- mistaken for a successful reclaim.
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
        message = 'Reclaim idempotency key is already bound to another TASK or Board instance';
    end if;
    if not exists (
      select 1
      from public.engineering_activity_log
      where entity_type = 'board_task'
        and entity_id = v_task.id::text
        and action = 'task_claim_reclaimed'
        and after_data ->> 'claim_id' = v_existing_claim.id::text
    ) then
      raise exception using errcode = '23505',
        message = 'Reclaim idempotency key is already bound to another claim operation';
    end if;

    return jsonb_build_object(
      'success', true,
      'reclaimed', true,
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

  select *
    into v_previous_claim
  from private.board_task_claims
  where claim_token = p_expired_claim_token
    and actor_label = 'Co'
  for update;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Expired Co Claim not found';
  end if;
  if v_previous_claim.task_id <> v_task.id
     or v_previous_claim.board_instance_id <> v_task.board_instance_id then
    raise exception using errcode = '42501',
      message = 'Expired Claim does not belong to the requested TASK and Board instance';
  end if;
  if v_previous_claim.state <> 'active' then
    raise exception using errcode = '40901',
      message = 'Claim is no longer eligible for targeted reclaim';
  end if;
  if v_previous_claim.lease_expires_at > v_now then
    raise exception using errcode = '40901',
      message = 'Claim is not expired; renew the active Claim instead';
  end if;
  if coalesce(v_task.status, '') <> 'inprogress'
     or coalesce(v_task.assignee, '') <> 'Co'
     or v_task.archived_at is not null
     or v_task.workspace_id is distinct from v_co_workspace.id then
    raise exception using errcode = '55000',
      message = 'TASK is no longer in the reclaimable inprogress / Co state';
  end if;

  update private.board_task_claims
  set state = 'expired',
      released_at = coalesce(released_at, v_now),
      release_reason = 'targeted_reclaim',
      updated_at = v_now
  where id = v_previous_claim.id
  returning * into v_previous_claim;

  insert into private.board_task_claims (
    task_id, board_instance_id, actor_label, idempotency_key,
    state, claimed_at, lease_expires_at, created_at, updated_at
  ) values (
    v_task.id, v_task.board_instance_id, 'Co', v_key,
    'active', v_now, v_now + make_interval(secs => p_lease_seconds), v_now, v_now
  )
  returning * into v_reclaimed_claim;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_task.id::text, 'task_claim_reclaimed',
    jsonb_build_object(
      'claim_id', v_previous_claim.id,
      'claim_state', 'active',
      'lease_expires_at', v_previous_claim.lease_expires_at,
      'status', v_task.status,
      'assignee', v_task.assignee,
      'workspace_id', v_task.workspace_id
    ),
    jsonb_build_object(
      'claim_id', v_reclaimed_claim.id,
      'claim_state', v_reclaimed_claim.state,
      'lease_expires_at', v_reclaimed_claim.lease_expires_at,
      'status', v_task.status,
      'assignee', v_task.assignee,
      'workspace_id', v_task.workspace_id,
      'lifecycle', 'claim_reclaimed'
    ),
    'Co reclaimed the same TASK through the authoritative Cloud expired-lease path',
    null, 'ai', 'Co', 'system_activity'
  );

  return jsonb_build_object(
    'success', true,
    'reclaimed', true,
    'idempotent', false,
    'claim', jsonb_build_object(
      'id', v_reclaimed_claim.id,
      'task_id', v_reclaimed_claim.task_id,
      'board_instance_id', v_reclaimed_claim.board_instance_id,
      'actor_label', v_reclaimed_claim.actor_label,
      'claim_token', v_reclaimed_claim.claim_token,
      'state', v_reclaimed_claim.state,
      'claimed_at', v_reclaimed_claim.claimed_at,
      'lease_expires_at', v_reclaimed_claim.lease_expires_at
    ),
    'previous_claim', jsonb_build_object(
      'id', v_previous_claim.id,
      'state', v_previous_claim.state,
      'released_at', v_previous_claim.released_at,
      'release_reason', v_previous_claim.release_reason
    ),
    'task', to_jsonb(v_task)
  );
end;
$function$;

revoke all on function public.board_reclaim_expired_task(uuid, uuid, text, integer) from public, anon, authenticated;
grant execute on function public.board_reclaim_expired_task(uuid, uuid, text, integer) to service_role;

commit;
