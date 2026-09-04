# Module C — Workspace Email Notification v1

## Scope

This feature is a shared Module C capability. WorkTodo, AI Board, GAS, and
Investment use the same workspace settings UI, the same Board Runtime action
surface, and the same Cloud contracts. Only workspace/consumer data differs.

Settings are stored in `public.board_workspace_notification_settings` and are
read or written through authenticated RPCs. The browser does not use
`localStorage`, `sessionStorage`, IndexedDB, cookies, or any other local
fallback for this feature.

## Runtime behaviour

- Open a C workspace `⋮` menu and choose `⚙️ 工作區設定`.
- Configure Email enabled state, assignee/reporter recipients, custom email
  recipients, subject, and body.
- A notification is considered only when a card enters a different workspace
  through an existing controlled movement/update path.
- The movement is committed first. A missing Function, missing recipient, or
  provider failure never rolls back the card movement.
- Supported template variables are `{{卡片編號}}`, `{{卡片名稱}}`, and
  `{{工作區名稱}}`. Unknown variables remain literal text and do not crash
  rendering.
- Recipients are deduplicated. An assignee is resolved only when the existing
  task assignee value is itself a valid email; the reporter is resolved from
  the task creator's authenticated email; custom recipients are explicit
  addresses.

## Cloud contract

Apply `docs/supabase/20260904_c_workspace_email_notifications.sql` only in an
authorized development Supabase project first. The migration:

- uses the existing `board_instance_can_read` / `board_instance_can_write`
  ownership boundary;
- revokes direct table access and exposes only authenticated RPCs;
- keeps settings associated with the existing workspace and board instance;
- records send attempts in the existing `engineering_activity_log`; and
- uses an idempotency key derived from the authoritative workspace-entry audit
  event to prevent duplicate sends.

Deploy `supabase/functions/workspace-email-notification/index.ts` with JWT
verification enabled. Required backend secret names are:

- `RESEND_API_KEY`
- `WORKSPACE_NOTIFICATION_FROM_EMAIL`

The Supabase URL, publishable/anon key, and service-role/secret key are server
configuration. Secret values must never be committed to the repository or
shown in PM delivery notes.

## QA boundary

Developer QA must cover the shared C Runtime and all four consumers:

1. Open settings, cancel, save, and reopen.
2. Confirm Cloud persistence and read-back after reload and re-login.
3. Confirm workspace isolation and no local-storage fallback.
4. Move a card into a different workspace and verify the function request,
   recipient de-duplication, template rendering, and audit state.
5. Repeat the same trigger and verify the idempotency result does not send a
   duplicate.
6. Verify a disabled setting, missing recipient, provider failure, and missing
   function are handled without changing card data.
7. Run Desktop, mobile, reload, and relevant regression checks for WorkTodo,
   AI Board, GAS, and Investment.

The migration and Edge Function are source-complete in this Candidate, but
have not been applied or deployed to the formal production project. Therefore
this Candidate is not PM-accepted until an authorized development Cloud path
is available and the Cloud QA evidence is attached.
