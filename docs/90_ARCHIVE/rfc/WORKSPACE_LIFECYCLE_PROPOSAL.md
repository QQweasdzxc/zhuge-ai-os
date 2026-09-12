# Workspace Lifecycle Proposal

Status: PM Review Required  
Scope: proposal only; no schema, migration, RPC, Cloud, or UI delete implementation in the current Candidate.

## Decision boundary

Workspace deletion is a container lifecycle operation. It must never cascade-delete Tasks. The current Candidate does not expose or implement a delete action.

The proposed guard is:

- System / Canonical Workspace: cannot be deleted or archived by a Consumer.
- Custom Workspace with zero Tasks: may be archived through a controlled write path.
- Custom Workspace with one or more Tasks: reject the operation and require the user to move Tasks first.

## Current mapping

The current `board_workspaces` representation has `workspace_key`, `name`, `sort_order`, `active`, `archived_at`, `application_scope`, and ownership/timestamp fields, but no reliable explicit `system` / `custom` discriminator. `owner_uuid IS NULL` is not sufficient because canonical and legacy rows can both have no owner. The existing controlled rename/reorder/create paths do not provide a formal delete/archive contract. Task-to-workspace referential integrity is restrictive, so a direct delete must not be introduced as a shortcut.

## Recommended identity model

Add one canonical classification owned by the Workspace domain, preferably an enum-like `workspace_kind` with values `system` and `custom` (or an equivalent non-null boolean plus a canonical registry). The classification must be independent from display name, sort order, active state, and owner.

Recommended precedence:

1. A canonical registry defines the immutable system workspace keys for each application scope.
2. A persisted non-null classification records the resolved value on every row.
3. The server-side controlled operation rejects any row whose classification is not `custom`.

A registry-only approach avoids a schema flag but is more vulnerable to legacy-key drift and renamed system workspaces. It is therefore a fallback, not the preferred long-term contract.

## Migration / backfill proposal

No migration is authorized in this Candidate. For a future migration, the steps should be:

1. Add the non-null classification with a safe temporary default that does not grant deletion.
2. Backfill canonical rows from an approved per-scope registry and an explicit PM-reviewed legacy-key mapping.
3. Backfill remaining rows as `custom` only after ownership and application scope are verified; ambiguous rows remain protected and are reported for PM review.
4. Add a constraint that rejects unknown classifications.
5. Read back the counts and key/name mapping before enabling the archive operation.

The migration must be append-only with respect to Task data and must not move, delete, or cascade rows.

## Controlled archive / delete contract

Prefer a controlled archive RPC at the domain boundary, for example `worktodo_archive_workspace(p_workspace_id)` for WorkTodo and a separate AI Board domain operation if AI Board later adopts the capability. The RPC must:

- resolve the authenticated Creator / owner context;
- lock or consistently read the Workspace row;
- require `workspace_kind = custom`;
- require the caller to be authorized for that application scope;
- count active and archived Task references before changing state;
- reject when the Task count is greater than zero;
- set `archived_at`, `active = false`, and audit fields rather than cascade-delete;
- write an audit record with actor, workspace, reason, and timestamp;
- return the updated row for read-back verification.

No direct table delete and no client-side pre-check alone are sufficient. The server-side guard is the authority.

## Authorization and audit

Only the existing Creator / domain authorization contract should be extended. RLS must continue to prevent cross-user or cross-scope access. A rejected attempt should be auditable without exposing Task contents. Audit data should identify the workspace and reason, not duplicate domain payloads.

## UI confirmation flow

After PM approves the data contract and RPC:

1. Show Delete / Archive only for a custom Workspace.
2. Show a clear non-destructive confirmation naming the Workspace.
3. If Task count is greater than zero, block the action and show the required move-Tasks instruction; do not offer cascade deletion.
4. If Task count is zero, require a second confirmation and an explicit reason if governance requires it.
5. Read back the updated Workspace and refresh the shared Board presentation.
6. Keep the action available only through the Shared C Workspace Interaction Contract; the Adapter supplies the domain write callback.

## Restore

Restore is recommended for an initial version because archive is reversible and preserves the container identity. It should use the same authorization, registry classification, audit, and read-back rules. Restore must not recreate or move Tasks automatically. If restore is not approved, the UI must state that the archive is irreversible before confirmation.

## Review gates

Before implementation, PM must approve:

- the canonical registry and `system` / `custom` classification;
- the migration/backfill mapping and handling of ambiguous legacy rows;
- the domain-specific controlled archive RPC contract;
- Task = 0 enforcement and RLS behavior;
- audit fields and restore policy.

Until those decisions are approved, Workspace Delete remains intentionally out of the Candidate.
