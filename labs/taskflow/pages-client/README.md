# Native TaskFlow Dashboard on the canonical GitHub Pages URL

**Source-only development. DO NOT deploy this directory as a second user-facing site or replace the existing Pages root until all gates pass.**

## Canonical experience — PM authority
- Dashboard URL exactly `https://qqweasdzxc.github.io/zhuge-ai-os/`.
- Full native TF functionality in that origin: view/edit Issues, Projects, Settings, AI Engineering, Members, GitHub sidebar, Desktop/Mobile and realtime. No redirect to Render web, iframe, synthetic data, partial copy or fake RUNNING.
- All authoritative TF database/API/WS stays at existing Render TaskFlow backend; old Render web may remain an implementation detail but NOT a redirected user's dashboard.
- TaskFlow ↔ Codex GitHub App is BLOCKED until this experience passes PM acceptance (Issue #57). This module does not configure GitHub App or access paid AI APIs.

## Engineering findings (2026-10-16)
1. Current `main` .9.58 `index.html` JS redirects to Render. PM expressly REJECTED as fulfillment.
2. Next.js 16 `third_party/multica/apps/web` is a server-side App Router with `proxy.ts`, request cookies/locale headers, standalone Node runtime and dynamic slug issue routes. GitHub Pages cannot host its Next backend or provide arbitrary route rewrites.
3. The pinned native Multica source already has a portable view/core UI layer: `@multica/views`, `@multica/ui`, `@multica/core`. Its Electron desktop renderer uses React Router and these shared packages. **Architectural target: browser Vite SPA shell around the original views** — do not fork new native TF business/UI rules.
4. Existing Zhuge SSO on the Pages origin already exchanges `zhuge_ai_os_google_auth_session_v1` with `POST https://zhuge-taskflow-api.onrender.com/auth/zhuge`. Native `/api/workspaces`, `/api/issues`, `/api/issues/{id}` return genuine workspace data. Source-only `taskflow-pages-api.mjs` exercises those exact endpoints.
5. The backend's cors middleware and WS use `CORS_ALLOWED_ORIGINS`. GitHub Actions `TaskFlow Pages Native Client Feasibility` proved read-only OPTIONS preflight from `https://qqweasdzxc.github.io` for `/auth/zhuge` and `/api/issues` **PASS**. WebSocket origin/actual authenticated browser requests remain to verify.
6. TaskFlow `CoreProvider` supports custom `StorageAdapter` and an existing React client. Do not let its defaultStorage persist a new TaskFlow bearer on `github.io`: all paths on that host share origin permissions. Pass `createTaskFlowPagesMemoryStorage()` to native CoreProvider and exchange Google token only after real Zhuge authentication; never persist TF bearer in URL, GitHub Pages source or browser localStorage.

## Source milestone A — complete
`taskflow-pages-api.mjs` provides:
- Canonical hostname guard (no Render origin spoofing);
- Existing-Zhuge-session credential exchange with real TaskFlow API, no hidden redirects, no raw-token export;
- Native workspaces, issues and exact issue query with server-side workspace slug scoping;
- Volatile CoreProvider-compatible token storage;
- Fail-closed invalid CORS, 401/403, malformed payload and workspace/Issue guards.
`tests/taskflow-pages-native-client.test.mjs` verifies all data is mocked only **inside CI tests**, never in user runtime. Workflow additionally checks production anonymous OPTIONS CORS live without using private keys.
This is **not the completed Dashboard and is not deployed**.

## Source milestone A2 — implemented and tested (not deployed)
`taskflow-pages-navigation.mjs` supplies a Pages-origin-only native navigation
adapter with the Dashboard at the exact root URL; workspace / issue / settings
deep-links remain on the same github.io host through hash routes. Handles browser
back, share links, new tab and refresh; rejects raw and percent-encoded dot
traversal before WHATWG URL path normalization. Offline native-route tests
validate hostile URLs as well as valid ZG-6 issue deep links. This is a route
adapter, **not** the native React Dashboard.

## Milestone B — native view SPA (pending)
- Build a Vite/browser React host against exact `third_party/multica` source pinned at SHA `8db6cfe19ae6fd5c35ec71bd8fea42a3ef3861ec`, using shared `@multica/core`, `@multica/ui`, `@multica/views` and native token-mode `CoreProvider`.
- Adopt React Router with Pages-safe base/hash navigation: root remains EXACT `/zhuge-ai-os/` for Dashboard; hash routes can carry issue/settings destinations and must survive hard refresh.
- Use original TaskFlow live views, i18n, design tokens, responsive sidebar and Issue detail surfaces. Replace Electron-only bridge calls with browser adapters, preserving original native business code and RBAC behavior.
- Native network must use `apiBaseUrl=https://zhuge-taskflow-api.onrender.com`, `wsUrl=wss://zhuge-taskflow-api.onrender.com/ws` (only after live WSS Origin verification). No token in WebSocket query unless the source's documented authorization contract supports it and is reviewed.
- Login failure can display a sign-in step; **must not silently bounce** between Pages, old WorkLog login and Render.

## Milestone C — parity, safety and release (pending)
- Live authenticated Desktop + iPhone QA on one official Pages site; create/update Issue, add comments, Project navigation, Settings, AI Engineering side panel and actual realtime across two tabs. No fake provider dispatch.
- Tenant/workspace RBAC and offline/service unavailable fail-closed; no cross-origin cookie bypass or third-party iframe. Test Google OAuth callback explicitly.
- Source/build/version/cache identity, FullSource ZIP/Manifest, Pages artifact and Preview-free CI gates; retain .9.58 homepage until all parity checks PASS and PM confirms Production GO.
- Only after root renders actual native TF Dashboard on Pages without changing URL and PM accepts: return to Issue #51 for GitHub App/Co integration.

## Hard production gate
A PASS of token exchange, CORS preflight, or synthetic CI tests **does not** establish native Dashboard functionality. Do not merge this source branch merely because Milestone A passes. Never call this a deployed or complete TF Dashboard until Milestones B+C pass and the user verifies the exact URL.
