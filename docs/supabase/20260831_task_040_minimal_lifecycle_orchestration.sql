-- TASK-040 Minimal Lifecycle Orchestration
--
-- This is an additive, non-destructive contract for the existing AI Board
-- lifecycle. It does not seed, rename, delete, backfill, or rewrite any
-- existing board task. The private claim ledger is only orchestration
-- metadata; the canonical task state remains public.board_tasks.
--
-- Contract:
--   Co claim -> coding / Developer QA -> qa / QJC -> PM PASS -> done / QJC
--   PM FAIL -> ready / Co queue -> a fresh Co claim
--
-- GPT evidence remains visible and auditable, but this automation does not
-- fabricate GPT QA and does not make it a PM checkbox gate.
--
-- Rollback design (not executed here): disable the new Edge operations, restore
-- the prior canonical function bodies from the preceding lifecycle migration,
-- then drop only these new RPCs and private.board_task_claims after active
-- claims are closed. Never rewrite board_tasks, checklist evidence, or formal
-- Board data during rollback; never drop the pre-existing private schema.

begin;

create schema if not exists private;

create table if not exists private.board_task_claims (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.board_tasks(id) on delete restrict,
  board_instance_id uuid not null references public.board_instances(id) on delete restrict,
  actor_label text not null check (actor_label = 'Co'),
  idempotency_key text not null check (length(btrim(idempotency_key)) between 8 and 200),
  claim_token uuid not null default gen_random_uuid(),
  state text not null default 'active'
    check (state in ('active', 'released', 'expired', 'completed')),
  claimed_at timestamptz not null default now(),
  lease_expires_at timestamptz not null,
  released_at timestamptz,
  release_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table private.board_task_claims enable row level security;

revoke all on schema private from public, anon, authenticated, service_role;
revoke all on private.board_task_claims from public, anon, authenticated, service_role;

create unique index if not exists board_task_claims_idempotency_idx
  on private.board_task_claims (actor_label, idempotency_key);

create unique index if not exists board_task_claims_active_task_idx
  on private.board_task_claims (task_id)
  where state = 'active';

create unique index if not exists board_task_claims_token_idx
  on private.board_task_claims (claim_token);

create index if not exists board_task_claims_instance_state_idx
  on private.board_task_claims (board_instance_id, state, lease_expires_at);

create index if not exists board_task_claims_task_idx
  on private.board_task_claims (task_id, created_at desc);

-- Expired claims are requeued only while the task is still inprogress / Co.
-- If another canonical transition already occurred, the claim is closed
-- without touching that newer task state.
create or replace function public.board_claim_next_task(
  p_board_instance_id uuid,
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
  v_instance public.board_instances%rowtype;
  v_co_workspace public.board_workspaces%rowtype;
  v_candidate public.board_tasks%rowtype;
  v_claim private.board_task_claims%rowtype;
  v_existing_claim private.board_task_claims%rowtype;
  v_existing_task public.board_tasks%rowtype;
  v_expired_claim private.board_task_claims%rowtype;
  v_expired_task public.board_tasks%rowtype;
  v_requeued_task public.board_tasks%rowtype;
  v_claimed_task public.board_tasks%rowtype;
  v_now timestamptz := now();
  v_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
begin
  if coalesce(auth.role(), '') <> 'service_role' or p_actor_label <> 'Co' then
    raise exception using errcode = '42501',
      message = 'Co Claim requires the controlled service path';
  end if;
  if p_board_instance_id is null or v_key is null or length(v_key) < 8 or length(v_key) > 200 then
    raise exception using errcode = '22023',
      message = 'Board instance and a bounded idempotency key are required';
  end if;
  if p_lease_seconds < 60 or p_lease_seconds > 86400 then
    raise exception using errcode = '22023',
      message = 'Claim lease must be between 60 and 86400 seconds';
  end if;

  select *
    into v_instance
  from public.board_instances
  where id = p_board_instance_id
    and active = true
  for share;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Active Board instance not found';
  end if;
  if v_instance.task_code_prefix <> 'TASK'
     or coalesce(v_instance.legacy_application_scope, '') <> 'ai_board' then
    raise exception using errcode = '42501',
      message = 'Co Claim is limited to the canonical AI Board';
  end if;

  -- Serialize retries for the same actor/key. Different idempotency keys can
  -- still claim different rows concurrently through SKIP LOCKED below.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_key, 0));

  -- A retry with the same key returns the original result and never claims a
  -- second task.
  select *
    into v_existing_claim
  from private.board_task_claims
  where actor_label = 'Co'
    and idempotency_key = v_key;
  if found then
    if v_existing_claim.board_instance_id <> p_board_instance_id then
      raise exception using errcode = '23505',
        message = 'Idempotency key is already bound to another Board instance';
    end if;
    select *
      into v_existing_task
    from public.board_tasks
    where id = v_existing_claim.task_id;
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
      'task', to_jsonb(v_existing_task)
    );
  end if;

  select *
    into v_co_workspace
  from public.board_workspaces
  where board_instance_id = p_board_instance_id
    and active = true
    and workspace_key = 'co'
  order by sort_order asc, created_at asc
  limit 1;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Canonical Co workspace is missing';
  end if;

  -- Close stale leases in task-first lock order. This is deliberately bounded
  -- to the requested Board instance and never edits a newer task state.
  for v_expired_claim in
    select claim.*
    from private.board_task_claims claim
    where claim.board_instance_id = p_board_instance_id
      and claim.state = 'active'
      and claim.lease_expires_at <= v_now
    order by claim.lease_expires_at asc, claim.created_at asc
  loop
    select *
      into v_expired_task
    from public.board_tasks
    where id = v_expired_claim.task_id
    for update;

    select *
      into v_expired_claim
    from private.board_task_claims
    where id = v_expired_claim.id
    for update;

    if v_expired_claim.state <> 'active'
       or v_expired_claim.lease_expires_at > v_now then
      continue;
    end if;

    if v_expired_task.status = 'inprogress'
       and v_expired_task.assignee = 'Co' then
      update public.board_tasks
      set status = 'ready',
          assignee = 'Co',
          workspace_id = v_co_workspace.id,
          updated_at = v_now
      where id = v_expired_task.id
      returning * into v_requeued_task;

      insert into public.engineering_activity_log (
        entity_type, entity_id, action, before_data, after_data, note,
        actor_id, actor_type, actor_label, activity_type
      ) values (
        'board_task', v_expired_task.id::text, 'task_claim_expired_requeued',
        jsonb_build_object(
          'status', v_expired_task.status,
          'assignee', v_expired_task.assignee,
          'workspace_id', v_expired_task.workspace_id,
          'claim_id', v_expired_claim.id
        ),
        jsonb_build_object(
          'status', v_requeued_task.status,
          'assignee', v_requeued_task.assignee,
          'workspace_id', v_requeued_task.workspace_id,
          'claim_id', v_expired_claim.id,
          'lifecycle', 'claim_expired'
        ),
        'Co Claim lease expired; TASK safely returned to the Co queue',
        null, 'system', 'System', 'system_activity'
      );
    end if;

    update private.board_task_claims
    set state = 'expired',
        released_at = coalesce(released_at, v_now),
        release_reason = coalesce(release_reason, 'lease_expired'),
        updated_at = v_now
    where id = v_expired_claim.id;

    insert into public.engineering_activity_log (
      entity_type, entity_id, action, before_data, after_data, note,
      actor_id, actor_type, actor_label, activity_type
    ) values (
      'board_task', v_expired_task.id::text, 'task_claim_expired',
      jsonb_build_object(
        'claim_id', v_expired_claim.id,
        'claim_state', 'active',
        'lease_expires_at', v_expired_claim.lease_expires_at
      ),
      jsonb_build_object(
        'claim_id', v_expired_claim.id,
        'claim_state', 'expired',
        'released_at', v_now,
        'release_reason', 'lease_expired'
      ),
      'Co Claim lease closed by the authoritative Cloud claim path',
      null, 'system', 'System', 'system_activity'
    );
  end loop;

  select task.*
    into v_candidate
  from public.board_tasks task
  join public.board_workspaces workspace
    on workspace.id = task.workspace_id
   and workspace.board_instance_id = task.board_instance_id
   and workspace.active = true
   and workspace.workspace_key = 'co'
  where task.board_instance_id = p_board_instance_id
    and task.application_scope = 'ai_board'
    and task.status = 'ready'
    and task.assignee = 'Co'
    and task.archived_at is null
    and not exists (
      select 1
      from private.board_task_claims active_claim
      where active_claim.task_id = task.id
        and active_claim.state = 'active'
    )
  order by task.updated_at asc nulls first, task.work_code asc
  limit 1
  for update of task skip locked;

  if not found then
    return jsonb_build_object(
      'success', true,
      'claimed', false,
      'idempotent', false,
      'reason', 'no_executable_task',
      'board_instance_id', p_board_instance_id
    );
  end if;

  update public.board_tasks
  set status = 'inprogress',
      assignee = 'Co',
      workspace_id = v_co_workspace.id,
      updated_at = v_now
  where id = v_candidate.id
  returning * into v_claimed_task;

  insert into private.board_task_claims (
    task_id, board_instance_id, actor_label, idempotency_key,
    state, claimed_at, lease_expires_at, created_at, updated_at
  ) values (
    v_claimed_task.id, p_board_instance_id, 'Co', v_key,
    'active', v_now, v_now + make_interval(secs => p_lease_seconds), v_now, v_now
  )
  returning * into v_claim;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_claimed_task.id::text, 'task_claimed',
    jsonb_build_object(
      'status', v_candidate.status,
      'assignee', v_candidate.assignee,
      'workspace_id', v_candidate.workspace_id
    ),
    jsonb_build_object(
      'status', v_claimed_task.status,
      'assignee', v_claimed_task.assignee,
      'workspace_id', v_claimed_task.workspace_id,
      'claim_id', v_claim.id,
      'lease_expires_at', v_claim.lease_expires_at,
      'lifecycle', 'co_claim'
    ),
    'Co claimed the next executable TASK through the authoritative Cloud claim path',
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

