# Shared Task Drawer — WorkLog Compatibility / Field Mapping Assessment

Status: WorkTodo Shared Task UX Integration — QA Runtime pending PM validation.

## Boundary

The Shared Task Drawer is a presentation component. AI Board and WorkLog may
map their own domain records into it, but they do not merge task tables, status
semantics, authorization, or Cloud write paths. The WorkTodo adapter is now
the second consumer of the Golden Master presentation; WorkTodo writes remain
on its own DataService/Repository/RLS path.

## Field mapping

| Shared Drawer concept | WorkLog current source | Assessment |
| --- | --- | --- |
| Task identity | `user_tasks.id` plus `work_code` | Existing mapping; `WLTK-xxx` is Cloud-generated and concurrency-safe, while UUID remains the internal identity. |
| Title | `normalizeTask().title` | Available. |
| Metadata | `status`, `progress`, `priority`, `userPinned`, `createdAt`, `updatedAt` | Available; WorkLog status/progress remain WorkLog semantics. |
| Description / usage | `note` plus `user_tasks.usage_scenario` | Existing mapping; both fields use the controlled WorkTodo task update path. |
| Checklist | `worktodo_checklist_items` and controlled checklist RPCs | Canonical capability implemented; the adapter maps it to the Golden Master Checklist presentation. |
| Attachment / artifact | `worktodo_attachments` plus private `worktodo-attachments` Storage bucket | Canonical capability implemented for general task and progress-note attachments; it is separate from AI Board artifacts. |
| Activity / progress record | `work_journal_entries` and `DataService.loadWorkJournal()` | Existing mapping; active human journal entries use the shared timeline while system activity remains canonical but outside the PM timeline. Revision/tombstone writes use controlled RPCs. |
| Date / deadline | `dueDate` normalized from `dueDate`, `deadline`, or `due_date` | WorkLog-specific functional field; must remain outside AI Board. |
| Calendar capability | Existing WorkLog Calendar / Google Calendar path | Must remain WorkLog-specific; no Calendar capability is added to the AI Board consumer. |
| GPT analysis | `user_tasks.gpt_*` fields | Canonical capability implemented as a read-only Analysis View; no chat or autonomous write path is introduced. |
| Completion / Archive | `user_tasks.completed_at`, `archive_due_at`, `archived_at` plus reconciliation RPC | Canonical capability implemented; completion is timestamped in Cloud and the 48-hour archive is reconciled server-side on authenticated hydration. |
| Governance / engineering evidence | No WorkLog equivalent in this scope | Not Applicable; no engineering evidence is fabricated for WorkTodo. |

## Compatibility conclusion

WorkTodo now consumes the existing Shared Task Card/Drawer/Checklist/Attachment/
Progress/GPT presentation through `modules/worklog/components/worktodo-task-adapter.js`.
WorkTodo-specific Pin and Calendar remain outside the Shared UX contract. The
approved capability migration is `docs/supabase/20260820_worktodo_shared_task_capabilities.sql`;
it extends only WorkTodo canonical tables and controlled paths, does not reuse
AI Board tables/RPCs, and does not change the Pre-WorkTodo PM Accepted Baseline.
