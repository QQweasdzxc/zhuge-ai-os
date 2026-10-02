# Zhuge AI OS — Codex Cloud Handoff

## Document purpose

This is the formal handoff contract for a new Codex Cloud Agent that has not
participated in the preceding Zhuge AI OS conversation.

Read this file together with the repository source and governance documents
before taking any implementation action. This document contains no Secret,
Token, Password, API-key value, service credential, private key, or browser
session.

Audit time: 2026-10-02, Asia/Taipei

## 1. PROJECT IDENTITY

| Item | Current value |
|---|---|
| Project | Zhuge AI OS |
| Product Version | 0.9.0-alpha.9.13 |
| Candidate Runtime Build | 20261001-2324 |
| Canonical branch | main |
| Canonical Source Baseline Commit | 6e459bcdbc0220c2db5fee206a66370dbc36fd41 |
| Canonical Release Tag | AIOS-CANONICAL-20261002-2229 |
| GitHub repository | https://github.com/QQweasdzxc/zhuge-ai-os |
| Formal local repository used for the freeze | /Users/qq/Documents/GitHub/zhuge-ai-os |
| Root identity source | version.json |
| API contract version | v1 |

The Source Baseline Commit is the commit frozen and tested immediately before
this documentation-only handoff. The release tag resolves to that commit.
The only intended change after that baseline is this CLOUD_HANDOFF.md file;
the handoff document must not be confused with a new application-runtime
release. The final handoff commit is recorded by Git itself after this file is
committed and pushed.

The current FullSource Candidate produced from the Source Baseline is:

- Filename: 20261001-2324_Zhuge_AI_OS-v0.9.0-alpha.9.13-Canonical-20261002-FullSource-Candidate.zip
- File count: 918
- ZIP size: 19,889,022 bytes
- SHA-256: 119aedfbcbb2d7533a5b57b93b640aa6f6663edae9f42db74995e167975d29a0
- Manifest: same filename with .manifest.json appended
- Source-to-ZIP consistency: PASS
- ZIP integrity: PASS
- Artifact Created At: 2026-10-02 22:30:23 Asia/Taipei

The artifact is a source/deployment package, not proof that Production or
Supabase Cloud has been deployed or accepted.

## 2. CURRENT ARCHITECTURE

### 2.1 High-level system

Zhuge AI OS is a browser-oriented application with:

- static HTML, JavaScript, CSS, and public assets in app, shared, modules,
  public, and root entry files;
- a shared shell, navigation registry, authentication boundary, runtime
  services, task drawer, Board runtime, and action contracts;
- Supabase Postgres as the governed data and authorization backend;
- database functions/RPCs, triggers, RLS policies, migrations, and read-back
  contracts under the Supabase and docs/supabase areas;
- server-side Edge Functions under supabase/functions for protected,
  provider-facing, or server-only operations;
- browser and runtime QA fixtures under tests and tools/runtime.

There is no second local database authority, browser-side direct DML
authority, or module-specific replacement for the shared Board runtime.

### 2.2 Module C

Module C is the shared Board runtime and authority used by the formal Board
consumers, including:

- AI Board;
- WorkTodo;
- GAS / Procurement;
- Investment / IVTK;
- the C Motherboard and future C adopters.

The C Motherboard creates a consumer Board through the shared UI and runtime,
the shared Board service, and the canonical
board_provision_c_consumer_v2 RPC. Provisioning is atomic and initializes the
configured C adoption/default Workspace contract.

The shared runtime owns common Board behavior. Consumer adapters supply
domain-specific read or presentation details without creating a competing
Board, navigation, numbering, or action authority.

### 2.3 Shared UI and runtime authorities

- Shared Golden Master UI: shared/components/golden-master.js
- Shared Golden Master runtime: shared/components/golden-master-runtime.js
- Shared Board read/write boundary: shared/board/board-read-service.js
- Shared navigation registry: shared/components/zhuge-navigation.js
- Shared workspace ordering authority:
  shared/components/workspace-ordering-authority.js
- Shared action contract/adapters:
  shared/components/task-action-contract.js and
  shared/components/task-action-adapters.js
- C runtime entry: app/Board/template-preview/index.html

The shared navigation registry discovers active Board instances and routes
through boardInstanceId. Do not add a second navigation registry or a local
storage-based Board registry.