create or replace function public.board_renew_task_claim(
  p_claim_token uuid,
  p_lease_seconds integer default 900
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim private.board_task_claims%rowtype;
  v_task public.board_tasks%rowtype;
  v_previous_lease_expires_at timestamptz;
  v_now timestamptz := now();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501',
      message = 'Claim renewal requires the controlled service path';
  end if;
  if p_claim_token is null or p_lease_seconds < 60 or p_lease_seconds > 86400 then
    raise exception using errcode = '22023',
      message = 'Valid claim token and bounded lease are required';
  end if;

  select *
    into v_claim
  from private.board_task_claims
  where claim_token = p_claim_token
    and actor_label = 'Co';
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Claim not found';
  end if;

  select *
    into v_task
  from public.board_tasks
  where id = v_claim.task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Claimed TASK not found';
  end if;
  select *
    into v_claim
  from private.board_task_claims
  where id = v_claim.id
  for update;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Claim not found';
  end if;
  if v_claim.state <> 'active' or v_claim.lease_expires_at <= v_now then
    raise exception using errcode = '40901',
      message = 'Claim is expired or no longer active; acquire a new TASK';
  end if;
  if v_task.status <> 'inprogress' or v_task.assignee <> 'Co' then
    raise exception using errcode = '55000',
      message = 'Claimed TASK is no longer owned by Co';
  end if;

  v_previous_lease_expires_at := v_claim.lease_expires_at;

  update private.board_task_claims
  set lease_expires_at = v_now + make_interval(secs => p_lease_seconds),
      updated_at = v_now
  where id = v_claim.id
  returning * into v_claim;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_task.id::text, 'task_claim_renewed',
    jsonb_build_object(
      'claim_id', v_claim.id,
      'lease_expires_at', v_previous_lease_expires_at
    ),
    jsonb_build_object(
      'claim_id', v_claim.id,
      'lease_expires_at', v_claim.lease_expires_at,
      'lifecycle', 'claim_renewed'
    ),
    'Co renewed the active Cloud claim lease',
    null, 'ai', 'Co', 'system_activity'
  );

  return jsonb_build_object(
    'success', true,
    'claim', jsonb_build_object(
      'id', v_claim.id,
      'task_id', v_claim.task_id,
      'claim_token', v_claim.claim_token,
      'state', v_claim.state,
      'lease_expires_at', v_claim.lease_expires_at
    ),
    'task', to_jsonb(v_task)
  );
