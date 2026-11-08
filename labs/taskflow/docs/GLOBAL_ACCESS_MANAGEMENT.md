# TF global access management (ZG-70)

Baseline main: `9476a22134a4abc66d30ce8ce919f30ace07c698`.
Release: `0.9.0-alpha.9.189`, Build `20261108-2043`.

## BLOCKED — not approved for merge or deployment

The cross-origin browser acceptance test fails on the selected environment's
Chromium, including a persistent profile and a successful first-party Pages
session read before navigating to the TF iframe. The iframe loads successfully
with its correct HTTPS origin and Render parent, but the existing auth scripts
cannot read localStorage:

```text
Failed to read the 'localStorage' property from 'Window':
Access is denied for this document.
origin: https://qqweasdzxc.github.io
ancestorOrigins: [https://zhuge-taskflow-web.onrender.com]
```

Reproduce with `node --test --test-name-pattern=cross-origin
tests/taskflow-access-management-browser.test.js`. All requests in this test
are intercepted and fulfilled locally; there are no production RPC writes.
This establishes a browser cross-site storage limitation in this environment,
not a live Render CSP diagnosis or proof that every user's browser rejects
storage. The requested embedded session reuse is therefore NOT VERIFIED and
the acceptance test is intentionally left failing, not skipped or masked with
browser security flags. Per the work order, stop here without merge/deploy or
credential bridging. The PR is Draft. There is no merge SHA or new deployed
Pages/Render version. A Formal FullSource package is not produced because the
required browser QA gate has not passed.

Passed local checks: 84 TF Python overlay tests; 22 React settings/hook tests
(including the fixed stable iframe mounting regression); standalone Pages
mock-RPC browser acceptance. The initial PR commit's Browser Regression and
TaskFlow Build Parity passed on GitHub, but that result predates the new
cross-origin reproducer and iframe mounting fix and is NOT final approval.
The broad local regressions exposed existing non-panel failures in mobile
actions, compact headers and investment provider evidence; they were stopped
after the blocking iframe result and are not reported as PASS.

## Source and authority

`patches/apply-taskflow-access-management.py` installs
`overrides/taskflow-access-management.tsx` into the copied web source's
`packages/views/settings/components/`. `Dockerfile.web` runs this after the
existing overlays. The frozen `third_party/multica` is unchanged. The settings
entry shares the workspace subgroup with General and uses the existing tab URL
mechanism (`?tab=app-access`). Workspace names, slugs and identifiers are unchanged.

The iframe loads the Pages route `labs/taskflow/access-management/`. It uses
the existing shared auth scripts, session store and Google sign-in function;
there is no TF JWT/Supabase bridge. Embedded login opens the same Pages route
in a new tab, where the existing Google login button runs outside the iframe.
After login, the user can press Recheck in the iframe. A browser that isolates
third-party storage may still require using the standalone Pages panel; this
change does not bypass browser storage policy or transfer credentials.

The existing `resolve_creator_capability({})` RPC is the creator authority.
Unknown/error/non-creator states hide the TF entry. An unauthenticated Pages
session exposes the entry to permit the requested Google login; it never
exposes a switch. Direct panel access by a non-creator displays 無權限.
Workspace owner/admin status is never used. Frame messages contain only
`type` and presentation `status`; the shell validates exact origin and frame
source. These messages grant no database authority.

The panel reads `app_access_review_paused({})`. Only a user change followed by
confirmation and a fresh creator check calls
`set_app_access_review_paused({paused: boolean})`. The existing RPC enforces
authorization. No migration, RLS, DB function, access policy, OAuth/scopes,
token/secret, login implementation or brand change is included.

## Verification and deployment boundaries

The Python test exercises installation on a copied vendor tree, rejects marker
drift/double application and refuses the frozen vendor. The React test checks
hidden/creator/non-creator/login states, forged origin/source messages and TF
identity changes. Playwright executes the actual Pages auth scripts and panel
with all network requests intercepted: both boolean parameters, read arguments,
confirmation cancellation, creator gate, missing session, setter rejection and
cross-origin embedding without credential messages. None of these tests calls
the production setter. Live Google OAuth completion and production creator UI
acceptance are separate runtime checks, not implied by these tests.

Pages publishing supplies the static panel; it does not update Render. To apply
the TF shell after merge, deploy the merged revision to the existing
`zhuge-taskflow-web` service using the repository-root context and
`labs/taskflow/Dockerfile.web`. Keep all existing runtime configuration. No new
environment variables or backend/database deployment are required by this UI.
Record the actual Render deploy ID/commit and wait for `live`, then verify the
settings entry and read-only status as creator/non-creator. Do not toggle the
production setting for smoke testing. If auto-deploy is configured, inspect its
actual successful deployment rather than assuming merge deployed Render.
