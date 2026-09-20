-- TASK-074 Agent Workspace Closed Loop
--
-- Canonical lifecycle:
--   ready/Co/todo
--     -> GPT Claim (qa/GPT/gpt)
--     -> GPT plan + handoff (ready/Co/todo)
--     -> Co Claim (inprogress/Co/co)
--     -> Co Developer QA (qa/GPT/gpt)
--     -> GPT Review PASS (qa/QJC/qjc)
--     -> QJC / PM acceptance or Runtime QA
--
-- GPT is added to the existing private claim ledger.  board_tasks remains the
-- only Task SSOT; the claim ledger remains orchestration metadata only.  The
-- migration is additive and does not create, delete, backfill, or rewrite any
-- existing task/card/product data.

begin;

-- The existing ledger was created for Co only.  Widen its actor boundary and
-- retain a purpose field so lease expiry has a truthful, auditable outcome for
-- GPT planning versus GPT review.
alter table private.board_task_claims
  drop constraint if exists board_task_claims_actor_label_check;
alter table private.board_task_claims
  drop constraint if exists board_task_claims_actor_label_scope_check;
alter table private.board_task_claims
  add constraint board_task_claims_actor_label_scope_check
  check (actor_label in ('Co', 'GPT'));

alter table private.board_task_claims
  add column if not exists claim_purpose text;
update private.board_task_claims
set claim_purpose = 'co_execution'
where claim_purpose is null;
alter table private.board_task_claims
  alter column claim_purpose set default 'co_execution';
alter table private.board_task_claims
  alter column claim_purpose set not null;
alter table private.board_task_claims
  drop constraint if exists board_task_claims_claim_purpose_check;
alter table private.board_task_claims
  add constraint board_task_claims_claim_purpose_check
  check (claim_purpose in ('co_execution', 'gpt_planning', 'gpt_review'));

comment on column private.board_task_claims.claim_purpose is
  'TASK-074 audit boundary: co_execution, gpt_planning, or gpt_review; never a second Task state.';

-- Re-emit the existing Co queue Claim with an explicit Co-only expiry scan.
-- Once GPT claims share the same ledger, the old broad expiry query must not
-- close a live GPT planning/review lease merely because Co asks for work.
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
  v_key text := nullif(pg_catalog.btrim(coalesce(p_idempotency_key, '')), '');