end;
$function$;

create or replace function public.board_release_task_claim(
  p_claim_token uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_claim private.board_task_claims%rowtype;
  v_task public.board_tasks%rowtype;
  v_workspace public.board_workspaces%rowtype;
  v_requeued_task public.board_tasks%rowtype;
  v_now timestamptz := now();
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501',
      message = 'Claim release requires the controlled service path';
  end if;
  if p_claim_token is null then
    raise exception using errcode = '22023',
      message = 'Claim token is required';
  end if;

  select *
    into v_claim
  from private.board_task_claims
  where claim_token = p_claim_token
    and actor_label = 'Co';
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Claim not found';
  end if;

  select *
    into v_task
  from public.board_tasks
  where id = v_claim.task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Claimed TASK not found';
  end if;
  select *
    into v_claim
  from private.board_task_claims
  where id = v_claim.id
  for update;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Claim not found';
  end if;

  if v_claim.state <> 'active' then
    return jsonb_build_object(
      'success', true,
      'released', false,
      'idempotent', true,
      'claim', jsonb_build_object(
        'id', v_claim.id,
        'task_id', v_claim.task_id,
        'claim_token', v_claim.claim_token,
        'state', v_claim.state,
        'release_reason', v_claim.release_reason
      ),
      'task', to_jsonb(v_task)
    );
  end if;

  select *
    into v_workspace
  from public.board_workspaces
  where board_instance_id = v_claim.board_instance_id
    and active = true
    and workspace_key = 'co'
  order by sort_order asc, created_at asc
  limit 1;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Canonical Co workspace is missing';
  end if;

  if v_task.status = 'inprogress' and v_task.assignee = 'Co' then
    update public.board_tasks
    set status = 'ready',
        assignee = 'Co',
        workspace_id = v_workspace.id,
        updated_at = v_now
    where id = v_task.id
    returning * into v_requeued_task;
  else
    v_requeued_task := v_task;
  end if;

  update private.board_task_claims
  set state = 'released',
      released_at = v_now,
      release_reason = coalesce(v_reason, 'released_by_co'),
      updated_at = v_now
  where id = v_claim.id
  returning * into v_claim;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_task.id::text, 'task_claim_released',
    jsonb_build_object(
      'claim_id', v_claim.id,
      'claim_state', 'active',
      'status', v_task.status,
      'assignee', v_task.assignee,
      'workspace_id', v_task.workspace_id
    ),
    jsonb_build_object(
      'claim_id', v_claim.id,
      'claim_state', v_claim.state,
      'status', v_requeued_task.status,
      'assignee', v_requeued_task.assignee,
      'workspace_id', v_requeued_task.workspace_id,
      'release_reason', v_claim.release_reason,
      'lifecycle', 'claim_released'
    ),
    'Co released the active claim; TASK returned to the executable Co queue',
    null, 'ai', 'Co', 'system_activity'
  );

  return jsonb_build_object(
    'success', true,
    'released', true,
    'idempotent', false,
    'claim', jsonb_build_object(
      'id', v_claim.id,
      'task_id', v_claim.task_id,
      'claim_token', v_claim.claim_token,
      'state', v_claim.state,
      'released_at', v_claim.released_at,
      'release_reason', v_claim.release_reason
    ),
    'task', to_jsonb(v_requeued_task)
  );
