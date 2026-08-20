# Shared Task Drawer — WorkLog Compatibility / Field Mapping Assessment

Status: Assessment only — WorkLog Runtime and Cloud data are unchanged.

## Boundary

The Shared Task Drawer is a presentation component. AI Board and WorkLog may
map their own domain records into it, but they do not merge task tables, status
semantics, authorization, or Cloud write paths. This assessment does not
authorize a WorkLog integration or migration.

## Field mapping

| Shared Drawer concept | WorkLog current source | Assessment |
| --- | --- | --- |
| Task identity | `normalizeTask().id` and `cloudId` | Available; adapter must preserve both local and canonical Cloud identity. |
| Title | `normalizeTask().title` | Available. |
| Metadata | `status`, `progress`, `priority`, `userPinned`, `createdAt`, `updatedAt` | Available; WorkLog status/progress remain WorkLog semantics. |
| Description / usage | `note`; completion text in `completedNote` | Partial; no separate Engineering Contract or usage-scenario field is introduced. |
| Checklist | No canonical checklist field is produced by the current WorkLog task normalizer | Not implemented in current WorkLog mapping; do not invent a parallel source. |
| Attachment / artifact | No equivalent field or source was found in the current WorkLog task model | Not Found for future adapter; AI Board artifacts remain AI Board canonical data. |
| Activity / progress record | `normalizeWorkJournalEntry()` and `workJournalForTask()`; loaded through `DataService.loadWorkJournal()` | Available; journal entries map to the shared activity presentation while retaining WorkLog entry type, author, timestamps, status, and progress. |
| Date / deadline | `dueDate` normalized from `dueDate`, `deadline`, or `due_date` | WorkLog-specific functional field; must remain outside AI Board. |
| Calendar capability | Existing WorkLog Calendar / Google Calendar path | Must remain WorkLog-specific; no Calendar capability is added to the AI Board consumer. |
| Governance / engineering evidence | No WorkLog equivalent in this scope | Not shared or fabricated. |

## Compatibility conclusion

WorkLog can be a future Shared Task Drawer consumer through an adapter that
maps the fields above. The current task makes no WorkLog Runtime, data,
migration, RPC, RLS, Auth, Calendar Sync, or business-logic changes.
