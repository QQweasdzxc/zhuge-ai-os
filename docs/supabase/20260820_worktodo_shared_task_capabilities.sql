-- WorkTodo Shared Task UX capability foundation.
-- Domain boundary: this migration extends public.user_tasks and
-- public.work_journal_entries only for WorkTodo.  It does not reuse AI Board
-- tables, IDs, RPCs, or storage objects.
BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.worktodo_wltk_seq AS bigint START WITH 1 INCREMENT BY 1;

ALTER TABLE public.user_tasks
  ADD COLUMN IF NOT EXISTS work_code text,
  ADD COLUMN IF NOT EXISTS usage_scenario text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS gpt_understanding text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS gpt_analysis text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS gpt_recommendation text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS gpt_execution_principles text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS gpt_handoff_summary text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS archive_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid;

UPDATE public.user_tasks
SET work_code = 'WLTK-' || lpad(nextval('public.worktodo_wltk_seq')::text, 3, '0')
WHERE work_code IS NULL OR btrim(work_code) = '';

CREATE UNIQUE INDEX IF NOT EXISTS user_tasks_work_code_uidx
  ON public.user_tasks (work_code)
  WHERE work_code IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_tasks_work_code_format_ck'
      AND conrelid = 'public.user_tasks'::regclass
  ) THEN
    ALTER TABLE public.user_tasks
      ADD CONSTRAINT user_tasks_work_code_format_ck
      CHECK (work_code ~ '^WLTK-[0-9]{3,}$');
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.worktodo_assign_work_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.work_code IS NULL OR btrim(NEW.work_code) = '' THEN
    NEW.work_code := 'WLTK-' || lpad(nextval('public.worktodo_wltk_seq')::text, 3, '0');
  ELSIF NEW.work_code !~ '^WLTK-[0-9]{3,}$' THEN
    RAISE EXCEPTION 'WorkTodo identity must use WLTK namespace';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS worktodo_assign_work_code_before_write ON public.user_tasks;
CREATE TRIGGER worktodo_assign_work_code_before_write
BEFORE INSERT ON public.user_tasks
FOR EACH ROW EXECUTE FUNCTION public.worktodo_assign_work_code();

CREATE OR REPLACE FUNCTION public.worktodo_apply_completion_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status = 'completed' AND (TG_OP = 'INSERT' OR COALESCE(OLD.status, '') <> 'completed') THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
    NEW.archive_due_at := NEW.completed_at + interval '48 hours';
    NEW.archived_at := NULL;
    NEW.archived_by := NULL;
  ELSIF NEW.status = 'completed' AND NEW.archived_at IS NULL AND NEW.archive_due_at IS NULL AND NEW.completed_at IS NOT NULL THEN
    NEW.archive_due_at := NEW.completed_at + interval '48 hours';
  ELSIF TG_OP = 'UPDATE' AND COALESCE(OLD.status, '') = 'completed' AND NEW.status <> 'completed' THEN
    NEW.archive_due_at := NULL;
    NEW.archived_at := NULL;
    NEW.archived_by := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS worktodo_completion_lifecycle_before_write ON public.user_tasks;
CREATE TRIGGER worktodo_completion_lifecycle_before_write
BEFORE INSERT OR UPDATE OF status, completed_at, archive_due_at, archived_at ON public.user_tasks
FOR EACH ROW EXECUTE FUNCTION public.worktodo_apply_completion_lifecycle();

CREATE INDEX IF NOT EXISTS user_tasks_worktodo_archive_due_idx
  ON public.user_tasks (archive_due_at)
  WHERE deleted_at IS NULL AND status = 'completed' AND archived_at IS NULL;

ALTER TABLE public.work_journal_entries
  ADD COLUMN IF NOT EXISTS revision_of uuid,
  ADD COLUMN IF NOT EXISTS tombstone_of uuid,
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'active';

