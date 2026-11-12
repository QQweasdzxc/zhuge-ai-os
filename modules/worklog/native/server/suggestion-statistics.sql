-- Read-only derived counts. No owner argument, no data writes, no global setting.
CREATE OR REPLACE FUNCTION public.worklog_suggestion_statistics(p_year integer,p_now timestamptz,p_weekday integer)
RETURNS TABLE(model_name text,recent_usage bigint,weekday_usage bigint)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='28000'; END IF;
 IF p_year IS NULL OR p_weekday IS NULL OR p_year NOT BETWEEN 1900 AND 2200 OR p_weekday NOT BETWEEN 0 AND 6 OR p_now IS NULL THEN RAISE EXCEPTION 'Invalid statistics range' USING ERRCODE='22023'; END IF;
 RETURN QUERY SELECT m.name::text,
  count(e.id) FILTER(WHERE p_now-e.started_at <= interval '90 days'),
  count(e.id) FILTER(WHERE extract(dow FROM e.started_at AT TIME ZONE 'Asia/Taipei')::integer=p_weekday)
 FROM public.user_work_models m
 LEFT JOIN public.work_entries e ON e.user_uuid=auth.uid()
  AND e.work_date>=make_date(p_year-1,12,1) AND e.work_date<make_date(p_year+1,2,1)
  AND e.status<>'deleted' AND e.deleted_at IS NULL
  AND (position(coalesce(m.name,'') in coalesce(e.title,''))>0 OR position(coalesce(e.title,'') in coalesce(m.name,''))>0)
 WHERE m.user_uuid=auth.uid() AND m.is_active IS NOT FALSE GROUP BY m.name;
END $$;
REVOKE ALL ON FUNCTION public.worklog_suggestion_statistics(integer,timestamptz,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.worklog_suggestion_statistics(integer,timestamptz,integer) TO authenticated;
-- Rollback: DROP FUNCTION public.worklog_suggestion_statistics(integer,timestamptz,integer);

CREATE OR REPLACE FUNCTION public.worklog_calendar_statistics(p_from date,p_to date)
RETURNS TABLE(work_date date,hours numeric,entry_count bigint)
LANGUAGE plpgsql STABLE SECURITY INVOKER SET search_path=pg_catalog,public AS $$
BEGIN
 IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE='28000'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_to<=p_from OR p_to-p_from>370 THEN RAISE EXCEPTION 'Invalid statistics range' USING ERRCODE='22023'; END IF;
 RETURN QUERY SELECT e.work_date,sum(e.hours)::numeric,count(*) FROM public.work_entries e
 WHERE e.user_uuid=auth.uid() AND e.work_date>=p_from AND e.work_date<p_to AND e.status<>'deleted' AND e.deleted_at IS NULL GROUP BY e.work_date;
END $$;
REVOKE ALL ON FUNCTION public.worklog_calendar_statistics(date,date) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.worklog_calendar_statistics(date,date) TO authenticated;
-- Rollback: DROP FUNCTION public.worklog_calendar_statistics(date,date);