begin
  if coalesce(auth.role(), '') <> 'service_role' or p_actor_label <> 'Co' then
    raise exception using errcode = '42501', message = 'Co Claim requires the controlled service path';
  end if;
  if p_board_instance_id is null or v_key is null
     or pg_catalog.length(v_key) < 8 or pg_catalog.length(v_key) > 200 then
    raise exception using errcode = '22023', message = 'Board instance and a bounded idempotency key are required';
  end if;
  if p_lease_seconds < 60 or p_lease_seconds > 86400 then
    raise exception using errcode = '22023', message = 'Claim lease must be between 60 and 86400 seconds';
  end if;
  select * into v_instance from public.board_instances
  where id = p_board_instance_id and active = true for share;
  if not found then raise exception using errcode = 'P0002', message = 'Active Board instance not found'; end if;
  if coalesce(v_instance.task_code_prefix, '') <> 'TASK'
     or coalesce(v_instance.legacy_application_scope, '') <> 'ai_board' then
    raise exception using errcode = '42501', message = 'Co Claim is limited to the canonical AI Board';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_key, 0));

  select * into v_existing_claim from private.board_task_claims
  where actor_label = 'Co' and idempotency_key = v_key;
  if found then
    if v_existing_claim.board_instance_id <> p_board_instance_id then
      raise exception using errcode = '23505', message = 'Idempotency key is already bound to another Board instance';
    end if;
    select * into v_existing_task from public.board_tasks where id = v_existing_claim.task_id;
    return jsonb_build_object(
      'success', true, 'claimed', v_existing_claim.state in ('active', 'completed'),
      'idempotent', true,
      'claim', jsonb_build_object(
        'id', v_existing_claim.id, 'task_id', v_existing_claim.task_id,
        'board_instance_id', v_existing_claim.board_instance_id,
        'actor_label', v_existing_claim.actor_label,
        'claim_purpose', v_existing_claim.claim_purpose,
        'claim_token', v_existing_claim.claim_token, 'state', v_existing_claim.state,
        'claimed_at', v_existing_claim.claimed_at,
        'lease_expires_at', v_existing_claim.lease_expires_at,
        'released_at', v_existing_claim.released_at,
        'release_reason', v_existing_claim.release_reason
      ),
      'task', to_jsonb(v_existing_task)
    );
  end if;

  select * into v_co_workspace from public.board_workspaces
  where board_instance_id = p_board_instance_id and active = true and workspace_key = 'co'
  order by sort_order asc, created_at asc limit 1;
  if not found then raise exception using errcode = 'P0002', message = 'Canonical Co workspace is missing'; end if;

  for v_expired_claim in
    select claim.* from private.board_task_claims claim
    where claim.board_instance_id = p_board_instance_id
      and claim.actor_label = 'Co'
      and claim.claim_purpose = 'co_execution'
      and claim.state = 'active'
      and claim.lease_expires_at <= v_now
    order by claim.lease_expires_at asc, claim.created_at asc
  loop
    select * into v_expired_task from public.board_tasks
    where id = v_expired_claim.task_id for update;
    select * into v_expired_claim from private.board_task_claims
    where id = v_expired_claim.id for update;
    if v_expired_claim.state <> 'active' or v_expired_claim.lease_expires_at > v_now then continue; end if;

    if v_expired_task.status = 'inprogress' and v_expired_task.assignee = 'Co' then
      update public.board_tasks
      set status = 'ready', assignee = 'Co', workspace_id = v_co_workspace.id, updated_at = v_now
      where id = v_expired_task.id returning * into v_requeued_task;
      insert into public.engineering_activity_log (
        entity_type, entity_id, action, before_data, after_data, note,
        actor_id, actor_type, actor_label, activity_type
      ) values (
        'board_task', v_expired_task.id::text, 'task_claim_expired_requeued',
        jsonb_build_object('status', v_expired_task.status, 'assignee', v_expired_task.assignee,
          'workspace_id', v_expired_task.workspace_id, 'claim_id', v_expired_claim.id),
        jsonb_build_object('status', v_requeued_task.status, 'assignee', v_requeued_task.assignee,
          'workspace_id', v_requeued_task.workspace_id, 'claim_id', v_expired_claim.id,
          'lifecycle', 'claim_expired'),
        'Co Claim lease expired; TASK safely returned to the Co queue',
        null, 'system', 'System', 'system_activity'
      );
    end if;

    update private.board_task_claims
    set state = 'expired', released_at = coalesce(released_at, v_now),
        release_reason = coalesce(release_reason, 'lease_expired'), updated_at = v_now
    where id = v_expired_claim.id;
    insert into public.engineering_activity_log (
      entity_type, entity_id, action, before_data, after_data, note,
      actor_id, actor_type, actor_label, activity_type
    ) values (
      'board_task', v_expired_task.id::text, 'task_claim_expired',
      jsonb_build_object('claim_id', v_expired_claim.id, 'claim_state', 'active',
        'lease_expires_at', v_expired_claim.lease_expires_at),
      jsonb_build_object('claim_id', v_expired_claim.id, 'claim_state', 'expired',
        'released_at', v_now, 'release_reason', 'lease_expired'),
      'Co Claim lease closed by the authoritative Cloud claim path',
      null, 'system', 'System', 'system_activity'
    );
    v_requeued_task := null;
  end loop;

  select task.* into v_candidate
  from public.board_tasks task
  join public.board_workspaces workspace
    on workspace.id = task.workspace_id
   and workspace.board_instance_id = task.board_instance_id
   and workspace.active = true and workspace.workspace_key = 'co'
  where task.board_instance_id = p_board_instance_id
    and task.application_scope = 'ai_board'
    and task.status = 'ready' and task.assignee = 'Co'
    and task.archived_at is null
    and not exists (
      select 1 from private.board_task_claims active_claim
      where active_claim.task_id = task.id and active_claim.state = 'active'
    )
  order by task.updated_at asc nulls first, task.work_code asc
  limit 1 for update of task skip locked;
  if not found then
    return jsonb_build_object('success', true, 'claimed', false, 'idempotent', false,
      'reason', 'no_executable_task', 'board_instance_id', p_board_instance_id);
  end if;

  update public.board_tasks
  set status = 'inprogress', assignee = 'Co', workspace_id = v_co_workspace.id, updated_at = v_now
  where id = v_candidate.id returning * into v_claimed_task;
  insert into private.board_task_claims (
    task_id, board_instance_id, actor_label, claim_purpose, idempotency_key,
    claim_token, state, claimed_at, lease_expires_at, created_at, updated_at
  ) values (
    v_claimed_task.id, p_board_instance_id, 'Co', 'co_execution', v_key,
    gen_random_uuid(), 'active', v_now, v_now + make_interval(secs => p_lease_seconds), v_now, v_now
  ) returning * into v_claim;
  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_claimed_task.id::text, 'task_claimed',
    jsonb_build_object('status', v_candidate.status, 'assignee', v_candidate.assignee,
      'workspace_id', v_candidate.workspace_id),
    jsonb_build_object('status', v_claimed_task.status, 'assignee', v_claimed_task.assignee,
      'workspace_id', v_claimed_task.workspace_id, 'claim_id', v_claim.id,
      'claim_purpose', v_claim.claim_purpose, 'lease_expires_at', v_claim.lease_expires_at,
      'lifecycle', 'co_claim'),
    'Co claimed the next executable TASK through the authoritative Cloud claim path',
    null, 'ai', 'Co', 'system_activity'
  );
  return jsonb_build_object(
    'success', true, 'claimed', true, 'idempotent', false,
    'claim', jsonb_build_object(
      'id', v_claim.id, 'task_id', v_claim.task_id,
      'board_instance_id', v_claim.board_instance_id, 'actor_label', v_claim.actor_label,
      'claim_purpose', v_claim.claim_purpose, 'claim_token', v_claim.claim_token,
      'state', v_claim.state, 'claimed_at', v_claim.claimed_at,
      'lease_expires_at', v_claim.lease_expires_at
    ),
    'task', to_jsonb(v_claimed_task)
  );
end;
$function$;

