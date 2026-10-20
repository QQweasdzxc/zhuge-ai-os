# TaskFlow DM-00～DM-03 Review Handoff

## Identity

- Engineer: `CO-02`
- Scope: `DM-00`～`DM-03`
- Review branch: `review/dm00-dm03-taskflow-dispatch-20261020`
- Base SHA: `20df367bb6094545bf65767fb52f4df532279906` (`origin/main` at task start)
- Formal Build: `20261020-1123`
- Production / main: unchanged
- Migration / #42 SQL: not applied

## Delivered

The canonical TaskFlow Dashboard and its standalone Pages client now share one native DM entry. PM can enter work code, owner code, priority, next step, source evidence, acceptance, and an optional native Agent. The client creates an existing TaskFlow issue, writes the existing per-issue metadata KV, and keeps the native issue ID as the only task identity.

Assignment uses the existing `/api/agents` and `PUT /api/issues/{id}` contract with `suppress_run: true`. Start uses the existing `POST /api/issues/{id}/rerun`; a successful HTTP 202 is shown as `ACK_PENDING` with the real TaskFlow `task_id`. `RUNNING` comes only from native `task-runs` readback. A provider Run ID remains `未取得` until a provider returns one.

GitHub evidence uses the existing native PR association endpoint for an already mirrored PR. Issue URL, PR URL, commit URL, CI URL, and exact SHA are stored on the same native issue metadata. The native PR response now exposes `head_sha`, so a matching mirror can replace a manually recorded SHA with the server readback and mark its source.

The contract is recorded in [DM00_DM03_NATIVE_DISPATCH_CONTRACT.md](../../labs/taskflow/docs/DM00_DM03_NATIVE_DISPATCH_CONTRACT.md). No second task database, provider simulation, GitHub comment trigger, animation state, Supabase migration, secret, Render setting, or Production write was added.

## GEM-01 interface

DM-04 can consume the same native issue fields: `identifier`, `metadata.zhuge_*`, `assignee_id`, `GET /task-runs`, and `GET /pull-requests`. The UI must preserve the distinction between `task_id`, `provider_run_id`, `status_source`, `observed_at`, and error evidence. No BFF-specific task ID is required by this slice.

## Verification

- `node --test tests/taskflow*.test.mjs tests/taskflow*.test.js` — **46 passed**.
- Browser coverage includes canonical status Dashboard, standalone Pages client, desktop/mobile layout, native create-card POST, metadata writes, authentication failure, SSO handoff, and exact workspace scoping.
- `node tools/taskflow-pages-feasibility.js` — `DM_REVIEW_CANDIDATE_READY_FOR_RUNTIME_QA`; `deploymentAllowed: false`; `pmRuntimeQARequired: true`.
- `git diff --check` — passed.

## Remaining gates

The branch is Review source only. PM/GPT still need to review the exact commit before any push. Formal DB write permission, paid/provider execution, Production deployment, and runtime acceptance remain separate gates. If a provider or native runtime refuses a request, the card must remain `BLOCKED`／`UNSUPPORTED` with the returned reason.

## Next handoff step

GEM-01 can build DM-04 against this contract. CO-02 can then add provider capability/readback adapters only after the provider matrix and authorization gate identify a real cloud execution path; unsupported capabilities must stay explicit.
