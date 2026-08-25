# Dashboard / WorkLog Task Navigation UX Handoff

## Scope

This visual/interaction polish keeps the existing WorkLog data and Drawer flow. It makes the task order predictable and gives the Dashboard a direct, current-user path into an individual task.

## Delivered behavior

- The full 工作待辦 list and Dashboard「我的待辦事項」use one recent-update ordering contract, with created time and title as deterministic fallbacks.
- Dashboard shows up to five active tasks in that same order.
- Dashboard「＋新增待辦」opens the existing WorkLog task Drawer; no second task creation flow was added.
- Selecting a Dashboard task opens the existing 工作推進紀錄 Drawer for that exact task and scrolls the corresponding WorkLog row into view.
- Full-page task journal previews are collapsed by default to reduce the long, dense list while keeping the existing timeline available on demand.

## Boundaries

No database, Supabase, schema, RLS, Auth, OAuth, identity, or business-logic changes were made. Existing task records, journal records, and persistence paths are reused.

## QA

- JavaScript syntax: PASS
- `git diff --check`: PASS
- Automated regression: PASS (82 passed, 0 failed, 0 skipped)
- Browser regression: PASS under configured macOS Chrome executable