end;
$function$;

create or replace function public.board_orchestrate_developer_qa(
  p_task_id uuid,
  p_item_id uuid,
  p_evidence_note text,
  p_evidence_ref text default null,
  p_actor_label text default 'Co',
  p_claim_token uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_task public.board_tasks%rowtype;
  v_item public.engineering_checklist_items%rowtype;
  v_updated_item public.engineering_checklist_items%rowtype;
  v_qjc_workspace public.board_workspaces%rowtype;
  v_claim private.board_task_claims%rowtype;
  v_closed_claim private.board_task_claims%rowtype;
  v_updated_task public.board_tasks%rowtype;
  v_note text := nullif(btrim(coalesce(p_evidence_note, '')), '');
  v_ref text := nullif(btrim(coalesce(p_evidence_ref, '')), '');
  v_now timestamptz := now();
begin
  if coalesce(auth.role(), '') <> 'service_role' or p_actor_label <> 'Co' then
    raise exception using errcode = '42501',
      message = 'Developer QA orchestration requires the controlled Co service path';
  end if;
  if p_task_id is null or p_item_id is null or v_note is null and v_ref is null then
    raise exception using errcode = '22023',
      message = 'TASK, Developer QA item, and evidence are required';
  end if;

  select *
    into v_task
  from public.board_tasks
  where id = p_task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Board task not found';
  end if;
  if v_task.application_scope <> 'ai_board'
     or v_task.board_instance_id is null then
    raise exception using errcode = '42501',
      message = 'Developer QA orchestration is limited to AI Board TASKs';
  end if;

  select *
    into v_item
  from public.engineering_checklist_items
  where id = p_item_id
    and task_id = p_task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Developer QA checklist item does not belong to TASK';
  end if;
  if lower(v_item.stage) <> 'co'
     or lower(v_item.item_key) <> 'developer-qa'
     or v_item.required <> true then
    raise exception using errcode = '42501',
      message = 'Only the required Co Developer QA item can trigger orchestration';
  end if;

  select *
    into v_qjc_workspace
  from public.board_workspaces
  where board_instance_id = v_task.board_instance_id
    and active = true
    and workspace_key = 'qjc'
  order by sort_order asc, created_at asc
  limit 1;
  if not found then
    raise exception using errcode = 'P0002',
      message = 'Canonical QJC workspace is missing';
  end if;

  -- A retry after the atomic handoff is a truthful no-op.
  if v_task.status = 'qa'
     and v_task.assignee = 'QJC'
     and v_task.workspace_id = v_qjc_workspace.id
     and v_item.state = 'pass'
     and (nullif(btrim(coalesce(v_item.evidence_note, '')), '') is not null
          or nullif(btrim(coalesce(v_item.evidence_ref, '')), '') is not null) then
    return jsonb_build_object(
      'success', true,
      'idempotent', true,
      'task', to_jsonb(v_task),
      'checklist', to_jsonb(v_item),
      'handoff', 'qjc'
    );
  end if;

  if v_task.status <> 'inprogress' or v_task.assignee <> 'Co' then
    raise exception using errcode = '55000',
      message = 'TASK must be actively claimed by Co before Developer QA handoff';
  end if;

  if p_claim_token is null then
    select *
      into v_claim
    from private.board_task_claims
    where task_id = p_task_id
      and actor_label = 'Co'
      and state = 'active'
    order by claimed_at desc
    limit 1
    for update;
  else
    select *
      into v_claim
    from private.board_task_claims
    where task_id = p_task_id
      and actor_label = 'Co'
      and claim_token = p_claim_token
      and state = 'active'
    for update;
  end if;
  if not found then
    raise exception using errcode = '55000',
      message = 'An active Cloud Co Claim is required before Developer QA handoff';
  end if;
  if v_claim.lease_expires_at <= v_now then
    raise exception using errcode = '40901',
      message = 'Co Claim is expired; acquire a new TASK before Developer QA handoff';
  end if;

  update public.engineering_checklist_items
  set state = 'pass',
      checked_by = null,
      checked_at = v_now,
      evidence_note = v_note,
      evidence_ref = v_ref,
      updated_at = v_now
  where id = v_item.id
  returning * into v_updated_item;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'engineering_checklist_item', v_item.id::text, 'checklist_item_updated',
    to_jsonb(v_item), to_jsonb(v_updated_item),
    coalesce(v_note, v_ref),
    null, 'ai', 'Co', 'system_activity'
  );

  update public.board_tasks
  set status = 'qa',
      assignee = 'QJC',
      workspace_id = v_qjc_workspace.id,
      updated_at = v_now
  where id = v_task.id
  returning * into v_updated_task;

  update private.board_task_claims
  set state = 'completed',
      released_at = v_now,
      release_reason = 'developer_qa_handoff',
      updated_at = v_now
  where id = v_claim.id
  returning * into v_closed_claim;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_task.id::text, 'task_developer_qa_handoff',
    jsonb_build_object(
      'status', v_task.status,
      'assignee', v_task.assignee,
      'workspace_id', v_task.workspace_id,
      'claim_id', v_claim.id
    ),
    jsonb_build_object(
      'status', v_updated_task.status,
      'assignee', v_updated_task.assignee,
      'workspace_id', v_updated_task.workspace_id,
      'claim_id', v_closed_claim.id,
      'claim_state', v_closed_claim.state,
      'lifecycle', 'developer_qa_to_qjc'
    ),
    'Co Developer QA passed; TASK atomically entered the QJC PM QA queue',
    null, 'ai', 'Co', 'system_activity'
  );

  return jsonb_build_object(
    'success', true,
    'idempotent', false,
    'handoff', 'qjc',
    'task', to_jsonb(v_updated_task),
    'checklist', to_jsonb(v_updated_item),
    'claim', jsonb_build_object(
      'id', v_closed_claim.id,
      'task_id', v_closed_claim.task_id,
      'state', v_closed_claim.state,
      'released_at', v_closed_claim.released_at,
      'release_reason', v_closed_claim.release_reason
    )
  );
