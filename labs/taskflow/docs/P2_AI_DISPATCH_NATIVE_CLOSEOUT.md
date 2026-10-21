# AI dispatch native Workspace closeout

Scope authority: PR #109 comment 6304967030 (2026-10-21).

The TaskFlow-owned source-copy overlay installs `/[workspaceSlug]/ai-dispatch`
under the existing dashboard layout and adds one AI Team sidebar link. The
existing Kanban, native task state machine, Usage/Errors, authentication and
workspace membership remain unchanged. Frozen Multica source is not edited.

## Data and trust

- One native Issue ID identifies each work item. Links use native
  `paths.issueDetail`; no duplicate Issue or task database is created.
- The shared native ApiClient supplies the existing session and Workspace.
  Issue and runtime identity must match the currently selected Workspace.
- Native Issue metadata supplies only explicitly labelled work context and
  GitHub references. It cannot establish official Provider Run ID or RUNNING.
- Runtime is read only from `GET /api/issues/{id}/dispatch-runtime`, on demand
  for an expanded card or the native Issue Detail panel. No per-card background
  runtime requests or invented Workspace totals are used.
- Twenty native Issues are loaded per page. Executor/search/PM Inbox counts
  explicitly apply to that page; pagination preserves access to later Issues.
- PM Inbox distinguishes PM decision/acceptance from engineering failure or
  blockage. Metadata-derived requests are labelled as awaiting verification.
- Native terminal task status is labelled TaskFlow native task evidence and
  cannot imply official Provider success. Missing binding stays unverified.
- Start/dispatch controls in the new center remain disabled. No costs, quota,
  ACK, Run, heartbeat or official Provider execution is fabricated.
- API failures render errors with retry, never an Empty State.

## Verification and limitations

Overlay drift tests verify the route/sidebar/API patch and Frozen Vendor hashes.
Native component tests cover single-Issue links, five executors, no runtime
fan-out, forged metadata, identity mismatch, permissions, empty data and native
terminal status. The browser fixture mounts the same native React component,
native ApiClient, Workspace context and navigation with intercepted API data;
it is isolated QA, not a real-user session or Provider E2E result.

The fixture is injected only into the CI builder container. It is not copied
to Production public assets or hosted as another site. CI retains desktop,
mobile portrait and landscape screenshots. Exact-SHA CI and artifact evidence
are recorded in PR #109. No public Review hosting or authenticated PM UAT has
been established; the candidate route is not a deployed acceptance URL.

## Rollback

Review-only changes are retained in PR #109. main and Production stay at the
accepted Phase 1 baseline. No migration, DB write, ACL, Secrets or Provider
binding is introduced. Rejecting the Review leaves Production unchanged. A
future authorized release must retain its previous deployment anchors and
follow the existing forward-only version/build rollback policy.
