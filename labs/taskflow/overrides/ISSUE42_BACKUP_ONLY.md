# Issue #42 BACKUP ONLY runbook

## Scope and protections

This is a manual, protected operation for the `taskflow` PostgreSQL schema only.
It is not a full Supabase project/database backup and it does not install SQL,
run a migration, create a TaskFlow Issue, or create a Canary. The workflow uses
the existing `production-migration` GitHub Environment reviewer gate and its
existing migration connection secrets. No Drive credentials are added to the
repository or workflow.

The job checks the exact selected candidate SHA, the TaskFlow project host,
`taskflow_migrator` session identity, TLS verification, and PostgreSQL 17 client
versions before reading schema data. It creates a custom-format dump in the
ephemeral runner temp directory, restores it into a disposable PostgreSQL 17
database, compares table row counts and normalized schema-only dumps, then
encrypts the dump with `age`. Its output directory contains only the encrypted
dump, SHA256 sidecar, and non-secret manifest. The private age identity is
never sent to GitHub or the runner.

## Key separation

Create an age key pair on a trusted PM-controlled device. Store the private
identity in the PM password manager, not in this repository, Actions, Drive,
or chat. Only the public `age1...` recipient is entered into the
`backup_age_recipient` workflow input. A CI fixture key is generated and deleted
inside its isolated test; it is not used for the production backup.

The age public recipient is not a secret. The private identity is the only key
that can decrypt the archived database data. If the private identity is lost,
the Drive ciphertext cannot be recovered; store a separate protected recovery
copy in the PM password manager before starting the backup.

## Run BACKUP ONLY

1. Open **Actions → TaskFlow Official Site Release Gate → Run workflow**.
2. Select branch `review/p0-functional-consolidation-20261023`.
3. Set `issue42_install_only=false` and `issue42_backup_only=true`.
4. Set `expected_candidate_sha` to the reviewed head SHA and put only the public
   age recipient in `backup_age_recipient`.
5. Start the run and have a required `production-migration` reviewer approve it.
6. Confirm the `TaskFlow schema BACKUP ONLY` job reports identity/TLS, isolated
   PostgreSQL 17 restore, row-count comparison, and schema comparison PASS.
   The backup job has no call to the SQL installer.

The workflow artifact is a one-day transfer containing only ciphertext and
non-secret verification metadata; it is not the backup of record. Download it
through the connected GitHub owner account, verify the outer ZIP and inner
ciphertext SHA256, then use the connected owner Google Drive account to upload
the ciphertext-and-metadata archive to the already-approved folder
`1426lDVU97bSseRVzMLRMzh1C2eAIZ-xU`. Do not change sharing permissions. Read
back the uploaded file metadata and verify size, checksum, and owner-only
sharing before treating the backup as stored.

## INSTALL ONLY gate

Do not run INSTALL ONLY unless all of the following are evidenced: the backup
is encrypted, its ciphertext and SHA256 sidecar are stored in the approved
owner-only Drive folder, the uploaded object has been read back and verified,
and the isolated PostgreSQL 17 restore passed. Use the separate existing
INSTALL ONLY input only after the backup gate passes, then run the read-only
Postflight. An install job failure after SQL COMMIT must be reported as
`INSTALLED_BUT_POSTFLIGHT_FAILED`; it is not a rollback.
