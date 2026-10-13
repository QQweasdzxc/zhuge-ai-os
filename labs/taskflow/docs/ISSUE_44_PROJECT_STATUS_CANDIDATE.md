# Issue #44 — Project status fields candidate

## Candidate boundary

This candidate changes only the TaskFlow Web build overlay. It does not edit
`third_party/multica`, add a database migration, change Production data, or
change the Native Lab.

The seven native status keys and lifecycle categories remain intact. Project
custom statuses are created through the existing native status API, with the
Project UUID encoded into a valid native key. On a Project surface, the
TaskFlow catalog exposes native workspace statuses plus custom keys owned by
that Project. The workspace-wide surface excludes Project-owned keys. Existing
status lookup closures remain intact so historic issue rows still have labels.

Owner/Admin checks in the UI are only a convenience; the existing native API
remains the authorization authority for status create/update. Custom status
names can be edited through the native update mutation. Hiding a status changes
only the view preference; it does not archive the status or modify issues.

## Persistence

Visibility uses the existing `issue_view_preference` endpoint with
`scope_type=project` and the current Project ID. The TaskFlow value is stored
under `prefs.taskflow_hidden_statuses`; native `hidden` and `order` values are
preserved when either settings surface writes the whole JSON document. Reset
removes only the TaskFlow key, restoring the native default hidden status.
This is the existing per-user/per-Project preference contract, so visibility
is currently personal to each member rather than shared Project configuration.

The native database also enforces unique active status names per Workspace.
Therefore two Projects in one Workspace cannot currently create active custom
statuses with the exact same name. This overlay does not disguise or rewrite
names to bypass that native constraint.

## Important isolation limit for CTO review

The canonical `issue_status` table and native status API are Workspace-scoped;
they have no `project_id` ownership field. This candidate provides
Project-scoped behavior in TaskFlow Web, but not a database-enforced boundary:
other clients and direct API callers can still enumerate Workspace status
rows, and the API does not validate a status key against an issue's Project.
The category attached to a custom status retains its native lifecycle behavior.
Strict server-side Project ownership would require a backend/schema change and
is intentionally not claimed by this overlay-only candidate.

On Board/List/Swimlane, hidden status groups remain available from the native
Hidden columns panel; the settings description states that hiding never
deletes tasks and that the panel can restore the column. Table/Gantt use their
native status presentation rather than status columns.

## QA scope

The overlay contract checks temporary-source patching and frozen-vendor hashes.
Targeted unit/component tests cover status-key roundtrip/length, all seven
built-ins, two-Project catalog isolation, workspace-wide exclusion, historic
label lookup, per-Project visibility actions, name edits, and restoring defaults
without deletion. Full authenticated API persistence and real Desktop/iPhone
browser behavior still require an isolated TaskFlow runtime; no Production
write or device session is used by this candidate test.
