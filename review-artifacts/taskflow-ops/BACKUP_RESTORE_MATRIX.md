# BACKUP_RESTORE_MATRIX

Status: proposed operating contract; no Production backup configuration or data was read/changed/exported. Program/version bundles and database backups remain separate.

| Method | Scope / protection | RPO / RTO | Cost / dependency | Current status |
|---|---|---|---|---|
| Supabase managed snapshots / PITR | Project-level provider backup; exact inclusion, cadence, retention and restore granularity depend on the active plan. It may include more than `taskflow`; must not be treated as an isolated TaskFlow restore without a drill. | Unknown until Dashboard plan/settings are read; do not promise a value. | Existing plan/capability and any PITR price not verified. | NOT VERIFIED; no settings changed. |
| TaskFlow logical dump (`pg_dump -Fc -n taskflow --no-owner`) | TaskFlow schema objects/data only; restore target can be a separate PostgreSQL database. Does not include Supabase Auth, `public`, `lab_multica`, Storage objects, Render settings/secrets, or source/image artifacts. Check external file/object references separately. | If scheduled daily and each run is verified: nominal RPO ≤24h; manual restore target ≤4h is a planning objective only. Neither is measured or promised. | No recurring cost on existing operator hardware; encrypted offsite destination/storage may incur cost or need approval. | Synthetic local dump and isolated restore PASS only; production schedule/destination NOT CONFIGURED. |
| Encrypted offline/rotated media | Independent copy of the TaskFlow custom dump and manifest, encrypted before leaving the trusted host; media stored separately. Protects against provider/account outage but not if both copies are co-located or keys are lost. | Same as source dump cadence; restore time depends on media and drill. | No new recurring service if approved media already exists; hardware availability is unknown. | Proposed only; no physical media inspected or written. |
| Existing cloud drive/object storage | Encrypted blob archive, immutable/versioned retention if service supports it; separate identity and ACL from app admins. A spreadsheet/export mirror is not a database backup. | Depends on upload schedule; not tested. | Marginal cost unknown; PM/GPT approval required before moving sensitive TaskFlow data to Google or another cloud. | NOT AUTHORIZED/NOT CONFIGURED. |
| WAL/incremental continuous archive | Point-in-time recovery with lower RPO; requires provider support, retention, storage and a restore drill. | Potentially minutes; actual RPO/RTO depends on service and plan. | Plan/storage/egress cost unknown; may require paid feature. | PM decision required; not implemented. |

## Recommended no-new-service starting point (not yet active)

- Use a dedicated, protected operator job to make a daily custom-format logical dump of `taskflow` only. Do not place connection strings in command lines or logs; use the approved secret store at execution time.
- Encrypt before copying. Use an approved public-key encryption workflow (for example age recipient public key); keep decryption keys separately under human-controlled recovery access. Do not include credentials or keys in the dump, source bundle, CI, issue comments or this artifact.
- Retain 30 daily and 12 monthly encrypted copies with hash manifest and deletion protection. Actual storage usage is unknown; calculate before retention is activated.
- Keep a second copy physically separate using existing approved storage/media. No current offsite destination is authorized; do not upload to Google Drive/Sheets without PM approval. Until that is resolved, `OFFSITE COPY = NOT CONFIGURED`.
- Alert on missed/failed jobs only after an approved monitoring destination exists. A backup is valid only after checksum verification and a restore test.

## Restore drill contract

1. Select a disposable isolated PostgreSQL target, not Production and not `lab_multica`.
2. Verify archive hash and encryption, decrypt only into a restricted temporary workspace, inspect `pg_restore --list`, and restore with `--exit-on-error`.
3. Verify ordered schema/migration ledger, relation count, constraints/FKs, sequence values, Workspace/Project/Task counts and identities, and sample authorization ownership; compare counts with the backup manifest.
4. If object storage is in use, restore its manifest and sample bytes separately and verify hashes. The prior synthetic drill did not include Storage objects.
5. Run API smoke using a non-Production test identity and verify existing Project/Task reads; never point the restored target at Zhuge Production Auth.
6. Record elapsed restore time/RPO and evidence. Destroy the disposable target after review.

## Evidence and limits

A synthetic local custom-format dump (`SHA256 c01ce924901891bb77b55a49853829531f69cc9a876287ed646eec76840d16b2`) restored successfully to another local database: 590 migrations, 124 relations, one synthetic workspace/project/task. This is not a Production backup, no Production data was exported, and it does not establish production retention, offsite protection, RPO, RTO, Storage recovery, Auth continuity or provider failover.
