-- Trusted Engineering Agent Read Path
--
-- Reuses the existing Engineering Actor Broker and engineering-transition Edge
-- Function.  This migration only permits the server-side service-role bridge
-- to invoke the existing read-only Engineering Memory resolvers.  It does not
-- grant anonymous access, change table RLS, or add any Engineering write path.

begin;

create or replace function public.resolve_current_engineering_memory(
  p_knowledge_codes text[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  result jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role'
     and (auth.uid() is null or not public.is_engineering_member()) then
    raise exception using errcode = '42501', message = 'Authenticated Engineering Member or trusted service read path is required';
  end if;

  with requested_codes as (
    select distinct upper(trim(code)) as code
    from unnest(coalesce(p_knowledge_codes, array[]::text[])) as input(code)
    where length(trim(code)) > 0
    union
    select distinct upper(trim(knowledge_code)) as code
    from public.engineering_knowledge
    where p_knowledge_codes is null
      and lower(trim(coalesce(status, ''))) = 'approved'
      and length(trim(coalesce(knowledge_code, ''))) > 0
  ),
  grouped as (
    select
      requested.code,
      count(knowledge.knowledge_code)::integer as candidate_count,
      (array_agg(knowledge.knowledge_type))[1] as knowledge_type,
      (array_agg(knowledge.title))[1] as title,
      (array_agg(knowledge.summary))[1] as summary,
      (array_agg(knowledge.content))[1] as content,
      (array_agg(knowledge.version))[1] as version,
      (array_agg(knowledge.updated_at))[1] as updated_at
    from requested_codes requested
    left join public.engineering_knowledge knowledge
      on upper(trim(knowledge.knowledge_code)) = requested.code
     and lower(trim(coalesce(knowledge.status, ''))) = 'approved'
    group by requested.code
  )
  select jsonb_build_object(
    'source', 'public.engineering_knowledge',
    'current_rule', 'status = approved; one approved current record per knowledge_code',
    'records', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'knowledge_code', code,
          'knowledge_type', knowledge_type,
          'title', title,
          'summary', summary,
          'content', content,
          'version', version,
          'updated_at', updated_at
        ) order by code
      )
      from grouped
      where candidate_count = 1
    ), '[]'::jsonb),
    'failures', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'knowledge_code', code,
          'reason', case when candidate_count > 1
            then 'Canonical Conflict / Need PM Decision'
            else 'Canonical Retrieval Failed'
          end,
          'candidate_count', candidate_count
        ) order by code
      )
      from grouped
      where candidate_count <> 1
    ), '[]'::jsonb),
    'status', case when exists (select 1 from grouped where candidate_count <> 1)
      then 'failed' else 'ready' end
  ) into result;

  return result;
end;
$$;

create or replace function public.resolve_engineering_startup_gate(
  p_knowledge_codes text[] default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, auth, pg_temp
as $$
declare
  principles jsonb;
  checkpoint jsonb;
  baseline jsonb;
  artifact_rule jsonb;
  artifact_records jsonb;
begin
  if coalesce((select auth.jwt() ->> 'role'), '') <> 'service_role'
     and (auth.uid() is null or not public.is_engineering_member()) then
    raise exception using errcode = '42501', message = 'Authenticated Engineering Member or trusted service read path is required';
  end if;

  principles := public.resolve_current_engineering_memory(p_knowledge_codes);

  select to_jsonb(row_data) - 'updated_by'
    into checkpoint
  from (
    select *
    from public.engineering_project_checkpoints
    where checkpoint_key = 'current'
    limit 1
  ) as row_data;

  select to_jsonb(row_data) - 'accepted_by' - 'updated_by'
    into baseline
  from (
    select *
    from public.engineering_pm_accepted_baselines
    where baseline_key = 'current'
      and lower(trim(coalesce(pm_acceptance_status, ''))) = 'accepted'
    limit 1
  ) as row_data;

  select configuration_value
    into artifact_rule
  from public.engineering_project_configuration
  where configuration_key = 'artifact_rule'
    and is_active = true
  limit 1;

  select coalesce(jsonb_agg(to_jsonb(row_data) order by artifact_timestamp desc), '[]'::jsonb)
    into artifact_records
  from (
    select *
    from public.engineering_artifacts
    order by artifact_timestamp desc
    limit 1
  ) as row_data;

  return jsonb_build_object(
    'principles', coalesce(principles, jsonb_build_object(
      'source', 'public.engineering_knowledge',
      'status', 'failed',
      'records', '[]'::jsonb,
      'failures', jsonb_build_array(jsonb_build_object('reason', 'Canonical Retrieval Failed'))
    )),
    'checkpoint', coalesce(checkpoint, 'null'::jsonb),
    'pm_accepted_baseline', coalesce(baseline, 'null'::jsonb),
    'artifact_rule', coalesce(artifact_rule, 'null'::jsonb),
    'artifact_records', artifact_records
  );
end;
$$;

revoke execute on function public.resolve_current_engineering_memory(text[]) from public, anon;
revoke execute on function public.resolve_engineering_startup_gate(text[]) from public, anon;
grant execute on function public.resolve_current_engineering_memory(text[]) to authenticated, service_role;
grant execute on function public.resolve_engineering_startup_gate(text[]) to authenticated, service_role;

commit;