-- GPT may claim only the canonical AI Board.  Planning claims move a ready Co
-- task into the existing GPT workspace; review claims acquire a task already
-- returned by Co Developer QA.  Same-key retries are idempotent.
create or replace function public.board_claim_next_gpt_task(
  p_board_instance_id uuid,
  p_idempotency_key text,
  p_stage text default 'planning',
  p_lease_seconds integer default 900
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_instance public.board_instances%rowtype;
  v_todo_workspace public.board_workspaces%rowtype;
  v_gpt_workspace public.board_workspaces%rowtype;
  v_candidate public.board_tasks%rowtype;
  v_claim private.board_task_claims%rowtype;
  v_existing_claim private.board_task_claims%rowtype;
  v_existing_task public.board_tasks%rowtype;
  v_expired_claim private.board_task_claims%rowtype;
  v_expired_task public.board_tasks%rowtype;
  v_requeued_task public.board_tasks%rowtype;
  v_claimed_task public.board_tasks%rowtype;
  v_now timestamptz := now();
  v_key text := nullif(pg_catalog.btrim(coalesce(p_idempotency_key, '')), '');
  v_stage text := lower(pg_catalog.btrim(coalesce(p_stage, 'planning')));
  v_purpose text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501',
      message = 'GPT Claim requires the controlled service path';
  end if;
  if p_board_instance_id is null
     or v_key is null
     or pg_catalog.length(v_key) < 8
     or pg_catalog.length(v_key) > 200 then
    raise exception using errcode = '22023',
      message = 'Board instance and a bounded idempotency key are required';
  end if;
  if v_stage not in ('planning', 'review') then
    raise exception using errcode = '22023',
      message = 'GPT Claim stage must be planning or review';
  end if;
  if p_lease_seconds < 60 or p_lease_seconds > 86400 then
    raise exception using errcode = '22023',
      message = 'Claim lease must be between 60 and 86400 seconds';
  end if;
  v_purpose := case when v_stage = 'planning' then 'gpt_planning' else 'gpt_review' end;

  select * into v_instance
  from public.board_instances
  where id = p_board_instance_id and active = true
  for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'Active Board instance not found';
  end if;
  if coalesce(v_instance.task_code_prefix, '') <> 'TASK'
     or coalesce(v_instance.legacy_application_scope, '') <> 'ai_board' then
    raise exception using errcode = '42501',
      message = 'GPT Claim is limited to the canonical AI Board';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(pg_catalog.concat('GPT:', v_key), 0)
  );

  select * into v_existing_claim
  from private.board_task_claims
  where actor_label = 'GPT' and idempotency_key = v_key
  for update;
  if found then
    if v_existing_claim.board_instance_id <> p_board_instance_id then
      raise exception using errcode = '23505',
        message = 'GPT Claim idempotency key is already bound to another Board instance';
    end if;
    select * into v_existing_task
    from public.board_tasks where id = v_existing_claim.task_id;
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
      'task', to_jsonb(v_existing_task)
    );
  end if;

  select * into v_todo_workspace
  from public.board_workspaces
  where board_instance_id = p_board_instance_id
    and active = true and workspace_key = 'todo'
  order by sort_order asc, created_at asc limit 1;
  select * into v_gpt_workspace
  from public.board_workspaces
  where board_instance_id = p_board_instance_id
    and active = true and workspace_key = 'gpt'
  order by sort_order asc, created_at asc limit 1;
  if not found or v_todo_workspace.id is null then
    raise exception using errcode = 'P0002',
      message = 'Canonical GPT and Todo workspaces are required';
  end if;

  -- Close only expired GPT claims for this instance.  A planning lease that
  -- expires returns work to the Co queue; a review lease stays in qa/GPT so
  -- the next GPT review claim can resume without pretending Co reworked it.
  for v_expired_claim in
    select claim.*
    from private.board_task_claims claim
    where claim.board_instance_id = p_board_instance_id
      and claim.actor_label = 'GPT'
      and claim.state = 'active'
      and claim.lease_expires_at <= v_now
    order by claim.lease_expires_at asc, claim.created_at asc
  loop
    select * into v_expired_task
    from public.board_tasks where id = v_expired_claim.task_id for update;
    select * into v_expired_claim
    from private.board_task_claims where id = v_expired_claim.id for update;
    if v_expired_claim.state <> 'active'
       or v_expired_claim.lease_expires_at > v_now then
      continue;
    end if;

    if v_expired_claim.claim_purpose = 'gpt_planning'
       and v_expired_task.status = 'qa'
       and v_expired_task.assignee = 'GPT'
       and v_expired_task.workspace_id = v_gpt_workspace.id then
      update public.board_tasks
      set status = 'ready', assignee = 'Co', workspace_id = v_todo_workspace.id,
          updated_at = v_now
      where id = v_expired_task.id
      returning * into v_requeued_task;
    end if;

    update private.board_task_claims
    set state = 'expired', released_at = coalesce(released_at, v_now),
        release_reason = coalesce(release_reason, 'lease_expired'), updated_at = v_now
    where id = v_expired_claim.id;

    insert into public.engineering_activity_log (
      entity_type, entity_id, action, before_data, after_data, note,
      actor_id, actor_type, actor_label, activity_type
    ) values (
      'board_task', v_expired_task.id::text, 'task_gpt_claim_expired',
      jsonb_build_object(
        'claim_id', v_expired_claim.id,
        'claim_purpose', v_expired_claim.claim_purpose,
        'status', v_expired_task.status,
        'assignee', v_expired_task.assignee,
        'workspace_id', v_expired_task.workspace_id
      ),
      jsonb_build_object(
        'claim_id', v_expired_claim.id,
        'claim_state', 'expired',
        'claim_purpose', v_expired_claim.claim_purpose,
        'returned_to_co_queue', v_requeued_task.id is not null,
        'lifecycle', 'gpt_claim_expired'
      ),
      'GPT Claim lease expired through the canonical AI Board claim ledger',
      null, 'system', 'System', 'system_activity'
    );
    v_requeued_task := null;
  end loop;

  if v_stage = 'planning' then
    select task.* into v_candidate
    from public.board_tasks task
    where task.board_instance_id = p_board_instance_id
      and task.application_scope = 'ai_board'
      and task.status = 'ready' and task.assignee = 'Co'
      and task.workspace_id = v_todo_workspace.id
      and task.archived_at is null
      and not exists (
        select 1 from private.board_task_claims active_claim
        where active_claim.task_id = task.id and active_claim.state = 'active'
      )
    order by task.updated_at asc, task.created_at asc
    for update of task skip locked
    limit 1;
  else
    select task.* into v_candidate
    from public.board_tasks task
    where task.board_instance_id = p_board_instance_id
      and task.application_scope = 'ai_board'
      and task.status = 'qa' and task.assignee = 'GPT'
      and task.workspace_id = v_gpt_workspace.id
      and task.archived_at is null
      and not exists (
        select 1 from private.board_task_claims active_claim
        where active_claim.task_id = task.id and active_claim.state = 'active'
      )
    order by task.updated_at asc, task.created_at asc
    for update of task skip locked
    limit 1;
  end if;

  if not found then
    return jsonb_build_object(
      'success', true, 'claimed', false, 'idempotent', false,
      'stage', v_stage, 'reason', 'no_eligible_task'
    );
  end if;

  if v_stage = 'planning' then
    update public.board_tasks
    set status = 'qa', assignee = 'GPT', workspace_id = v_gpt_workspace.id,
        updated_at = v_now
    where id = v_candidate.id
    returning * into v_claimed_task;
  else
    v_claimed_task := v_candidate;
  end if;

  insert into private.board_task_claims (
    task_id, board_instance_id, actor_label, claim_purpose, idempotency_key,
    claim_token, state, claimed_at, lease_expires_at
  ) values (
    v_claimed_task.id, p_board_instance_id, 'GPT', v_purpose, v_key,
    gen_random_uuid(), 'active', v_now,
    v_now + make_interval(secs => p_lease_seconds)
  ) returning * into v_claim;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_claimed_task.id::text, 'task_gpt_claimed',
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
      'claim_token', v_claim.claim_token,
      'claim_purpose', v_claim.claim_purpose,
      'stage', v_stage,
      'idempotency_key', v_key,
      'lifecycle', case when v_stage = 'planning' then 'gpt_claim_for_planning' else 'gpt_claim_for_review' end
    ),
    'GPT acquired a bounded, idempotent Claim through the canonical AI Board service path',
    null, 'ai', 'GPT', 'system_activity'
  );

  return jsonb_build_object(
    'success', true, 'claimed', true, 'idempotent', false, 'stage', v_stage,
    'claim', jsonb_build_object(
      'id', v_claim.id, 'task_id', v_claim.task_id,
      'board_instance_id', v_claim.board_instance_id,
      'actor_label', v_claim.actor_label, 'claim_purpose', v_claim.claim_purpose,
      'claim_token', v_claim.claim_token, 'state', v_claim.state,
      'claimed_at', v_claim.claimed_at, 'lease_expires_at', v_claim.lease_expires_at
    ),
    'task', to_jsonb(v_claimed_task)
  );
