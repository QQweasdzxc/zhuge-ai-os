-- TaskFlow G1 Executor Native Mapping (read-only postflight)
--
-- Allow-listed output only: per-executor mapping state, never row payloads.
-- Mirrors the Agent.system_key -> Project.lead contract readback in
-- labs/taskflow/overrides/taskflow_native_ai_readback.go. Run after the
-- candidate; expected end state: 5 rows, all MAPPED with unbound runtimes.

WITH required(executor_id) AS (
    SELECT unnest(ARRAY['CO-01','CO-02','CO-03','GEM-01','GH-HELPER'])
), native_agents AS (
    SELECT id, system_key
    FROM public.agent
    WHERE workspace_id = '01a1247f-520e-78eb-aa58-0a0e458185f6'
      AND system_key = ANY(ARRAY['CO-01','CO-02','CO-03','GEM-01','GH-HELPER'])
      AND archived_at IS NULL
)
SELECT r.executor_id,
       count(DISTINCT a.id) AS agent_count,
       count(DISTINCT p.id) AS project_count,
       CASE
           WHEN count(DISTINCT a.id) = 1 AND count(DISTINCT p.id) = 1 THEN 'MAPPED'
           WHEN count(DISTINCT a.id) = 0 THEN 'AGENT_MISSING'
           WHEN count(DISTINCT a.id) > 1 THEN 'AGENT_DUPLICATE'
           WHEN count(DISTINCT p.id) = 0 THEN 'PROJECT_MISSING'
           ELSE 'PROJECT_DUPLICATE'
       END AS mapping_state
FROM required r
LEFT JOIN native_agents a ON a.system_key = r.executor_id
LEFT JOIN public.project p
  ON p.workspace_id = '01a1247f-520e-78eb-aa58-0a0e458185f6'
 AND p.lead_type = 'agent'
 AND p.lead_id = a.id
GROUP BY r.executor_id
ORDER BY array_position(ARRAY['CO-01','CO-02','CO-03','GEM-01','GH-HELPER'], r.executor_id);
