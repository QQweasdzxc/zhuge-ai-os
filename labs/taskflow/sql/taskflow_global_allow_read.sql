-- Add only the scalar whole-site decision lookup. No person decisions, cutoff,
-- approval pause, workspaces, tasks or worklogs are changed.
begin;
create schema if not exists taskflow_gate;
revoke all on schema taskflow_gate from public, anon, authenticated, service_role;
grant usage on schema taskflow_gate to taskflow_runtime;
create or replace function taskflow_gate.taskflow_app_access_decision(p_user_id uuid)
returns boolean language sql stable security definer
set search_path to pg_catalog, private, public, pg_temp
as $$ select private.app_access_effective_allowed(p_user_id); $$;
revoke all on function taskflow_gate.taskflow_app_access_decision(uuid) from public, anon, authenticated, service_role;
grant execute on function taskflow_gate.taskflow_app_access_decision(uuid) to taskflow_runtime;
commit;
