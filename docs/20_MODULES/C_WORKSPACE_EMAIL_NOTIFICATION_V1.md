# Module C — Workspace Email Notification v1 (PM QA)

Scope lock: only **enter workspace → email**.

## Cloud-only rule
- Settings: `public.board_workspace_notification_settings` in Supabase.
- Workspace/card movement: existing Supabase RPC.
- Sending: Supabase Edge Function `workspace-email-notification`.
- No localStorage/sessionStorage fallback.

## Deploy before PM Runtime QA
1. Apply `docs/supabase/20260904_c_workspace_email_notifications.sql`.
2. Deploy `supabase/functions/workspace-email-notification`.
3. Configure Edge Function secrets:
   - `RESEND_API_KEY`
   - `WORKSPACE_NOTIFICATION_FROM_EMAIL` (a verified sender)
4. Deploy this web source.

## PM QA path
Workspace `⋮` → `⚙️ 工作區設定` → enable Email → choose recipient(s) → save → drag a card into that workspace.

Supported recipients in v1:
- Card assignee: resolves automatically when `assignee` itself is an email address.
- Original reporter: resolves from the task `created_by` Supabase Auth user email.
- Custom email(s): explicit addresses stored in Cloud.

Mail failure never rolls back the already-authoritative Cloud card movement.
