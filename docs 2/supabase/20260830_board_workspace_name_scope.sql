-- Generic Consumer Creation: workspace names are unique per board instance.
-- Existing workspace rows are preserved; only the uniqueness scope changes.

begin;

drop index if exists public.board_workspaces_active_name_idx;

create unique index board_workspaces_active_name_idx
  on public.board_workspaces (board_instance_id, lower(btrim(name)))
  where active = true;

commit;
