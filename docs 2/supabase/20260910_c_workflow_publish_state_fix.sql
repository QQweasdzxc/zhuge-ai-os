-- Module C Workflow v2 publish-state integrity fix.
-- A published version is immutable; publishing it must also clear the
-- Board Instance's draft pointer so the Runtime cannot reopen a published
-- row as an editable draft.  This is an additive function replacement only.

begin;

create or replace function public.board_c_workflow_publish(
  p_workflow_version_id uuid,
  p_expected_published_version_id uuid default null,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, private, pg_temp
as $function$
declare
  v_definition public.board_workflow_definitions%rowtype;
  v_state public.board_instance_workflow_state%rowtype;
  v_previous uuid;
  v_validation jsonb;
  v_response jsonb;
  v_hash text := md5(concat_ws('|', p_workflow_version_id::text, coalesce(p_expected_published_version_id::text, '')));
  v_existing private.board_workflow_action_idempotency%rowtype;
begin
  select * into v_definition
  from public.board_workflow_definitions
  where id = p_workflow_version_id
  for update;
  if not found or not public.board_instance_can_write(v_definition.board_instance_id) then
    raise exception using errcode = '42501', message = '只有子板 Owner／授權管理者可以發布流程。';
  end if;
  if v_definition.status <> 'draft' then
    raise exception using errcode = '55000', message = '只有流程草稿可以發布；已發布版本不可覆寫。';
  end if;
  if p_idempotency_key is not null then
    select * into v_existing
    from private.board_workflow_action_idempotency
    where idempotency_key = p_idempotency_key
      and expires_at > now();
    if found then
      if v_existing.request_hash <> v_hash then
        raise exception using errcode = '40001', message = '發布請求的 Idempotency Key 已用於不同內容。';
      end if;
      return v_existing.response;
    end if;
  end if;
  select * into v_state
  from public.board_instance_workflow_state
  where board_instance_id = v_definition.board_instance_id
  for update;
  v_previous := v_state.published_workflow_version_id;
  if p_expected_published_version_id is not null
     and v_previous is distinct from p_expected_published_version_id then
    raise exception using errcode = '40001', message = '已發布版本已變更，請重新載入後再發布。';
  end if;
  v_validation := private.board_workflow_validate(p_workflow_version_id);
  if coalesce((v_validation->>'valid')::boolean, false) is not true then
    raise exception using errcode = '22023', message = '流程草稿尚未通過驗證。', detail = v_validation::text;
  end if;
  if v_previous is not null then
    update public.board_workflow_definitions
    set status = 'retired', retired_at = now(), updated_at = now()
    where id = v_previous and status = 'published';
  end if;
  update public.board_workflow_definitions
  set status = 'published', published_by = auth.uid(), published_at = now(), updated_at = now()
  where id = p_workflow_version_id
  returning * into v_definition;
  insert into public.board_instance_workflow_state (
    board_instance_id,
    draft_workflow_version_id,
    published_workflow_version_id,
    updated_by
  )
  values (v_definition.board_instance_id, null, p_workflow_version_id, auth.uid())
  on conflict (board_instance_id) do update
  set draft_workflow_version_id = null,
      published_workflow_version_id = excluded.published_workflow_version_id,
      updated_by = excluded.updated_by,
      updated_at = now();
  v_response := jsonb_build_object(
    'contract', 'module-c-lifecycle-acceptance-v2',
    'action', 'publish',
    'board_instance_id', v_definition.board_instance_id,
    'workflow', private.board_workflow_snapshot(p_workflow_version_id),
    'previous_published_workflow_version_id', v_previous
  );
  insert into public.engineering_activity_log (
    entity_type, entity_id, action, after_data, note, actor_id, actor_type, actor_label, activity_type
  ) values (
    'board_workflow_definition', v_definition.id::text, 'workflow_published', v_response,
    'C Mother workflow published', auth.uid(), 'human', 'PM', 'system_activity'
  );
  if p_idempotency_key is not null then
    insert into private.board_workflow_action_idempotency (
      idempotency_key, action_type, board_instance_id, request_hash, response, status
    ) values (
      p_idempotency_key, 'publish', v_definition.board_instance_id, v_hash, v_response, 'completed'
    );
  end if;
  return v_response;
end;
$function$;

revoke all on function public.board_c_workflow_publish(uuid, uuid, text) from public, anon;
grant execute on function public.board_c_workflow_publish(uuid, uuid, text) to authenticated;

commit;
