create unique index if not exists engineering_activity_log_workspace_email_idempotency_idx
on public.engineering_activity_log ((after_data->>'idempotency_key'))
where entity_type = 'board_workspace'
  and action = 'workspace_email_notification'
  and nullif(after_data->>'idempotency_key', '') is not null;