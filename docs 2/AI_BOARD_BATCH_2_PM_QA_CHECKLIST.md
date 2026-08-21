# AI Board Development Batch #2 — PM QA Checklist

Product Version: `v0.9.0-alpha.9.12`
Runtime / Source Build: `20260809-1903`
Artifact: `20260809_1903_ZhugeAIOS_v0.9.0-alpha.9.12_AI_Board_Batch2_Hotfix_GPT_Review_Candidate.zip`

## Access and Cloud Read

- [ ] Sign in as the authenticated QJC engineering member.
- [ ] Open AI Board from the Zhuge AI OS Dashboard.
- [ ] Confirm tasks come from Supabase `public.board_tasks`, not fixtures or browser storage.
- [ ] Confirm approved principles come from `public.engineering_knowledge` and appear in the fixed Principles area.
- [ ] Confirm the Board shows the current assignee (`QJC`, `GPT`, or `Co`).

## Workflow handoff

- [ ] `ready / Co` can move to `inprogress / Co` through the approved control.
- [ ] `inprogress / Co` can move to `qa / GPT`.
- [ ] `qa / GPT` can move to `qa / QJC`.
- [ ] `qa / QJC` can move to `done / QJC`.
- [ ] QA fail can return `qa / GPT` or `qa / QJC` to `inprogress / Co`.
- [ ] Disallowed jumps are rejected without changing the task.
- [ ] Dragging a card updates status and assignee through the controlled RPC.

## Checklist and evidence

- [ ] Open a task and confirm its pre-defined Development Contract / PM QA Checklist is already present.
- [ ] Confirm the checklist is grouped by Co Developer QA, GPT Review, and QJC PM QA stages.
- [ ] Tick an item to PASS and provide required Evidence; uncheck returns it to `not_verified`.
- [ ] Mark an item FAIL and provide Evidence; the failure remains visible to the next receiver.
- [ ] Confirm the next reviewer can independently read each item, state, checked actor, timestamp, and Evidence.
- [ ] Confirm required items are not treated as PASS when still `not_verified`.
- [ ] Confirm QJC is not asked to invent the acceptance criteria and no blank-checklist creation flow is shown.

## Realtime

- [ ] Open the Board in two authenticated browser tabs.
- [ ] Perform a controlled transition in one tab.
- [ ] Confirm the other tab updates without manual refresh.
- [ ] Record whether Realtime is PASS; refresh is recovery only, not a substitute for Realtime.

## Security and regression

- [ ] Anonymous access cannot read or write Board data.
- [ ] Browser requests do not contain a service key.
- [ ] QJC remains the only authenticated human owner; no GPT/Co Auth users exist.
- [ ] Dashboard, WorkLog, Investment, OAuth, Session, and existing navigation remain functional.
- [ ] No Production deployment or `main` merge is implied by this Candidate.