### 2.4 Supabase and Edge Functions

Supabase is the backend authority for:

- Board instances, Workspaces, Tasks, workflow state, activity, evidence,
  attachments, and governed history;
- RLS and Board instance access checks;
- canonical RPC writers and server-side lifecycle routines;
- scheduler-backed Module C completion/archive behavior;
- protected provider and runtime operations exposed through Edge Functions.

The browser uses the shared gateway/service and canonical RPC paths. Do not
replace these with direct SQL, direct table writes, service-role impersonation,
or client-side secrets.

### 2.5 GitHub and runtime relationship

- GitHub main is the canonical source branch.
- A commit or tag identifies source; it does not automatically deploy
  Production or change Supabase Cloud.
- The Candidate Build comes from root version.json.build.
- Published C identity is a separate persisted release/adoption identity and
  may have a different build from the current Candidate Runtime Build.
- Runtime, Cloud, Published C, and PM acceptance are separate gates and must
  be read back independently.
- The current Candidate package was generated by
  tools/release-governance.js and passed Source-to-ZIP validation.

### 2.6 Single Source of Truth and authority map

| Domain | Canonical authority |
|---|---|
| Source | GitHub repository, main, exact commit/tag |
| Candidate Build | root version.json.build |
| Module release/adoption | persisted release/adoption contract and its guarded service/RPC path |
| Shared UI behavior | Golden Master/shared runtime |
| Navigation | Shared Navigation registry |
| Board/task reads and writes | Shared Board service/gateway plus canonical RPCs |
| Workspace ordering | Module C Workspace Ordering Authority and canonical reorder RPC |
| Completion/archive | Module C Completion/Archive Authority, completion-entry timestamp, server-side scheduler/RPC |
| Permissions | Supabase Auth, RLS, Board instance authorization, owner/tenant scope |
| QA evidence | committed evidence plus test output tied to an exact source commit |
| Release package | release-governance.js ZIP and sidecar manifest |

Protected identity is not the same as fixed display position. Workspace delete,
semantic identity, ownership, and RLS protection must remain separate from
Workspace ordering.

## 3. CURRENT PM / CO WORKFLOW

### PM

PM is the final Human Authority. PM decides scope, authorizes Cloud or
Production mutation, accepts runtime behavior, and decides whether a
Candidate becomes an accepted baseline.

### GPT

GPT is the PM Proxy and CTO-level first-class actor. GPT performs architecture
review, governance review, decision framing, and release review. GPT must not
self-authorize Production, Cloud, or PM acceptance.

### Co

Co is the implementation/execution actor. Co inspects the current state,
implements an explicitly authorized task, runs Developer QA, records truthful
evidence, and stops at the requested gate.

### Codex

Codex is the coding and Developer QA actor. Codex inspects source, implements
scoped changes, runs tests, verifies source/runtime contracts, and reports
what is source-verified versus still runtime-pending.

### Developer QA

Developer QA covers source, unit/integration contracts, targeted tests,
regression tests, browser fixtures, release preflight, and package
integrity. Developer QA is not PM acceptance and is not proof of a live
Supabase/Production deployment.

### GPT Review

GPT Review checks architecture, authority boundaries, source identity,
regression evidence, security/governance claims, and whether the work should
advance to runtime review. It is a separate gate, not an inferred result of
passing tests.

### QJC Runtime QA

QJC is the Runtime QA and human gate. QJC uses an authorized/signed runtime
session where required, checks live Cloud read-back, browser behavior,
permissions, and user-visible evidence. Missing authentication, unavailable
Cloud access, or a 401 remains pending; it must not be fabricated as PASS.

### Completion

A task is complete only when the requested source work, Developer QA, required
GPT Review, and required QJC/PM runtime or Cloud gates are actually satisfied.
Source PASS does not imply Runtime PASS, Cloud PASS, Deployment PASS, or PM
Accepted Baseline.

Default sequence:

PM scope/authority
→ Co implementation
→ Codex Developer QA
→ GPT Review
→ QJC Runtime QA
→ PM decision/acceptance

## 4. CURRENT STATUS

### Completed and verified

1. Module C Workspace Ordering Authority is in the canonical source.
   Existing, system, newly created, and Completion Workspaces are reorderable;
   first, middle, and last placement is covered; canonical order is persisted
   and read back; protection is separate from position.
