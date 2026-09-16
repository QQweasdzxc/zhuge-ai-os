-- TASK-064 / STEP 8 Item 3
-- Keep checklist and engineering-evidence capture in this RPC.  PM Acceptance
-- movement, completion, requeue, and archive lifecycle decisions belong to
-- the already-formal C routes and must not be side effects of this adapter.

begin;

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

  -- Keep the existing relationship/existence guard, but do not write the
  -- related board task here.  The task row is not a lifecycle output of this
  -- checklist evidence adapter.
  perform 1
  from public.board_tasks
  where id = v_current_item.task_id;
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

  return v_updated_item;
end;
$function$;

-- Preserve the existing application boundary.  CREATE OR REPLACE does not
-- change the existing service_role privilege; no role surface is broadened.
revoke all on function public.board_update_checklist_item(uuid, text, text, text, text, text)
  from public, anon;
grant execute on function public.board_update_checklist_item(uuid, text, text, text, text, text)
  to authenticated;

comment on function public.board_update_checklist_item(uuid, text, text, text, text, text) is
  'Checklist and engineering evidence adapter only. PM Acceptance movement, completion, requeue, and archive lifecycle decisions must use the formal C contract; this function does not write board_tasks lifecycle fields.';

notify pgrst, 'reload schema';

commit;
