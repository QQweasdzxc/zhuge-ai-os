# Active Backlog Shared UX — Co Developer QA

## Scope

This checkpoint covers the currently authorized Shared UX / AI Board slices for TASK-014, TASK-015, TASK-023, TASK-024 and TASK-032. TASK-022 remains `qa / QJC` and is used as the workflow regression baseline; it is not re-developed here.

## Changes

- WorkLog now opts into the shared workspace-shell frame while retaining its existing WorkLog business panels and data flow.
- WorkLog shows the shared workspace context/header and common content surface on desktop and narrow viewports.
- AI Board task reads retain the separate PM contract fields (problem, objective, proposed solution, acceptance criteria, related work and notes) so the detail view can explain the request without inference.
- AI Board detail order is Requirement → Usage Scenario → Next Step → Checklist / Evidence.
- Checklist rows explicitly show what to verify, expected evidence, evidence location, verifier/time and the next action; missing evidence is never treated as PASS.
- PM-facing status, evidence and handoff copy is Traditional Chinese; engineering references remain detail-level evidence.
- The existing enabled/visible Shared Navigation registry and fixed Principles/System Map views remain the single navigation/data boundary.

## Developer QA evidence

Run from the repository root:

```text
node --check shared/board/board-read-service.js
node --check app/Board/ai/board-runtime.js
node --check modules/worklog/worklog-app.js
git diff --check
BROWSER_EXECUTABLE=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome node --test tests/*.test.js
NODE_PATH=/Users/qq/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules \
  BROWSER_EXECUTABLE=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome \
  node tests/investment/sprint-3-browser-regression.js
```

Observed result for this checkpoint:

- Automated suite: 55 passed, 0 failed, 0 skipped.
- AI Board Chrome fixture: PASS at 1600×1000.
- Investment Chrome regression: PASS at 1440×1000.
- JavaScript syntax: PASS.
- `git diff --check`: PASS.
- No OAuth, Supabase Auth, RLS, Service Role, WorkLog business logic or Production configuration change.

The existing WorkLog live-page probe with a synthetic browser token is not considered product PASS: Supabase correctly rejected the non-JWT token (401). A real signed QJC session is required for live Cloud browser QA; no evidence is fabricated for that path.

## Scope boundary

No Candidate ZIP, Runtime Build change, Release, GitHub Pages deployment, or `main` merge is performed at this checkpoint. GPT and QJC checklist stages remain unverified until their independent review and PM operation.
