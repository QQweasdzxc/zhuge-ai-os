# TF Dashboard as the canonical GitHub Pages origin — architecture gate
Date: 2026-10-16
Status: **NOT IMPLEMENTED / NOT RELEASE APPROVED**

## Binding PM requirement
Opening `https://qqweasdzxc.github.io/zhuge-ai-os/` MUST display and operate the **real, authenticated TaskFlow Dashboard** while the browser URL remains on the `qqweasdzxc.github.io` origin. Changes to navigation/task paths may remain under `/zhuge-ai-os/`. It MUST NOT navigate to `zhuge-taskflow-web.onrender.com` or to the WorkLog fallback, embed Render inside an iframe, or render mock task data. Render API and database can remain internal service authorities. GitHub App/Codex integration is a downstream task and is **frozen** until this is tested and accepted.

## Evidence from current source
- GitHub Pages is built by `tools/build-pages-site.js` and publishes tracked static HTML/JS/CSS through `.github/workflows/p0-home-apps-pages.yml`.
- Published `index.html` currently executes `window.location.replace("https://zhuge-taskflow-web.onrender.com/")` (PR #56 release .9.58): **a redirect, not the requested Dashboard**.
- Actual TaskFlow web is Next.js 16, `third_party/multica/apps/web`, compiled to `standalone` in `labs/taskflow/Dockerfile.web`. It relies on Next proxy/request middleware, server rewrites (`/api`, `/auth`, `/uploads`, `/ws`), the Next App Router and workspace route resolution.
- Rendering React without a URL change is not enough: real auth/bootstrap, per-workspace RBAC and token storage, multi-route navigation, issue updates, uploads and WebSocket reconnection MUST work.
- GitHub Pages cannot execute Next.js runtime middleware or act as an authenticated reverse proxy. `next export` is not a drop-in replacement for those server capabilities.
- The Pages origin cannot set or read HttpOnly cookies scoped to `onrender.com`. No copy/paste of personal OAuth secrets, browser cookies or bearer credentials to public Pages build artifacts.
- Because TaskFlow uses server-side Next routes, the feasible direction on this *specific hostname* is a separate **real client-side TaskFlow shell / SPA** reusing vendor components or carefully extracted shared views and APIs, served at a `/zhuge-ai-os/` base path. This is substantial product engineering and must be independently validated. Render remains the existing trusted API, DB and realtime authority.

## Mandatory research checks before implementation
1. Confirm Render API accepts the exact HTTPS GitHub Pages origin under a restricted origin allowlist for REST and WebSocket; confirm preflight and Authorization without exposing tokens. Do not widen CORS to `*`.
2. Reuse official TaskFlow login flow only if it safely supports Pages as a distinct origin. Existing Next session cookies are not automatically portable. Plan a scoped, audited SSO authorization-code / PKCE bridge if needed; do NOT put tokens in URL query strings.
3. Validate full SSR/Next dependency inventory, especially App Router, `next/font`, Next Link/navigation, cookies, image optimization, API rewrites, server actions, desktop/Mobile and authenticated root-page path semantics.
4. Implement real API-backed Dashboard: authenticated workspace list, native issue list, issue detail and updates, project navigation, layout and AI Engineering panel with honest disabled states. No static fake dashboard, no `iframe`, no unconditional Render redirect.
5. Configure same-origin deep-link fallback using Pages `404.html` SPA strategy without hijacking old `/modules/worklog` and OAuth callback routes; verify refresh and bookmarks.
6. Test real session, expired session, multi-workspace access denial, CRUD, mobile, WebSocket, files, navigation and direct deep links against **authorized** TaskFlow environment; never use production `ZG-6` as write test without explicit PM task GO.
7. FullSource, security, regression and PM acceptance MUST pass before main merge or Pages publish. Never deploy exploratory code over the currently working site.

## Release gates
- `PAGES_TF_ORIGIN_STAYS`: root and all routed Dashboard pages preserve `https://qqweasdzxc.github.io/zhuge-ai-os/` prefix; no Render frontend redirect.
- `PAGES_TF_REAL_DATA`: successful authenticated reads from the existing native TaskFlow API and authorized workspace.
- `PAGES_TF_AUTH_SAFE`: no session token in URLs or static source, origin-scoped protection, proper expiry/refresh.
- `PAGES_TF_FUNCTIONAL`: issue/project navigation, detail editing where authorized, WS, and mobile.
- `PAGES_TF_RELEASE_GOVERNANCE`: all automated security/full regressions and PM visual GO.
- `CODEX_GITHUB_FROZEN`: do not configure GitHub App, Co/Gem agent credentials or live dispatch until all above are complete.

The correct status until all gates pass is **BLOCKED / in development**; do not call .9.58 the accepted canonical TF Dashboard.
