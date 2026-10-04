-- Engineering Memory error semantics follow-up
--
-- A requested code with zero approved canonical records is a valid Not Found
-- state. Resolver or authorization errors remain distinct failure states.

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
          'reason', case
            when candidate_count > 1 then 'Canonical Conflict / Need PM Decision'
            when candidate_count = 0 then 'Not Found'
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

revoke execute on function public.resolve_current_engineering_memory(text[]) from public, anon;
grant execute on function public.resolve_current_engineering_memory(text[]) to authenticated, service_role;

commit;
