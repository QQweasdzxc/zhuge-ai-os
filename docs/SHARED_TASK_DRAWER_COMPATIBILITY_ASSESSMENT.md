# Shared Task Drawer — WorkLog Compatibility / Field Mapping Assessment

Status: Historical WorkLog compatibility assessment. The Checklist canonical
wording below is superseded for formal Template C WorkTodo; the Legacy WorkLog
mapping is retained as active compatibility history.

## Boundary

The Shared Task Drawer is a presentation component. AI Board and WorkLog may
map their own domain records into it, but they do not merge task tables, status
semantics, authorization, or Cloud write paths. Formal Template C AI Board and
WorkTodo Checklist operations use the Shared Action Contract and the Board
canonical data path. WorkLog remains an active legacy consumer with its own
DataService/Repository/RLS path. This document preserves the historical
WorkLog field mappings; it is not the canonical implementation reference for
new Template C Checklist work.

## Checklist canonical boundary (current)

Formal Template C WorkTodo Checklist uses:

`board_tasks` → `board_task_checklist_items` → existing
`board_*_task_checklist_item` controlled RPCs → Shared Action Contract.

The mapping retained below describes the active Legacy WorkLog compatibility
path only:

`user_tasks` → `worktodo_checklist_items` → legacy
`worktodo_*_checklist_item` RPCs.

Legacy WorkLog remains active and is not removed. Its Checklist mapping must
not be used as the canonical source for Template C or Shared Task Drawer
Checklist implementation. This section supersedes any earlier wording in
this document that called `worktodo_checklist_items` the canonical WorkTodo
Checklist source.

## Field mapping

| Shared Drawer concept | WorkLog current source | Assessment |
| --- | --- | --- |
| Task identity | `user_tasks.id` plus `work_code` | Existing mapping; `WLTK-xxx` is Cloud-generated and concurrency-safe, while UUID remains the internal identity. |
| Title | `normalizeTask().title` | Available. |
| Metadata | `status`, `progress`, `priority`, `userPinned`, `createdAt`, `updatedAt` | Available; WorkLog status/progress remain WorkLog semantics. |
| Work property | `user_tasks.work_property` | Canonical WorkTodo task-level capability; distinct from `user_work_models.category`, exposed in the Golden Master 工作區 property slot as `工作屬性`. |
| Estimated time | `user_tasks.estimated_minutes` | Existing canonical field; exposed through the Shared Property Extension as `預估時間`, with WorkTodo-specific formatting and no layout fork. |
| Description / usage | `note` plus `user_tasks.usage_scenario` | Existing mapping; both fields use the controlled WorkTodo task update path. |
| Checklist | Legacy WorkLog: `user_tasks` → `worktodo_checklist_items` and legacy controlled checklist RPCs | Active compatibility mapping only; not the formal Template C canonical implementation. |
| Attachment / artifact | `worktodo_attachments` plus private `worktodo-attachments` Storage bucket | Canonical capability implemented for general task and progress-note attachments; it is separate from AI Board artifacts. |
| Activity / progress record | `work_journal_entries` and `DataService.loadWorkJournal()` | Existing mapping; active human journal entries use the shared timeline while system activity remains canonical but outside the PM timeline. Revision/tombstone writes use controlled RPCs. |
| Date / deadline | `dueDate` normalized from `dueDate`, `deadline`, or `due_date` | WorkLog-specific functional field; must remain outside AI Board. |
| Calendar capability | Existing WorkLog Calendar / Google Calendar path | Must remain WorkLog-specific; no Calendar capability is added to the AI Board consumer. |
| GPT analysis | `user_tasks.gpt_*` fields | Canonical capability implemented as a read-only Analysis View; no chat or autonomous write path is introduced. |
| Completion / Archive | `user_tasks.completed_at`, `archive_due_at`, `archived_at` plus reconciliation RPC | Canonical capability implemented; completion is timestamped in Cloud and the 48-hour archive is reconciled server-side on authenticated hydration. |
| Governance / engineering evidence | No WorkLog equivalent in this scope | Not Applicable; no engineering evidence is fabricated for WorkTodo. |

## Compatibility conclusion

Formal Template C WorkTodo consumes the existing Shared Task
Card/Drawer/Checklist/Attachment/Progress/GPT presentation through
`modules/worklog/components/worktodo-task-adapter.js`; its Checklist operations
use the Board canonical path documented above. WorkTodo-specific Pin and
Calendar remain outside the Shared UX contract. The approved capability
migrations are
`docs/supabase/20260820_worktodo_shared_task_capabilities.sql` and
`docs/supabase/20260820_worktodo_task_properties.sql`; the legacy mappings in
this assessment remain active for WorkLog compatibility and must not be used
as the canonical reference for new Template C or Shared Task Drawer Checklist
work.
