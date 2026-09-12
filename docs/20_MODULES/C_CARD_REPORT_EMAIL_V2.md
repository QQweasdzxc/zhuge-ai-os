# Module C — Card Report Email v2

Scope: Module C shared capability only. Consumer data remains isolated per Board/Workspace.

## Added
- Workspace entry Email supports To / CC / BCC.
- Entry Email includes a card deep link (`?task=<task-id>`); runtime opens that exact card after authentication.
- Workspace setting can enable "工作進度回報通知" with independent To / CC / BCC.
- Saving a new human 工作進度 triggers Cloud Edge Function `card-progress-email-notification` after the progress record is committed.
- Notification failure never rolls back the saved progress.
- Idempotency is keyed by immutable progress activity id.

## Cloud deployment required before PM Runtime QA
1. Apply `docs/supabase/20260905_c_workspace_email_followup_v2.sql`.
2. Redeploy `workspace-email-notification`.
3. Deploy `card-progress-email-notification`.
4. Existing `RESEND_API_KEY` and `WORKSPACE_NOTIFICATION_FROM_EMAIL` secrets are reused.

Deep links do not bypass authorization. Recipient must be signed in and already have access to the target board/card.
