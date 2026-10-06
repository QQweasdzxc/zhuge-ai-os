-- Module C Board Instance lifecycle. Production apply requires separate PM authority.
begin;
alter table public.board_instances
  add column archived_at timestamptz,
  add column archived_by uuid references auth.users(id) on delete set null,
  add column archive_origin text,
  add column lifecycle_managed boolean not null default false;
-- Preserve legacy inactive rows; unknown historical actors are not fabricated.
update public.board_instances set archived_at=coalesce(updated_at,created_at,now()), archive_origin='legacy-inactive' where not active;
-- Only verified canonical provisioning evidence permits historical eligibility.
update public.board_instances b set lifecycle_managed=true
where b.template_key='c' and not b.is_template_instance and b.legacy_application_scope is null
and exists(select 1 from private.board_c_consumer_provision_idempotency p
  where p.board_instance_id=b.id and p.response->>'capability'='c-native-consumer-provisioning');
alter table public.board_instances add constraint board_instance_lifecycle_state_ck check
 ((active and archived_at is null and archived_by is null) or (not active and archived_at is not null));
alter table public.board_instances add constraint board_instance_lifecycle_eligibility_ck check
 (not lifecycle_managed or (template_key='c' and not is_template_instance and legacy_application_scope is null));

create or replace function public.board_instance_can_manage_lifecycle(p_board_instance_id uuid)
returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select auth.uid() is not null and exists(select 1 from public.board_instances b
 where b.id=p_board_instance_id and b.lifecycle_managed and b.template_key='c'
 and not b.is_template_instance and b.legacy_application_scope is null
 and ((b.authorization_mode='owner' and b.owner_uuid=auth.uid())
   or (b.authorization_mode='engineering' and public.is_engineering_member(array['owner']))));
$$;
revoke all on function public.board_instance_can_manage_lifecycle(uuid) from public,anon;
grant execute on function public.board_instance_can_manage_lifecycle(uuid) to authenticated;
-- Archived Board metadata remains manageable; Task/Workspace runtime RLS is unchanged.
create policy board_instances_archived_lifecycle_read on public.board_instances for select to authenticated
using (not active and public.board_instance_can_manage_lifecycle(id));
create policy engineering_activity_board_lifecycle_read on public.engineering_activity_log for select to authenticated
using (entity_type='board_instance' and action in ('board_instance_archived','board_instance_restored')
 and case when entity_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
 then public.board_instance_can_manage_lifecycle(entity_id::uuid) else false end);

create or replace function private.board_instance_set_archived(p_board_instance_id uuid,p_archived boolean)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare v_before public.board_instances%rowtype; v_after public.board_instances%rowtype; v_user uuid:=auth.uid();
begin
 if v_user is null then raise exception using errcode='42501',message='Board lifecycle requires authentication'; end if;
 select * into v_before from public.board_instances where id=p_board_instance_id for update;
 if not found or not public.board_instance_can_manage_lifecycle(p_board_instance_id) then
   raise exception using errcode='42501',message='Board lifecycle management denied'; end if;
 if v_before.active = p_archived then
   update public.board_instances set active=not p_archived,
     archived_at=case when p_archived then now() else null end,
     archived_by=case when p_archived then v_user else null end,
     archive_origin=case when p_archived then 'user' else null end,
     updated_at=now() where id=p_board_instance_id returning * into v_after;
   insert into public.engineering_activity_log(entity_type,entity_id,action,before_data,after_data,actor_id,note)
   values ('board_instance',p_board_instance_id::text,
     case when p_archived then 'board_instance_archived' else 'board_instance_restored' end,
     to_jsonb(v_before),to_jsonb(v_after),v_user,'Module C Board lifecycle; all owned data retained');
   return to_jsonb(v_after);
 end if;
 raise exception using errcode='40001',message='Board lifecycle state conflict; reload before retrying';
end;
$$;
revoke all on function private.board_instance_set_archived(uuid,boolean) from public,anon,authenticated;
create or replace function public.board_instance_archive(p_board_instance_id uuid)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
 select private.board_instance_set_archived(p_board_instance_id,true);
$$;
create or replace function public.board_instance_restore(p_board_instance_id uuid)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
 select private.board_instance_set_archived(p_board_instance_id,false);
