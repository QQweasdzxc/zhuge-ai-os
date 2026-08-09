# AI Board Batch #2 — PM QA Hotfix Developer QA

Runtime / Source Build: `20260809-2038`
Candidate type: **GPT Review Candidate** (not a Release)

## Candidate scope

This evidence covers the PM QA FAIL hotfix plus the approved TASK-032 usage-scenario and UI/UX cleanup slice:

- pre-defined TASK Development Contract / PM QA Checklist
- per-item checkbox, PASS/FAIL state, and Evidence
- explicit status/assignee-aware handoff actions
- removal of the dead QJC mode control
- working AI Board / 全部工作 / Engineering Center navigation
- TASK usage-scenario field: create → Cloud save → detail display → refresh persistence path
- removal of the prototype-only workspace/principle add entry points
- shared Zhuge AI OS navigation remains visible around AI Board and opens WorkLog, 待辦事項, Investment, Knowledge, 控制台, and 設定 directly

No new feature, `main` merge, production deploy, OAuth change, WorkLog logic change, or new Schema/RLS change was included.

## Root cause evidence

See [`AI_BOARD_BATCH_2_PM_QA_FAIL_RCA.md`](./AI_BOARD_BATCH_2_PM_QA_FAIL_RCA.md).

## QA results

| Check | Result | Evidence |
|---|---|---|
| JavaScript syntax | PASS | `node --check app/Board/ai/board-runtime.js` |
| AI Board unit/static tests | PASS | 8 passed / 0 failed |
| Full repository Node regression | PASS | 30 passed / 0 failed |
| Browser UI regression | PASS | `tests/ai-board-batch-2-browser.test.js` |
| Contract checklist is pre-seeded | PASS | Supabase `engineering_checklist_items` query: core tasks have 3 items; TASK-026/TASK-032 have 6 |
| TASK-026 action semantics | PASS | `qa / GPT` exposes `退回 Co` and `GPT Review 通過 → 交 QJC`; no direct Done action |
| Dead QJC mode button | PASS | removed from markup and runtime; browser fixture confirms absent |
| 全部工作 navigation | PASS | pointer/keyboard handler and browser fixture banner evidence |
| Search | PASS | browser fixture filters by TASK code and reports result count |
| TASK detail order | PASS | requirement → usage scenario → Development Contract／PM QA Checklist → next action |
| Usage scenario data path | PASS | Shared adapter selects `usage_scenario`; approved RPC migration accepts `p_usage_scenario`; historical NULL renders `尚未補充使用情境` |
| Create TASK UI | PASS | modal collects requirement, usage scenario, and title; success/failure banner is explicit |
| Unavailable entry points | PASS | no prototype “新增工作區” or principles “新增卡片” control is exposed |
| Shared Navigation / TASK-024 | PASS | AI Board is mounted inside the shared shell; global links remain available and WorkLog workspace query routes are preserved |
| `git diff --check` | PASS | no whitespace errors |
| Database migration | NO new hotfix schema change | Approved checklist seed/default SQL already applied; no RLS change |
| OAuth / Session / WorkLog | unchanged | source diff restricted to Board/docs/tests/approved checklist SQL |

## QJC persona UI/UX walkthrough

The developer-run browser walkthrough is recorded in
[`AI_BOARD_BATCH_2_HOTFIX_QJC_PERSONA_WALKTHROUGH.md`](./AI_BOARD_BATCH_2_HOTFIX_QJC_PERSONA_WALKTHROUGH.md).
It exercises the actual user path: Dashboard → AI Board → search → TASK detail →
requirement/usage scenario/checklist/evidence/next action → status-aware handoff →
全部工作／Engineering Center navigation → 新增 TASK modal. The browser fixture
passes this path, including explicit success feedback. Live authenticated QJC
production QA and final acceptance remain the next gate.

## Developer QA conclusion

**PASS — ready for GPT Review.** This navigation hotfix is included in the new candidate build. The artifact timestamp and Runtime Build are `20260809-2038`; QJC PM QA is the next gate and this report does not mark any TASK done.
