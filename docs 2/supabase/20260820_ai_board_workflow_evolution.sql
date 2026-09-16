-- AI Board Workflow Evolution
--
-- GPT區 is a legacy workspace row.  The current responsibility workflow is
-- 待辦 -> Co區 -> QJC驗證 -> 已完成.  Preserve the legacy row and all task
-- history, but remove it from the active workspace source used by the Board.
-- No task, status, assignee, audit, or lifecycle data is deleted or rewritten.

update public.board_workspaces
set active = false,
    archived_at = coalesce(archived_at, now())
where workspace_key = 'gpt'
  and active = true;