UPDATE public.work_journal_entries
SET lifecycle_status = 'active'
WHERE lifecycle_status IS NULL OR btrim(lifecycle_status) = '';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'work_journal_entries_lifecycle_status_ck'
      AND conrelid = 'public.work_journal_entries'::regclass
  ) THEN
    ALTER TABLE public.work_journal_entries
      ADD CONSTRAINT work_journal_entries_lifecycle_status_ck
      CHECK (lifecycle_status IN ('active', 'superseded', 'tombstoned', 'tombstone'));
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'work_journal_entries_revision_fk'
      AND conrelid = 'public.work_journal_entries'::regclass
  ) THEN
    ALTER TABLE public.work_journal_entries
      ADD CONSTRAINT work_journal_entries_revision_fk
      FOREIGN KEY (revision_of) REFERENCES public.work_journal_entries(id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'work_journal_entries_tombstone_fk'
      AND conrelid = 'public.work_journal_entries'::regclass
  ) THEN
    ALTER TABLE public.work_journal_entries
      ADD CONSTRAINT work_journal_entries_tombstone_fk
      FOREIGN KEY (tombstone_of) REFERENCES public.work_journal_entries(id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS work_journal_entries_revision_idx
  ON public.work_journal_entries (revision_of)
  WHERE revision_of IS NOT NULL;
CREATE INDEX IF NOT EXISTS work_journal_entries_tombstone_idx
  ON public.work_journal_entries (tombstone_of)
  WHERE tombstone_of IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.worktodo_checklist_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_uuid uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_uuid uuid NOT NULL REFERENCES public.user_tasks(id) ON DELETE RESTRICT,
  label text NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  updated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX IF NOT EXISTS worktodo_checklist_task_idx
  ON public.worktodo_checklist_items (task_uuid, sort_order, created_at)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.worktodo_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_uuid uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  task_uuid uuid NOT NULL REFERENCES public.user_tasks(id) ON DELETE RESTRICT,
  journal_entry_uuid uuid REFERENCES public.work_journal_entries(id) ON DELETE RESTRICT,
  attachment_scope text NOT NULL DEFAULT 'task',
  filename text NOT NULL,
  mime_type text NOT NULL DEFAULT 'application/octet-stream',
  byte_size bigint NOT NULL DEFAULT 0,
  storage_bucket text NOT NULL DEFAULT 'worktodo-attachments',
  storage_path text NOT NULL,
  upload_status text NOT NULL DEFAULT 'uploading',
  created_by uuid NOT NULL REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  deletion_status text NOT NULL DEFAULT 'active',
  deleted_at timestamptz,
  deleted_by uuid REFERENCES auth.users(id),
  CONSTRAINT worktodo_attachments_scope_ck CHECK (
    (attachment_scope = 'task' AND journal_entry_uuid IS NULL)
    OR (attachment_scope = 'progress_note' AND journal_entry_uuid IS NOT NULL)
  ),
  CONSTRAINT worktodo_attachments_upload_status_ck CHECK (upload_status IN ('uploading', 'ready', 'failed')),
  CONSTRAINT worktodo_attachments_deletion_status_ck CHECK (deletion_status IN ('active', 'deleting', 'deleted'))
);

CREATE INDEX IF NOT EXISTS worktodo_attachments_task_idx
  ON public.worktodo_attachments (task_uuid, created_at)
  WHERE deletion_status = 'active' AND upload_status = 'ready';
CREATE INDEX IF NOT EXISTS worktodo_attachments_journal_idx
  ON public.worktodo_attachments (journal_entry_uuid)
  WHERE deletion_status = 'active' AND upload_status = 'ready';

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('worktodo-attachments', 'worktodo-attachments', false, 26214400)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.worktodo_checklist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.worktodo_attachments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS worktodo_checklist_select_own ON public.worktodo_checklist_items;
CREATE POLICY worktodo_checklist_select_own
ON public.worktodo_checklist_items FOR SELECT TO authenticated
USING (user_uuid = auth.uid() AND deleted_at IS NULL);

DROP POLICY IF EXISTS worktodo_attachment_select_own ON public.worktodo_attachments;
CREATE POLICY worktodo_attachment_select_own
ON public.worktodo_attachments FOR SELECT TO authenticated
USING (user_uuid = auth.uid() AND upload_status = 'ready' AND deletion_status = 'active');

REVOKE INSERT, UPDATE, DELETE ON public.worktodo_checklist_items FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.worktodo_attachments FROM anon, authenticated;
GRANT SELECT ON public.worktodo_checklist_items, public.worktodo_attachments TO authenticated;
GRANT USAGE ON SEQUENCE public.worktodo_wltk_seq TO authenticated;
REVOKE ALL ON SEQUENCE public.worktodo_wltk_seq FROM anon, public;

