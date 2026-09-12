# AI Board Batch #2 — PM QA FAIL RCA / Hotfix Evidence

## Scope

This hotfix addresses only the PM QA findings for the existing Batch #2 Candidate. It does not change OAuth, WorkLog, Dashboard, Database Schema, RLS policy direction, Product Version, or Runtime Build. No `main` merge or deployment is performed.

## Root causes

1. **Checklist was an empty operational surface.** The original Batch #2 migration created the structured checklist table and RPCs, but existing TASK records had no seeded Development Contract items. The UI consequently presented an empty state and invited QJC to create acceptance items, reversing the intended Co → GPT → QJC evidence flow.
2. **QJC mode was a label without a behavior.** The top action was enabled and renamed by `enableBoardActions()`, but no click handler or state transition was attached. It was therefore a dead control.
3. **全部工作 navigation was static markup.** The nav item had no event handler, so it provided no visible behavior. The runtime now binds keyboard and pointer activation to explicit board navigation feedback.
4. **Handoff labels exposed implementation vocabulary.** Task detail rendered generic `交接至 <assignee>` actions and exposed all actions for every `qa` task. TASK-026 (`qa / GPT`) therefore showed ambiguous and invalid choices. Actions are now derived from current status/assignee and use explicit human-readable labels; direct `qa / GPT → done` is rejected.

## Fixes

- Seeded a pre-defined three-stage Development Contract for existing active TASK records, with TASK-026 and TASK-032 acceptance-specific items.
- Updated `board_create_task` so every new TASK receives Co / GPT / QJC checklist items in the same controlled transaction.
- Replaced the blank-checklist creation UI with a read-only contract presentation and per-item checkbox, PASS/FAIL action, and Evidence capture.
- Added required-item summary and explicit missing-contract error state.
- Removed the dead `QJC 可操作模式` button.
- Wired AI Board, 全部工作, and Engineering Center navigation for mouse and keyboard activation.
- Added status/assignee-aware handoff labels, including `退回 Co`, `GPT Review 通過 → 交 QJC`, and `PM QA 通過 → 完成`.

## Changed files

- `app/Board/ai/board-runtime.js`
- `app/Board/ai/index.html`
- `docs/supabase/20260809_ai_board_batch_2.sql`
- `docs/supabase/20260809_ai_board_batch_2_checklist_seed.sql`
- `docs/supabase/20260809_ai_board_batch_2_task_checklist_default.sql`
- `docs/AI_BOARD_BATCH_2_PM_QA_CHECKLIST.md`
- `docs/AI_BOARD_BATCH_2_PM_QA_FAIL_RCA.md`

## Developer QA evidence

- JavaScript syntax: PASS (`node --check app/Board/ai/board-runtime.js`)
- Existing Batch #2 unit/static tests: PASS (8 passed / 0 failed)
- Browser UI regression fixture: PASS (see `tests/ai-board-batch-2-browser.test.js`)
- Database migration: only the approved checklist seed/default follow-up was applied; no new schema or RLS change in this hotfix.
- OAuth / Session / WorkLog logic: unchanged.

## Known issues / out of scope

- Live authenticated two-tab Realtime evidence remains a GPT/QJC deployment QA step; this hotfix does not change the existing Realtime adapter.
- GPT/Co actor writes remain on the controlled service path; the browser continues to operate as the authenticated QJC owner.
- No TASK is marked `done`; no release or production deployment is implied.
