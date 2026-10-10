# TaskFlow CLI SSO — GPT/CTO Release Review Evidence

## Decision state

- GPT/CTO comment: [conditional approval, not deployment approval](https://github.com/QQweasdzxc/zhuge-ai-os/issues/38#issuecomment-6098479134).
- Candidate source commit: [`22182207b2e58a465204df8d1f84bc5300f84535`](https://github.com/QQweasdzxc/zhuge-ai-os/commit/22182207b2e58a465204df8d1f84bc5300f84535).
- Baseline: `origin/main` `92e6a61fcfbb2c9e5639f45a93d63599482d9e44` — Product `0.9.0-alpha.9.29`, Build `20261010-1406`.
- Candidate identity: **0.9.0-alpha.9.30 / 20261010-2139**. The two root canonical identity sources and all governed Product manifests match; Published C remains independent at `0.9.0-alpha.9.13 / 20260915-1707`.
- Candidate is four commits ahead of baseline, a direct descendant, not a merge of `taskflow-dev`. The divergent `origin/taskflow-dev` `a4c22c1bba68957532965e2648ff49b411317810` remains unmerged.
- Review-only remote reference is intended to contain this exact candidate as its parent, plus this evidence package and a CI-only workflow. That reference is not a deployed app and does not trigger Pages or Render deployment.
- No main push, Render deployment, Production DB/Auth/Cron mutation, or PM-authenticated CLI acceptance has occurred.

## Exact diff inventory and scope

The complete compare is `origin/main...22182207b2e58a465204df8d1f84bc5300f84535`:

- **6,496 changed paths** total.
- **6,432** are the pinned, byte-identical `third_party/multica/` snapshot.
- **64** are non-vendor paths, with **3,776 insertions / 608 deletions**.
- Overall diff: 1,451,612 insertions / 608 deletions.

Readable artifacts in this review reference:

- `CHANGED_FILES.txt`: exact all-path inventory (6,496 paths).
- `NONVENDOR_CHANGED_FILES.txt`: exact 64 non-vendor paths.
- `64_NON_VENDOR.patch`: complete zero-context Git patch for every non-vendor path, no vendor hunks; the compare link provides surrounding context.
- `64_PATH_SCOPE_AUDIT.tsv`: one row per non-vendor path with disposition.
- `candidate-diff-summary.json`: counts and SHA-256 digests.
- `VENDOR_PROVENANCE.md`: pinned SHA, tree hash, file count, exact comparison result.

Path classification summary: `labs/taskflow/` contains the TaskFlow entry/CLI SSO, overlays, build/staging, docs, and tests; `tests/` contains related regression/test-contract changes; `.github/workflows/taskflow-build-parity.yml` is a build-only workflow (push on `main` or manual dispatch; no deploy step); `.gitattributes` prevents whitespace normalization of the immutable vendor snapshot. Other Product surfaces contain governed Version/Build/cache-buster synchronization only, with one TaskFlow-related WorkLog return monitor in `modules/worklog/index.html`. No `supabase/`, Production Auth, Legacy Board, Native Lab, or shared cron path is changed. Investment functional code is unchanged; Investment paths are release metadata/cache-buster updates only.

The source diff should be reviewed against the exact candidate SHA, not the review-evidence commit. The candidate source compare is `https://github.com/QQweasdzxc/zhuge-ai-os/compare/92e6a61fcfbb2c9e5639f45a93d63599482d9e44...22182207b2e58a465204df8d1f84bc5300f84535`.

## Vendor verification

See `VENDOR_PROVENANCE.md`. Independent upstream fetch was performed at `8db6cfe19ae6fd5c35ec71bd8fea42a3ef3861ec`. The candidate subtree and `origin/taskflow-dev` subtree both have Git tree `8ab084cede9b821deb4573263c24866fa49383a9` and contain exactly 6,432 tracked files. The upstream checkout and candidate directory compared byte-for-byte with zero differences. This confirms the 6,432 files are the pinned upstream snapshot; the formal-main diff shows them as additions because main did not previously contain the vendor.

## CLI SSO credential-flow review

### What is and is not in a URL

- **No long-lived Supabase access JWT, TaskFlow session JWT, or native PAT is put in a URL.** The Zhuge access token is sent over HTTPS to the TaskFlow API in a POST body; the API verifies it through Supabase Auth `/auth/v1/user` and derives the UUID from that verified response. The browser's TaskFlow API session is carried in an Authorization header, not a URL.
- The native CLI loopback callback does carry `?token=zgc_<opaque-code>&state=<cli-state>`. `zgc_...` is a **one-use bearer authorization code**, not a JWT/PAT; the native CLI's legacy callback field name is `token`. The code is returned only to the `localhost`/`127.0.0.1` callback supplied by `multica login`.
- If that code were captured before the legitimate CLI exchange, it could be raced against `POST /api/tokens` to mint a native revocable PAT. That is the residual risk of a bearer authorization code; it is not equivalent to a long-lived PAT/JWT being directly exposed in a URL. The final reviewer should explicitly accept or reject this boundary.

### Checks in the candidate source

- Callback allowlist: HTTP loopback only, explicit port, exact `/callback`, no user/password/query/fragment; duplicate callback/state parameters are rejected.
- Native CLI state: 16 bytes from `crypto/rand` (128-bit), encoded as exactly 32 lowercase hex characters. The local CLI checks exact returned state before accepting the callback. Browser-side state is consumed once in `sessionStorage`; pending intent TTL is 4 minutes.
- Server code: 32 bytes from `crypto/rand` (256-bit), URL-safe opaque value with `zgc_` prefix; only SHA-256 digest is stored; grant is bound to the API-authenticated canonical Multica user UUID; TTL is 5 minutes; mutex-protected single consume; unknown, expired and replayed codes fail closed. Process restart invalidates outstanding codes. Current Render API configuration is one instance; failover/restart means the user must rerun `multica login`.
- Code is accepted only by the native `POST /api/tokens` exchange route; other routes reject it. The native route then creates the revocable PAT in the expected CLI flow.
- Anonymous grant creation and caller-selected UUID are rejected. The API derives identity through verified Zhuge session middleware, not request JSON.
- Server request logging uses the URL path only and does not log query strings, request URI, Authorization header, or request body. The CLI callback listener has no access-log write. CLI terminal instructions contain callback/state before approval, but not the issued code; success output says the token is saved without printing it.
- The redirect into the official AIOS origin sets `Cache-Control: no-store` and `Referrer-Policy: no-referrer`; the code-issuance response also sets those headers. The one-use code is still present in the loopback callback URL and may appear in local browser history until consumed/expired. No remote app log captures that callback URL. This review did not make a PM-authenticated Runtime request, so actual browser history behavior remains source-level analysis.
- Server grant storage is in-process memory, not durable. Restart safely invalidates the outstanding code. Server-side grant records bind the code to user ID but do not separately bind `cli_state`; the CLI performs state verification at the localhost receiver. An observer who steals the code can attempt a one-time exchange, so the short lifetime and single-use are important.

### Security evidence tests

The exact candidate tests cover invalid and duplicate callbacks/state, remote callback rejection, stale/tampered intent, anonymous/caller-selected identity denial, expiry, replay, wrong-route redemption, no JWT-shaped code, no token field in hosted redirect URL, and request logger exclusion of query/request URI. Current local run: CLI/entry test suite included in **73/73 targeted pass** and **61/61 browser pass**. High-confidence secret scan of added non-vendor lines found **0** literal private keys, API secrets, PAT-shaped values, or JWT-shaped values. Intentional dummy strings in tests are not production credentials; vendor test fixtures are part of the byte-identical upstream snapshot.

## QA on exact candidate

Rerun on source SHA `22182207b2e58a465204df8d1f84bc5300f84535`:

- Targeted Node: `node --test tests/release-consistency.test.js tests/release-governance.test.js tests/shared-navigation.test.js tests/taskflow-entry.test.js tests/taskflow-cli-sso.test.js` — **73 pass / 0 fail / 0 skip**.
- TaskFlow Python: `PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover -s labs/taskflow/tests -v` — **13 pass**.
- Full Regression: `node --test tests/*.test.js` — **954 pass / 0 fail / 0 skip**.
- Browser Regression: `BROWSER_EXECUTABLE=/usr/bin/chromium npm run test:browser` — **61 pass / 0 fail / 0 skip**; 23 browser suites plus the defined standalone browser scripts, no page/console errors in report.
- `git diff --check origin/main...22182207b2e58a465204df8d1f84bc5300f84535` — PASS.
- Remote Build Parity: **PENDING** until the review-reference workflow completes. The workflow checks out and builds exact candidate `22182207b2e58a465204df8d1f84bc5300f84535`, not the review-evidence commit.

Full Regression rewrites tracked screenshot evidence. Those test-generated PNGs were restored to the pre-run candidate versions; the original candidate worktree is clean.

## Render source binding and release plan

Read-only Render control-plane state:

| Service | ID | URL | Current branch | Auto deploy | Current live deployment | Live source SHA |
|---|---|---|---|---|---|---|
| Shell | `srv-db4hgrnlot8c73910ce0` | `https://zhuge-taskflow.onrender.com` | `taskflow-dev` | off | `dep-db4hgs7lot8c73910e30` | `12ff66e6cd94b8f55bed6adeff3c536fe9dd806c` |
| Web | `srv-db4hgqvlot8c73910ae0` | `https://zhuge-taskflow-web.onrender.com` | `taskflow-dev` | off | `dep-db4hgrflot8c73910blg` | `12ff66e6cd94b8f55bed6adeff3c536fe9dd806c` |
| API | `srv-db4hgfflk1mc73827pr0` | `https://zhuge-taskflow-api.onrender.com` | `taskflow-dev` | off | `dep-db4tdajbc2fs73dibh90` | `12ff66e6cd94b8f55bed6adeff3c536fe9dd806c` |

Promotion plan after GPT/CTO final release sign-off:

1. Confirm `origin/main` still equals `92e6a61fcfbb2c9e5639f45a93d63599482d9e44`. Push the exact four reviewed commits as a fast-forward to `main`; do not merge `taskflow-dev`. GitHub Pages then builds that exact main SHA.
2. Keep Render auto-deploy OFF. For each of the three existing services, change the source branch from `taskflow-dev` to `main` without triggering deployment. No new service/site is created.
3. Manually deploy the same immutable `main` SHA, preferably API → Web → Shell. Confirm the Render control plane reports the same source SHA for all three. Shell/Web canonical manifests must read `0.9.0-alpha.9.30 / 20261010-2139`; API image is built from that same SHA. Verify `/readyz` HTTP 200 and the identity in runtime/static source.
4. Run minimum non-destructive smoke: official AIOS origin, WORK → TaskFlow, authenticated same-Zhuge session handoff, anonymous/session-expired denial, TaskFlow workspace UI, CLI authorization flow without starting a Daemon, `/readyz`, and source SHA/version/build readback. PM's actual authenticated CLI interaction remains pending unless done by PM after release; no fake identity is used.
5. The Render MCP available in this session is read-only for service source branch settings; no branch change or deploy was attempted. The source branch update is a release-time Render control-plane action, after final approval.

### Recovery

- No database migration or shared Auth/Cron change is in this candidate. Rollback requires no DB restore.
- Before promotion: leave main and all Render deployments unchanged.
- After promotion, if an issue occurs: use Render's recorded prior live deployment IDs above for immediate artifact rollback; restore branch config as needed. Then make a **forward revert on `main`** with a new Product Version and Build and manually deploy that same revert SHA to all three services. Do not rewrite main history or reuse `.9.30 / 20261010-2139` for a later deployment.
- Because the code exchange code is one-use and in-memory, a rollback/restart invalidates pending grants; users rerun CLI login. Existing issued native PATs remain under Multica's normal revocation/expiry controls.

## Minimal release acceptance gate

- GitHub Build Parity on exact candidate: PASS.
- Source review: GPT/CTO final sign-off.
- Main promotion: exact fast-forward from `92e6a61fcfbb2c9e5639f45a93d63599482d9e44` to the reviewed source SHA; `main=origin/main`, clean tree.
- Pages / Render: successful deploy from one main SHA; Shell/Web/API and Pages source identity matches; no DB migration, Auth expansion, Cron edit, second service, or VM/Daemon enablement.
- Smoke outcomes recorded separately: `ENTRY DEPLOYED`, `AUTHENTICATED WORKSPACE VERIFIED`, `CLI SSO VERIFIED`, and `PM ACCEPTED`. PM-authenticated CLI login and any Agent Run are not represented as passed here. Runtime/VM/Daemon/autodispatch remain deferred and are not a release blocker.

Final disposition from this package is **READY FOR GPT/CTO FINAL RELEASE REVIEW; NOT YET APPROVED TO DEPLOY**.
