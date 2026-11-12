-- Candidate only. No historical backfill, enrollment, deployment or activation.
BEGIN;
ALTER TABLE public.work_entries
 ADD COLUMN IF NOT EXISTS date_only boolean NOT NULL DEFAULT false,
 ADD COLUMN IF NOT EXISTS taskflow_issue_ref jsonb,
 ADD COLUMN IF NOT EXISTS taskflow_hours_adjusted boolean NOT NULL DEFAULT false;
ALTER TABLE public.work_entries ALTER COLUMN started_at DROP NOT NULL;
ALTER TABLE public.work_entries ALTER COLUMN ended_at DROP NOT NULL;
ALTER TABLE public.work_entries DROP CONSTRAINT IF EXISTS work_entries_time_check;
ALTER TABLE public.work_entries ADD CONSTRAINT work_entries_time_check CHECK
 ((date_only AND started_at IS NULL AND ended_at IS NULL AND taskflow_issue_ref IS NOT NULL)
  OR (NOT date_only AND started_at IS NOT NULL AND ended_at IS NOT NULL AND started_at<ended_at));
CREATE UNIQUE INDEX IF NOT EXISTS work_entries_native_date_identity ON public.work_entries
 (user_uuid,(taskflow_issue_ref->>'workspaceId'),(taskflow_issue_ref->>'id'),work_date)
 WHERE date_only AND deleted_at IS NULL AND status<>'deleted';
CREATE TABLE IF NOT EXISTS public.worklog_task_date_enrollments(
 user_uuid uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
 workspace_uuid uuid NOT NULL,
 enabled boolean NOT NULL DEFAULT true,
 effective_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_uuid,workspace_uuid)
);
ALTER TABLE public.worklog_task_date_enrollments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.worklog_task_date_enrollments FROM PUBLIC,anon,authenticated;
-- Enrollment is an explicit rollout action, never a side effect of reading.
CREATE OR REPLACE FUNCTION public.worklog_enable_task_dates(p_workspace uuid)
RETURNS timestamptz LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE effective timestamptz;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_app_access_approved() OR NOT EXISTS(SELECT 1 FROM taskflow.member WHERE user_id=auth.uid() AND workspace_id=p_workspace AND role='owner') THEN
  RAISE EXCEPTION 'Current owner workspace required' USING ERRCODE='42501';
 END IF;
 INSERT INTO public.worklog_task_date_enrollments(user_uuid,workspace_uuid)
 VALUES(auth.uid(),p_workspace) ON CONFLICT(user_uuid,workspace_uuid) DO UPDATE SET enabled=true
 RETURNING effective_at INTO effective;
 RETURN effective;
