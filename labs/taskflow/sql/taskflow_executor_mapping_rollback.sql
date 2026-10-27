-- TaskFlow G1 Executor Native Mapping (guarded rollback only)
--
-- Removes ONLY the five Executor Agent rows and their 1:1 lead-bound Project
-- rows created by taskflow_executor_mapping_candidate.sql, and only while
-- nothing references them. Refuses (transaction aborts, nothing deleted)
-- when any of the following exist:
--   * any issue assigned to or created by one of the five Agents;
--   * any issue inside one of the five Projects;
--   * any agent_task_queue / invocation-target row for the five Agents;
--   * any Agent row whose fields drifted from the candidate's exact values
--     (someone edited or adopted the record: it is no longer ours to drop).

BEGIN;

-- Serialize against concurrent writers on the affected slices.
LOCK TABLE public.agent IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.project IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.issue IN SHARE ROW EXCLUSIVE MODE;

DO $g1_rollback_guard$
DECLARE
    ws CONSTANT UUID := '01a1247f-520e-78eb-aa58-0a0e458185f6';
    keys CONSTANT TEXT[] := ARRAY['CO-01','CO-02','CO-03','GEM-01','GH-HELPER'];
BEGIN
    -- Field-drift guard: the rows must still be exactly what the candidate
    -- wrote (unbound, private, offline, cloud, kind=user, owned by the
    -- reviewed user). Anything else is someone else's data.
    IF EXISTS (
        SELECT 1 FROM public.agent a
        WHERE a.workspace_id = ws AND a.system_key = ANY(keys)
          AND (a.runtime_id IS NOT NULL
               OR a.runtime_mode <> 'cloud'
               OR a.visibility <> 'private'
               OR a.status <> 'offline'
               OR a.kind <> 'user'
               OR a.permission_mode <> 'private'
               OR a.owner_id <> 'ac5afcc7-f045-41a9-8827-eaf085a04c0d'
               OR a.archived_at IS NOT NULL)
    ) THEN
        RAISE EXCEPTION 'refusing rollback: executor agent rows drifted from candidate values';
    END IF;

    -- Reference guards: nothing may point at these agents or projects.
    IF EXISTS (
        SELECT 1 FROM public.issue i
        JOIN public.agent a ON a.workspace_id = ws AND a.system_key = ANY(keys)
        WHERE (i.assignee_type = 'agent' AND i.assignee_id = a.id)
           OR (i.creator_type = 'agent' AND i.creator_id = a.id)
    ) THEN
        RAISE EXCEPTION 'refusing rollback: issues reference executor agents';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.issue i
        JOIN public.project p ON p.workspace_id = ws AND p.lead_type = 'agent'
        JOIN public.agent a ON a.id = p.lead_id AND a.system_key = ANY(keys)
        WHERE i.project_id = p.id
    ) THEN
        RAISE EXCEPTION 'refusing rollback: executor projects contain issues';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.agent_task_queue q
        JOIN public.agent a ON a.workspace_id = ws AND a.system_key = ANY(keys)
        WHERE q.agent_id = a.id
    ) THEN
        RAISE EXCEPTION 'refusing rollback: executor agents have queued tasks';
    END IF;
    IF EXISTS (
        SELECT 1 FROM public.agent_invocation_target t
        JOIN public.agent a ON a.workspace_id = ws AND a.system_key = ANY(keys)
        WHERE t.agent_id = a.id
    ) THEN
        RAISE EXCEPTION 'refusing rollback: executor agents have invocation targets';
    END IF;
END
$g1_rollback_guard$;

-- Delete projects first (their lead_id references the agents), then agents.
DELETE FROM public.project p
USING public.agent a
WHERE p.workspace_id = '01a1247f-520e-78eb-aa58-0a0e458185f6'
  AND p.lead_type = 'agent'
  AND p.lead_id = a.id
  AND a.workspace_id = p.workspace_id
  AND a.system_key IN ('CO-01','CO-02','CO-03','GEM-01','GH-HELPER')
  AND NOT EXISTS (SELECT 1 FROM public.issue i WHERE i.project_id = p.id);

DELETE FROM public.agent a
WHERE a.workspace_id = '01a1247f-520e-78eb-aa58-0a0e458185f6'
  AND a.system_key IN ('CO-01','CO-02','CO-03','GEM-01','GH-HELPER')
  AND a.runtime_id IS NULL
  AND a.permission_mode = 'private'
  AND a.kind = 'user'
  AND a.archived_at IS NULL;

COMMIT;
