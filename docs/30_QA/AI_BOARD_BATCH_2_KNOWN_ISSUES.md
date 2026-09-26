# AI Board Development Batch #2 — Known Issues / Out of Scope

These findings are recorded without expanding the approved Batch #2 scope:

1. Live authenticated QJC browser QA and two-tab Realtime evidence must be completed during PM QA deployment.
2. GPT/Co actor writes are intentionally limited to a controlled service/tool path. No fake Auth accounts are created and no service key is shipped to the browser.
3. Checklist rows are structured and available, but existing tasks are not automatically backfilled with checklist items in this Batch.
4. Arbitrary custom workspace creation is not part of the fixed four-stage Board workflow.
5. The repository has no `package.json`; `npm test` is unavailable. Node's built-in test runner is used instead.
6. No Production Release, GitHub Pages deployment, `main` merge, or TASK `done` transition has been performed.
