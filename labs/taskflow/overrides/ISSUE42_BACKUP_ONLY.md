# Issue #42 BACKUP ONLY runbook

## Scope and protections

This manual operation backs up only the PostgreSQL `taskflow` schema. It is
not a full Supabase project/database backup. It does not install SQL, run any
migration, create an Issue, or create a Canary. The reviewed runner uses the
existing `production-migration` GitHub Environment reviewer gate and the
existing TaskFlow migration connection; its first Google Drive check happens
before it reads any production database data.

The runner uses PostgreSQL 17 clients, verifies TLS and the live
`taskflow_migrator` identity, makes a schema-scoped custom-format dump, restores
it into disposable PostgreSQL 17, and compares TaskFlow table row counts and
the normalized schema definition. It calculates SHA256, uploads the dump,
sidecar, and manifest directly to the approved private Drive folder using the
Drive API over HTTPS, then reads the uploaded dump back and recalculates its
SHA256. Plaintext temporary files are removed by the runner. No database dump
is placed in the repository, a GitHub Artifact, or workflow logs. The backup
is not application-layer encrypted, as authorized by PM; it is stored in the
restricted Google Drive folder.

The Drive uploader accepts only the approved folder ID and checks its Drive
container, authenticated principal, write capability, and visible ACL before
any production database read. Public, domain, group, or unexpected principals
cause a fail-closed stop. No folder permission is changed by the workflow.

## Current destination blocker

The approved folder currently lives in the owner's My Drive (`driveId` is
absent, `shared=false`) and its ACL contains only the owner. The current GitHub
OIDC service-account uploader requires a Shared Drive because service accounts
cannot own files in a personal My Drive. The runner therefore rejects this
folder with `service_account_requires_shared_drive` before reading production
data. Do not grant a service account access to this My Drive folder; that does
not provide a supported storage destination.

To preserve the fixed folder without changing its ACL, the remaining supported
route is an OAuth user identity for the folder owner. That requires an
approved OAuth client and owner-authorized refresh credential stored only as
GitHub Environment Secrets; the GitHub connector's OAuth session cannot be
exported to Actions. The current workflow does not yet implement that OAuth
path, and no such credential is configured. The workflow must remain blocked
until the owner/admin authorizes that credential path and the source is changed
to use it. Do not put OAuth credentials in chat, repository files, or logs. No
database connection or backup has been run while this gate is blocked.

The alternative service-account flow would require moving the destination to a
Shared Drive. That changes the approved storage destination and is not enabled
by this runbook.

## Run BACKUP ONLY

**Current status: BLOCKED.** Do not start this operation until a compatible
Drive identity is authorized and the exact-SHA workflow is updated and passes
CI. The steps below describe the existing protected workflow inputs only.

1. Open **Actions → TaskFlow Official Site Release Gate → Run workflow**.
2. Select `review/p0-functional-consolidation-20261023` and set
   `issue42_install_only=false`, `issue42_backup_only=true`.
3. Set `expected_candidate_sha` to the CTO-reviewed exact branch head. The
   workflow checks that SHA, the reviewed SQL commit and SQL SHA256, exact-SHA
   Build Parity, the PostgreSQL target, and the protected Environment.
4. Start the run and have a Required Reviewer approve the `production-migration`
   Environment job.
5. Confirm `TASKFLOW_BACKUP_ONLY_READY`, isolated restore, schema and row-count
   comparison, and `TASKFLOW_BACKUP_DRIVE_READBACK_PASS` in the protected job
   log. The runner removes temporary dump files before exiting.
6. In the approved private Drive folder, verify that the three files share
   the candidate SHA and workflow run identity. The manifest states the
   `taskflow`-only scope, source version/SHA, byte size, SHA256, and isolated
   restore checks. The workflow's readback verifies the Drive file metadata
   and recomputes the full dump SHA256.

## INSTALL ONLY gate

The INSTALL ONLY job first authenticates to the same private Drive destination
and independently checks for a matching exact-candidate backup manifest,
sidecar, dump size, full SHA256, project ID, and successful PostgreSQL 17
restore. If any check fails, it stops before the database connection and SQL
installer. Only after this backup precondition does the existing
`production-migration` Required Reviewer approve the install job. The install
runner remains locked to the reviewed Issue #42 SQL and never invokes another
migration or creates a card.

The backup covers TaskFlow schema objects and data only; it does not contain
Supabase Auth, Storage, other schemas, project configuration, or global
database roles. Use the already-approved schema restore process only for the
TaskFlow schema and keep existing audit history. If SQL commits but read-only
postflight fails, report `INSTALLED_BUT_POSTFLIGHT_FAILED`; do not describe it
as rolled back or delete the installation ledger.
