-- Stage 2/3: existing taskflow_migrator only. No new role membership or general grants.
BEGIN;
CREATE OR REPLACE FUNCTION taskflow.worklog_lock_date_issue(p_issue uuid,p_workspace uuid,p_owner uuid)
RETURNS SETOF taskflow.issue LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,taskflow,public AS $$
BEGIN
 IF p_owner IS NULL OR NOT EXISTS(
  SELECT 1 FROM taskflow.member WHERE user_id=p_owner AND workspace_id=p_workspace AND role='owner'
 ) THEN RAISE EXCEPTION 'Current owner workspace required' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT * FROM taskflow.issue WHERE id=p_issue AND workspace_id=p_workspace FOR UPDATE;
END $$;
REVOKE ALL ON FUNCTION taskflow.worklog_lock_date_issue(uuid,uuid,uuid) FROM PUBLIC,anon,authenticated,service_role,taskflow_runtime;
GRANT EXECUTE ON FUNCTION taskflow.worklog_lock_date_issue(uuid,uuid,uuid) TO postgres;
CREATE OR REPLACE FUNCTION taskflow.worklog_move_date_endpoint(p_issue uuid,p_workspace uuid,p_owner uuid,p_kind text,p_previous date,p_date date)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,taskflow,public AS $$
DECLARE original taskflow.issue%ROWTYPE;
BEGIN
 SELECT * INTO original FROM taskflow.worklog_lock_date_issue(p_issue,p_workspace,p_owner);
 IF original.id IS NULL OR p_previous IS NULL OR p_date IS NULL OR p_kind IS NULL OR p_kind NOT IN('start','due','both') THEN
  RAISE EXCEPTION 'Original date endpoint required' USING ERRCODE='40001'; END IF;
 IF (p_kind IN('start','both') AND original.start_date IS DISTINCT FROM p_previous)
  OR (p_kind IN('due','both') AND original.due_date IS DISTINCT FROM p_previous) THEN
  RAISE EXCEPTION 'Original task dates changed' USING ERRCODE='40001'; END IF;
 UPDATE taskflow.issue SET start_date=CASE WHEN p_kind IN('start','both') THEN p_date ELSE start_date END,
  due_date=CASE WHEN p_kind IN('due','both') THEN p_date ELSE due_date END WHERE id=p_issue AND workspace_id=p_workspace;
END $$;
REVOKE ALL ON FUNCTION taskflow.worklog_move_date_endpoint(uuid,uuid,uuid,text,date,date) FROM PUBLIC,anon,authenticated,service_role,taskflow_runtime;
GRANT EXECUTE ON FUNCTION taskflow.worklog_move_date_endpoint(uuid,uuid,uuid,text,date,date) TO postgres;
DROP TRIGGER IF EXISTS worklog_task_dates_changed ON taskflow.issue;
CREATE TRIGGER worklog_task_dates_changed AFTER INSERT OR UPDATE OF start_date,due_date,title OR DELETE ON taskflow.issue
FOR EACH ROW EXECUTE FUNCTION public.worklog_task_dates_changed();
COMMIT;
