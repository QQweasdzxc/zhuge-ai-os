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

The Drive uploader accepts only the approved folder ID and checks the OAuth
principal, folder owner, My Drive container, write capability, and visible
owner-only ACL before any production database read. It writes files only with
that folder as their parent, then checks file ownership, ACL, parent, size, and
full SHA256 on readback. Public, domain, group, shared-drive, or unexpected
principals cause a fail-closed stop. No Drive permission is changed by the
workflow. The OAuth grant is limited to Google's `drive.file` scope. The
existing folder must first be explicitly opened/shared with this OAuth app
through Google Picker; owner-only Drive ACL by itself does not grant an app
specific file scope. The refresh token remains a protected credential.

## One-time owner OAuth setup

The approved folder is in the owner's My Drive and currently has an owner-only
ACL. The GitHub Drive connector's OAuth session cannot be exported to Actions.
The protected workflow therefore requires a separate owner-authorized OAuth
client and refresh credential stored only in the `production-migration`
Environment. Required configuration:

* Variable `TASKFLOW_BACKUP_DRIVE_OAUTH_EMAIL`: account that owns the folder.
* Secrets `TASKFLOW_BACKUP_DRIVE_OAUTH_CLIENT_ID`,
  `TASKFLOW_BACKUP_DRIVE_OAUTH_CLIENT_SECRET`, and
  `TASKFLOW_BACKUP_DRIVE_OAUTH_REFRESH_TOKEN`.

The OAuth client must have the Drive API enabled and must be the same client
used for the one-time Google Picker folder grant. The owner must explicitly
select the approved folder in a Picker configured for folder selection; a
plain OAuth consent for `drive.file` does not make an existing unselected
folder accessible. The refresh token must be minted for that same OAuth client
with the single scope `https://www.googleapis.com/auth/drive.file`. Place the
Client ID, Client Secret, and refresh token directly in the protected GitHub
Environment and set the expected owner email as an Environment variable. Do not
put credentials in chat, PRs, workflow inputs, repository files, or logs. This
scope does not grant Drive-wide access. If the folder has not been granted to
the client through Picker, the API returns not-found/permission-denied and the
runner stops before reading production database data.

**Picker readiness:** the existing WorkLog Picker supports file selection but
currently disables folder selection. Until an authorized existing Picker
surface selects this folder using the backup OAuth client, real `drive.file`
folder compatibility is **NOT VERIFIED** and BACKUP ONLY must not run.

The workflow validates the returned token scope, authenticated Drive principal,
folder owner and ACL before reading production data. An expired or revoked
refresh credential fails closed. If Google's token endpoint rotates the refresh
token, the job stops and the administrator must replace the Environment secret
securely before retrying. No database connection or backup is attempted until
the OAuth preflight passes.

## Run BACKUP ONLY

**Current status: awaiting owner OAuth authorization and an app-specific folder
grant.** The source implements the protected OAuth upload path. No production
database connection is attempted until the owner OAuth, exact-folder access, and
owner-only ACL preflight pass.

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