END $$;
REVOKE ALL ON FUNCTION public.worklog_enable_task_dates(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.worklog_enable_task_dates(uuid) TO authenticated;
CREATE OR REPLACE FUNCTION public.worklog_task_dates_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE owner_row record; entry_row record; marker record; desired_dates date[]; claimed_ids uuid[]; active_ids uuid[]; chosen uuid; link text; ref jsonb; ecp text; allow_new boolean;
BEGIN
 IF TG_OP='DELETE' THEN
  UPDATE public.work_entries SET status='deleted',deleted_at=now(),google_delete_requested_at=now()
   WHERE date_only AND taskflow_issue_ref->>'id'=OLD.id::text AND taskflow_issue_ref->>'workspaceId'=OLD.workspace_id::text
    AND user_uuid IN(SELECT user_uuid FROM public.worklog_task_date_enrollments WHERE workspace_uuid=OLD.workspace_id AND enabled)
    AND status<>'deleted';
  RETURN OLD;
 END IF;
 IF TG_OP='UPDATE' AND OLD.start_date IS NOT DISTINCT FROM NEW.start_date AND OLD.due_date IS NOT DISTINCT FROM NEW.due_date AND OLD.title IS NOT DISTINCT FROM NEW.title THEN RETURN NEW; END IF;
 allow_new := TG_OP='INSERT';
 IF TG_OP='UPDATE' THEN allow_new := OLD.start_date IS DISTINCT FROM NEW.start_date OR OLD.due_date IS DISTINCT FROM NEW.due_date; END IF;
 SELECT '/'||w.slug||'/issues/'||NEW.id::text INTO link FROM taskflow.workspace w WHERE w.id=NEW.workspace_id;
 desired_dates:=ARRAY(SELECT DISTINCT d FROM unnest(ARRAY[NEW.start_date,NEW.due_date]) d WHERE d IS NOT NULL ORDER BY d);
 FOR owner_row IN SELECT e.* FROM public.worklog_task_date_enrollments e JOIN taskflow.member m
  ON m.user_id=e.user_uuid AND m.workspace_id=e.workspace_uuid AND m.role='owner'
  WHERE e.workspace_uuid=NEW.workspace_id AND e.enabled AND e.effective_at<=now()
 LOOP
  -- Lock stable existing source rows before any date rearrangement; preserve manual duration.
  PERFORM 1 FROM public.work_entries WHERE user_uuid=owner_row.user_uuid AND date_only
    AND taskflow_issue_ref->>'id'=NEW.id::text AND taskflow_issue_ref->>'workspaceId'=NEW.workspace_id::text FOR UPDATE;
  SELECT coalesce(array_agg(id),ARRAY[]::uuid[]) INTO active_ids FROM public.work_entries WHERE user_uuid=owner_row.user_uuid AND date_only
    AND taskflow_issue_ref->>'id'=NEW.id::text AND taskflow_issue_ref->>'workspaceId'=NEW.workspace_id::text AND status<>'deleted' AND deleted_at IS NULL;
  -- Temporarily release only this source's active unique keys inside the same
  -- statement transaction so swapped/adjacent endpoint moves preserve row IDs.
  UPDATE public.work_entries SET status='deleted' WHERE id=ANY(active_ids);
  claimed_ids:=ARRAY[]::uuid[];
  SELECT name INTO ecp FROM public.user_ecp_tasks WHERE user_uuid=owner_row.user_uuid AND is_active
    ORDER BY sort_order,name LIMIT 1;
  SELECT coalesce((SELECT nullif(default_task,'') FROM public.user_work_profiles WHERE user_uuid=owner_row.user_uuid LIMIT 1),ecp) INTO ecp;
  FOR marker IN SELECT d AS work_date,CASE WHEN d=NEW.start_date AND d=NEW.due_date THEN 'both' WHEN d=NEW.start_date THEN 'start' ELSE 'due' END AS kind FROM unnest(desired_dates) d
  LOOP
   chosen:=NULL;
   -- Same-day records win, then same endpoint when its date moves. Never title match.
   SELECT id INTO chosen FROM public.work_entries WHERE user_uuid=owner_row.user_uuid AND date_only
    AND taskflow_issue_ref->>'id'=NEW.id::text AND taskflow_issue_ref->>'workspaceId'=NEW.workspace_id::text
    AND id=ANY(active_ids) AND id<>ALL(claimed_ids)
    AND (work_date=marker.work_date OR (taskflow_issue_ref->>'kind'=marker.kind) OR taskflow_issue_ref->>'kind'='both')
    ORDER BY (id=ANY(active_ids)) DESC,(taskflow_issue_ref->>'kind'=marker.kind) DESC,(work_date=marker.work_date) DESC,created_at,id LIMIT 1;
   ref:=jsonb_build_object('id',NEW.id::text,'workspaceId',NEW.workspace_id::text,'title',NEW.title,'href',link,'kind',marker.kind);
   IF chosen IS NULL AND allow_new THEN
    INSERT INTO public.work_entries(user_uuid,work_date,started_at,ended_at,hours,title,note,event_type,status,source,ecp_task_name_snapshot,ecp_task_id,date_only,taskflow_issue_ref)
    VALUES(owner_row.user_uuid,marker.work_date,NULL,NULL,1,NEW.title,'','WORK','completed','ai-card',coalesce(ecp,''),(SELECT id FROM public.user_ecp_tasks WHERE user_uuid=owner_row.user_uuid AND name=ecp AND is_active LIMIT 1),true,ref) RETURNING id INTO chosen;
   ELSIF chosen IS NOT NULL THEN
    UPDATE public.work_entries SET work_date=marker.work_date,
     title=CASE WHEN title=taskflow_issue_ref->>'title' THEN NEW.title ELSE title END,
     taskflow_issue_ref=ref,status='completed',deleted_at=NULL,google_delete_requested_at=NULL
     WHERE id=chosen;
   END IF;
   IF chosen IS NOT NULL THEN claimed_ids:=array_append(claimed_ids,chosen); END IF;
  END LOOP;
  UPDATE public.work_entries SET status='deleted',deleted_at=now(),google_delete_requested_at=now()
   WHERE user_uuid=owner_row.user_uuid AND date_only AND taskflow_issue_ref->>'id'=NEW.id::text
    AND taskflow_issue_ref->>'workspaceId'=NEW.workspace_id::text AND id<>ALL(claimed_ids) AND (status<>'deleted' OR id=ANY(active_ids));
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.worklog_task_dates_changed() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS worklog_task_dates_changed ON taskflow.issue;
CREATE TRIGGER worklog_task_dates_changed AFTER INSERT OR UPDATE OF start_date,due_date,title OR DELETE ON taskflow.issue
FOR EACH ROW EXECUTE FUNCTION public.worklog_task_dates_changed();
-- Ordinary REST clients may not invent or rewrite native date registrations.
-- Only the fixed definer trigger/RPC can write these rows; timed rows retain RLS.
CREATE OR REPLACE FUNCTION public.worklog_guard_date_hours()
RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
BEGIN
 IF current_user IN ('anon','authenticated') AND
  ((TG_OP<>'INSERT' AND OLD.date_only) OR (TG_OP<>'DELETE' AND (NEW.date_only OR NEW.taskflow_issue_ref IS NOT NULL OR NEW.taskflow_hours_adjusted))) THEN
  RAISE EXCEPTION 'Native date hours require the owner-scoped transaction' USING ERRCODE='42501';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.worklog_guard_date_hours() FROM PUBLIC,anon,authenticated;
DROP TRIGGER IF EXISTS worklog_guard_date_hours ON public.work_entries;
CREATE TRIGGER worklog_guard_date_hours BEFORE INSERT OR UPDATE OR DELETE ON public.work_entries
FOR EACH ROW EXECUTE FUNCTION public.worklog_guard_date_hours();
-- One owner-scoped edit transaction updates the exact original endpoint when its date moves.
-- Never accept caller-supplied task/workspace/owner identifiers as the binding.
CREATE OR REPLACE FUNCTION public.worklog_update_date_hours(p_entry uuid,p_expected timestamptz,p_date date,p_title text,p_hours numeric,p_note text,p_ecp text)
RETURNS SETOF public.work_entries LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE original public.work_entries%ROWTYPE; issue_row taskflow.issue%ROWTYPE; task_id uuid; ws_id uuid; ecp_id uuid; day_total numeric; previous_total numeric;
BEGIN
 IF auth.uid() IS NULL OR NOT public.is_app_access_approved() THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='42501'; END IF;
 SELECT (taskflow_issue_ref->>'id')::uuid,(taskflow_issue_ref->>'workspaceId')::uuid INTO task_id,ws_id
 FROM public.work_entries WHERE id=p_entry AND user_uuid=auth.uid() AND date_only;
 IF task_id IS NULL OR NOT EXISTS(SELECT 1 FROM taskflow.member WHERE workspace_id=ws_id AND user_id=auth.uid() AND role='owner') THEN RAISE EXCEPTION 'Original owner workspace required' USING ERRCODE='42501'; END IF;
 SELECT * INTO issue_row FROM taskflow.issue WHERE id=task_id AND workspace_id=ws_id FOR UPDATE;
 SELECT * INTO original FROM public.work_entries WHERE id=p_entry AND user_uuid=auth.uid() AND date_only AND status<>'deleted' AND deleted_at IS NULL FOR UPDATE;
 IF original.id IS NULL OR issue_row.id IS NULL OR original.updated_at IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'Date hours changed, reload required' USING ERRCODE='40001'; END IF;
 IF p_date IS NULL OR p_title IS NULL OR length(btrim(p_title))=0 OR p_hours IS NULL OR p_hours<=0 OR p_hours>10 THEN RAISE EXCEPTION 'Invalid date hours' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(auth.uid()::text||':'||p_date::text,0));
 SELECT coalesce(sum(hours),0) INTO day_total FROM public.work_entries WHERE user_uuid=auth.uid() AND work_date=p_date AND status<>'deleted' AND deleted_at IS NULL AND id<>p_entry;
 previous_total:=day_total+CASE WHEN original.work_date=p_date THEN original.hours ELSE 0 END;
 IF day_total+p_hours>12 AND day_total+p_hours>previous_total THEN RAISE EXCEPTION 'Daily hours exceed limit' USING ERRCODE='22023'; END IF;
 IF EXISTS(SELECT 1 FROM public.work_entries WHERE user_uuid=auth.uid() AND date_only AND id<>p_entry AND status<>'deleted' AND deleted_at IS NULL AND work_date=p_date AND taskflow_issue_ref->>'id'=task_id::text AND taskflow_issue_ref->>'workspaceId'=ws_id::text) THEN RAISE EXCEPTION 'Date endpoints would merge, edit the original task dates' USING ERRCODE='40001'; END IF;
 SELECT id INTO ecp_id FROM public.user_ecp_tasks WHERE user_uuid=auth.uid() AND name=p_ecp AND is_active LIMIT 1;
 IF p_date IS DISTINCT FROM original.work_date THEN
  IF original.taskflow_issue_ref->>'kind'='both' AND (issue_row.start_date IS DISTINCT FROM original.work_date OR issue_row.due_date IS DISTINCT FROM original.work_date) THEN RAISE EXCEPTION 'Original task dates changed' USING ERRCODE='40001'; END IF;
  IF original.taskflow_issue_ref->>'kind'='start' AND issue_row.start_date IS DISTINCT FROM original.work_date THEN RAISE EXCEPTION 'Original start date changed' USING ERRCODE='40001'; END IF;
  IF original.taskflow_issue_ref->>'kind'='due' AND issue_row.due_date IS DISTINCT FROM original.work_date THEN RAISE EXCEPTION 'Original due date changed' USING ERRCODE='40001'; END IF;
  UPDATE taskflow.issue SET
   start_date=CASE WHEN original.taskflow_issue_ref->>'kind' IN('start','both') THEN p_date ELSE start_date END,
   due_date=CASE WHEN original.taskflow_issue_ref->>'kind' IN('due','both') THEN p_date ELSE due_date END
   WHERE id=task_id AND workspace_id=ws_id;
 END IF;
 UPDATE public.work_entries SET work_date=p_date,title=btrim(p_title),hours=p_hours,note=coalesce(p_note,''),ecp_task_name_snapshot=coalesce(p_ecp,''),ecp_task_id=ecp_id,taskflow_hours_adjusted=true
 WHERE id=p_entry AND user_uuid=auth.uid();
 RETURN QUERY SELECT * FROM public.work_entries WHERE id=p_entry AND user_uuid=auth.uid();
END $$;
REVOKE ALL ON FUNCTION public.worklog_update_date_hours(uuid,timestamptz,date,text,numeric,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.worklog_update_date_hours(uuid,timestamptz,date,text,numeric,text,text) TO authenticated;
COMMIT;