DROP POLICY IF EXISTS worktodo_attachment_storage_select ON storage.objects;
CREATE POLICY worktodo_attachment_storage_select
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'worktodo-attachments'
  AND EXISTS (
    SELECT 1 FROM public.worktodo_attachments a
    WHERE a.storage_bucket = bucket_id
      AND a.storage_path = name
      AND a.user_uuid = auth.uid()
      AND a.upload_status = 'ready'
      AND a.deletion_status = 'active'
  )
);

DROP POLICY IF EXISTS worktodo_attachment_storage_insert ON storage.objects;
CREATE POLICY worktodo_attachment_storage_insert
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'worktodo-attachments'
  AND EXISTS (
    SELECT 1 FROM public.worktodo_attachments a
    WHERE a.storage_bucket = bucket_id
      AND a.storage_path = name
      AND a.user_uuid = auth.uid()
      AND a.created_by = auth.uid()
      AND a.upload_status = 'uploading'
  )
);

DROP POLICY IF EXISTS worktodo_attachment_storage_delete ON storage.objects;
CREATE POLICY worktodo_attachment_storage_delete
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'worktodo-attachments'
  AND EXISTS (
    SELECT 1 FROM public.worktodo_attachments a
    WHERE a.storage_bucket = bucket_id
      AND a.storage_path = name
      AND a.user_uuid = auth.uid()
      AND a.deletion_status = 'deleting'
  )
);

