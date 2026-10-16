# Official GitHub Pages TaskFlow homepage: home-only release scope
Updated: 2026-10-16
Scope authority: PM clarified **only fix the homepage now**; inner TaskFlow paths and apps are explicitly NOT in scope and may change in a later milestone.

## Binding acceptance criteria
1. When PM opens `https://qqweasdzxc.github.io/zhuge-ai-os/`, the **browser URL stays exactly on the GitHub Pages origin**. Root immediately renders an authenticated, live-data TaskFlow Dashboard (workspace, projects and issues), not the old public landing page, a Render JS redirect or an iframe.
2. Native TaskFlow dataset stays in the existing Render-backed Workspace/API/DB; no screenshots, mock counts or independent data replicas. No TaskFlow/Co GitHub App integration or extra paid provider.
3. Existing Zhuge login is reused; expired/absent session is a visible login state, NEVER a fabricated dashboard. The intentional login link preserves a short-lived same-origin return without leaking token in URL; OAuth callback and explicit `?app=1&workspace=...` routes remain intact.
4. **Do not rewrite or require all inner TaskFlow URLs to stay on GitHub Pages for this release**. Provide clear link through the existing `labs/taskflow/` trusted SSO launcher to the full TaskFlow on Render. Native dashboard issue detail may use same-origin hash navigation, but no claim of full Next.js parity.
5. Desktop/mobile responsive rendering, CORS origin restricted to `https://qqweasdzxc.github.io`, native Auth + Workspace RBAC, no new storage of backend service tokens. Preserve public legal/privacy pages.
6. New formal version/build identity, full source/browser release QA and verified Pages deploy. PM's live authenticated visual confirmation required to close release.
7. **GitHub App / TaskFlow↔Codex is a downstream blocked dependency**, held until homepage acceptance.

## Architecture
- `index.html` = the GitHub Pages root Dashboard entrypoint, loading `labs/taskflow/pages-client/app.mjs` and `app.css`.
- Pages code calls the existing native `POST https://zhuge-taskflow-api.onrender.com/auth/zhuge` using the existing browser-origin Zhuge session and holds the resulting TaskFlow bearer **in memory only**.
- Workspace reads `GET /api/workspaces`, `GET /api/issues`, `GET /api/projects`, `GET /api/issue-statuses`; task detail and comments readback use native endpoints + `X-Workspace-Slug`; browser has no privileged service-level app credentials.
- Existing `labs/taskflow/` maintains the secure launch/handoff for advanced TaskFlow operations and existing app pages.
- `modules/worklog/` handles Google OAuth and existing AIOS modules and uses scoped explicit return handoff.
- `tools/build-pages-site.js` publishes tracked static assets through the single existing `P0 TaskFlow Home and Curated Pages` workflow.
- The existing Render TaskFlow Node/Next.js backend is NOT copied to or run on GitHub Pages. The limitation on SSR and rewrites applies only to inner pages beyond this release scope.

## Evidence and release decision
- Source-only no-secret unit/browser tests MUST pass for absence of Render redirect, native API schema, origin retention, mobile, existing WorkLog routes, login return, unauthorized fail-closed and workspace identity.
- Read-only production OPTIONS preflight from the Pages origin to the Render API must pass; this does not substitute for authorized real-browser session validation.
- FullSource Build ID and strict Source Regression gate required.
- No GitHub App/Co/worker/Codex settings or credentials touched.
- If live login fails in actual PM browser, release stays in runtime QA until diagnosed; do not silently fall back to Render redirect.

## Phase 2 (intentionally deferred)
Full TaskFlow multi-route Next.js parity, native issue mutations, agents, realtime, deep-link server routing, files/attachments and permanent navigation changes. This is later work by PM direction, not acceptance criteria for this homepage-only fix.
