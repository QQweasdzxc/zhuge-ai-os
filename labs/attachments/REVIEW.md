# Issue #45 — attachment management review candidate

Version `0.9.0-alpha.9.46`, Build `20261015-1303` (Asia/Taipei).
Continues `review/issue45-supabase-lifecycle-20261015` from `d3787336`,
based on main `802f820e`. No Production access, deployment, cleanup, secret
change, formal TASK allocation, or Frozen Multica edit is part of this work.

## Source map

| Module | Authoritative completion | Ownership / metadata | Bytes and application integration |
| --- | --- | --- | --- |
| TaskFlow | `taskflow.issue.status` joins native `issue_status(workspace_id,key).category = 'done'`; custom project status still uses its canonical native status | Existing `taskflow.attachment`, comment-to-issue resolution, verified workspace membership | Existing private `taskflow-attachments` adapter; Docker stages Zhuge overlays, Web handoff supplies a separate verified Supabase JWT; API never receives a service key |
| Board | Canonical `public.board_tasks.status = 'done'` | Existing `board_task_attachments` and Board-instance ACLs | Existing `board-task-attachments`, same keys, no upsert or metadata rewrite |
| WorkTodo | Same canonical card status, including its Board instance scope | Existing canonical attachments and task/instance owner ACLs | Same shared bucket and same action adapters |

Investment/WorkLog consumers sharing the canonical table/bucket are excluded
from this lifecycle; their original Storage policies remain effective.
Knowledge and other buckets are counted for capacity but never cleaned here.

## Implemented contract

- One app-owned, RLS-protected ledger; immutable bucket/key and independent
  completion generation. Card status transitions record/reset T0. Historical
  Done cards get T0 at explicit activation, not installation or upload time.
- Upload reservations serialize the aggregate quota check, include unfinished
  uploads, and reject new attachments on Done cards. Upload completion/linking
  checks the parent again, preventing a completion race. Object replacement
  remains disabled.
- Preview and download use independently authorized gateway intents. Direct
  browser Storage signing/read/delete is restricted for managed objects after
  activation. HMAC media capabilities bind the user, attachment and preview/download intent; native GET rechecks current membership and lifecycle through a service-only RPC before streaming bytes. Their maximum 60-second TTL is clamped
  to the relevant 24/72-hour boundary. Downloads always use attachment disposition, so stripping a query parameter cannot turn them into inline preview. No bearer token appears in those URLs.
- TaskFlow metadata remains readable when preview expires, allowing the download
  button to request a separate download capability. Content/Blob paths also
  enforce preview policy. Board/WorkTodo acquire fresh URLs on click.
- Durable cleanup claims lock the current card generation. Before 72h a reopen
  cancels the timer; a claimed irreversible operation cannot race a reopen.
  After 72h, a reopen may briefly fail with "deletion in progress" until recovery.
  Sticky claims survive crashes; retrying the same immutable key is idempotent.
- Cleanup uses Storage DELETE and then verifies object-info returns 404 before
  finalizing the tombstone/releasing reserved space. Failure retains the claim,
  records a sanitized audit event, and is retried by later scheduler runs.
- Capacity page: actual aggregate Storage usage plus nonduplicated reservations,
  per-module/other breakdown, largest 100 accessible attachments and owning
  cards, deadlines/estimated release, last cleanup outcome, 70/90% warnings,
  and explicitly confirmed manual delete. Original attachment records remain.
- Optional scheduling is Free-compatible pg_cron/pg_net; source is separate and
  not installed automatically. Each sweep is bounded to 25 objects, with indexed
  due-card/state lookups. It is disabled by default.

## Safe installation and cutover — NOT executed

1. Review this candidate, SQL privileges, and both complete Docker builds in
   unrestricted CI. Preserve existing bytes/metadata; inventory old missing
   Render-local files separately. Do not run any supplied SQL on Production
   without PM release approval.
2. Follow the existing TaskFlow private-bucket installation plan in
   `../taskflow/docs/SUPABASE_STORAGE_INSTALL_PLAN.md`: bootstrap app-owned
   helper schema, use the restricted migrator for its boolean ACL helpers,
   and use the authorized Dashboard authority for bucket/policies. Do not
   grant TaskFlow direct managed-schema DML or any service-role credential.
