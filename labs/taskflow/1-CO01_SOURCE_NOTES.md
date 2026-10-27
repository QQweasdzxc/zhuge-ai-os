# CO-01 source-only evidence

Baseline: PM-supplied files attributed to c6452b95718eaa5e51ee183d0472d7db922bf6f8.
All six original file hashes and five role-contract hashes were matched.
Matching bytes available locally were used for the five role documents; the
container HEAD is not the technical baseline. No Git fetch, branch or write.

No Dispatch caller is approved. There are no new Dispatch EXECUTE grants.
The migrator's inherent ownership powers remain administrative, not caller
approval. PUBLIC and explicit non-owner function ACLs are removed in the same
transaction, including prior grants preserved by CREATE OR REPLACE. Unexpected
Ledger table/column ACLs reject the migration instead of changing those ACLs.
Inherited membership and elevated roles are inspected by the metadata postflight;
ACL removal cannot revoke inherent superuser or object-owner powers.

The platform roles in the isolated tests are simulations. Mock role defaults
are assumptions, not production evidence. The image's postgres properties are
read from pg_roles, never assigned or assumed. Existing administrator functional
checks do not prove ordinary-role authorization. Denial calls may encounter the
schema boundary in the minimal fixture; effective function/table/column ACLs are
checked independently. Elevated effective authority must be reported as unsafe.

Postflight never reads Ledger rows. Missing metadata fails closed. It always
reports NOT_READY with rollback_script_requires_isolated_test because catalogs
cannot attest an external rollback file. Other reasons identify ACL or structure
defects even with this unresolved gate. Exact catalog-rendered constraint/index
expressions are deliberately conservative and require PG16/17 verification.

Rollback locks the Ledger before checking emptiness and dropping any object.
Nonempty rollback must fail without catalog/data changes. Empty rollback tests
are confined to disposable databases. Forward-fix means reapply the candidate
under the existing owner, retain all rows, verify STOP remains false and the
reconciliation writer fence still refuses a second claim. Never clear/truncate
a live Ledger to make rollback possible. Test-only TRUNCATE is not an operation
for an existing environment. No production installer/deployment/backup procedure.

Static tests are source assertions, not proof of PostgreSQL behavior. PG16/17
integration tests are NOT VERIFIED in this task: local Docker was already proven
inaccessible. No network, environment, secret, shared ACL or Provider workaround.
Result: BLOCKED, not STEP1_SOURCE_READY.
