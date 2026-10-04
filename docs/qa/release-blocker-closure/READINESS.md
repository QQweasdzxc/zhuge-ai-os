# Release blocker closure

Review baseline: `e047c3128ecaefaac213ae4b4bc98ac78de565cd`.
This extends the accepted Workspace/Step, completion archive and ordering
authorities. Banner and baseline general cleanup are outside this scope.

## Writers and callers

- Formal AI Board, WorkTodo, administration and C Mother startup already uses
  `createInstanceService` and `board_instance_create_workspace`. The exported
  root `BoardRead.createWorkspace` compatibility service now delegates to that
  same authority. The old `board_create_workspace(text)` has no client EXECUTE
  grants and its retained signature raises an authorization error even if
  invoked by the database function owner. It cannot insert a Workspace.
- Existing shared attachment rename/note controls use
  `board_update_task_attachment_metadata`. Its additive nullable columns preserve
  attachment IDs, Task ownership, storage object path and filename. The definer
  writer locks the active row and calls the existing `board_task_can_write`
  parent authorization. Only authenticated clients receive EXECUTE.
- The five fixed-owner WorkLog compatibility writers have no tracked current
  Runtime callers. Their signatures and legitimate fixed owner's operations
  remain available; every call now verifies the authenticated session matches
  that existing owner. Anonymous and service-role EXECUTE are revoked. No
  verified service caller was found, so no service bypass was added. The normal
  authenticated WorkLog repository remains unchanged. Untracked external
  prototype clients require an authenticated owner session, not anonymous
  compatibility. No WorkLog data is retired or deleted by migration.

## Migration contract

The existing eight pending migrations and all 157 exact recovered historical
SQL files are unchanged. The additional closure migration is
`20261004114949_release_blocker_authorization_closure.sql`. Standard Supabase
dry-run must therefore resolve to nine pending files, in version order. The
historical 158 applied entries must remain byte-equivalent in the ledger.
Historical files are ledger restoration only and must not be replayed.

## Developer QA

`tests/release-blocker-authorization-closure.test.js` executes the actual new
SQL in the existing PGlite fixture: legacy bypass fails for all clients and the
function owner; attachment rename/note requires parent ownership; anonymous,
foreign and missing-session WorkLog writes fail; all five legitimate owner
operations continue to work. The existing Board service test checks canonical
Workspace creation, exactly-one binding and absence of the retired RPC call.

The disposable loopback Supabase rehearsal extends the existing 17 readiness
cases with three grouped cases: legacy Workspace bypass closure, attachment
metadata authorization and all five WorkLog writer authorizations. Cases run
in transactions and roll back. Data preservation compares every captured
original column, with the two new nullable attachment fields separately
required to start null. Published/Draft workflow, Tasks, ownership, attachments
and audit remain preserved. The two old-client probes are hazard detection,
not release acceptance; they prove write freeze is required while Source and
schema differ.

Required gates: targeted tests, governance tests, full regression and the
existing `npm run test:browser` authority, with no failures or skips; release
preflight; exact historical/pending SQL preservation; controlled Candidate
packaging with ZIP integrity, Source-to-ZIP and Manifest-to-ZIP verification.

## Deployment rehearsal and Production gate

Sequence: enforce write freeze / quiesce old clients → apply the complete
reviewed pending chain → promote the reviewed exact Source SHA → deploy and
read back Version/Build/SHA → canonical Workspace reconciliation → Runtime QA
→ unfreeze. The rehearsal simulates main in a local bare repository and serves
exact committed Source over loopback HTTP; it does not push or deploy to
Production. The existing old-client Draft publication hazard means a live
Cloud-first rollout without write freeze is unsafe.

Production write freeze, migration apply, main push/deploy and reconciliation
remain separate PM authorization gates. Local rehearsal PASS is not evidence
that Production has applied this migration or completed Runtime QA. Production
data and migration history must not be changed during this work.
