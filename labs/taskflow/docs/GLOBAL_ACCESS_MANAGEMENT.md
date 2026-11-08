# TF global access management (ZG-70)

Baseline main: `9476a22134a4abc66d30ce8ce919f30ace07c698`.
Proposed release: `0.9.0-alpha.9.189`, Build `20261108-2121`.

## Final behavior

The workspace Settings entry 全站存取管理 sits at the same level as General.
It is available to all TF workspace roles without querying global creator
status. Its content is one fixed URL launch button and the explanation
需全站管理者登入，請另開管理頁進行設定。 The anchor uses `target="_blank"`
and `rel="noopener noreferrer"` to open the top-level Pages route:
`https://qqweasdzxc.github.io/zhuge-ai-os/labs/taskflow/access-management/`.
No iframe, cross-origin message listener, credential handoff or TF RPC is used.

`patches/apply-taskflow-access-management.py` installs
`overrides/taskflow-access-management.tsx` into the copied web source's
`packages/views/settings/components/`. `Dockerfile.web` consumes these inputs
using the existing overlay mechanism. Frozen `third_party/multica` is unchanged;
workspace names, slug and all identifiers are unchanged.

The top-level Pages panel uses the existing shared auth scripts and session
store. Without a session, its Google login button calls the existing
`signInWithGoogle()` implementation, preserving its OAuth/scopes and callback
behavior. The existing `resolve_creator_capability({})` RPC is the global
creator authority. A non-creator sees 無權限 and no switch. TF workspace owner
status is never treated as global authority.

The panel reads `app_access_review_paused({})`. Only an explicit user toggle,
one confirmation and a fresh creator check can call
`set_app_access_review_paused({paused: boolean})`. The existing server RPC
continues to enforce authorization. No migration, RLS, DB function, access
policy, OAuth/scopes, token/secret, login implementation or branding change is
included. The prior iframe session experiment and its failing cross-origin
acceptance test have been removed.

## Verification

All six baseline comparison runs used the same `/usr/bin/chromium`, Node and
installed dependencies; main was a separate clean detached worktree at the
baseline SHA. Source changes were not copied into main.

| Test group | clean main | PR branch | Comparison |
| --- | --- | --- | --- |
| mobile-actions-workspace-archive-browser.test.js | FAIL | FAIL | identical `ai_board header 116.1875`, line 117 |
| shared-header-compact-browser.test.js | FAIL | FAIL | identical `Board/investment narrow height 116.1875`, line 87 |
| investment-intelligence-providers.test.js | 16 PASS / 1 FAIL | 16 PASS / 1 FAIL | identical line 579: old `/Zhuge AI OS Investment Intelligence/` expectation vs `TRQN Investment Intelligence/1.0` |

These failures reproduce on main and are not introduced by this work. They
remain failures; no assertion, fixture, brand or security flag was changed to
mask them. The local browser results do not imply the same outcome in the
pinned CI browser environment. FullSource packaging must not claim full/local
browser regression PASS while these failures remain.

Passed local checks: 84 TF Python overlay tests; 21 React component/settings
integration tests; standalone Pages Playwright with every network request
intercepted locally. The latter exercises creator/non-creator/no-session,
cancelled confirmation, both boolean setter parameters and RPC rejection.
The settings integration proves the entry is offered to workspace members,
uses the fixed secure new-tab URL and mounts no iframe or switch in TF.
No test invokes the production setter. Real Google OAuth completion and a
production creator session are not claimed as tested. Latest CI results and
exact head are recorded in the PR, independently of local baseline results.

## Deployment boundary

This PR is not authorized to merge yet. There is no new deployment or merge
SHA for this work. Pages publishing after an approved merge supplies the
static panel only. Render TF still needs a web deployment of that merged
revision using repository-root context and `labs/taskflow/Dockerfile.web` on
`zhuge-taskflow-web`. No new env vars, backend deployment or DB change is
required by this UI. Keep the existing configuration, record the deploy
ID/commit, wait for `live`, then click the settings launch button and verify
read-only status on the top-level Pages panel. Do not toggle production as a
smoke test. If auto-deploy is enabled, verify its actual completed deploy;
never infer Render rollout from a successful Pages build.

## Complete PR diff file list

See the generated exact file list below; release identity/cache-buster files
change only to synchronize Version/Build as required by RELEASE.md.

```text
.github/workflows/taskflow-build-parity.yml
app/Board/ai/index.html
app/Board/investment/index.html
app/Board/procurement/index.html
app/Board/template-preview/index.html
app/Board/worktodo/index.html
app/dashboard/index.html
app/dashboard/zhuge-dashboard.js
docs/index.html
docs/status-classic.html
index.html
labs/investment/app.js
labs/investment/index.html
labs/investment/src/portfolio/view.mjs
labs/investment/version.json
labs/taskflow/Dockerfile.web
labs/taskflow/access-management/index.html
labs/taskflow/access-management/panel.js
labs/taskflow/docs/GLOBAL_ACCESS_MANAGEMENT.md
labs/taskflow/index.html
labs/taskflow/overrides/taskflow-access-management.test.tsx
labs/taskflow/overrides/taskflow-access-management.tsx
labs/taskflow/overrides/taskflow-access-settings-test-block.txt
labs/taskflow/patches/apply-taskflow-access-management.py
labs/taskflow/tests/test_taskflow_access_management_overlay.py
modules/investment/index.html
modules/investment/version.json
modules/skyeye/index.html
modules/worklog/chat/index.html
modules/worklog/index.html
modules/worklog/version.json
shared/app-config.js
shared/config/template-release.js
shared/config/version.js
status-classic.html
tests/run-browser-regression.js
tests/taskflow-access-management-browser.test.js
version.json
```