end;
$function$;

create or replace function public.board_renew_gpt_task_claim(
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
  v_now timestamptz := now();
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'GPT Claim renewal requires the controlled service path';
  end if;
  if p_claim_token is null or p_lease_seconds < 60 or p_lease_seconds > 86400 then
    raise exception using errcode = '22023', message = 'GPT claim token and bounded lease are required';
  end if;
  select * into v_claim
  from private.board_task_claims
  where claim_token = p_claim_token and actor_label = 'GPT' and state = 'active'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Active GPT Claim not found';
  end if;
  if v_claim.lease_expires_at <= v_now then
    raise exception using errcode = '40901', message = 'GPT Claim is expired';
  end if;
  select * into v_task from public.board_tasks where id = v_claim.task_id for share;
  if v_task.status <> 'qa' or v_task.assignee <> 'GPT' then
    raise exception using errcode = '55000', message = 'GPT Claim is no longer attached to a GPT task';
  end if;
  update private.board_task_claims
  set lease_expires_at = v_now + make_interval(secs => p_lease_seconds), updated_at = v_now
  where id = v_claim.id returning * into v_claim;
  return jsonb_build_object(
    'success', true, 'renewed', true,
    'claim', jsonb_build_object(
      'id', v_claim.id, 'task_id', v_claim.task_id,
      'claim_purpose', v_claim.claim_purpose, 'claim_token', v_claim.claim_token,
      'state', v_claim.state, 'lease_expires_at', v_claim.lease_expires_at
    ),
    'task', to_jsonb(v_task)
  );
end;
$function$;

create or replace function public.board_release_gpt_task_claim(
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
  v_todo_workspace public.board_workspaces%rowtype;
  v_updated_task public.board_tasks%rowtype;
  v_now timestamptz := now();
  v_reason text := nullif(pg_catalog.btrim(coalesce(p_reason, '')), '');
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'GPT Claim release requires the controlled service path';
  end if;
  if p_claim_token is null then
    raise exception using errcode = '22023', message = 'GPT claim token is required';
  end if;
  select * into v_claim
  from private.board_task_claims
  where claim_token = p_claim_token and actor_label = 'GPT' and state = 'active'
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Active GPT Claim not found';
  end if;
  select * into v_task from public.board_tasks where id = v_claim.task_id for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Claimed Board TASK not found';
  end if;
  if v_claim.claim_purpose = 'gpt_planning' then
    select * into v_todo_workspace
    from public.board_workspaces
    where board_instance_id = v_task.board_instance_id
      and active = true and workspace_key = 'todo'
    order by sort_order asc, created_at asc limit 1;
    if not found then
      raise exception using errcode = 'P0002', message = 'Canonical Todo workspace is missing';
    end if;
    update public.board_tasks
    set status = 'ready', assignee = 'Co', workspace_id = v_todo_workspace.id,
        updated_at = v_now
    where id = v_task.id returning * into v_updated_task;
  else
    v_updated_task := v_task;
  end if;
  update private.board_task_claims
  set state = 'released', released_at = v_now,
      release_reason = coalesce(v_reason, 'gpt_claim_released'), updated_at = v_now
  where id = v_claim.id returning * into v_claim;
  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_task.id::text, 'task_gpt_claim_released',
    jsonb_build_object('claim_id', v_claim.id, 'claim_purpose', v_claim.claim_purpose,
      'status', v_task.status, 'assignee', v_task.assignee, 'workspace_id', v_task.workspace_id),
    jsonb_build_object('claim_id', v_claim.id, 'claim_state', v_claim.state,
      'status', v_updated_task.status, 'assignee', v_updated_task.assignee,
      'workspace_id', v_updated_task.workspace_id, 'release_reason', v_claim.release_reason,
      'lifecycle', 'gpt_claim_released'),
    coalesce(v_reason, 'GPT released the bounded Claim through the canonical service path'),
    null, 'ai', 'GPT', 'system_activity'
  );
  return jsonb_build_object(
    'success', true, 'released', true,
    'claim', jsonb_build_object('id', v_claim.id, 'task_id', v_claim.task_id,
      'claim_purpose', v_claim.claim_purpose, 'claim_token', v_claim.claim_token,
      'state', v_claim.state, 'released_at', v_claim.released_at,
      'release_reason', v_claim.release_reason),
    'task', to_jsonb(v_updated_task)
  );
end;
$function$;

-- GPT planning uses the existing governed task-contract columns.  It does not
-- introduce a plan table or a second Task record.
create or replace function public.board_gpt_plan_and_handoff_co(
  p_task_id uuid,
  p_claim_token uuid,
  p_idempotency_key text,
  p_plan jsonb,
  p_actor_label text default 'GPT'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_task public.board_tasks%rowtype;
  v_claim private.board_task_claims%rowtype;
  v_existing_activity public.engineering_activity_log%rowtype;
  v_todo_workspace public.board_workspaces%rowtype;
  v_updated_task public.board_tasks%rowtype;
  v_now timestamptz := now();
  v_key text := nullif(pg_catalog.btrim(coalesce(p_idempotency_key, '')), '');
  v_objective text := nullif(pg_catalog.btrim(coalesce(p_plan->>'objective', '')), '');
  v_solution text := nullif(pg_catalog.btrim(coalesce(p_plan->>'proposed_solution', '')), '');
  v_acceptance text := nullif(pg_catalog.btrim(coalesce(p_plan->>'acceptance_criteria', '')), '');
begin
  if coalesce(auth.role(), '') <> 'service_role' or p_actor_label <> 'GPT' then
    raise exception using errcode = '42501', message = 'GPT planning requires the controlled service path';
  end if;
  if p_task_id is null or p_claim_token is null
     or v_key is null or pg_catalog.length(v_key) < 8 or pg_catalog.length(v_key) > 200 then
    raise exception using errcode = '22023', message = 'TASK, GPT claim token and bounded idempotency key are required';
  end if;
  if pg_catalog.jsonb_typeof(coalesce(p_plan, '{}'::jsonb)) <> 'object' then
    raise exception using errcode = '22023', message = 'GPT plan must be a JSON object';
  end if;
  if exists (
    select 1 from pg_catalog.jsonb_object_keys(p_plan) as key(name)
    where name not in ('summary', 'problem', 'objective', 'proposed_solution',
      'related_work', 'acceptance_criteria', 'developer_notes', 'usage_scenario')
  ) then
    raise exception using errcode = '22023', message = 'GPT plan field is not allowlisted';
  end if;
  if v_objective is null or v_solution is null or v_acceptance is null then
    raise exception using errcode = '22023', message = 'GPT plan requires objective, proposed_solution and acceptance_criteria';
  end if;
  if greatest(
    pg_catalog.length(coalesce(p_plan->>'summary', '')),
    pg_catalog.length(coalesce(p_plan->>'problem', '')),
    pg_catalog.length(coalesce(p_plan->>'objective', '')),
    pg_catalog.length(coalesce(p_plan->>'proposed_solution', '')),
    pg_catalog.length(coalesce(p_plan->>'related_work', '')),
    pg_catalog.length(coalesce(p_plan->>'acceptance_criteria', '')),
    pg_catalog.length(coalesce(p_plan->>'developer_notes', '')),
    pg_catalog.length(coalesce(p_plan->>'usage_scenario', ''))
  ) > 12000 then
    raise exception using errcode = '22023', message = 'GPT plan fields exceed the bounded contract';
  end if;

  select * into v_existing_activity
  from public.engineering_activity_log
  where entity_type = 'board_task' and entity_id = p_task_id::text
    and action = 'task_gpt_plan_handoff_to_co'
    and after_data ->> 'idempotency_key' = v_key
  order by created_at desc limit 1;
  if found then
    select * into v_task from public.board_tasks where id = p_task_id;
    return jsonb_build_object('success', true, 'idempotent', true,
      'handoff', 'co', 'task', to_jsonb(v_task), 'activity', to_jsonb(v_existing_activity));
  end if;

  select * into v_task from public.board_tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Board TASK not found'; end if;
  if v_task.application_scope <> 'ai_board' or v_task.status <> 'qa' or v_task.assignee <> 'GPT' then
    raise exception using errcode = '55000', message = 'TASK must be in qa/GPT before GPT planning handoff';
  end if;
  select * into v_todo_workspace
  from public.board_workspaces
  where board_instance_id = v_task.board_instance_id
    and active = true and workspace_key = 'todo'
  order by sort_order asc, created_at asc limit 1;
  if not found then raise exception using errcode = 'P0002', message = 'Canonical Todo workspace is missing'; end if;
  select * into v_claim
  from private.board_task_claims
  where task_id = p_task_id and claim_token = p_claim_token
    and actor_label = 'GPT' and claim_purpose = 'gpt_planning' and state = 'active'
  for update;
  if not found then raise exception using errcode = '55000', message = 'Active GPT planning Claim is required'; end if;
  if v_claim.lease_expires_at <= v_now then raise exception using errcode = '40901', message = 'GPT planning Claim is expired'; end if;

  update public.board_tasks
  set summary = case when p_plan ? 'summary' then nullif(pg_catalog.btrim(p_plan->>'summary'), '') else summary end,
      problem = case when p_plan ? 'problem' then nullif(pg_catalog.btrim(p_plan->>'problem'), '') else problem end,
      objective = case when p_plan ? 'objective' then nullif(pg_catalog.btrim(p_plan->>'objective'), '') else objective end,
      proposed_solution = case when p_plan ? 'proposed_solution' then nullif(pg_catalog.btrim(p_plan->>'proposed_solution'), '') else proposed_solution end,
      related_work = case when p_plan ? 'related_work' then nullif(pg_catalog.btrim(p_plan->>'related_work'), '') else related_work end,
      acceptance_criteria = case when p_plan ? 'acceptance_criteria' then nullif(pg_catalog.btrim(p_plan->>'acceptance_criteria'), '') else acceptance_criteria end,
      developer_notes = case when p_plan ? 'developer_notes' then nullif(pg_catalog.btrim(p_plan->>'developer_notes'), '') else developer_notes end,
      usage_scenario = case when p_plan ? 'usage_scenario' then nullif(pg_catalog.btrim(p_plan->>'usage_scenario'), '') else usage_scenario end,
      status = 'ready', assignee = 'Co', workspace_id = v_todo_workspace.id, updated_at = v_now
  where id = v_task.id returning * into v_updated_task;

  update private.board_task_claims
  set state = 'completed', released_at = v_now,
      release_reason = 'gpt_plan_handoff_to_co', updated_at = v_now
  where id = v_claim.id returning * into v_claim;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_task.id::text, 'task_gpt_plan_handoff_to_co',
    jsonb_build_object('status', v_task.status, 'assignee', v_task.assignee,
      'workspace_id', v_task.workspace_id, 'claim_id', v_claim.id),
    jsonb_build_object('status', v_updated_task.status, 'assignee', v_updated_task.assignee,
      'workspace_id', v_updated_task.workspace_id, 'claim_id', v_claim.id,
      'claim_state', v_claim.state, 'idempotency_key', v_key,
      'plan', p_plan, 'lifecycle', 'gpt_plan_handoff_to_co'),
    'GPT completed the bounded implementation plan and returned TASK to the canonical Co queue',
    null, 'ai', 'GPT', 'system_activity'
  );
  return jsonb_build_object('success', true, 'idempotent', false, 'handoff', 'co',
    'task', to_jsonb(v_updated_task),
    'claim', jsonb_build_object('id', v_claim.id, 'state', v_claim.state,
      'claim_purpose', v_claim.claim_purpose, 'release_reason', v_claim.release_reason));
end;
$function$;

-- The formal Co Developer QA handoff now returns to GPT Review.  QJC/PM is
-- reached only after GPT Review PASS through the existing transition gate.
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
  v_gpt_workspace public.board_workspaces%rowtype;
  v_claim private.board_task_claims%rowtype;
  v_closed_claim private.board_task_claims%rowtype;
  v_updated_task public.board_tasks%rowtype;
  v_note text := nullif(pg_catalog.btrim(coalesce(p_evidence_note, '')), '');
  v_ref text := nullif(pg_catalog.btrim(coalesce(p_evidence_ref, '')), '');
  v_now timestamptz := now();
begin
  if coalesce(auth.role(), '') <> 'service_role' or p_actor_label <> 'Co' then
    raise exception using errcode = '42501', message = 'Developer QA orchestration requires the controlled Co service path';
  end if;
  if p_task_id is null or p_item_id is null or (v_note is null and v_ref is null) then
    raise exception using errcode = '22023', message = 'TASK, Developer QA item, and evidence are required';
  end if;
  select * into v_task from public.board_tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Board task not found'; end if;
  if v_task.application_scope <> 'ai_board' or v_task.board_instance_id is null then
    raise exception using errcode = '42501', message = 'Developer QA orchestration is limited to AI Board TASKs';
  end if;
  select * into v_item from public.engineering_checklist_items
  where id = p_item_id and task_id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Developer QA checklist item does not belong to TASK'; end if;
  if lower(v_item.stage) <> 'co' or lower(v_item.item_key) <> 'developer-qa' or v_item.required <> true then
    raise exception using errcode = '42501', message = 'Only the required Co Developer QA item can trigger orchestration';
  end if;
  select * into v_gpt_workspace from public.board_workspaces
  where board_instance_id = v_task.board_instance_id and active = true and workspace_key = 'gpt'
  order by sort_order asc, created_at asc limit 1;
  if not found then raise exception using errcode = 'P0002', message = 'Canonical GPT workspace is missing'; end if;

  if v_task.status = 'qa' and v_task.assignee = 'GPT'
     and v_task.workspace_id = v_gpt_workspace.id and v_item.state = 'pass'
     and (nullif(pg_catalog.btrim(coalesce(v_item.evidence_note, '')), '') is not null
       or nullif(pg_catalog.btrim(coalesce(v_item.evidence_ref, '')), '') is not null) then
    return jsonb_build_object('success', true, 'idempotent', true,
      'handoff', 'gpt', 'task', to_jsonb(v_task), 'checklist', to_jsonb(v_item));
  end if;
  if v_task.status <> 'inprogress' or v_task.assignee <> 'Co' then
    raise exception using errcode = '55000', message = 'TASK must be actively claimed by Co before Developer QA handoff';
  end if;
  if p_claim_token is null then
    select * into v_claim from private.board_task_claims
    where task_id = p_task_id and actor_label = 'Co' and state = 'active'
    order by claimed_at desc limit 1 for update;
  else
    select * into v_claim from private.board_task_claims
    where task_id = p_task_id and actor_label = 'Co' and claim_token = p_claim_token and state = 'active'
    for update;
  end if;
  if not found then raise exception using errcode = '55000', message = 'An active Cloud Co Claim is required before Developer QA handoff'; end if;
  if v_claim.lease_expires_at <= v_now then raise exception using errcode = '40901', message = 'Co Claim is expired; acquire a new TASK before Developer QA handoff'; end if;

  update public.engineering_checklist_items
  set state = 'pass', checked_by = null, checked_at = v_now,
      evidence_note = v_note, evidence_ref = v_ref, updated_at = v_now
  where id = v_item.id returning * into v_updated_item;
  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'engineering_checklist_item', v_item.id::text, 'checklist_item_updated',
    to_jsonb(v_item), to_jsonb(v_updated_item), coalesce(v_note, v_ref),
    null, 'ai', 'Co', 'system_activity'
  );
  update public.board_tasks
  set status = 'qa', assignee = 'GPT', workspace_id = v_gpt_workspace.id, updated_at = v_now
  where id = v_task.id returning * into v_updated_task;
  update private.board_task_claims
  set state = 'completed', released_at = v_now,
      release_reason = 'developer_qa_handoff_to_gpt', updated_at = v_now
  where id = v_claim.id returning * into v_closed_claim;
  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', v_task.id::text, 'task_developer_qa_handoff',
    jsonb_build_object('status', v_task.status, 'assignee', v_task.assignee,
      'workspace_id', v_task.workspace_id, 'claim_id', v_claim.id),
    jsonb_build_object('status', v_updated_task.status, 'assignee', v_updated_task.assignee,
      'workspace_id', v_updated_task.workspace_id, 'claim_id', v_closed_claim.id,
      'claim_state', v_closed_claim.state, 'lifecycle', 'developer_qa_to_gpt'),
    'Co Developer QA passed; TASK atomically entered the GPT Review queue',
    null, 'ai', 'Co', 'system_activity'
  );
  return jsonb_build_object('success', true, 'idempotent', false, 'handoff', 'gpt',
    'task', to_jsonb(v_updated_task), 'checklist', to_jsonb(v_updated_item),
    'claim', jsonb_build_object('id', v_closed_claim.id, 'state', v_closed_claim.state,
      'released_at', v_closed_claim.released_at, 'release_reason', v_closed_claim.release_reason));
