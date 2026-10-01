-- WorkTodo Task Properties: canonical task-level property and estimate.
-- This extends WorkTodo only; it does not reuse AI Board workspace data or
-- change WorkTodo Calendar, Auth, Identity, or lifecycle semantics.
BEGIN;

ALTER TABLE public.user_tasks
  ADD COLUMN IF NOT EXISTS work_property text NOT NULL DEFAULT '';

COMMENT ON COLUMN public.user_tasks.work_property IS
  'WorkTodo task-level 工作屬性. This is distinct from user_work_models.category.';

CREATE OR REPLACE FUNCTION public.worktodo_update_task_properties(
  p_task_id uuid,
  p_patch jsonb
)
RETURNS SETOF public.user_tasks
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_task public.user_tasks;
  v_work_property text;
  v_estimated_minutes integer;
  v_updates jsonb := '{}'::jsonb;
  v_changes jsonb := '{}'::jsonb;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_patch IS NULL OR jsonb_typeof(p_patch) <> 'object' THEN
    RAISE EXCEPTION 'Task property patch must be a JSON object';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_object_keys(p_patch) AS keys(name)
    WHERE keys.name NOT IN ('work_property', 'estimated_minutes')
  ) THEN
    RAISE EXCEPTION 'Unsupported WorkTodo task property';
  END IF;

  SELECT * INTO v_task
  FROM public.user_tasks
  WHERE id = p_task_id
    AND user_uuid = auth.uid()
    AND deleted_at IS NULL
    AND archived_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'WorkTodo task is not editable by the current user';
  END IF;

  IF p_patch ? 'work_property' THEN
    IF p_patch->'work_property' IS NULL OR jsonb_typeof(p_patch->'work_property') = 'null' THEN
      v_work_property := '';
    ELSIF jsonb_typeof(p_patch->'work_property') <> 'string' THEN
      RAISE EXCEPTION 'WorkTodo 工作屬性 must be text';
    ELSE
      v_work_property := btrim(p_patch->>'work_property');
    END IF;
    IF length(v_work_property) > 120 THEN
      RAISE EXCEPTION 'WorkTodo 工作屬性不可超過 120 字元';
    END IF;
    IF v_work_property IS DISTINCT FROM coalesce(v_task.work_property, '') THEN
      v_updates := v_updates || jsonb_build_object('work_property', coalesce(v_work_property, ''));
      v_changes := v_changes || jsonb_build_object(
        'work_property', jsonb_build_object(
          'from', coalesce(v_task.work_property, ''),
          'to', coalesce(v_work_property, '')
        )
      );
    END IF;
  END IF;

  IF p_patch ? 'estimated_minutes' THEN
    IF p_patch->'estimated_minutes' IS NULL OR jsonb_typeof(p_patch->'estimated_minutes') = 'null' THEN
      v_estimated_minutes := NULL;
    ELSIF jsonb_typeof(p_patch->'estimated_minutes') <> 'number'
      OR (p_patch->>'estimated_minutes') !~ '^[0-9]+$' THEN
      RAISE EXCEPTION '預估時間必須是非負整數分鐘';
    ELSE
      v_estimated_minutes := (p_patch->>'estimated_minutes')::integer;
    END IF;
    IF v_estimated_minutes IS DISTINCT FROM v_task.estimated_minutes THEN
      v_updates := v_updates || jsonb_build_object('estimated_minutes', v_estimated_minutes);
      v_changes := v_changes || jsonb_build_object(
        'estimated_minutes', jsonb_build_object(
          'from', v_task.estimated_minutes,
          'to', v_estimated_minutes
        )
      );
    END IF;
  END IF;

  IF v_updates = '{}'::jsonb THEN
    RETURN NEXT v_task;
    RETURN;
  END IF;

  UPDATE public.user_tasks
  SET work_property = CASE
        WHEN v_updates ? 'work_property' THEN v_updates->>'work_property'
        ELSE work_property
      END,
      estimated_minutes = CASE
        WHEN v_updates ? 'estimated_minutes' THEN (v_updates->>'estimated_minutes')::integer
        ELSE estimated_minutes
      END,
      updated_at = now()
  WHERE id = v_task.id
  RETURNING * INTO v_task;

  INSERT INTO public.work_journal_entries (
    user_uuid,
    task_uuid,
    entry_type,
    content,
    status,
    progress,
    metadata,
    created_by,
    created_at,
    updated_at,
    lifecycle_status
  ) VALUES (
    auth.uid(),
    v_task.id,
    'system_activity',
    'WorkTodo 工作屬性已更新',
    v_task.status,
    v_task.progress,
    jsonb_build_object(
      'event', 'worktodo_task_properties_updated',
      'taskId', v_task.id,
      'changes', v_changes
    ),
    auth.uid(),
    now(),
    now(),
    'active'
  );

  RETURN NEXT v_task;
END;
$$;

REVOKE ALL ON FUNCTION public.worktodo_update_task_properties(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.worktodo_update_task_properties(uuid, jsonb) TO authenticated;

COMMENT ON FUNCTION public.worktodo_update_task_properties(uuid, jsonb) IS
  'Controlled authenticated WorkTodo update for task-level 工作屬性 and 預估時間; writes an auditable system activity.';

COMMIT;