CREATE OR REPLACE FUNCTION public.worktodo_add_progress_note(
  p_task_id uuid,
  p_content text,
  p_entry_type text DEFAULT 'progress',
  p_status text DEFAULT NULL,
  p_progress integer DEFAULT 0,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS SETOF public.work_journal_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.work_journal_entries;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NULLIF(btrim(p_content), '') IS NULL THEN RAISE EXCEPTION 'Progress note cannot be empty'; END IF;
  IF p_entry_type NOT IN ('progress', 'completion', 'note') THEN RAISE EXCEPTION 'Unsupported WorkTodo journal entry type'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_tasks WHERE id = p_task_id AND user_uuid = auth.uid() AND deleted_at IS NULL AND archived_at IS NULL) THEN
    RAISE EXCEPTION 'WorkTodo task is not available to the current user';
  END IF;
  INSERT INTO public.work_journal_entries (
    user_uuid, task_uuid, entry_type, content, status, progress, metadata,
    created_by, created_at, updated_at, lifecycle_status
  ) VALUES (
    auth.uid(), p_task_id, p_entry_type, btrim(p_content), p_status,
    greatest(0, least(100, coalesce(p_progress, 0))), coalesce(p_metadata, '{}'::jsonb),
    auth.uid(), now(), now(), 'active'
  ) RETURNING * INTO v_row;
  RETURN NEXT v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.worktodo_edit_progress_note(
  p_entry_id uuid,
  p_content text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS SETOF public.work_journal_entries
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old public.work_journal_entries;
  v_row public.work_journal_entries;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NULLIF(btrim(p_content), '') IS NULL THEN RAISE EXCEPTION 'Progress note cannot be empty'; END IF;
  SELECT * INTO v_old FROM public.work_journal_entries
  WHERE id = p_entry_id AND user_uuid = auth.uid() AND lifecycle_status = 'active'
    AND entry_type IN ('progress', 'completion', 'note')
    AND (created_by IS NULL OR created_by = auth.uid())
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Progress note is not editable by the current user'; END IF;
  UPDATE public.work_journal_entries
  SET lifecycle_status = 'superseded', updated_at = now()
  WHERE id = v_old.id;
  INSERT INTO public.work_journal_entries (
    user_uuid, task_uuid, entry_type, content, status, progress, work_entry_uuid,
    metadata, created_by, created_at, updated_at, revision_of, lifecycle_status
  ) VALUES (
    auth.uid(), v_old.task_uuid, v_old.entry_type, btrim(p_content), v_old.status,
    v_old.progress, v_old.work_entry_uuid,
    coalesce(v_old.metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('revisionSource', v_old.id),
    auth.uid(), now(), now(), v_old.id, 'active'
  ) RETURNING * INTO v_row;
  UPDATE public.worktodo_attachments
  SET journal_entry_uuid = v_row.id
  WHERE journal_entry_uuid = v_old.id AND deletion_status = 'active';
  RETURN NEXT v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.worktodo_delete_progress_note(p_entry_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_old public.work_journal_entries;
  v_tombstone uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  SELECT * INTO v_old FROM public.work_journal_entries
  WHERE id = p_entry_id AND user_uuid = auth.uid() AND lifecycle_status = 'active'
    AND entry_type IN ('progress', 'completion', 'note')
    AND (created_by IS NULL OR created_by = auth.uid())
  FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Progress note is not removable by the current user'; END IF;
  UPDATE public.work_journal_entries
  SET lifecycle_status = 'tombstoned', updated_at = now()
  WHERE id = v_old.id;
  INSERT INTO public.work_journal_entries (
    user_uuid, task_uuid, entry_type, content, status, progress, metadata,
    created_by, created_at, updated_at, tombstone_of, lifecycle_status
  ) VALUES (
    auth.uid(), v_old.task_uuid, 'system_activity', '工作進度已撤回', v_old.status, v_old.progress,
    jsonb_build_object('event', 'worktodo_progress_note_tombstone', 'sourceEntryId', v_old.id),
    auth.uid(), now(), now(), v_old.id, 'tombstone'
  ) RETURNING id INTO v_tombstone;
  RETURN jsonb_build_object('tombstoned_id', v_old.id, 'audit_id', v_tombstone);
END;
$$;

CREATE OR REPLACE FUNCTION public.worktodo_add_checklist_item(
  p_task_id uuid,
  p_label text,
  p_sort_order integer DEFAULT 0
)
RETURNS SETOF public.worktodo_checklist_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_row public.worktodo_checklist_items;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NULLIF(btrim(p_label), '') IS NULL THEN RAISE EXCEPTION 'Checklist label cannot be empty'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_tasks WHERE id = p_task_id AND user_uuid = auth.uid() AND deleted_at IS NULL AND archived_at IS NULL) THEN RAISE EXCEPTION 'WorkTodo task is not available to the current user'; END IF;
  INSERT INTO public.worktodo_checklist_items (user_uuid, task_uuid, label, sort_order, created_by, updated_by)
  VALUES (auth.uid(), p_task_id, btrim(p_label), coalesce(p_sort_order, 0), auth.uid(), auth.uid())
  RETURNING * INTO v_row;
  INSERT INTO public.work_journal_entries (user_uuid, task_uuid, entry_type, content, metadata, created_by, created_at, updated_at, lifecycle_status)
  VALUES (auth.uid(), p_task_id, 'system_activity', 'Checklist 已新增', jsonb_build_object('event','checklist_created','checklistId',v_row.id), auth.uid(), now(), now(), 'active');
  RETURN NEXT v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.worktodo_update_checklist_item(
  p_item_id uuid,
  p_label text DEFAULT NULL,
  p_completed boolean DEFAULT NULL,
  p_sort_order integer DEFAULT NULL
)
RETURNS SETOF public.worktodo_checklist_items
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_row public.worktodo_checklist_items;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  UPDATE public.worktodo_checklist_items
  SET label = coalesce(NULLIF(btrim(p_label), ''), label),
      completed = coalesce(p_completed, completed),
      sort_order = coalesce(p_sort_order, sort_order),
      updated_by = auth.uid(), updated_at = now()
  WHERE id = p_item_id AND user_uuid = auth.uid() AND deleted_at IS NULL
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Checklist item is not editable by the current user'; END IF;
  INSERT INTO public.work_journal_entries (user_uuid, task_uuid, entry_type, content, metadata, created_by, created_at, updated_at, lifecycle_status)
  VALUES (auth.uid(), v_row.task_uuid, 'system_activity', 'Checklist 已更新', jsonb_build_object('event','checklist_updated','checklistId',v_row.id,'completed',v_row.completed), auth.uid(), now(), now(), 'active');
  RETURN NEXT v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.worktodo_delete_checklist_item(p_item_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_row public.worktodo_checklist_items;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  UPDATE public.worktodo_checklist_items
  SET deleted_at = now(), updated_by = auth.uid(), updated_at = now()
  WHERE id = p_item_id AND user_uuid = auth.uid() AND deleted_at IS NULL
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Checklist item is not removable by the current user'; END IF;
  INSERT INTO public.work_journal_entries (user_uuid, task_uuid, entry_type, content, metadata, created_by, created_at, updated_at, lifecycle_status)
  VALUES (auth.uid(), v_row.task_uuid, 'system_activity', 'Checklist 已移除', jsonb_build_object('event','checklist_deleted','checklistId',v_row.id), auth.uid(), now(), now(), 'active');
  RETURN jsonb_build_object('deleted_id', v_row.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.worktodo_prepare_attachment(
  p_task_id uuid,
  p_filename text,
  p_mime_type text DEFAULT 'application/octet-stream',
  p_byte_size bigint DEFAULT 0,
  p_attachment_scope text DEFAULT 'task',
  p_journal_entry_id uuid DEFAULT NULL
)
RETURNS SETOF public.worktodo_attachments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.worktodo_attachments;
  v_name text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NULLIF(btrim(p_filename), '') IS NULL THEN RAISE EXCEPTION 'Attachment filename cannot be empty'; END IF;
  IF p_attachment_scope NOT IN ('task', 'progress_note') THEN RAISE EXCEPTION 'Unsupported WorkTodo attachment scope'; END IF;
  IF p_attachment_scope = 'progress_note' AND p_journal_entry_id IS NULL THEN RAISE EXCEPTION 'Progress note attachment requires a journal entry'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.user_tasks WHERE id = p_task_id AND user_uuid = auth.uid() AND deleted_at IS NULL AND archived_at IS NULL) THEN RAISE EXCEPTION 'WorkTodo task is not available to the current user'; END IF;
  IF p_journal_entry_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.work_journal_entries WHERE id = p_journal_entry_id AND task_uuid = p_task_id AND user_uuid = auth.uid() AND lifecycle_status = 'active') THEN RAISE EXCEPTION 'Progress note is not available to the current user'; END IF;
  v_name := regexp_replace(left(btrim(p_filename), 180), '[^a-zA-Z0-9._-]+', '-', 'g');
  v_name := coalesce(nullif(v_name, ''), 'attachment');
  INSERT INTO public.worktodo_attachments (
    user_uuid, task_uuid, journal_entry_uuid, attachment_scope, filename,
    mime_type, byte_size, storage_bucket, storage_path, upload_status, created_by
  ) VALUES (
    auth.uid(), p_task_id, p_journal_entry_id, p_attachment_scope, btrim(p_filename),
    coalesce(nullif(p_mime_type, ''), 'application/octet-stream'), greatest(0, coalesce(p_byte_size, 0)),
    'worktodo-attachments', auth.uid()::text || '/' || p_task_id::text || '/' || gen_random_uuid()::text || '-' || v_name,
    'uploading', auth.uid()
  ) RETURNING * INTO v_row;
  RETURN NEXT v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.worktodo_complete_attachment(p_attachment_id uuid)
RETURNS SETOF public.worktodo_attachments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_row public.worktodo_attachments;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.objects o JOIN public.worktodo_attachments a ON a.storage_bucket = o.bucket_id AND a.storage_path = o.name WHERE a.id = p_attachment_id AND a.user_uuid = auth.uid()) THEN
    RAISE EXCEPTION 'Attachment object has not reached Cloud Storage';
  END IF;
  UPDATE public.worktodo_attachments
  SET upload_status = 'ready', completed_at = coalesce(completed_at, now())
  WHERE id = p_attachment_id AND user_uuid = auth.uid() AND upload_status = 'uploading' AND deletion_status = 'active'
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attachment is not completable by the current user'; END IF;
  INSERT INTO public.work_journal_entries (user_uuid, task_uuid, entry_type, content, metadata, created_by, created_at, updated_at, lifecycle_status)
  VALUES (auth.uid(), v_row.task_uuid, 'system_activity', '附件已上傳', jsonb_build_object('event','attachment_uploaded','attachmentId',v_row.id,'scope',v_row.attachment_scope), auth.uid(), now(), now(), 'active');
  RETURN NEXT v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.worktodo_request_attachment_delete(p_attachment_id uuid)
RETURNS SETOF public.worktodo_attachments
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_row public.worktodo_attachments;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  UPDATE public.worktodo_attachments
  SET deletion_status = 'deleting'
  WHERE id = p_attachment_id AND user_uuid = auth.uid() AND deletion_status = 'active'
    AND EXISTS (SELECT 1 FROM public.user_tasks t WHERE t.id = task_uuid AND t.archived_at IS NULL AND t.deleted_at IS NULL)
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attachment is not deletable by the current user'; END IF;
  RETURN NEXT v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.worktodo_finalize_attachment_delete(p_attachment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE v_row public.worktodo_attachments;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF EXISTS (SELECT 1 FROM storage.objects o JOIN public.worktodo_attachments a ON a.storage_bucket = o.bucket_id AND a.storage_path = o.name WHERE a.id = p_attachment_id AND a.user_uuid = auth.uid()) THEN
    RAISE EXCEPTION 'Attachment object still exists in Cloud Storage';
  END IF;
  UPDATE public.worktodo_attachments
  SET deletion_status = 'deleted', deleted_at = now(), deleted_by = auth.uid()
  WHERE id = p_attachment_id AND user_uuid = auth.uid() AND deletion_status = 'deleting'
  RETURNING * INTO v_row;
  IF NOT FOUND THEN RAISE EXCEPTION 'Attachment deletion is not finalizable by the current user'; END IF;
  INSERT INTO public.work_journal_entries (user_uuid, task_uuid, entry_type, content, metadata, created_by, created_at, updated_at, lifecycle_status)
  VALUES (auth.uid(), v_row.task_uuid, 'system_activity', '附件已刪除', jsonb_build_object('event','attachment_deleted','attachmentId',v_row.id), auth.uid(), now(), now(), 'active');
  RETURN jsonb_build_object('deleted_id', v_row.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.worktodo_reconcile_completion_lifecycle()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.user_tasks;
  v_count integer := 0;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  FOR v_row IN
    SELECT * FROM public.user_tasks
    WHERE user_uuid = auth.uid() AND deleted_at IS NULL AND status = 'completed'
      AND archived_at IS NULL AND archive_due_at IS NOT NULL AND archive_due_at <= now()
    FOR UPDATE
  LOOP
    UPDATE public.user_tasks
    SET archived_at = now(), archived_by = auth.uid(), updated_at = now()
    WHERE id = v_row.id AND archived_at IS NULL;
    IF FOUND THEN
      INSERT INTO public.work_journal_entries (user_uuid, task_uuid, entry_type, content, metadata, created_by, created_at, updated_at, lifecycle_status)
      VALUES (auth.uid(), v_row.id, 'system_activity', '待辦事項已自動封存', jsonb_build_object('event','worktodo_auto_archived','archiveDueAt',v_row.archive_due_at), auth.uid(), now(), now(), 'active');
      v_count := v_count + 1;
    END IF;
  END LOOP;
  RETURN jsonb_build_object('archived_count', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.worktodo_add_progress_note(uuid, text, text, text, integer, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.worktodo_edit_progress_note(uuid, text, jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.worktodo_delete_progress_note(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.worktodo_add_checklist_item(uuid, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.worktodo_update_checklist_item(uuid, text, boolean, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.worktodo_delete_checklist_item(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.worktodo_prepare_attachment(uuid, text, text, bigint, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.worktodo_complete_attachment(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.worktodo_request_attachment_delete(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.worktodo_finalize_attachment_delete(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.worktodo_reconcile_completion_lifecycle() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.worktodo_add_progress_note(uuid, text, text, text, integer, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.worktodo_edit_progress_note(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.worktodo_delete_progress_note(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.worktodo_add_checklist_item(uuid, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.worktodo_update_checklist_item(uuid, text, boolean, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.worktodo_delete_checklist_item(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.worktodo_prepare_attachment(uuid, text, text, bigint, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.worktodo_complete_attachment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.worktodo_request_attachment_delete(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.worktodo_finalize_attachment_delete(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.worktodo_reconcile_completion_lifecycle() TO authenticated;

-- The general WorkTodo Journal now follows the same controlled revision / tombstone
-- boundary as the AI Board.  Reads remain direct under the existing owner policy.
REVOKE INSERT, UPDATE, DELETE ON public.work_journal_entries FROM anon, authenticated;
GRANT SELECT ON public.work_journal_entries TO authenticated;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'worktodo_checklist_items'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.worktodo_checklist_items;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'worktodo_attachments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.worktodo_attachments;
  END IF;
END $$;

COMMIT;