3. Confirm actual Free project-wide single-file limit. Set the private bucket
   limit, API `TASKFLOW_STORAGE_MAX_BYTES`, Web build argument
   `NEXT_PUBLIC_TASKFLOW_STORAGE_MAX_BYTES`, and ledger
   `taskflow_max_file_bytes` to the same reviewed value <=50,000,000 bytes
   and <= the configured global limit. Existing Board/WorkTodo 25 MiB caps
   remain bounded by this lower project limit. Set `capacity_bytes` to the
   actual available object-storage allowance (default conservative 1 GB).
4. With separately approved owner authority, install
   `sql/lifecycle_candidate.sql` in its own transaction. It is deliberately
   outside automatic app migrations. It does NOT activate or delete anything.
   Keep `attachment_lifecycle` outside exposed schemas; only explicitly granted
   public RPCs are callable. Confirm each SECURITY DEFINER owner can read the
   relevant catalogs/tables; private-schema grants to callers are unnecessary.
5. Deploy the authenticated Edge gateway using its existing server-side service
   identity, a specific allowed-origin list, and cleanup disabled. The function-specific `verify_jwt=false` config enables native capability GETs; POSTs explicitly verify Supabase Auth, and GETs verify HMAC plus current ACL/policy. Other functions keep their platform defaults. No service
   credential goes to TaskFlow or the browser. Install the separate restrictive
   `sql/storage_policies_candidate.sql` only through the managed Storage policy
   authority. They preserve original permissive ACLs and are inert while the
   ledger is disabled.
6. Deploy compatible Web/API in the approved coordinated cutover, set
   `TASKFLOW_STORAGE_PROVIDER=supabase` and
   `TASKFLOW_ATTACHMENT_LIFECYCLE=true`, then explicitly invoke the private
   `attachment_lifecycle.activate()` once. Activation locks source tables and
   initializes all historical windows at that instant; review its duration
   against a metadata inventory first. Validate with synthetic PDF/image/PPTX,
   refresh/account switch, direct preview denials, and restart durability.
7. Only after separate cleanup approval, provision the scheduler's existing
   Vault bindings through the secret administrator, enable Edge cleanup, and
   install `sql/schedule_candidate.sql`. The 5-minute sweep processes eligible
   objects after 72h; outages/backlogs can delay physical deletion. The URL
   binding must point to this gateway, and the scheduler token is server-only.

## Rollback / failure recovery

Before activation, keep cleanup disabled and remove only reviewed new code or
policies if needed; no attachment data needs undoing. After activation, stop the
cron and disable cleanup first; retain ledger/audit and storage-compatible API.
Do not fall back to ephemeral local storage or drop the private bucket, metadata,
claims, or audit. A confirmed Storage delete is irreversible. Retry an existing
sticky claim rather than resetting its token or making the object writable.
Do not disable the lifecycle to bypass an expiry or authorization failure.

## Known limits and release gates

- Production runtime, actual Supabase TUS/readback, hosted policy parity,
  restart durability, and scheduled deletes remain **NOT VERIFIED**. Local
  HTTP/storage substitutes and real isolated PostgreSQL are not hosted proof.
- Historical missing ZG-9/ZG-10 bytes cannot be reconstructed from metadata;
  old Render-local URLs are never silently reinterpreted as Supabase keys and
  are not deletion candidates. This branch does not claim the historical
  13.5 MB PPTX HTTP 500 root cause is repaired.
- Already loaded/downloaded bytes cannot be revoked. Short-lived capabilities
  are rechecked at redemption; this feature stops new
  preview authorization, not copies users have already received.
- Pending uploads reserve capacity and remain visible as pending. Uncertain
  upload failures are not optimistically freed/deleted. Unbound uploads and
  failed reservations need inventory/reconciliation; they do not inherit an
  unrelated card's countdown. This is a safe capacity limitation to review.
- Capacity uses managed Storage metadata and ledger reservations. Unknown or
  invalid size metadata fails closed; it does not manufacture free capacity.
- Complete Docker build is blocked locally by the network policy denying
  `dl-cdn.alpinelinux.org`. Standalone Next build is blocked by Google Fonts
  fetches. Do not mark either image or hosted acceptance PASS on that basis.

Candidate is for GPT/CTO source and isolated-QA review. Main merge, publication,
Production installation, and irreversible cleanup remain on hold for PM.
