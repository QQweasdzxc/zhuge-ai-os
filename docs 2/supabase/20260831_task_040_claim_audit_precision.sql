-- TASK-040 follow-up: preserve the exact pre-renewal lease in Audit evidence.
-- This is a function-body correction only; it does not touch formal task data.

begin;

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

revoke all on function public.board_renew_task_claim(uuid, integer) from public, anon, authenticated;
grant execute on function public.board_renew_task_claim(uuid, integer) to service_role;

commit;