$$;
create or replace function public.board_instance_list_archived()
returns jsonb language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Archived Board read requires authentication'; end if;
 return (select coalesce(jsonb_agg(to_jsonb(b) order by b.archived_at desc,b.id),'[]'::jsonb)
 from public.board_instances b where not b.active and b.archived_at is not null and public.board_instance_can_manage_lifecycle(b.id));
end;
$$;
revoke all on function public.board_instance_archive(uuid) from public,anon;
revoke all on function public.board_instance_restore(uuid) from public,anon;
revoke all on function public.board_instance_list_archived() from public,anon;
grant execute on function public.board_instance_archive(uuid),public.board_instance_restore(uuid),public.board_instance_list_archived() to authenticated;
revoke insert,update,delete,truncate,references,trigger on public.board_instances from authenticated;

-- Extend the existing provisioning Authority; signature/hash/idempotency remain unchanged.
create or replace function public.board_provision_c_consumer_v2(
  p_name text,
  p_task_code_prefix text,
  p_template_key text default 'c',
  p_application_scope text default null,
  p_workspace_blueprint jsonb default null,
  p_workflow_blueprint jsonb default null,
  p_idempotency_key text default null,
  p_project_assignment text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth, private, pg_temp
as $function$
declare
  v_user uuid := auth.uid();
  v_name text := btrim(coalesce(p_name, ''));
  v_prefix text := upper(btrim(coalesce(p_task_code_prefix, '')));
  v_template text := lower(btrim(coalesce(p_template_key, 'c')));
  v_scope text := nullif(lower(btrim(coalesce(p_application_scope, ''))), '');
  v_idempotency_key text := nullif(btrim(coalesce(p_idempotency_key, '')), '');
  v_request_hash text := md5(concat_ws('|', v_name, v_prefix, v_template, coalesce(v_scope, ''), coalesce(p_workspace_blueprint::text, ''), coalesce(p_workflow_blueprint::text, '')));
  v_is_personal_worktodo boolean := lower(btrim(coalesce(p_application_scope, ''))) = 'worktodo-self';
  v_project text := nullif(lower(btrim(coalesce(p_project_assignment, ''))), '');
  v_is_creator boolean := false;
  v_existing private.board_c_consumer_provision_idempotency%rowtype;
  v_instance public.board_instances%rowtype;
  v_release public.module_releases%rowtype;
  v_workspace jsonb;
  v_workspace_id uuid;
  v_workspace_key text;
  v_workspace_blueprint jsonb := coalesce(
    p_workspace_blueprint,
    jsonb_build_array(
      jsonb_build_object('workspace_key', 'todo', 'name', '待辦', 'sort_order', 10),
      jsonb_build_object('workspace_key', 'working', 'name', '處理中', 'sort_order', 20),
      jsonb_build_object('workspace_key', 'review', 'name', '待驗收', 'sort_order', 30),
      jsonb_build_object('workspace_key', 'completed', 'name', '完成', 'sort_order', 40)
    )
  );
  v_workspace_map jsonb := '{}'::jsonb;
  v_workflow jsonb;
  v_step jsonb;
  v_steps jsonb := '[]'::jsonb;
  v_workflow_response jsonb;
  v_published_workflow_response jsonb;
  v_workflow_version_id uuid;
  v_workspaces jsonb;
  v_adoption jsonb;
  v_response jsonb;
begin
  if v_project is not null then
    if v_project not in ('worklog', 'investment') or v_scope is not null then
      raise exception using errcode = '22023', message = 'Project assignment must be WorkLog or Investment and cannot replace application scope';
    end if;
    v_request_hash := md5(v_request_hash || '|project:' || v_project);
  end if;
  if v_user is null then
    raise exception using errcode = '42501', message = 'Authenticated governance identity is required';
  end if;

  select exists (
    select 1 from public.app_users au
    where au.auth_user_id = v_user
      and lower(trim(au.role)) in ('creator', 'owner')
  ) into v_is_creator;

  if v_is_personal_worktodo then
    if not public.is_app_access_approved() then
      raise exception using errcode = '42501', message = 'Approved Zhuge AI OS access is required';
    end if;
    if v_template <> 'c'
       or v_name <> '工作待辦'
       or v_prefix <> 'SELF'
       or v_scope <> 'worktodo-self'
       or p_workspace_blueprint is not null
       or p_workflow_blueprint is not null then
      raise exception using errcode = '22023', message = 'Personal WorkTodo provisioning accepts only the fixed self-provision contract';
    end if;

    -- A canonical Owner WorkTodo is resolved by the Runtime and must never be
    -- converted, cloned, or provisioned again through the personal branch.
    if exists (
      select 1 from public.board_instances existing_owner
       where existing_owner.owner_uuid = v_user
         and existing_owner.legacy_application_scope = 'worktodo'
    ) then
      raise exception using errcode = '23505', message = 'Canonical WorkTodo already exists; resolve the existing Board instead of provisioning another one';
    end if;

    v_name := '工作待辦';
    v_scope := 'worktodo-user-' || replace(v_user::text, '-', '');
    v_prefix := 'W' || upper(substr(md5(v_user::text), 1, 15));
    v_workspace_blueprint := jsonb_build_array(
      jsonb_build_object('workspace_key', 'worktodo-todo', 'name', '待辦事項', 'sort_order', 10),
      jsonb_build_object('workspace_key', 'worktodo-inprogress', 'name', '進行中', 'sort_order', 20),
      jsonb_build_object('workspace_key', 'worktodo-completed', 'name', '已完成', 'sort_order', 30)
    );
  else
    if not v_is_creator then
      raise exception using errcode = '42501', message = 'Only an approved user may self-provision their own WorkTodo';
    end if;
  end if;

  if v_template <> 'c' then
    raise exception using errcode = '22023', message = 'Module C provisioning requires template key C';
  end if;
  if v_name = '' or v_prefix !~ '^[A-Z][A-Z0-9]{1,15}$' then
    raise exception using errcode = '22023', message = 'Board name and task-code prefix are required';
  end if;
  if v_scope is not null and v_scope !~ '^[a-z][a-z0-9_-]{0,63}$' then
    raise exception using errcode = '22023', message = 'Application scope format is invalid';
  end if;
  if v_idempotency_key is null then
    raise exception using errcode = '22023', message = 'C Consumer provisioning requires an idempotency key';
  end if;

  -- Preserve the original per-request idempotency contract, and serialize
  -- personal requests by auth.uid() below so independent tabs cannot create
  -- duplicate Boards using different request keys.
  perform pg_advisory_xact_lock(hashtextextended(v_idempotency_key, 0));
  select * into v_existing
    from private.board_c_consumer_provision_idempotency
   where idempotency_key = v_idempotency_key
     and expires_at > now()
   for update;
  if found then
    if v_existing.request_hash <> v_request_hash then
      raise exception using errcode = '40001', message = 'C Consumer provisioning Idempotency Key 已用於不同內容。';
    end if;
    return v_existing.response || jsonb_build_object('idempotent', true);
  end if;

  if v_is_personal_worktodo then
    perform pg_advisory_xact_lock(hashtextextended('module-c-personal-worktodo:' || v_user::text, 0));

    select * into v_instance
      from public.board_instances existing_personal
     where existing_personal.owner_uuid = v_user
       and existing_personal.legacy_application_scope = v_scope
     for update;
    if found then
      if v_instance.active is distinct from true
         or v_instance.template_key is distinct from 'c'
         or v_instance.authorization_mode is distinct from 'owner'
         or v_instance.is_template_instance is distinct from false
         or v_instance.task_code_prefix <> v_prefix then
        raise exception using errcode = '23505', message = 'Existing personal WorkTodo identity is inconsistent; provisioning stopped without changes';
      end if;

      select * into v_release
        from public.module_releases
       where module_id = 'c'
       for share;
      if not found then
        raise exception using errcode = 'P0002', message = 'Published Module C release is unavailable';
      end if;
      v_adoption := v_release.consumer_adoptions -> v_instance.id::text;
      if v_adoption is null
         or jsonb_typeof(v_adoption) is distinct from 'object'
         or v_adoption->>'status' is distinct from 'adopted'
         or v_adoption->>'template_key' is distinct from 'c' then
        raise exception using errcode = 'P0002', message = 'Existing personal WorkTodo has no verifiable C adoption; resolution failed closed';
      end if;

      select coalesce(jsonb_agg(to_jsonb(workspace) order by workspace.sort_order), '[]'::jsonb)
        into v_workspaces
        from public.board_workspaces workspace
       where workspace.board_instance_id = v_instance.id
         and workspace.active = true;
      select state.published_workflow_version_id
        into v_workflow_version_id
        from public.board_instance_workflow_state state
       where state.board_instance_id = v_instance.id;

      v_response := jsonb_build_object(
        'contract', 'module-c-consumer-provisioning-v2',
        'capability', 'c-native-consumer-provisioning',
        'contract_version', 'module-c-lifecycle-acceptance-v2',
        'board_instance', to_jsonb(v_instance),
        'board_instance_id', v_instance.id,
        'template_key', 'c',
        'application_scope', v_scope,
        'workspaces', v_workspaces,
        'published_release', to_jsonb(v_release),
        'module_adoption', v_adoption,
        'workflow', case when v_workflow_version_id is null then null else jsonb_build_object('status', 'published', 'workflow_version_id', v_workflow_version_id) end,
        'workflow_version_id', v_workflow_version_id,
        'shared_runtime', 'module-c-golden-master-runtime',
        'shared_authority', 'module-c-canonical-contract',
        'existing_board', true,
        'atomic', true,
        'idempotent', true,
        'fail_closed', true,
        'card_mutation', 0
      );
      insert into private.board_c_consumer_provision_idempotency (
        idempotency_key, request_hash, board_instance_id, response, status
      ) values (
        v_idempotency_key, v_request_hash, v_instance.id, v_response, 'completed'
      );
      return v_response;
    end if;
  end if;

  if exists (select 1 from public.board_instances where task_code_prefix = v_prefix) then
    raise exception using errcode = '23505', message = 'Board code is already in use';
  end if;
  if v_scope is not null and exists (select 1 from public.board_instances where legacy_application_scope = v_scope) then
    raise exception using errcode = '23505', message = 'Application scope is already assigned';
  end if;

  select * into v_release
    from public.module_releases
   where module_id = v_template
   for share;
  if not found then
    raise exception using errcode = 'P0002', message = 'Published Module C release is unavailable';
  end if;

  -- The existing low-level creator supplies Board identity and verifies App
  -- Access. All following writes remain in this same transaction.
  v_instance := public.board_create_instance(v_name, v_prefix, v_template);
  -- Generic provisioning automatically opts into this same Board lifecycle.
  update public.board_instances set lifecycle_managed=(v_scope is null)
    where id=v_instance.id returning * into v_instance;
  if v_scope is not null or v_project is not null then
    update public.board_instances
       set legacy_application_scope = v_scope,
           project_assignment = v_project,
           updated_at = now()
     where id = v_instance.id
     returning * into v_instance;
  end if;

  if jsonb_typeof(v_workspace_blueprint) <> 'array'
     or jsonb_array_length(v_workspace_blueprint) = 0 then
    raise exception using errcode = '22023', message = 'C Consumer workspace blueprint must be a non-empty array';
  end if;
  if exists (
    select 1
      from jsonb_array_elements(v_workspace_blueprint) entry
     group by lower(btrim(entry->>'workspace_key'))
    having count(*) > 1
  ) then
    raise exception using errcode = '22023', message = 'C Consumer workspace blueprint contains duplicate keys';
  end if;

  for v_workspace in select value from jsonb_array_elements(v_workspace_blueprint) loop
    v_workspace_key := lower(btrim(v_workspace->>'workspace_key'));
    if v_workspace_key !~ '^[a-z][a-z0-9_-]{0,63}$'
       or nullif(btrim(v_workspace->>'name'), '') is null then
      raise exception using errcode = '22023', message = 'C Consumer workspace blueprint contains an invalid workspace';
    end if;
    insert into public.board_workspaces (
      board_instance_id, workspace_key, name, sort_order, active,
      application_scope, owner_uuid, created_by, updated_by
    ) values (
      v_instance.id,
      v_workspace_key,
      btrim(v_workspace->>'name'),
      coalesce((v_workspace->>'sort_order')::integer, 0),
      coalesce((v_workspace->>'active')::boolean, true),
      case when v_is_personal_worktodo then 'worktodo' when v_scope in ('ai_board', 'worktodo') then v_scope else null end,
      v_user,
      v_user,
      v_user
    ) returning id into v_workspace_id;
    v_workspace_map := v_workspace_map || jsonb_build_object(v_workspace_key, v_workspace_id::text);
  end loop;

  if not v_is_personal_worktodo then
    if p_workflow_blueprint is null then
      -- Preserve existing Creator/Owner behavior: a generic C Consumer gets
      -- its current Instance-owned starter Workflow through canonical C APIs.
      v_workflow := jsonb_build_object(
        'name', v_name || ' 流程',
        'description', '由 Module C 建立的子板起始流程；流程資料屬於本 Board Instance。',
        'transitions', '[]'::jsonb,
        'gates', '[]'::jsonb,
        'evidence_requirements', '[]'::jsonb
      );
      -- Initialize the supplied active Workspace blueprint itself. Do not
      -- assume the four default workspace keys exist: custom C consumers
      -- must also receive one standalone Step per Workspace and zero Edges.
      for v_workspace in select value from jsonb_array_elements(v_workspace_blueprint) loop
        if coalesce((v_workspace->>'active')::boolean, true) then
          v_workspace_key := lower(btrim(v_workspace->>'workspace_key'));
          v_steps := v_steps || jsonb_build_array(jsonb_build_object(
            'step_key', v_workspace_key,
            'name', btrim(v_workspace->>'name'),
            'sort_order', coalesce((v_workspace->>'sort_order')::integer, 0),
            'role_key', case v_workspace_key when 'review' then 'qjc' when 'completed' then 'pm' else 'co' end,
            'workspace_id', v_workspace_map->>v_workspace_key,
            'status_key', case v_workspace_key when 'working' then 'inprogress' when 'review' then 'qa' when 'completed' then 'done' else 'ready' end,
            'is_initial', false,
            'is_completion', false
          ));
        end if;
      end loop;
    else
      if jsonb_typeof(p_workflow_blueprint) <> 'object' then
        raise exception using errcode = '22023', message = 'C Consumer workflow blueprint must be an object';
      end if;
      v_workflow := p_workflow_blueprint;
      if jsonb_typeof(coalesce(v_workflow->'steps', '[]'::jsonb)) <> 'array'
         or jsonb_array_length(coalesce(v_workflow->'steps', '[]'::jsonb)) = 0 then
        raise exception using errcode = '22023', message = 'C Consumer workflow blueprint must contain steps';
      end if;
      for v_step in select value from jsonb_array_elements(v_workflow->'steps') loop
        v_workspace_key := lower(btrim(v_step->>'workspace_key'));
        if not (v_workspace_map ? v_workspace_key) then
          raise exception using errcode = '22023', message = 'C Consumer workflow step references an unknown workspace';
        end if;
        v_step := jsonb_set(v_step - 'workspace_key', '{workspace_id}', to_jsonb(v_workspace_map->>v_workspace_key), true);
        v_steps := v_steps || jsonb_build_array(v_step);
      end loop;
    end if;

    -- A Published Workflow binds every active Workspace exactly once.
    -- Fill missing Steps without creating any Edge; Edges remain opt-in.
    for v_workspace in select value from jsonb_array_elements(v_workspace_blueprint) loop
      v_workspace_key := lower(btrim(v_workspace->>'workspace_key'));
      if coalesce((v_workspace->>'active')::boolean, true)
         and not exists (
           select 1
             from jsonb_array_elements(v_steps) current_step
            where current_step->>'workspace_id' = v_workspace_map->>v_workspace_key
         ) then
        v_steps := v_steps || jsonb_build_array(jsonb_build_object(
          'step_key', v_workspace_key,
          'name', btrim(v_workspace->>'name'),
          'sort_order', (select coalesce(max((current_step->>'sort_order')::integer), -1) + 1 from jsonb_array_elements(v_steps) current_step),
          'role_key', 'co',
          'workspace_id', v_workspace_map->>v_workspace_key,
          'status_key', 'ready'
        ));
      end if;
    end loop;

    -- Initial and terminal markers are derived from Edge topology. With no
    -- Edges each independent node is both a start and an end.
    select coalesce(jsonb_agg(
      jsonb_set(
        jsonb_set(current_step, '{is_initial}', to_jsonb(not exists (
          select 1 from jsonb_array_elements(coalesce(v_workflow->'transitions', '[]'::jsonb)) edge
           where edge->>'to_step_key' = current_step->>'step_key'
        )), true),
        '{is_completion}', to_jsonb(not exists (
          select 1 from jsonb_array_elements(coalesce(v_workflow->'transitions', '[]'::jsonb)) edge
           where edge->>'from_step_key' = current_step->>'step_key'
        )), true
      ) order by coalesce((current_step->>'sort_order')::integer, 0)
    ), '[]'::jsonb)
      into v_steps
      from jsonb_array_elements(v_steps) current_step;

    if nullif(btrim(v_workflow->>'name'), '') is null then
      raise exception using errcode = '22023', message = 'C Consumer workflow name is required';
    end if;
    v_workflow_response := public.board_c_workflow_save_draft(
      v_instance.id,
      btrim(v_workflow->>'name'),
      nullif(btrim(v_workflow->>'description'), ''),
      v_steps,
      coalesce(v_workflow->'transitions', '[]'::jsonb),
      coalesce(v_workflow->'gates', '[]'::jsonb),
      coalesce(v_workflow->'evidence_requirements', '[]'::jsonb),
      null,
      'c-provision-draft-' || v_idempotency_key
    );
    v_workflow_version_id := (v_workflow_response #>> '{workflow,id}')::uuid;
    if v_workflow_version_id is null then
      raise exception using errcode = 'P0002', message = 'C Consumer workflow draft was not created';
    end if;
    v_published_workflow_response := public.board_c_workflow_publish(
      v_workflow_version_id,
      null,
      'c-provision-publish-' || v_idempotency_key
    );
  end if;

  -- Personal WorkTodo also receives the shared zero-edge structural baseline.
  if v_is_personal_worktodo then
    v_published_workflow_response := private.board_workspace_publish_lifecycle(v_instance.id);
    v_workflow_version_id := (v_published_workflow_response #>> '{workflow,id}')::uuid;
  end if;

  v_adoption := jsonb_build_object(
    'status', 'adopted',
    'module_version', v_release.published_version,
    'build', v_release.published_build,
    'source_commit', v_release.source_commit,
    'source_fingerprint', v_release.source_fingerprint,
    'published_at', v_release.published_at,
    'adopted_at', now(),
    'adopted_by', v_user,
    'template_key', 'c',
    'workflow_version_id', v_workflow_version_id
  );
  update public.module_releases
     set consumer_adoptions = jsonb_set(coalesce(consumer_adoptions, '{}'::jsonb), array[v_instance.id::text], v_adoption, true),
         updated_at = now()
   where module_id = 'c';
  if not found then
    raise exception using errcode = 'P0002', message = 'Published Module C adoption persistence failed';
  end if;

  select coalesce(jsonb_agg(to_jsonb(workspace) order by workspace.sort_order), '[]'::jsonb)
    into v_workspaces
    from public.board_workspaces workspace
   where workspace.board_instance_id = v_instance.id
     and workspace.active = true;

  v_response := jsonb_build_object(
    'contract', 'module-c-consumer-provisioning-v2',
    'capability', 'c-native-consumer-provisioning',
    'contract_version', 'module-c-lifecycle-acceptance-v2',
    'board_instance', to_jsonb(v_instance),
    'board_instance_id', v_instance.id,
    'template_key', 'c',
    'application_scope', v_scope,
    'workspaces', v_workspaces,
    'published_release', to_jsonb(v_release),
    'module_adoption', v_adoption,
    'workflow', v_published_workflow_response->'workflow',
    'workflow_version_id', v_workflow_version_id,
    'workflow_status', case when v_workflow_version_id is null then 'not_configured' else 'published' end,
    'shared_runtime', 'module-c-golden-master-runtime',
    'shared_authority', 'module-c-canonical-contract',
    'atomic', true,
    'idempotent', false,
    'fail_closed', true,
    'card_mutation', 0
  );
  insert into private.board_c_consumer_provision_idempotency (
    idempotency_key, request_hash, board_instance_id, response, status
  ) values (
    v_idempotency_key, v_request_hash, v_instance.id, v_response, 'completed'
  );
  return v_response;
end;
$function$;
notify pgrst, 'reload schema';
commit;
