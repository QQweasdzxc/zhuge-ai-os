-- TASK lifecycle: PM drag from the visible QJC workspace is the formal
-- acceptance intent.  Compose the existing governed GPT -> QJC handoff and
-- PM Acceptance PASS in one transaction; do not open a generic transition to
-- done and do not infer acceptance from workspace position alone.

begin;

create or replace function public.board_pm_acceptance_from_qjc_drop(
  p_task_id uuid,
  p_item_id uuid,
  p_evidence_note text,
  p_evidence_ref text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_task public.board_tasks%rowtype;
  v_completed_task public.board_tasks%rowtype;
  v_qjc_workspace public.board_workspaces%rowtype;
  v_item public.engineering_checklist_items%rowtype;
  v_updated_item public.engineering_checklist_items%rowtype;
  v_instance public.board_instances%rowtype;
  v_scope text;
  v_note text := nullif(btrim(coalesce(p_evidence_note, '')), '');
  v_ref text := nullif(btrim(coalesce(p_evidence_ref, '')), '');
  v_pretransition_applied boolean := false;
begin
  if auth.uid() is null or not public.is_engineering_member(array['owner']) then
    raise exception using
      errcode = '42501',
      message = 'PM Acceptance 需要已登入的 QJC／PM 身分；卡片未移動。';
  end if;
  if p_task_id is null or p_item_id is null then
    raise exception using
      errcode = '22023',
      message = 'PM Acceptance 缺少 TASK 或驗收項目；卡片未移動。';
  end if;
  if v_note is null and v_ref is null then
    raise exception using
      errcode = '22023',
      message = 'PM Acceptance 必須填寫 Evidence；卡片未移動，正式狀態不變。';
  end if;

  select *
    into v_task
  from public.board_tasks
  where id = p_task_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = '找不到指定 TASK；卡片未移動。';
  end if;

  select *
    into v_instance
  from public.board_instances
  where id = v_task.board_instance_id
    and active = true
  for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'TASK 的正式 Board Instance 不存在或未啟用；卡片未移動。';
  end if;
  v_scope := coalesce(
    nullif(btrim(coalesce(v_task.application_scope, '')), ''),
    nullif(btrim(coalesce(v_instance.legacy_application_scope, '')), '')
  );
  if v_scope <> 'ai_board' then
    raise exception using
      errcode = '42501',
      message = '此受控 PM Acceptance 入口只適用 AI Board TASK；卡片未移動。';
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
    raise exception using
      errcode = 'P0002',
      message = '找不到此 Board 的 QJC驗證工作區；卡片未移動。';
  end if;
  if v_task.workspace_id is distinct from v_qjc_workspace.id then
    raise exception using
      errcode = '42501',
      message = 'PM Acceptance 必須從「QJC驗證」工作區發起；卡片未移動，正式狀態不變。';
  end if;

  select *
    into v_item
  from public.engineering_checklist_items
  where id = p_item_id
    and task_id = v_task.id
  for update;
  if not found
     or lower(coalesce(v_item.stage, '')) <> 'qjc'
     or lower(coalesce(v_item.item_key, '')) <> 'pm-acceptance' then
    raise exception using
      errcode = '42501',
      message = '指定項目不是正式 PM Acceptance Record；卡片未移動。';
  end if;

  if v_task.status = 'qa' and v_task.assignee = 'GPT' then
    -- This is the existing governed handoff, composed inside this function.
    -- If any engineering evidence is missing, the exception rolls back both
    -- this transition and every later acceptance write.
    perform public.board_transition_task(
      v_task.id,
      'qa',
      'QJC',
      'human',
      'QJC',
      'QJC驗證 → 完成：受控 PM Acceptance 前置交接'
    );
    v_pretransition_applied := true;
  elsif v_task.status <> 'qa' or v_task.assignee <> 'QJC' then
    raise exception using
      errcode = '42501',
      message = '正式狀態必須是 qa/GPT 或 qa/QJC 才能執行 PM Acceptance；卡片未移動。';
  end if;

  -- Reuse the existing PM Acceptance contract.  It checks Co, GPT,
  -- Regression, and PM evidence, then atomically writes the checklist and
  -- done/QJC/completed task state.  No generic board_transition_task -> done.
  v_updated_item := public.board_update_checklist_item(
    v_item.id,
    'pass',
    v_note,
    v_ref,
    'human',
    'QJC'
  );

  select *
    into v_completed_task
  from public.board_tasks
  where id = v_task.id;

  return jsonb_build_object(
    'success', true,
    'contract', 'pm_acceptance_from_qjc_drop',
    'task_id', v_completed_task.id,
    'checklist_item_id', v_updated_item.id,
    'pretransition_applied', v_pretransition_applied,
    'status', v_completed_task.status,
    'assignee', v_completed_task.assignee,
    'workspace_id', v_completed_task.workspace_id,
    'lifecycle', 'pm_acceptance_pass'
  );
exception
  when others then
    -- Existing governed functions retain their Cloud checks.  Translate the
    -- known gate failures at this boundary so PM can act without reading
    -- SQLSTATE or internal English error text.  Re-raising aborts the whole
    -- transaction, including a possible qa/GPT -> qa/QJC pretransition.
    if SQLERRM ilike '%Co Developer QA Evidence%' then
      raise exception using
        errcode = '42501',
        message = 'PM Acceptance 尚缺 Co 開發驗證 Evidence；卡片未移動，正式狀態不變。';
    elsif SQLERRM ilike '%GPT Review evidence%' then
      raise exception using
        errcode = '42501',
        message = 'PM Acceptance 尚缺 GPT 工程審查 Evidence；卡片未移動，正式狀態不變。';
    elsif SQLERRM ilike '%GPT Review and Regression evidence%' then
      raise exception using
        errcode = '42501',
        message = 'PM Acceptance 尚缺 GPT 工程審查或 Regression Evidence；卡片未移動，正式狀態不變。';
    elsif SQLERRM ilike '%Regression evidence%' then
      raise exception using
        errcode = '42501',
        message = 'PM Acceptance 尚缺 Regression Evidence；卡片未移動，正式狀態不變。';
    elsif SQLERRM ilike '%Co/QJC engineering evidence%' then
      raise exception using
        errcode = '42501',
        message = 'PM Acceptance 的 Co／QJC 必要 Evidence 尚未完整；卡片未移動，正式狀態不變。';
    else
      raise;
    end if;
end;
$function$;

revoke all on function public.board_pm_acceptance_from_qjc_drop(uuid, uuid, text, text) from public, anon;
grant execute on function public.board_pm_acceptance_from_qjc_drop(uuid, uuid, text, text) to authenticated;

comment on function public.board_pm_acceptance_from_qjc_drop(uuid, uuid, text, text) is
  'Controlled PM Acceptance from the visible QJC workspace; composes qa/GPT -> qa/QJC and the existing PM Acceptance contract atomically, while keeping generic done transitions closed.';

commit;
