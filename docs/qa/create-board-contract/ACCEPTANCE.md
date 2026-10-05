# Shared Create Board UX / contract closure

Shared Golden Master buttons own enabled pointer, hover and focus-visible feedback.
No consumer stylesheet override or second Header/Menu authority is added.

Board project assignment is distinct from Workspace application scope. The existing
Board registry stores nullable project_assignment (worklog / investment). The
existing board_provision_c_consumer_v2 accepts a final optional project parameter;
its old named arguments remain valid, without a second writable overload. Default
consumer Workspaces have NULL application scope. Legacy AI Board / WorkTodo scopes
and the personal WorkTodo contract remain separate. Existing registry relationships,
Task ownership, Published history and recovered migrations are unchanged.

## Migration / rollout

20261005060842_c_consumer_project_assignment_contract.sql adds the Board relationship
column and extends the same canonical provisioning RPC. It is NOT applied to
Production by this delivery. Source promotion requires separate migration review
and readback before the new UI can send the new argument. No Production data-copy
or provisioning operation is performed in this Source cycle.

## QA authorities

- tests/create-board-contract.test.js executes canonical SQL in the existing
  isolated PGlite lifecycle fixture with Production Workspace scope and registry
  uniqueness constraints. Covers three project choices, repeated projects, four
  Steps / zero Edges, adoption, idempotency, rollback, anonymous denial and service
  compatibility.
- tests/create-board-golden-journey-browser.test.js uses the real C Mother DOM,
  SharedShell, Golden Master Runtime, navigation and read service, with isolated
  authentication/transport. Provisioning executes actual SQL, not mocked responses.
  Checks actual clicks, fields, project choice, navigation, opening and reload with
  four persisted Workspaces / four Published Steps / zero Edges. Cleanup closes the
  browser, localhost server and disposable database.
- Existing tests/run-browser-regression.js remains the browser authority. Complete
  regression includes tests/investment/*.test.js.

The journey does not prove Production migration or Runtime acceptance. Completion
scheduler and authority-health panel are outside this journey; those fixture seams
are disabled without claiming their acceptance.

## Archive principle — record only

PM principle: new work is new; prior work remains historical. Board, Workspace and
Task archive should be historical, read-only and terminal, without restore to Active.
No archive behavior is changed here. Separate reviewed Source work is required:

- Board Archive: MISSING. No canonical archive/list terminal lifecycle is added;
  Board active alone is not a complete archive UX.
- Workspace: CONFLICT. Existing board_instance_restore_workspace and shared restore
  UI return the same UUID to Active. Both remain unchanged.
- Task: PARTIAL / NEEDS REVIEW. Completion archive retains Tasks/history, but existing
  reopen/edit/attachment paths must be audited together against terminal read-only
  semantics. This cycle does not remove capabilities or claim terminal conformance.
