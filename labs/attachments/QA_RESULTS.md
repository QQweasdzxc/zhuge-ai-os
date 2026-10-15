# Issue #45 isolated QA — .9.47 / 20261015-1436

## GPT / CTO rework verification

- WorkTodo now recognizes its native `completed` status; AI Board completion
  remains exact to native `done` or the current Board workflow's explicitly
  designated completion step. Unbound/null scope and Investment/WorkLog remain
  outside lifecycle cleanup.
- Confirmed physical deletion now writes the existing canonical attachment
  tombstone only after Storage deletion is acknowledged; the source row and
  user-authored metadata remain for audit, while refreshed active lists exclude
  it. Capacity measurement rejects unknown/invalid object sizes, managed
  Board/WorkTodo paths fail closed on gateway outage, and unmanaged scopes keep
  their legacy access path. Cards show the server-provided 72-hour deadline
  while preserving the allowed download window after preview expires.
- `node --test labs/attachments/tests/*.test.*`: **12 PASS, 0 fail, 0 skip**.
  This covers native completion classification, historical grace, reopen/reset,
  24/72-hour boundaries, upload denial, manual/automatic tombstones, reload,
  quota fail-closed behavior, Edge outage/disabled/unmanaged routing, and card
  deadline/preview/download UI.
- `node labs/attachments/tests/postgres-concurrency.cjs`: **PASS** against an
  isolated disposable PostgreSQL 16; concurrent reopen/cleanup retained the
  fresh generation and deleted no bytes.
- `BROWSER_EXECUTABLE=/usr/bin/chromium npm run test:browser`: **75 PASS,
  0 fail, 0 skip**, including TaskFlow entry, Apps/SSO, desktop/mobile, and
  WorkTodo shared drawer flows.
- The root suite, excluding its argument-dependent Pages artifact script:
  **968 PASS, 0 fail, 0 skip**. Pages was built separately and its required
  output-path invocation is recorded above as **2 PASS**.
- Pages source builder included 300 files; the correctly parameterized Pages
  artifact suite: **2 PASS, 0 fail**. JavaScript syntax checks and
  `git diff --check` pass.
- No Production database, Storage, secrets, Render, deployed API, automatic
  cleanup, or irreversible deletion was accessed or run. Full original Docker
  and Next builds are not claimed here; the prior local environment blockers
  and unverified hosted acceptance gates remain below.

## Prior .9.46 regression evidence

## PASS

- Existing branch verified remotely at `d3787336ba4ea0ca9a2ca408c80c35f62e2324c2`;
  current main baseline `802f820e` retained. Frozen vendor diff is empty.
- Broad root regression: **968 tests PASS**. The first blanket `node --test`
  command also invoked the Pages artifact program without its required output
  argument; that invocation failed. Running the actual Pages builder followed
  by `node tests/pages-publish-artifact.test.js <output>` passes **2 tests**.
  This is recorded as a corrected invocation, not an application fix or skip.
- Standard `npm run test:browser`: **PASS**, all configured browser files and
  five standalone scripts, zero skips; includes TaskFlow entry, SSO, Apps,
  Desktop/Mobile, canonical Board/WorkTodo and shared shell regressions.
- Python TaskFlow overlays/parity: **43 tests PASS**, frozen vendor unchanged.
- Native staged Web: core **9 tests PASS**, views **35 tests PASS**, including
  native preview expiry UI/no iframe, token-auth PDF/image fallback, uploads
  and existing download behavior. The inherited 100 MiB test expectation was
  corrected to the reviewed Free cap.
- Native staged Go: Storage, Middleware, Handler and Router **4 packages PASS**;
  includes byte-preserving 13.5 MiB TUS/readback, JWT/workspace checks,
  preview/download intent routing, missing credentials, and configurable
  lower Free upload cap / rejection above 50 MB.
- New lifecycle/gateway/dashboard: **7 tests PASS**. Real SQL executes under
  PGlite; Desktop/iPhone browsers use the actual gateway with local HTTP,
  isolated SQL and file bytes. A previously minted preview capability is
  rejected at 24h, forced download still works, and its prior capability is
  rejected at 72h. HMAC tampering cannot change download into preview.
- Real disposable PostgreSQL 16: **concurrent reopen versus cleanup PASS**;
  no stale-generation claim, full new completion window, immutable claim token,
  and a reopen cannot race an already claimed irreversible operation.
- Existing full Storage SQL script: **PASS** against a separate disposable
  PostgreSQL 16, using real absent-schema preflight, restricted install logins,
  helper ACLs, private bucket RLS, cross-user/workspace denial, no UPDATE policy,
  unchanged legacy bucket, verification and rollback. This exposed and fixed
  another inherited stale 100 MiB post-install assertion.
- Governance, identity, canonical checklist/attachments: **59 tests PASS**.
- Docker source staging **PASS** for Web and backend, including the complete
  ordered identity/SSO/Apps/locale/preview/Storage overlays. Local validation
  uses an otherwise equivalent Python-containing source base because Alpine
  package downloads are blocked; it is not a complete production image build.
- Pages artifact: new capacity runtime included; SQL, server gateway, cleanup
  worker, tests and review documentation excluded from public Pages output.

## BLOCKED / NOT VERIFIED

- Full original Docker images: **BLOCKED** by local egress policy denying
  `dl-cdn.alpinelinux.org` at `apk add python3`; no TLS/policy bypass used.
- Full Next build: **BLOCKED** fetching Google Fonts (Inter/Source Serif 4).
  Source unit tests and source-stage builds are not represented as full-image
  or deployment acceptance. Updated branch CI includes both original images.
- Hosted Supabase policies/global caps/actual Storage TUS and readback, API
  restart durability, real scheduled deletion, Production preview/download,
  and Render runtime parity: **NOT VERIFIED; no Production access performed**.
- Historical missing ZG-9/ZG-10 bytes and prior 13.5 MB upload HTTP 500 recovery:
  **NOT VERIFIED**, not overwritten or claimed fixed.

## Reproduce

```sh
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s labs/taskflow/tests -v
npm ci --ignore-scripts
npx playwright install chromium
node --test labs/attachments/tests/*.test.*
node labs/attachments/tests/postgres-concurrency.cjs
BROWSER_EXECUTABLE=/path/to/chromium npm run test:browser
node --test tests/release-governance.test.js tests/release-consistency.test.js tests/worktodo-attachment-canonical.test.js tests/attachment-metadata-preservation.test.js
node tools/build-pages-site.js /tmp/issue45-pages-output
node tests/pages-publish-artifact.test.js /tmp/issue45-pages-output
```

The concurrency runner creates/removes only its own local disposable container.
The existing Storage SQL script must run only against its isolated fixture;
it creates synthetic roles/schemas and is never a Production acceptance command.
Native Go/Web tests run only in a throwaway staged vendor copy. Docker parity CI
executes the same overlay contracts using the actual repository Dockerfiles.

For review packaging, the required regression fields refer to the executed
local source/identity/checklist/browser suites above. Docker/Next build blockers
and all hosted acceptance gates remain explicitly separate, as recorded here
and in the package manifest. Packaging does not authorize activation or release.