2. Module C Completion/Archive Authority is in the canonical source.
   Completion entry time is the timestamp authority, the policy is 24 hours,
   moving out of Completion cancels the current countdown, re-entry starts a
   new countdown, archive is not delete, and the server-side writer is
   idempotent/auditable.
3. C Board consumer provisioning, default Workspace initialization, adoption,
   shared runtime, and shared navigation are present.
4. Legacy application writer paths relevant to the current C migration are
   fail-closed or retired according to the source contracts.
5. Current source freeze was committed, pushed, tagged, and packaged.
6. FullSource ZIP and sidecar Manifest passed source identity, archive
   integrity, and Source-to-ZIP consistency verification.
7. The read-only Board/Workspace lifecycle audit found that Board creation
   exists, while Workspace transfer between Board instances is missing.

### Current handoff activity

The project is being transferred to Codex Cloud. This handoff file is the
only intended application-repository change in this handoff task.

### Pending / not completed

- Production deployment has not been executed.
- Supabase Cloud migration or scheduler application has not been executed in
  this handoff.
- PM/QJC live runtime acceptance and Cloud read-back remain separate gates.
- Workspace transfer from Board A to Board B is not implemented.
- There is no persisted Workspace number/sequence or number-reclaim feature;
  current Workspace position is sort_order.
- Published C identity is intentionally separate from the Candidate Build;
  some persisted consumer adoption records can remain pending reload until an
  explicitly authorized publish/reload flow occurs.

### Known blockers or gates

- Cloud Agent must not assume that source, GitHub, Candidate, Published C,
  runtime, and PM acceptance are the same state.
- Live Cloud work requires the correct authenticated human/runtime gate and
  explicit PM authorization.
- The current two PM-created WorkTodo Workspaces are populated and must not
  be moved or edited as part of handoff. A read-only audit found:
  - 壽德待辦: 10 Tasks, 11 Activity rows, 3 Attachments
  - 台中點鑽待辦: 2 Tasks, 26 Activity rows, 4 Attachments
- No cross-Board Workspace transfer authority exists. Do not simulate one with
  a direct board_instance_id update.

### Areas to avoid without a new explicit task

- Do not apply Supabase migrations, alter Cloud rows, or change RLS.
- Do not deploy Edge Functions or Production.
- Do not change API contracts, DB schema, or runtime configuration casually.
- Do not create a second Module C, Board Registry, Navigation Registry,
  numbering system, Workspace ordering authority, or completion/archive timer.
- Do not modify the two PM-created WorkTodo Workspaces.
- Do not silently renumber Tasks or Workspaces.
- Do not reopen or merge the closed legacy PR #32.
- Do not turn the isolated Gloomberb or God's Eye View evaluations into
  Zhuge integration work.
- Do not modify Investment, Lab, or unrelated modules without a newly
  authorized scope.
- Do not treat the local Candidate ZIP, source tests, or a successful push as
  Production or PM acceptance.

## 5. CRITICAL RULES

### Canonical and SSOT rules

1. Start every task with Current State: repository, branch, HEAD, remote,
   working tree, relevant Cloud/runtime gate, and existing task/documentation.
2. Preserve existing work. Never reset, clean, overwrite, or delete user
   changes without explicit authority.
3. Use the existing shared authority before creating a new helper, service,
   RPC, registry, or numbering model.
4. Keep Candidate Build identity and Published C identity separate.
5. Keep source verification, Cloud/runtime verification, PM acceptance, and
   deployment status separately labeled.

### API, DB, RLS, and Edge Function rules

1. Do not change an API/RPC signature or retire a writer without a scoped
   task, contract evidence, and review.
2. Browser code must not perform direct governed DML or carry privileged
   credentials.
3. Use the shared gateway/service and canonical RPCs.
4. Preserve RLS, Board instance scope, owner/tenant scope, immutable identity
   guards, and workflow invariants.
5. Edge Functions are server-side boundaries. Keep provider calls and
   credentials server-side, bounded, and fail-closed.
6. A migration file in the repository is source evidence only. It is not
   proof that Cloud applied the migration.
7. Never put a Secret, Token, Password, API-key value, private key, session
   state, or service credential in this file, source, tests, ZIP, or manifest.