end;
$function$;

-- GPT Review owns the only controlled transition from qa/GPT.  PASS records
-- Review + Regression evidence before using the existing canonical transition
-- gate to qa/QJC.  REWORK returns the task to ready/Co so Co must Claim again.
create or replace function public.board_orchestrate_engineering_review(
  p_task_id uuid,
  p_review_state text,
  p_next_gate text default null,
  p_review_note text default null,
  p_evidence_ref text default null,
  p_regression_note text default null,
  p_regression_ref text default null,
  p_idempotency_key text default null,
  p_claim_token uuid default null,
  p_actor_label text default 'GPT'
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_task public.board_tasks%rowtype;
  v_before_task public.board_tasks%rowtype;
  v_claim private.board_task_claims%rowtype;
  v_review_item public.engineering_checklist_items%rowtype;
  v_updated_review public.engineering_checklist_items%rowtype;
  v_regression_item public.engineering_checklist_items%rowtype;
  v_updated_regression public.engineering_checklist_items%rowtype;
  v_existing_activity public.engineering_activity_log%rowtype;
  v_todo_workspace public.board_workspaces%rowtype;
  v_result jsonb;
  v_note text := nullif(pg_catalog.btrim(coalesce(p_review_note, '')), '');
  v_ref text := nullif(pg_catalog.btrim(coalesce(p_evidence_ref, '')), '');
  v_regression_note text := nullif(pg_catalog.btrim(coalesce(p_regression_note, '')), '');
  v_regression_ref text := nullif(pg_catalog.btrim(coalesce(p_regression_ref, '')), '');
  v_key text := nullif(pg_catalog.btrim(coalesce(p_idempotency_key, '')), '');
  v_state text := lower(pg_catalog.btrim(coalesce(p_review_state, '')));
  v_gate text := lower(pg_catalog.btrim(coalesce(p_next_gate, '')));
  v_now timestamptz := now();
begin
  if coalesce(auth.role(), '') <> 'service_role' or p_actor_label <> 'GPT' then
    raise exception using errcode = '42501', message = 'GPT Review requires the controlled service path';
  end if;
  if p_task_id is null or p_claim_token is null
     or v_key is null or pg_catalog.length(v_key) < 8 or pg_catalog.length(v_key) > 200 then
    raise exception using errcode = '22023', message = 'TASK, GPT review Claim and bounded idempotency key are required';
  end if;
  if v_state not in ('pass', 'rework') then
    raise exception using errcode = '22023', message = 'GPT Review state must be pass or rework';
  end if;
  if v_state = 'pass' and v_gate not in ('pm_decision_required', 'runtime_qa') then
    raise exception using errcode = '22023', message = 'GPT PASS must name pm_decision_required or runtime_qa as the next gate';
  end if;
  if v_state = 'rework' and v_gate is not null and v_gate <> '' then
    raise exception using errcode = '22023', message = 'GPT REWORK cannot hand off to a PM gate';
  end if;
  if v_note is null and v_ref is null then
    raise exception using errcode = '22023', message = 'GPT Review evidence is required';
  end if;
  if v_state = 'pass' and v_regression_note is null and v_regression_ref is null then
    raise exception using errcode = '22023', message = 'GPT PASS requires Regression evidence';
  end if;

  select * into v_existing_activity
  from public.engineering_activity_log
  where entity_type = 'board_task' and entity_id = p_task_id::text
    and action = 'task_engineering_review'
    and after_data ->> 'idempotency_key' = v_key
  order by created_at desc limit 1;
  if found then
    select * into v_task from public.board_tasks where id = p_task_id;
    return jsonb_build_object('success', true, 'idempotent', true,
      'review_state', v_existing_activity.after_data ->> 'review_state',
      'task', to_jsonb(v_task), 'activity', to_jsonb(v_existing_activity));
  end if;

  select * into v_task from public.board_tasks where id = p_task_id for update;
  if not found then raise exception using errcode = 'P0002', message = 'Board TASK not found'; end if;
  v_before_task := v_task;
  if v_task.application_scope <> 'ai_board' or v_task.status <> 'qa' or v_task.assignee <> 'GPT' then
    raise exception using errcode = '55000', message = 'TASK must be in qa/GPT before GPT Review';
  end if;
  select * into v_claim from private.board_task_claims
  where task_id = p_task_id and claim_token = p_claim_token
    and actor_label = 'GPT' and claim_purpose = 'gpt_review' and state = 'active'
  for update;
  if not found then raise exception using errcode = '55000', message = 'Active GPT review Claim is required'; end if;
  if v_claim.lease_expires_at <= v_now then raise exception using errcode = '40901', message = 'GPT review Claim is expired'; end if;
  select * into v_review_item from public.engineering_checklist_items
  where task_id = p_task_id and stage = 'gpt'
    and lower(item_key) in ('gpt-review', 'engineering-review')
    and required = true
  order by sort_order asc, created_at asc limit 1 for update;
  if not found then raise exception using errcode = '42501', message = 'Required GPT Review checklist item is missing'; end if;

  update public.engineering_checklist_items
  set state = case when v_state = 'pass' then 'pass' else 'fail' end,
      checked_by = null, checked_at = v_now, evidence_note = v_note,
      evidence_ref = v_ref, updated_at = v_now
  where id = v_review_item.id returning * into v_updated_review;
  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'engineering_checklist_item', v_review_item.id::text, 'checklist_item_updated',
    to_jsonb(v_review_item), to_jsonb(v_updated_review), coalesce(v_note, v_ref),
    null, 'ai', 'GPT', 'system_activity'
  );

  if v_state = 'pass' then
    insert into public.engineering_checklist_items (
      task_id, checklist_type, stage, item_key, label, required, sort_order, version
    ) values (
      p_task_id, 'batch_regression', 'gpt', 'regression-evidence',
      format('GPT Regression Evidence：確認「%s」Developer QA 後的 Regression 結果', v_task.title),
      true, 25, 1
    ) on conflict (task_id, checklist_type, stage, item_key, version) do nothing;
    select * into v_regression_item from public.engineering_checklist_items
    where task_id = p_task_id and checklist_type = 'batch_regression'
      and stage = 'gpt' and item_key = 'regression-evidence' and version = 1
    for update;
    update public.engineering_checklist_items
    set state = 'pass', checked_by = null, checked_at = v_now,
        evidence_note = v_regression_note, evidence_ref = v_regression_ref,
        updated_at = v_now
    where id = v_regression_item.id returning * into v_updated_regression;
    insert into public.engineering_activity_log (
      entity_type, entity_id, action, before_data, after_data, note,
      actor_id, actor_type, actor_label, activity_type
    ) values (
      'engineering_checklist_item', v_regression_item.id::text, 'checklist_item_updated',
      to_jsonb(v_regression_item), to_jsonb(v_updated_regression),
      coalesce(v_regression_note, v_regression_ref), null, 'ai', 'GPT', 'system_activity'
    );

    v_result := public.board_transition_task(
      p_task_id => p_task_id,
      p_target_status => 'qa',
      p_target_assignee => 'QJC',
      p_actor_type => 'ai',
      p_actor_label => 'GPT',
      p_note => format('GPT Review PASS; next gate: %s', v_gate)
    );
    select * into v_task from public.board_tasks where id = p_task_id;
  else
    select * into v_todo_workspace from public.board_workspaces
    where board_instance_id = v_task.board_instance_id
      and active = true and workspace_key = 'todo'
    order by sort_order asc, created_at asc limit 1;
    if not found then raise exception using errcode = 'P0002', message = 'Canonical Todo workspace is missing'; end if;
    update public.board_tasks
    set status = 'ready', assignee = 'Co', workspace_id = v_todo_workspace.id, updated_at = v_now
    where id = v_task.id returning * into v_task;
    v_result := jsonb_build_object('success', true, 'status', v_task.status,
      'assignee', v_task.assignee, 'workspace_id', v_task.workspace_id);
  end if;

  update private.board_task_claims
  set state = case when v_state = 'pass' then 'completed' else 'released' end,
      released_at = v_now,
      release_reason = case when v_state = 'pass' then 'gpt_review_passed' else 'gpt_review_rework' end,
      updated_at = v_now
  where id = v_claim.id returning * into v_claim;

  insert into public.engineering_activity_log (
    entity_type, entity_id, action, before_data, after_data, note,
    actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_task', p_task_id::text, 'task_engineering_review',
    jsonb_build_object('status', v_before_task.status,
      'assignee', v_before_task.assignee,
      'workspace_id', v_before_task.workspace_id,
      'claim_id', v_claim.id),
    jsonb_build_object('review_state', v_state, 'next_gate', nullif(v_gate, ''),
      'status', v_task.status,
      'assignee', v_task.assignee,
      'workspace_id', v_task.workspace_id,
      'claim_id', v_claim.id, 'claim_state', v_claim.state,
      'idempotency_key', v_key, 'review_evidence_ref', v_ref,
      'regression_evidence_ref', case when v_state = 'pass' then v_regression_ref else null end,
      'lifecycle', case when v_state = 'pass' then 'gpt_review_to_qjc' else 'gpt_review_rework_to_co' end),
    coalesce(v_note, v_ref), null, 'ai', 'GPT', 'system_activity'
  );
  return jsonb_build_object('success', true, 'idempotent', false,
    'review_state', v_state, 'next_gate', nullif(v_gate, ''),
    'transition', v_result, 'task', to_jsonb(v_task),
    'review', to_jsonb(v_updated_review),
    'regression', case when v_state = 'pass' then to_jsonb(v_updated_regression) else null end,
    'claim', jsonb_build_object('id', v_claim.id, 'claim_purpose', v_claim.claim_purpose,
      'state', v_claim.state, 'release_reason', v_claim.release_reason));
