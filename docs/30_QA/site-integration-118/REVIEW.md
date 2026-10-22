# Issue #118 — CO-03 site integration review

Baseline: main `12f7676f344bf6dd9d6f4486ef07db097f3642cd`, `.9.120`.
Scope: navigation, login-return routing, source readiness and isolated browser QA.

## SITE_MAP_DIFF / KEEP-CONNECT-GAP

KEEP: Pixel scene and role authority, native TF Issue/Runtime, WorkLog Auth/App Access, investment data and all backend/reporting remain their existing authorities.
CONNECT: office TaskFlow furniture now uses `labs/taskflow/` SSO; clock uses existing WorkLog login with `officeReturn=1`; existing approved-runtime post-login hook consumes this fixed-destination, expiring, one-use intent. Shared Shell and TF Apps expose Pixel Office return without replacing Dashboard. Pre-login/error WorkLog and TF entry retain a visible office return.
GAP: live OAuth/App Access, real iPhone Safari and production deployment are unverified. Unknown provider capability is not module readiness. The Pixel scene is generated from pinned Habblaud by its existing build pipeline, not a tracked `pixel-office/` directory.

## Canonical route / readiness matrix

`ZhugeSharedNavigation.siteMap(root)` derives module paths and disabled/visibility state from `DEFAULT_REGISTRY` and `destination`; it is a source inventory, not a second dashboard or ACL grant. TF Apps continues using its existing controlled overlay; Labs uses `labs/registry.json`. No extra registry replaces either.

| Surface | Existing route | Source / access boundary | Runtime |
| --- | --- | --- | --- |
| Pixel Office | `/` (docs alias `/docs/`) | existing Pages shell + generated pixel build | NOT_RUNTIME_VERIFIED |
| TaskFlow | `labs/taskflow/` → existing token handoff | existing Zhuge Auth / workspace ACL | NOT_RUNTIME_VERIFIED |
| WorkLog | `modules/worklog/?app=1&workspace=worklog` | existing Auth / App Access | NOT_RUNTIME_VERIFIED |
| Knowledge | same WorkLog, `workspace=library` | existing Auth / ACL | NOT_RUNTIME_VERIFIED |
| Management | same WorkLog, `workspace=management` | existing role/ACL, hidden for general user | NOT_RUNTIME_VERIFIED |
| AI Board | `app/Board/ai/` | existing shared Shell/Auth | NOT_RUNTIME_VERIFIED |
| WorkTodo | `app/Board/worktodo/` | existing shared Shell/Auth | NOT_RUNTIME_VERIFIED |
| GAS | `app/Board/procurement/` | existing registry/role visibility | NOT_RUNTIME_VERIFIED |
| Investment retained | `modules/investment/` | parked in TF Apps; existing office link retained, no new readiness claim | NOT_RUNTIME_VERIFIED |
| Investment Lab | `labs/investment/` | EXPERIMENTAL per existing Labs registry | NOT_RUNTIME_VERIFIED |
| Apps | existing TF sidebar | office entry opens TF SSO; no invented Apps route | NOT_RUNTIME_VERIFIED |
| SkyEye | `modules/skyeye/` | existing Auth / source only | NOT_RUNTIME_VERIFIED |
| HR / Travel | no enabled navigation destination | DISABLED / design only | NOT_RUNTIME_VERIFIED |

## ROUTE_MATRIX / QA_EVIDENCE

- Root and docs alias resolve TF/WL/IV/Apps under the same product prefix.
- Desktop 1440×900; portrait 390×844; landscape 844×390: actual root/furniture scripts, 44px rack links, no horizontal overflow, safe new-tab rel, clock stays in same context.
- Login return requires authenticated + accessApproved + runtimeReady; expiry, replay, unapproved, missing authentication/runtime, arbitrary returnTo parameter cannot redirect.
- Existing TF entry browser suite covers unauthorized/expired/403, network/HTTP errors, workspace readback and SSO.
- Screenshots under `tests/evidence/site-integration/` explicitly use SCENE_FIXTURE_ONLY; full pixel Canvas is separately built and smoke-tested by Pixel Office Review CI. Neither is PM Safari UAT.
- Readiness map exports SOURCE_ONLY / DISABLED, NOT_RUNTIME_VERIFIED; it never reports live quota, provider or runtime completion.

## CROSS_OWNER_FILES

Changes are limited to root furniture, shared navigation, existing login-return routing helper, static WL/TF return links, TF Apps navigation overlay, tests/workflows and formal release projections in this isolated branch. No SQL, Backend Handler, CO-02 reporting or Frozen Vendor edits. CO-01 should integrate reviewed source delta and resolve Version/Build centrally; never copy this review's identity over a newer release.

## BLOCKERS / PM_RUNTIME_QA_NEEDS

AUTH_RUNTIME_NOT_VERIFIED / PRODUCTION_NOT_DEPLOYED. PM must test real approved and denied accounts in Safari: clock → existing login → ACL approval → office, logout → office link, TF workspace selection and Apps return. No credentials, cloud role, OAuth configuration or production data were changed. No paid provider started.