### Production and Cloud mutation rules

- Default: no Cloud mutation, migration apply, deploy, production cutover,
  publish, or provider activation.
- These actions require explicit PM authority and the canonical controlled
  path.
- Read-only Cloud inspection may confirm state; it must not be described as
  runtime acceptance without the required signed human gate.
- Do not use service-role impersonation, direct SQL/DML, bypasses, or
  self-signed authorization.

### Git and branch rules

- Canonical branch is main.
- The current release tag is AIOS-CANONICAL-20261002-2229.
- Future implementation should use the branch/worktree explicitly authorized
  by PM. Do not work directly on main unless the task explicitly requires it.
- Do not force-push, rebase shared history, reset --hard, delete branches,
  create a PR, merge, or deploy unless explicitly authorized.
- Before commit, inspect staged diff, run the required QA, and verify clean
  source identity.
- Candidate ZIPs are append-only and must not overwrite an existing ZIP or
  Manifest.

### Test and regression rules

- Node runtime requirement: Node 20 or newer.
- Install pinned dependencies with npm ci when the environment requires it.
- Run targeted tests for the changed authority and its adopters.
- Run Full Regression: node --test tests/*.test.js.
- Run Browser Regression with a real Chromium/Chrome executable:
  npm run test:browser.
- Do not turn skipped, unavailable, or unauthenticated checks into PASS.
- Run git diff --check and release preflight before packaging.
- Package only from a clean working tree.
- Verify unzip integrity, forbidden entries, Manifest identity, SHA-256, file
  count, and Source-to-ZIP consistency.

## 6. CURRENT TEST BASELINE

The following baseline was verified during the current freeze cycle against
the Source Baseline Commit. The final freeze commit after the test run changed
only four generated browser-evidence PNGs; no application source was changed.

| Gate | Command / scope | Result |
|---|---|---|
| Targeted | Module C completion/archive, workspace ordering/reorder, C provisioning/adoption, WorkTodo writer closure, release governance, deployment readiness | 89 passed / 0 failed / 0 skipped |
| Full Regression | node --test tests/*.test.js | 804 passed / 0 failed / 0 skipped |
| Browser Regression | npm run test:browser with Google Chrome | 19 passed / 0 failed / 0 skipped |
| Browser standalone scripts | responsive preview, desktop preview, Investment screenshot import, Investment Sprint 3, Lab Investment E2E | 5 PASS |
| Release preflight | node tools/release-governance.js preflight | PASS |
| Diff gate | git diff --check | PASS |
| Candidate package | release-governance.js package with paired Manifest | PASS |
| ZIP integrity | unzip -t and extracted source comparison | PASS |

The Full Regression run emitted only an existing Node ESM module-type
performance warning. It did not produce a test failure.

## 7. IMPORTANT PROJECT FILES

Read these first, in this order:

1. CLOUD_HANDOFF.md
2. AGENTS.md
3. README.md
4. version.json
5. package.json
6. tests/README.md
7. tools/README.md
8. docs/README.md
9. docs/40_RELEASES/ACTIVE_BACKLOG_CANDIDATE_HANDOFF.md
10. tools/release-governance.js
11. tests/release-governance.test.js
12. tests/release-consistency.test.js

Shared runtime and authority:

- shared/components/golden-master.js
- shared/components/golden-master-runtime.js
- shared/components/zhuge-navigation.js
- shared/components/workspace-ordering-authority.js
- shared/components/task-action-contract.js
- shared/components/task-action-adapters.js
- shared/board/board-read-service.js
- shared/config/template-release.js
- shared/config/version.js
- shared/app-config.js

Canonical Board entry points:

- app/Board/template-preview/index.html
- app/Board/ai/index.html
- app/Board/worktodo/index.html
- app/Board/procurement/index.html
- modules/investment
- modules/worklog

Supabase and deployment boundaries:

- supabase/migrations
- supabase/functions
- docs/supabase
- tools/deployment/zhuge-deployment-readiness.mjs
- tools/deployment/zhuge-deployment-readiness.json
- tools/runtime/provider-readiness.mjs
- tools/runtime/authenticated-runtime-qa.mjs

Relevant test families:

- tests/generic-c-consumer.test.js
- tests/c-consumer-lifecycle-final.test.js
- tests/module-c-completion-auto-archive.test.js
- tests/module-c-workspace-ordering-authority.test.js
- tests/module-c-workspace-reorder.test.js
- tests/module-c-workspace-reorder-browser.test.js
- tests/worktodo-c-writer-authority-closure.test.js
- tests/run-browser-regression.js

## 8. CURRENT NEXT STEPS

### Immediate Cloud handoff step

The new Codex Cloud Agent must read this file and the files in Section 7,
verify the repository state, and produce a read-only Current State report.
It must not start coding until PM/GPT provides the next scoped task.

### Current product/runtime gates

1. PM/GPT may review the current Module C Workspace Ordering and Completion
   Archive source evidence.
2. QJC/PM may separately authorize live Runtime/Cloud QA and read-back.
3. If deployment is authorized, use the exact source baseline/tag or a newly
   approved commit and verify the deployed runtime independently.
4. Do not infer that the Candidate ZIP or GitHub push applied Cloud migration,
   scheduler, Published C reload, or Production deployment.

### If the next product request concerns Boards/Workspaces

The read-only lifecycle audit found:

- Board creation: EXISTS
- Default Workspace initialization: EXISTS
- Module C adoption: EXISTS
- Navigation registration: EXISTS
- Workspace cross-Board transfer: MISSING
- Workspace number/sequence: MISSING; display uses sort_order

If PM later authorizes Workspace transfer, first design one canonical Module C
Workspace Transfer Authority covering identity preservation, composite task
relationships, workflow compatibility, ownership/RLS, ordering, completion/
archive semantics, idempotency, audit, rollback, and read-back. Do not patch
WorkTodo, AI Board, GAS, or Investment separately.

### If a new implementation task is authorized

Use this sequence:

1. Reconfirm Current State and read the task-specific contract.
2. Search for an existing authority and current adopter behavior.
3. Define the smallest scoped source change.
4. Preserve all unrelated local work.
5. Run targeted tests, Full Regression, Browser Regression, and release gates
   appropriate to the change.
6. Report source, Cloud, runtime, PM, and deployment states separately.
7. Stop at the requested gate and wait for GPT/PM/QJC direction.

## 9. CLOUD BOOTSTRAP INSTRUCTION

The following instruction is intended to be given to a new Codex Cloud Agent:

    You are taking over Zhuge AI OS as a new Codex Cloud Agent.

    Start in READ-ONLY mode. Do not edit source, migrations, tests, runtime
    configuration, Cloud data, RLS, Edge Functions, branches, tags, or
    deployment settings until you have completed the handoff review.

    First read:
    1. CLOUD_HANDOFF.md
    2. AGENTS.md
    3. README.md
    4. version.json and package.json
    5. tests/README.md
    6. tools/README.md
    7. tools/release-governance.js
    8. the Module C files and tests listed in Section 7

    Then verify, without mutation:
    - repository root and GitHub remote;
    - current branch, HEAD, release tag, and remote main;
    - working tree and untracked files;
    - Version 0.9.0-alpha.9.13 and Build 20261001-2324;
    - the shared Module C runtime and its Board/Workspace authorities;
    - the difference between source, Candidate, Published C, Cloud/runtime,
      and PM/QJC acceptance;
    - the latest test baseline and any pending runtime gate.

    Return a concise report with:
    CURRENT_REPO, BRANCH, HEAD, REMOTE_HEAD, RELEASE_TAG,
    WORKING_TREE, SOURCE_STATUS, CLOUD_STATUS, RUNTIME_STATUS,
    TEST_BASELINE, KNOWN_GAPS, and NEXT_AUTHORIZED_ACTION.

    Do not begin implementation merely because a gap is visible. Do not
    create a second authority. Do not move the two PM-created WorkTodo
    Workspaces. Do not apply Cloud changes. Stop after the read-only report
    and wait for an explicit PM/GPT task.

## Handoff acceptance

This file is complete when the receiving Cloud Agent can:

- identify the exact source baseline and release tag;
- distinguish source/test/package PASS from Cloud/runtime/PM acceptance;
- locate the shared Module C authorities;
- avoid the known Workspace transfer and numbering traps;
- reproduce the QA gates without secrets;
- wait for explicit authorization before changing source or Cloud.
