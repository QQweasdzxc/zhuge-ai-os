-- Module C Workflow v2 hardening.
-- Additive function replacements only: adoption actions become idempotent and
-- card mapping refuses a card that is not on the adoption's source version.

begin;

create or replace function public.board_c_workflow_request_adoption(
  p_board_instance_id uuid,
  p_to_workflow_version_id uuid,
  p_note text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
declare
  v_from uuid;
  v_to public.board_workflow_definitions%rowtype;
  v_adoption public.board_workflow_adoptions%rowtype;
  v_existing private.board_workflow_action_idempotency%rowtype;
  v_response jsonb;
  v_hash text := md5(concat_ws('|', p_board_instance_id::text, p_to_workflow_version_id::text, coalesce(p_note, '')));
begin
  if auth.uid() is null or not public.board_instance_can_write(p_board_instance_id) then
    raise exception using errcode = '42501', message = '沒有申請流程採用的權限。';
  end if;
  if p_idempotency_key is not null then
    select * into v_existing
    from private.board_workflow_action_idempotency
    where idempotency_key = p_idempotency_key and expires_at > now();
    if found then
      if v_existing.request_hash <> v_hash then
        raise exception using errcode = '40001', message = '流程採用請求的 Idempotency Key 已用於不同內容。';
      end if;
      return v_existing.response;
    end if;
  end if;
  select published_workflow_version_id
    into v_from
  from public.board_instance_workflow_state
  where board_instance_id = p_board_instance_id
  for update;
  select * into v_to
  from public.board_workflow_definitions
  where id = p_to_workflow_version_id
    and board_instance_id = p_board_instance_id
    and status = 'published';
  if not found then
    raise exception using errcode = '22023', message = '目標流程不是此子板的已發布版本。';
  end if;
  insert into public.board_workflow_adoptions (board_instance_id, from_workflow_version_id, to_workflow_version_id, note, requested_by)
  values (p_board_instance_id, v_from, p_to_workflow_version_id, nullif(btrim(p_note), ''), auth.uid())
  returning * into v_adoption;
  v_response := jsonb_build_object('contract', 'module-c-lifecycle-acceptance-v2', 'action', 'request-adoption', 'adoption', to_jsonb(v_adoption));
  insert into public.engineering_activity_log (entity_type, entity_id, action, after_data, note, actor_id, actor_type, actor_label, activity_type)
  values ('board_workflow_adoption', v_adoption.id::text, 'workflow_adoption_requested', v_response, 'C Mother workflow adoption requested', auth.uid(), 'human', 'PM', 'system_activity');
  if p_idempotency_key is not null then
    insert into private.board_workflow_action_idempotency (idempotency_key, action_type, board_instance_id, request_hash, response, status)
    values (p_idempotency_key, 'request_adoption', p_board_instance_id, v_hash, v_response, 'completed');
  end if;
  return v_response;
end;
$function$;

create or replace function public.board_c_workflow_approve_adoption(
  p_adoption_id uuid,
  p_note text default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
declare
  v_adoption public.board_workflow_adoptions%rowtype;
  v_existing private.board_workflow_action_idempotency%rowtype;
  v_response jsonb;
  v_hash text := md5(concat_ws('|', p_adoption_id::text, coalesce(p_note, '')));
begin
  select * into v_adoption
  from public.board_workflow_adoptions
  where id = p_adoption_id
  for update;
  if not found or not public.board_instance_can_write(v_adoption.board_instance_id) then
    raise exception using errcode = '42501', message = '沒有核准流程採用的權限。';
  end if;
  if p_idempotency_key is not null then
    select * into v_existing
    from private.board_workflow_action_idempotency
    where idempotency_key = p_idempotency_key and expires_at > now();
    if found then
      if v_existing.request_hash <> v_hash then
        raise exception using errcode = '40001', message = '流程採用核准的 Idempotency Key 已用於不同內容。';
      end if;
      return v_existing.response;
    end if;
  end if;
  if v_adoption.status <> 'requested' then
    raise exception using errcode = '55000', message = '只有待核准的流程採用申請可以核准。';
  end if;
  update public.board_workflow_adoptions
  set status = 'approved',
      note = coalesce(nullif(btrim(p_note), ''), note),
      approved_by = auth.uid(),
      approved_at = now(),
      updated_at = now()
  where id = p_adoption_id
  returning * into v_adoption;
  v_response := jsonb_build_object('contract', 'module-c-lifecycle-acceptance-v2', 'action', 'approve-adoption', 'adoption', to_jsonb(v_adoption));
  insert into public.engineering_activity_log (entity_type, entity_id, action, after_data, note, actor_id, actor_type, actor_label, activity_type)
  values ('board_workflow_adoption', v_adoption.id::text, 'workflow_adoption_approved', v_response, 'C Mother workflow adoption approved', auth.uid(), 'human', 'PM', 'system_activity');
  if p_idempotency_key is not null then
    insert into private.board_workflow_action_idempotency (idempotency_key, action_type, board_instance_id, request_hash, response, status)
    values (p_idempotency_key, 'approve_adoption', v_adoption.board_instance_id, v_hash, v_response, 'completed');
  end if;
  return v_response;
end;
$function$;

create or replace function public.board_c_workflow_apply_card_mapping(
  p_adoption_id uuid,
  p_task_id uuid,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
declare
  v_adoption public.board_workflow_adoptions%rowtype;
  v_task public.board_tasks%rowtype;
  v_mapping public.board_workflow_step_mappings%rowtype;
  v_before jsonb;
  v_response jsonb;
  v_hash text := md5(concat_ws('|', p_adoption_id::text, p_task_id::text));
  v_existing private.board_workflow_action_idempotency%rowtype;
begin
  select * into v_adoption
  from public.board_workflow_adoptions
  where id = p_adoption_id;
  if not found or not public.board_instance_can_write(v_adoption.board_instance_id) then
    raise exception using errcode = '42501', message = '沒有套用流程對應的權限。';
  end if;
  if v_adoption.status not in ('approved', 'applied') then
    raise exception using errcode = '55000', message = '流程對應尚未核准。';
  end if;
  if p_idempotency_key is not null then
    select * into v_existing
    from private.board_workflow_action_idempotency
    where idempotency_key = p_idempotency_key and expires_at > now();
    if found then
      if v_existing.request_hash <> v_hash then
        raise exception using errcode = '40001', message = '流程採用請求的 Idempotency Key 已用於不同內容。';
      end if;
      return v_existing.response;
    end if;
  end if;
  select * into v_task
  from public.board_tasks
  where id = p_task_id
    and board_instance_id = v_adoption.board_instance_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '找不到此子板內的卡片。';
  end if;
  if v_task.workflow_version_id is distinct from v_adoption.from_workflow_version_id then
    raise exception using errcode = '55000', message = '此卡片目前不是原流程版本，不能套用這次對應；未變更卡片。';
  end if;
  if v_task.current_workflow_step_id is null then
    raise exception using errcode = '55000', message = '此卡片缺少目前流程階段，需由 PM 判定後才能套用，未變更卡片。';
  end if;
  select * into v_mapping
  from public.board_workflow_step_mappings
  where adoption_id = p_adoption_id
    and from_step_id = v_task.current_workflow_step_id
    and mapping_status = 'mapped';
  if not found then
    raise exception using errcode = '55000', message = '此卡片找不到安全的流程階段對應，已標記為待 PM 判定，未變更卡片。';
  end if;
  v_before := to_jsonb(v_task);
  update public.board_tasks
  set workflow_version_id = v_adoption.to_workflow_version_id,
      current_workflow_step_id = v_mapping.to_step_id,
      updated_at = now()
  where id = v_task.id
  returning * into v_task;
  update public.board_workflow_adoptions
  set status = 'applied',
      applied_by = auth.uid(),
      applied_at = coalesce(applied_at, now()),
      updated_at = now()
  where id = p_adoption_id;
  v_response := jsonb_build_object('contract', 'module-c-lifecycle-acceptance-v2', 'action', 'apply-card-mapping', 'task_id', v_task.id, 'adoption_id', p_adoption_id, 'before', v_before, 'after', to_jsonb(v_task));
  insert into public.engineering_activity_log (entity_type, entity_id, action, before_data, after_data, note, actor_id, actor_type, actor_label, activity_type)
  values ('board_task', v_task.id::text, 'workflow_card_mapping_applied', v_before, to_jsonb(v_task), 'C workflow adoption applied to one explicitly selected card', auth.uid(), 'human', 'PM', 'system_activity');
  if p_idempotency_key is not null then
    insert into private.board_workflow_action_idempotency (idempotency_key, action_type, board_instance_id, task_id, request_hash, response, status)
    values (p_idempotency_key, 'apply_card_mapping', v_adoption.board_instance_id, v_task.id, v_hash, v_response, 'completed');
  end if;
  return v_response;
end;
$function$;

revoke all on function public.board_c_workflow_request_adoption(uuid, uuid, text, text) from public, anon;
revoke all on function public.board_c_workflow_approve_adoption(uuid, text, text) from public, anon;
revoke all on function public.board_c_workflow_apply_card_mapping(uuid, uuid, text) from public, anon;
grant execute on function public.board_c_workflow_request_adoption(uuid, uuid, text, text) to authenticated;
grant execute on function public.board_c_workflow_approve_adoption(uuid, text, text) to authenticated;
grant execute on function public.board_c_workflow_apply_card_mapping(uuid, uuid, text) to authenticated;

commit;