end;
$function$;

-- PM QA FAIL is the only new behavior in the existing checklist completion
-- path: it records the failure and atomically returns the same TASK to Co.
create or replace function public.board_update_checklist_item(
  p_item_id uuid,
  p_state text,
  p_evidence_note text default null,
  p_evidence_ref text default null,
  p_actor_type text default 'human',
  p_actor_label text default null
)
returns public.engineering_checklist_items
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_current_item public.engineering_checklist_items;
  v_updated_item public.engineering_checklist_items;
  v_current_task public.board_tasks%rowtype;
  v_completed_task public.board_tasks%rowtype;
  v_requeued_task public.board_tasks%rowtype;
  v_co_workspace public.board_workspaces%rowtype;
  v_completion_workspace_id uuid;
  v_actor_type text := lower(trim(coalesce(p_actor_type, 'human')));
  v_actor_label text;
  v_actor_id uuid;
  v_state text := lower(trim(coalesce(p_state, '')));
  v_note text := nullif(btrim(coalesce(p_evidence_note, '')), '');
  v_ref text := nullif(btrim(coalesce(p_evidence_ref, '')), '');
begin
  if v_state not in ('not_verified', 'pass', 'fail', 'na') then
    raise exception using errcode = '22023', message = 'Invalid checklist state';
  end if;

  select *
    into v_current_item
  from public.engineering_checklist_items
  where id = p_item_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Checklist item not found';
  end if;

  select *
    into v_current_task
  from public.board_tasks
  where id = v_current_item.task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Board task not found';
  end if;

  if v_actor_type = 'human' then
    if auth.uid() is null or not public.is_engineering_member(array['owner']) then
      raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
    end if;
    v_actor_id := auth.uid();
    v_actor_label := 'QJC';
  elsif v_actor_type = 'ai'
        and coalesce(auth.role(), '') = 'service_role'
        and p_actor_label in ('GPT', 'Co') then
    if lower(p_actor_label) <> lower(v_current_item.stage) then
      raise exception using errcode = '42501', message = 'AI actor may only update its own checklist stage';
    end if;
    v_actor_id := null;
    v_actor_label := p_actor_label;
  else
    raise exception using errcode = '42501', message = 'Checklist actor is not allowed';
  end if;

  if v_current_task.status = 'done'
     and lower(v_current_item.stage) = 'qjc'
     and lower(v_current_item.item_key) = 'pm-acceptance'
     and v_current_item.state = 'pass'
     and v_state <> 'pass' then
    raise exception using errcode = '55000', message = 'Completed TASK acceptance is immutable';
  end if;

  if lower(v_current_item.stage) = 'qjc'
     and lower(v_current_item.item_key) = 'pm-acceptance'
     and v_state = 'pass' then
    if v_actor_type <> 'human' then
      raise exception using errcode = '42501', message = 'PM Acceptance requires the authenticated QJC owner';
    end if;
    if v_note is null and v_ref is null then
      raise exception using errcode = '22023', message = 'PM Acceptance evidence is required';
    end if;
    if v_current_task.status <> 'qa' or v_current_task.assignee <> 'QJC' then
      raise exception using errcode = '42501', message = 'TASK must be in QJC PM QA before acceptance';
    end if;
    if exists (
      select 1
      from public.engineering_checklist_items item
      where item.task_id = v_current_task.id
        and item.required = true
        and lower(coalesce(item.stage, '')) in ('co', 'qjc')
        and item.id <> v_current_item.id
        and (item.state <> 'pass'
             or (nullif(btrim(coalesce(item.evidence_note, '')), '') is null
                 and nullif(btrim(coalesce(item.evidence_ref, '')), '') is null))
    ) then
      raise exception using errcode = '42501', message = 'Co/QJC engineering evidence is incomplete';
    end if;
    if not exists (
      select 1
      from public.engineering_checklist_items item
      where item.task_id = v_current_task.id
        and item.required = true
        and lower(coalesce(item.stage, '')) = 'co'
    ) then
      raise exception using errcode = '42501', message = 'Co Developer QA evidence is required';
    end if;

    select id
      into v_completion_workspace_id
    from public.board_workspaces
    where board_instance_id = v_current_task.board_instance_id
      and active = true
      and workspace_key = 'completed'
    order by sort_order asc, created_at asc
    limit 1;
    if v_completion_workspace_id is null then
      select id
        into v_completion_workspace_id
      from public.board_workspaces
      where board_instance_id = v_current_task.board_instance_id
        and active = true
        and name = '已完成'
      order by sort_order asc, created_at asc
      limit 1;
    end if;
    if v_completion_workspace_id is null then
      raise exception using errcode = 'P0002', message = 'Canonical 已完成 workspace is missing';
    end if;
  end if;

  if lower(v_current_item.stage) = 'qjc'
     and lower(v_current_item.item_key) = 'pm-acceptance'
     and v_state = 'fail' then
    if v_actor_type <> 'human' then
      raise exception using errcode = '42501', message = 'PM QA FAIL requires the authenticated QJC owner';
    end if;
    if v_current_task.status <> 'qa' or v_current_task.assignee <> 'QJC' then
      raise exception using errcode = '42501', message = 'TASK must be in QJC PM QA before a PM QA FAIL';
    end if;
    select *
      into v_co_workspace
    from public.board_workspaces
    where board_instance_id = v_current_task.board_instance_id
      and active = true
      and workspace_key = 'co'
    order by sort_order asc, created_at asc
    limit 1;
    if not found then
      raise exception using errcode = 'P0002', message = 'Canonical Co workspace is missing';
    end if;
  end if;

  update public.engineering_checklist_items
  set state = v_state,
      checked_by = case when v_state = 'not_verified' then null else v_actor_id end,
      checked_at = case when v_state = 'not_verified' then null else now() end,
      evidence_note = v_note,
      evidence_ref = v_ref,
      updated_at = now()
  where id = p_item_id
  returning * into v_updated_item;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'engineering_checklist_item', p_item_id::text, 'checklist_item_updated',
    to_jsonb(v_current_item), to_jsonb(v_updated_item),
    coalesce(v_note, v_ref), v_actor_id, v_actor_type, v_actor_label, 'system_activity'
  );

  if lower(v_current_item.stage) = 'qjc'
     and lower(v_current_item.item_key) = 'pm-acceptance'
     and v_state = 'fail' then
    update public.board_tasks
    set status = 'ready',
        assignee = 'Co',
        workspace_id = v_co_workspace.id,
        updated_at = now()
    where id = v_current_task.id
    returning * into v_requeued_task;

    insert into public.engineering_activity_log (
      entity_type, entity_id, action, before_data, after_data, note,
      actor_id, actor_type, actor_label, activity_type
    ) values (
      'board_task', v_current_task.id::text, 'task_pm_qa_failed_requeued',
      jsonb_build_object(
        'status', v_current_task.status,
        'assignee', v_current_task.assignee,
        'workspace_id', v_current_task.workspace_id
      ),
      jsonb_build_object(
        'status', v_requeued_task.status,
        'assignee', v_requeued_task.assignee,
        'workspace_id', v_requeued_task.workspace_id,
        'lifecycle', 'pm_qa_fail_to_co_queue'
      ),
    'PM QA FAIL recorded; TASK returned to the executable Co queue for correction',
      v_actor_id, 'human', 'QJC', 'system_activity'
    );
  end if;

  if lower(v_current_item.stage) = 'qjc'
     and lower(v_current_item.item_key) = 'pm-acceptance'
     and v_state = 'pass' then
    update public.board_tasks
    set status = 'done',
        assignee = 'QJC',
        workspace_id = v_completion_workspace_id,
        accepted_at = coalesce(accepted_at, now()),
        accepted_by = coalesce(accepted_by, v_actor_id),
        completion_at = coalesce(completion_at, now()),
        completion_by = coalesce(completion_by, v_actor_id),
        archive_due_at = coalesce(archive_due_at, now() + interval '48 hours'),
        archived_at = null,
        archived_by = null,
        updated_at = now()
    where id = v_current_task.id
    returning * into v_completed_task;

    insert into public.engineering_activity_log (
      entity_type, entity_id, action, before_data, after_data, note,
      actor_id, actor_type, actor_label, activity_type
    ) values (
      'board_task', v_current_task.id::text, 'task_completed_after_pm_acceptance',
      jsonb_build_object(
        'status', v_current_task.status,
        'workspace_id', v_current_task.workspace_id,
        'assignee', v_current_task.assignee,
        'accepted_at', v_current_task.accepted_at,
        'completion_at', v_current_task.completion_at
      ),
      jsonb_build_object(
        'status', v_completed_task.status,
        'workspace_id', v_completed_task.workspace_id,
        'assignee', v_completed_task.assignee,
        'accepted_at', v_completed_task.accepted_at,
        'completion_at', v_completed_task.completion_at,
        'archive_due_at', v_completed_task.archive_due_at,
        'lifecycle', 'pm_acceptance_pass'
      ),
      'TASK entered 已完成 after authenticated PM Acceptance PASS',
      v_actor_id, 'human', 'QJC', 'system_activity'
    );
  end if;

  return v_updated_item;
