-- TaskFlow G1 Executor Native Mapping (candidate only)
--
-- Creates the five Executor identity records (native Agent.system_key) and
-- their 1:1 native Project bindings (Project.lead_type='agent'), per the
-- Agent.system_key -> Project.lead contract in
-- labs/taskflow/overrides/taskflow_native_ai_readback.go. The Executors are
-- external AI workers (Codex Cloud / Gemini / GitHub Helper) reached via
-- GitHub; no runtime/provider binding is created here (STEP3), and no ACL
-- widening occurs: permission_mode='private' + visibility='private' is the
-- deny-by-default posture (migration 130: private = owner-only invoke, no
-- admin bypass), with the record owner being the workspace owner's own user.
--
-- Idempotent: re-run inserts nothing. Reviewed-routine install only, same
-- shape as taskflow_native_dispatch_authority_candidate.sql.

BEGIN;

-- Owner/role guard: restricted migrator only, no elevated role attributes.
DO $g1_owner$
BEGIN
    IF current_user <> 'taskflow_migrator' OR EXISTS (
        SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = current_user
        AND (rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication)
    ) THEN
        RAISE EXCEPTION 'executor mapping requires restricted taskflow_migrator owner';
    END IF;
END
$g1_owner$;

-- Identity precheck: the target workspace and record owner must be exactly
-- the reviewed identities. owner_id is a record owner, never a privilege
-- grant; the user must already be a workspace member.
DO $g1_precheck$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM public.workspace
        WHERE id = '01a1247f-520e-78eb-aa58-0a0e458185f6'
          AND slug = 'zhuge-lab-ac5afcc7'
    ) THEN
        RAISE EXCEPTION 'executor mapping workspace identity mismatch';
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.member
        WHERE workspace_id = '01a1247f-520e-78eb-aa58-0a0e458185f6'
          AND user_id = 'ac5afcc7-f045-41a9-8827-eaf085a04c0d'
    ) THEN
        RAISE EXCEPTION 'executor mapping owner is not a workspace member';
    END IF;
END
$g1_precheck$;

-- Agents: one row per Executor, idempotent by (workspace_id, system_key).
-- runtime_id stays NULL (product models this as runtime_bound=false);
-- runtime_mode='cloud' records where the work actually happens (external
-- provider), status='offline' records that nothing is bound yet.
INSERT INTO public.agent (
    workspace_id, owner_id, name, description,
    runtime_id, runtime_mode, visibility, status,
    kind, system_key, permission_mode
)
SELECT '01a1247f-520e-78eb-aa58-0a0e458185f6',
       'ac5afcc7-f045-41a9-8827-eaf085a04c0d',
       e.system_key, e.description,
       NULL, 'cloud', 'private', 'offline',
       'user', e.system_key, 'private'
FROM (VALUES
    ('CO-01',     'Codex Executor CO-01（整合核心）。外部 Codex Cloud 工作者；STEP2 身分映射，Provider 實接屬 STEP3。'),
    ('CO-02',     'Codex Executor CO-02（回報閉環）。外部 Codex Cloud 工作者；STEP2 身分映射，Provider 實接屬 STEP3。'),
    ('CO-03',     'Codex Executor CO-03（導航與 QA）。外部 Codex Cloud 工作者；STEP2 身分映射，Provider 實接屬 STEP3。'),
    ('GEM-01',    'Gemini Executor GEM-01（獨立支援）。外部 Gemini 工作者；STEP2 身分映射，Provider 實接屬 STEP3。'),
    ('GH-HELPER', 'GitHub Helper（GitHub 路由接單）。外部 GitHub 工作者；STEP2 身分映射，Provider 實接屬 STEP3。')
) AS e(system_key, description)
WHERE NOT EXISTS (
    SELECT 1 FROM public.agent a
    WHERE a.workspace_id = '01a1247f-520e-78eb-aa58-0a0e458185f6'
      AND a.system_key = e.system_key
);

-- Refuse ambiguity: any duplicate system_key in the workspace means the
-- mapping contract (exactly one Agent per Executor) is already violated.
DO $g1_unique$
BEGIN
    IF EXISTS (
        SELECT 1 FROM public.agent
        WHERE workspace_id = '01a1247f-520e-78eb-aa58-0a0e458185f6'
          AND system_key IN ('CO-01','CO-02','CO-03','GEM-01','GH-HELPER')
        GROUP BY system_key HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'duplicate executor system_key present; refusing to bind projects';
    END IF;
END
$g1_unique$;

-- Projects: one native Project per Executor, lead bound 1:1 to its Agent.
-- Idempotent by lead binding; never repoints an existing project lead.
INSERT INTO public.project (workspace_id, title, description, lead_type, lead_id)
SELECT a.workspace_id, e.project_title,
       'Executor ' || e.system_key || ' 的原生派工專案（STEP2 映射）。',
       'agent', a.id
FROM (VALUES
    ('CO-01',     'CO-01 原生專案'),
    ('CO-02',     'CO-02 原生專案'),
    ('CO-03',     'CO-03 原生專案'),
    ('GEM-01',    'GEM-01 原生專案'),
    ('GH-HELPER', 'GH-HELPER 原生專案')
) AS e(system_key, project_title)
JOIN public.agent a
  ON a.workspace_id = '01a1247f-520e-78eb-aa58-0a0e458185f6'
 AND a.system_key = e.system_key
 AND a.archived_at IS NULL
WHERE NOT EXISTS (
    SELECT 1 FROM public.project p
    WHERE p.workspace_id = a.workspace_id
      AND p.lead_type = 'agent'
      AND p.lead_id = a.id
);

COMMIT;
