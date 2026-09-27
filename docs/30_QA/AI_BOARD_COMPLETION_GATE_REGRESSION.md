# AI Board Completion Gate Regression Closure

## Finding

Build `20260810-2305` showed a workflow regression: QJC PM QA could be marked as passed, but a required GPT Review checklist row still blocked the `qa → done` transition. GPT Review is an engineering review performed at the Candidate gate; it is not a checkbox that QJC completes in the Board UI.

## Correct contract

The shared completion gate now requires:

- required Co Developer QA evidence is `pass` and has traceable evidence;
- required QJC PM QA evidence is `pass` and has traceable evidence;
- the existing controlled transition authorizes the `qa / QJC → done / QJC` operation;
- no Co or QJC required item is failed or incomplete.

GPT checklist rows remain visible as read-only Engineering Review Evidence / Audit. Their historical state and evidence are retained, but their checkbox state does not block QJC completion.

Both the PM QA completion button and Kanban drag/drop call the same `transitionTask` path and therefore use the same gate, controlled RPC, audit, and Realtime behavior.

## Regression cases

| Case | Scenario | Expected |
| --- | --- | --- |
| A | Co PASS, QJC PASS, GPT checkbox empty | `done` allowed; GPT evidence remains untouched |
| B | Co PASS, QJC FAIL | `done` blocked with a PM-readable correction message |
| C | Co evidence missing, QJC PASS | `done` blocked with a PM-readable evidence message |
| D | QJC PASS, drag `qa → done` | controlled transition succeeds |
| E | QJC PASS, PM QA button → Done | the same controlled transition succeeds |
| F | historical GPT evidence exists | evidence remains readable and does not become a completion gate |
| G | task already `done` | no further transition is available |

Automated coverage is in `tests/ai-board-cloud-read.test.js`. Browser coverage continues to exercise the real checklist presentation, read-only GPT row, controlled handoff actions, and Shared Shell. No direct DML, RLS bypass, Service Role exposure, or GPT evidence fabrication is used.