end;
$function$;

-- A Co ready -> inprogress transition must go through the atomic Claim RPC.
-- QJC/GPT legacy transitions remain available for their existing governed
-- review paths.
create or replace function public.board_transition_task(
  p_task_id uuid,
  p_target_status text,
  p_target_assignee text,
  p_actor_type text default 'human',
  p_actor_label text default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_current public.board_tasks%rowtype;
  v_actor_id uuid;
  v_actor_type text := lower(trim(coalesce(p_actor_type, 'human')));
  v_actor_label text;
  v_target_status text := lower(trim(coalesce(p_target_status, '')));
  v_target_assignee text := trim(coalesce(p_target_assignee, ''));
begin
  if v_target_status not in ('ready', 'inprogress', 'qa', 'done') then
    raise exception using errcode = '22023', message = 'Unsupported Board status';
  end if;
  if v_target_assignee not in ('QJC', 'GPT', 'Co') then
    raise exception using errcode = '22023', message = 'Unsupported workflow assignee';
  end if;
  if v_target_status = 'done' then
    raise exception using errcode = '42501', message = 'PM Acceptance controlled path is required before completion';
  end if;

  if v_actor_type = 'human' then
    if auth.uid() is null or not public.is_engineering_member(array['owner']) then
      raise exception using errcode = '42501', message = 'QJC authenticated membership is required';
    end if;
    v_actor_id := auth.uid();
    v_actor_label := 'QJC';
  elsif v_actor_type = 'ai' then
    if coalesce(auth.role(), '') <> 'service_role' then
      raise exception using errcode = '42501', message = 'AI workflow actors require the controlled service path';
    end if;
    if p_actor_label not in ('GPT', 'Co') then
      raise exception using errcode = '22023', message = 'Unsupported AI workflow actor';
    end if;
    v_actor_id := null;
    v_actor_label := p_actor_label;
  else
    raise exception using errcode = '22023', message = 'Unsupported actor type';
  end if;

  select *
    into v_current
  from public.board_tasks
  where id = p_task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Board task not found';
  end if;

  if v_actor_label = 'Co'
     and v_current.status = 'ready'
     and v_target_status = 'inprogress'
     and v_target_assignee = 'Co' then
    raise exception using errcode = '42501',
      message = 'Co ready -> inprogress requires board_claim_next_task';
  end if;

  if not (
    (v_actor_label = 'QJC' and (
      (v_current.status = 'ready' and v_target_status = 'inprogress' and v_target_assignee = 'Co')
      or (v_current.status = 'inprogress' and v_target_status = 'qa' and v_target_assignee = 'GPT')
      or (v_current.status = 'qa' and v_target_status = 'qa' and v_target_assignee = 'QJC')
      or (v_current.status = 'qa' and v_target_status = 'inprogress' and v_target_assignee = 'Co')
    ))
    or (v_actor_label = 'Co' and (
      (v_current.status = 'inprogress' and v_target_status = 'qa' and v_target_assignee = 'GPT')
      or (v_current.status = 'qa' and v_target_status = 'inprogress' and v_target_assignee = 'Co')
    ))
    or (v_actor_label = 'GPT' and (
      (v_current.status = 'qa' and v_target_status = 'qa' and v_target_assignee = 'QJC')
      or (v_current.status = 'qa' and v_target_status = 'inprogress' and v_target_assignee = 'Co')
    ))
  ) then
    raise exception using errcode = '42501', message = 'Workflow transition is not permitted';
  end if;

  update public.board_tasks
  set status = v_target_status,
      assignee = v_target_assignee,
      updated_at = now()
  where id = p_task_id;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', p_task_id::text, 'workflow_transition',
    jsonb_build_object('status', v_current.status, 'assignee', v_current.assignee),
    jsonb_build_object('status', v_target_status, 'assignee', v_target_assignee),
    p_note, v_actor_id, v_actor_type, v_actor_label, 'system_activity'
  );

  return jsonb_build_object(
    'success', true,
    'task_id', p_task_id,
    'status', v_target_status,
    'assignee', v_target_assignee,
    'actor_type', v_actor_type,
    'actor_label', v_actor_label
  );
end;
$function$;

revoke all on function public.board_claim_next_task(uuid, text, text, integer) from public, anon, authenticated;
revoke all on function public.board_renew_task_claim(uuid, integer) from public, anon, authenticated;
revoke all on function public.board_release_task_claim(uuid, text) from public, anon, authenticated;
revoke all on function public.board_orchestrate_developer_qa(uuid, uuid, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.board_claim_next_task(uuid, text, text, integer) to service_role;
grant execute on function public.board_renew_task_claim(uuid, integer) to service_role;
grant execute on function public.board_release_task_claim(uuid, text) to service_role;
grant execute on function public.board_orchestrate_developer_qa(uuid, uuid, text, text, text, uuid) to service_role;

revoke all on function public.board_update_checklist_item(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.board_update_checklist_item(uuid, text, text, text, text, text) to authenticated;

revoke all on function public.board_transition_task(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.board_transition_task(uuid, text, text, text, text, text) to authenticated;

comment on table private.board_task_claims is
  'TASK-040 private Cloud claim ledger; access only through the controlled service RPCs.';

commit;
