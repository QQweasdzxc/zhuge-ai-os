# TASK-35 Workspace Reorder Runtime Evidence

## Evidence boundary

This is local Developer QA evidence only. The TASK-35 migration was not applied
to Cloud, no Cloud data was changed, and the GitHub remote was not mutated.

The browser test uses the real shared Task Board renderer and the shared
ordering authority with a test persistence/read-back adapter. It proves the
local interaction contract; it is not PM/QJC Cloud acceptance.

## Verified flows

The existing canonical browser fixture captures WorkTodo and AI Board flows at
`1920×1080` and covers:

- newly-created workspace to the first position;
- completion workspace first, middle, and last;
- an `after` drop on the final target;
- reload/read-back order persistence;
- completion drag handles;
- no uncaught browser errors.

Tracked screenshots are under
`docs/qa/task-34-workspace-reorder/screenshots/`.

## QA results

| Gate | Result |
|---|---|
| Targeted TASK-35 / Module C tests | **73 PASS / 0 FAIL** |
| Full Regression (`BROWSER_EXECUTABLE` configured) | **906 PASS / 0 FAIL / 0 skipped** |
| Browser Regression | **19 PASS / 0 FAIL / 0 skipped** |
| Browser Regression standalone scripts | PASS |
| Desktop before/after and reload contract | PASS in local fixture |
| Mobile touch reorder | Not present; not expanded in this round |
| Cloud migration | Not applied |
| PM/QJC authenticated runtime | Pending |