end;
$function$;

revoke all on function public.board_claim_next_gpt_task(uuid, text, text, integer) from public, anon, authenticated, service_role;
grant execute on function public.board_claim_next_gpt_task(uuid, text, text, integer) to service_role;
revoke all on function public.board_renew_gpt_task_claim(uuid, integer) from public, anon, authenticated, service_role;
grant execute on function public.board_renew_gpt_task_claim(uuid, integer) to service_role;
revoke all on function public.board_release_gpt_task_claim(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.board_release_gpt_task_claim(uuid, text) to service_role;
revoke all on function public.board_gpt_plan_and_handoff_co(uuid, uuid, text, jsonb, text) from public, anon, authenticated, service_role;
grant execute on function public.board_gpt_plan_and_handoff_co(uuid, uuid, text, jsonb, text) to service_role;
revoke all on function public.board_orchestrate_engineering_review(uuid, text, text, text, text, text, text, text, uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.board_orchestrate_engineering_review(uuid, text, text, text, text, text, text, text, uuid, text) to service_role;

comment on function public.board_claim_next_gpt_task(uuid, text, text, integer) is
  'TASK-074 canonical GPT Claim: bounded, idempotent planning/review lease on the AI Board only.';
comment on function public.board_gpt_plan_and_handoff_co(uuid, uuid, text, jsonb, text) is
  'TASK-074 GPT planning writes existing Task contract fields and returns the same Task to the canonical Co queue.';
comment on function public.board_orchestrate_engineering_review(uuid, text, text, text, text, text, text, text, uuid, text) is
  'TASK-074 GPT Review PASS/REWORK authority; PASS requires Review + Regression evidence before QJC handoff.';

commit;
