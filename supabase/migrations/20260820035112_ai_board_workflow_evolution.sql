-- AI Board Workflow Evolution: retire the legacy GPT workspace from the active source.
-- Preserve the workspace row and all task/audit history.
update public.board_workspaces
set active = false,
    archived_at = coalesce(archived_at, now())
where workspace_key = 'gpt'
  and active = true;