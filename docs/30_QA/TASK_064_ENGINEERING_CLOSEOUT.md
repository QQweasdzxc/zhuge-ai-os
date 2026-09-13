# TASK-064 Engineering Closeout

Status: `ENGINEERING COMPLETE / PM RUNTIME QA PENDING`

This is the current closeout record for the TASK-064 same-data WorkTodo
cutover and the optional Workflow/lifecycle contract. It does not retire the
old entry, delete legacy storage, or create a Final Candidate. The earlier
`C_CONSUMER_LIFECYCLE_FINAL_EVIDENCE.md` remains as historical evidence of the
former E mapping stop; this document records the later approved same-data
cutover state.

## Source and runtime boundary

- Product version: `0.9.0-alpha.9.13`
- Runtime build: `20260912-0921`
- Implementation source checkpoint validated before this documentation
  checkpoint: `7e8a0eaa8313dab1cb558053bab48937868ebf0e`
- Branch: `codex/task-063-delete-card-20260907`
- Protected Candidate source remains
  `6131cb9b267bedbd308e855645344bcc493279e0`
- WorkTodo Board Instance: `0b2b5c4e-6767-4792-a97a-d2ddf42e60da`

No product Source runtime behavior was changed during this closeout. The
documentation checkpoint and the explicitly authorized QA-data actions are
separate from the protected Candidate.

## Engineering gate

| Gate | Result | Evidence |
|---|---|---|
| Same-data identity | PASS | Live Cloud: 33 `board_tasks`, 33 distinct Card UUIDs, 33 distinct WLTK codes; no clone or second Board Instance |
| Workspace integrity | PASS | Live Cloud: 7 active WorkTodo Workspaces; 6 contain cards and 1 is the empty `完成` designation target where applicable to card usage |
| New Writer | PASS by Source/Contract QA | `golden-master-runtime.js` uses the C Instance service for `worktodo`; shared create/edit/move/completion paths are the only new-runtime writer surface |
| Old entry | PASS by Source/Contract QA | `?consumer=worktodo-old` is a comparison entry; the service boundary blocks mutations with `WORKTODO_OLD_READ_ONLY` |
| Dual Writer | PASS for current Board data | New WorkTodo writes `board_tasks`; the remaining `user_tasks` trigger is isolated compatibility/rollback storage and is not the current WorkTodo Board route |
| Optional Workflow | PASS | Missing Workflow is legal N/A; a configured completion designation is resolved by stable `workspace_key`, without a fake Workflow |
| Completion designation | PASS | Live Cloud resolves `worktodo-completed` / `完成` as the WorkTodo completion designation |
| 24-hour lifecycle | PASS by Contract/Cloud read-back | Published policy v2 is `86400` seconds; policy v1 `172800` is retired; existing due times are not retroactively recalculated |
| Background scheduler | PASS | Live Cloud job `module-c-completion-archive-v2`, active, `*/5 * * * *`; latest five runs completed with zero errors |
| Authority Checker v2 | PASS by automated contract/source QA | Current Cloud function definition sets legacy route reachability to false for the current C route and keeps old `user_tasks` objects as compatibility evidence; authenticated invocation remains a PM/runtime-visible check |
| Reload/persistence | PASS by automated contract QA | Shared C load path reads Cloud state; no localStorage fallback is used as formal state |
| C consumer boundaries | PASS by automated contract QA | C Mother optional, AI Board shared C, WorkTodo shared C, GAS fail-closed/optional, Investment read-only |

## Cloud read-back

Read-only verification against project `lenpbbhwxyyfwgvjcozf` confirmed:

- WorkTodo Board Instance is active, `template_key = c`, application scope
  `worktodo`, prefix `WLTK`.
- The formal WLTK set is 33 cards with unique IDs and unique work codes.
- `WLTK-049` is absent. No other WorkTodo Board card was deleted by the
  cleanup action.
- The stable completion designation is Workspace
  `1ac5492b-a333-4373-bab2-75cd2a0eb746`, key `worktodo-completed`, name
  `完成`.
- The current published completion-archive policy is
  `module-c-completion-archive-policy` v2 at `86400` seconds / 24 hours.
- Scheduler job id `1` is active and its five most recent read-backs were
  `completed` with `error_count = 0`.
- The raw SQL read-only session cannot invoke the authenticated-only checker;
  it correctly returned `42501` (`Authority Conformance Check 需要登入身分`).
  No JWT claim impersonation or security-boundary bypass was used.

## PM QA task state

Existing task retained; no duplicate task was created:

- Code: `TASK-077`
- ID: `fb895d5c-0990-49ab-8333-19892403b6be`
- Title: `TASK｜WorkTodo Same-Data Runtime Cutover QA`
- Board: AI Board (`74ff1127-ab98-4543-8f69-872e5d92fd33`)
- Workspace: `QJC驗證` (`2e3e4bc8-0bf3-4e6d-aa2c-cb1d75df7038`)
- Cloud status: `qa` / UI label `等待驗證`
- Checklist: 22 unique items, `0/22` complete, all still Pending
- `「工作待辦（舊）」正常開啟` occurs exactly once after duplicate cleanup

The checklist is an acceptance request, not an automated PASS marker. PM must
still verify the browser/runtime items, including the old read-only boundary,
same-data comparison, New WorkTodo writes, Reload, New Session, and the
Authority Checker presentation.

## Automated tests

Targeted TASK-064/C/WorkTodo gate:

- `84 tests / 84 PASS / 0 FAIL / 0 SKIP`

Full suite:

- `471 tests / 465 PASS / 0 FAIL / 6 SKIP`
- The six skips are existing browser regressions requiring a configured local
  Chrome/Chromium executable: AI Board browser UI, PM/QJC drawer drag,
  C-publish browser UI, Creator MFA browser UI, collapsed-rail browser UI, and
  WorkTodo Shared Drawer browser UI.
- No test failure was introduced by this closeout.

Additional gates:

- JavaScript syntax checks: PASS
- `git diff --check`: PASS
- Release preflight: PASS (`0.9.0-alpha.9.13` / `20260912-0921`)

## Authorized data mutation summary

- `WLTK-049`: deleted through the existing authenticated UI/Delete Contract
  after the prior read-back identified it as the QA/runtime accidental card.
- Formal WorkTodo cards/workspaces: no card/workspace mutation; current
  read-back remains 33 unique WLTK cards and 7 Workspaces.
- PM QA task: one duplicate checklist item was removed; the remaining
  checklist was completed to 22 unique Pending items through the existing
  checklist contract.
- Schema/Migration/Production lifecycle data: no change in this closeout.

## Closeout state

`ENGINEERING = COMPLETE`  
`PM RUNTIME QA = PENDING`  
`LEGACY RETIREMENT = WAITING FOR PM QA`  
`FINAL CANDIDATE = WAITING FOR PM QA`

The retirement decisions and rollback boundary are recorded separately in
`TASK_064_RETIREMENT_MANIFEST.md`. No old entry, legacy trigger, RPC, or
storage object is removed or disabled by this closeout.
