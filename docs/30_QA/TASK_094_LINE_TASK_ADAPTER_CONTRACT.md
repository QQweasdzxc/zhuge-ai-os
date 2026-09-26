# TASK-094｜Shared LINE Task Adapter Contract

Status: Edge-source-ready / provider-optional. LINE is a transport and notification
surface; the canonical AI Board / Module C runtime remains the only Task,
Workspace, Workflow, progress, audit, and persistence authority.

## Boundary

```text
LINE Webhook / LIFF
  → protected signature verification
  → server-side LINE subject → authenticated Zhuge user mapping
  → existing Board scope resolution
  → Shared LINE Task Adapter
  → canonical Board RPC / C authority
  → sanitized Flex or LIFF deep-link response
```

The browser, LIFF page, Flex payload, and LINE user cannot supply an
`auth.uid`, Board instance, Workspace, Workflow binding, or arbitrary RPC.
The protected server must pass a verified `serverResolution` object with
`authority = canonical-board-scope`, the authenticated Zhuge user, the Board
instance, the verified LINE subject/type, and (for non-create commands) the
server-resolved Task id. Missing, ambiguous, or subject-mismatched resolution
fails closed. No service-role or provider credential belongs in the browser or
a Flex message.

## Contract

- Contract: `zhuge-line-task-adapter-v1`
- Webhook signature: LINE channel-secret HMAC-SHA256, verified before parsing a
  command. The adapter does not store the channel secret.
- Commands: `create_task`, `accept_task`, `set_progress`, `mark_blocked`,
  `mark_delayed`, `complete_task`.
- Progress: explicit `0 / 25 / 50 / 75 / 100`; arbitrary percentages are
  rejected rather than rounded into a false state.
- Idempotency: `line-task-v1:<webhook-event-id>:<command>`; the protected
  server adapter passes it to the existing canonical write contract.
- Presentation: Flex cards are projections only and carry no mutation
  authority. LIFF is a mobile deep-link/detail surface, not a second Board.

## State and reminder matrix

| State | User-facing label | Allowed next action | Reminder rule |
|---|---|---|---|
| `unassigned` | 待接單 | 接單 | only when a canonical assignment/notification rule fires |
| `assigned` | 已接單 | 開始處理 / 回報進度 | no duplicate reminder for the same event id |
| `in_progress` | 進行中 | 25/50/75/100% / 卡關 / 延期 | reminder is evidence-backed and idempotent |
| `blocked` | 卡關 | 提供原因 / 解除卡關 | never claim completion automatically |
| `delayed` | 延期 | 提供新預計時間 | requires an explicit reason/date in the canonical path |
| `completed` | 完成 | 查看紀錄 | no further progress mutation |

The transport cannot choose a different state by sending a `state` field. The
allowlisted command determines the canonical target state. `mark_blocked`
requires a reason, `mark_delayed` requires a reason plus a valid `due_at`, and
`complete_task` requires explicit `progress = 100`; missing evidence fails
before the canonical RPC boundary.

Reminders are notifications, not state authority. A future Messaging API
adapter must call a bounded, server-side sender with a provider-specific
idempotency key and must not write `board_tasks` directly.

## Capability limits

- LINE LIFF can provide a mobile web view and deep link, but it does not grant
  Zhuge authorization by itself; Zhuge Auth and the server-side identity link
  remain required.
- Flex messages can render a compact status card and a deep link. They are not
  a secure place for secrets, full audit history, or arbitrary task mutation.
- Messaging API credentials stay in an Edge/server runtime. This source slice
  intentionally does not activate a provider or require a secret.
- Delivery, retry, timeout, malformed payload, duplicate event, and provider
  unavailable states must be shown as explicit unavailable/error evidence. The
  server-only messaging adapter bounds provider calls to 8 seconds (10 seconds
  absolute maximum), permits at most one retry for an explicit transient
  rejection, and does not retry a timeout because delivery is uncertain. An
  atomic idempotency-store `claim` is supported to prevent concurrent sends;
  a fresh pending claim returns `in_flight` without calling the provider, while
  an expired pending claim may be reclaimed after the store validates
  `replaceIfStale`.

## Test vectors and acceptance

1. Unverified webhook → rejected before command creation.
2. Missing event id → rejected; no idempotency key.
3. Missing or unverified `serverResolution` → `LINE_SERVER_RESOLUTION_REQUIRED`;
   a subject mismatch → `LINE_RESOLUTION_SUBJECT_MISMATCH`.
4. `60%` → rejected; only the five explicit progress steps are valid.
5. Duplicate event/command → same idempotency key; canonical server decides
   replay without a duplicate Task or activity.
6. Flex projection contains state text, progress, and optional deep link but
   `mutation = none`.
7. Any direct task id / Board id supplied without
   `serverResolution.verified` and `serverResolution.authority =
   canonical-board-scope` is rejected; a caller value that disagrees with the
   verified resolution is rejected with `LINE_RESOLUTION_MISMATCH`.

## Protected Edge runtime

`supabase/functions/zhuge-line-task-runtime` is the server-side webhook host.
It uses LINE channel-secret HMAC before JSON parsing, resolves the subject via
the service-role-only `line_resolve_subject` RPC, and sends allowlisted task
commands through `board_line_task_command_v1`. The RPC resolves the approved
user's single personal WorkTodo Board instance and uses the existing Board
creation/audit boundary; workflow-bound tasks fail closed rather than bypassing
the canonical Workflow transition. Webhook idempotency is durable in
`private.line_webhook_idempotency`, with a 30-second in-flight guard and stale
reclaim. The Edge `/health` response is sanitized and reports only configured,
available, error category, and mutation boundary.

Provider credentials are optional at deployment time. Without both
`LINE_CHANNEL_SECRET` and `LINE_CHANNEL_ACCESS_TOKEN`, the runtime returns
`PROVIDER_NOT_CONFIGURED`, performs no provider call, and performs no Board
mutation. The credentials remain Edge secrets; no browser, LIFF, Flex payload,
ZIP, or response contains them.

## Attribution

This slice uses no third-party source code or SDK. It calls the LINE Messaging
API only through the protected server-side adapter; provider terms and
credential activation remain a later runtime gate. No MIT attribution is
required for this slice.
