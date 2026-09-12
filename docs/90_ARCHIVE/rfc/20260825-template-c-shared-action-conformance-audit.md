# Template C Shared Action Conformance Audit

## Scope and decision

This audit covers the formal AI Board and WorkTodo Board runtimes. The
conformance target is one Template C presentation and one shared interaction
contract, with each consumer retaining its own domain adapter, data source,
controlled RPC, authorization, and persistence.

The audit was completed before the remediation changes in this Candidate.

## Before mapping

| Capability | AI Board before | WorkTodo before | Conformance result |
| --- | --- | --- | --- |
| Create task | Shared runtime -> `ZhugeBoardReadService.createTask` | Shared runtime -> `worktodoCreateTask` | Partial: same UI, split domain mapping in runtime |
| Edit title/content | Shared runtime directly selected AI or WorkTodo service | Shared runtime directly selected WorkTodo service | Fail: consumer branching in shared action handlers |
| Delete task | Shared runtime / Board service path | Board service WorkTodo path | Partial: domain calls exist, no shared action dispatcher |
| Progress add | Shared runtime -> `board_add_task_progress_note` | Shared runtime -> `worktodo_add_task_progress_note` | Partial: data/RPC may differ, lifecycle was duplicated in handler |
| Progress edit | Shared runtime -> Board RPC | Shared runtime -> legacy `DataService.saveWorkJournalEntry` | Fail: WorkTodo used legacy journal path |
| Progress delete | Shared runtime -> Board RPC | Shared runtime -> `DataService.deleteWorkJournalEntry` -> `work_journal_entries` | Fail: wrong table and standalone readiness guard |
| General attachment delete | Shared runtime -> `board_request_delete_task_attachment` lifecycle | WorkTodo adapter -> legacy DataService attachment path | Partial: different action entry points |
| Progress attachment delete | Shared runtime selector included progress + general attributes, then called general Board RPC | WorkTodo adapter attachment path | Fail: AI progress scope rejected by general RPC |
| Checklist | Shared markup, handlers branched in runtime | Shared markup, handlers branched in runtime/DataService | Partial: presentation shared, lifecycle not centralized |
| Drawer action / confirm | Shared runtime handlers | Adapter-owned legacy renderer also existed in WorkLog bootstrap | Fail: parallel legacy presentation/action route remained possible |
| Error handling | Each handler built its own banner and retry state | Adapter binder built its own error callback | Fail: duplicated lifecycle/error behavior |
| Read-back / refresh | Each handler manually reopened/ refreshed | Adapter callback manually refreshed | Fail: no shared post-mutation lifecycle |
| Workspace interaction | Shared markup with runtime-level consumer branches | WorkTodo service branch in shared runtime | Partial: data mapping valid, action contract not explicit |

## Confirmed root causes

1. `wireHumanProgressNoteActions()` selected `DataService.deleteWorkJournalEntry`
   for WorkTodo, even though WorkTodo add/read had already moved to
   `engineering_activity_log` through `worktodo_add_task_progress_note` and
   `loadActivity`.
2. The formal WorkTodo route does not boot `worklog-app.js`, so the legacy
   `DataService` readiness flag can remain false and produce `Cloud Sync 尚未就緒`
   before the wrong legacy delete path is reached.
3. `wireTaskAttachments()` treated
   `[data-progress-attachment-delete]` as a general Board attachment action.
   The general RPC intentionally rejects `attachment_scope = 'progress_note'`.
4. WorkTodo adapter presentation code still contained a compatibility Drawer
   renderer and its own attachment binder. The formal route normally uses the
   Shared Drawer, but the parallel renderer made a future bootstrap bypass
   possible.
5. Agreement presentation read `due_date` / `dueDate` as an agreement fallback
   and rendered both date inputs at once. This violates the approved domain
   semantics and progressive disclosure rule.

## After target mapping

```text
Template C Shared UI
  -> Shared Action Contract (confirm, busy, error, read-back, refresh)
  -> Domain Adapter (IDs, capabilities, domain RPC mapping only)
  -> Consumer controlled RPC / Storage lifecycle
  -> Shared read-back + Drawer refresh
```

| Shared action | AI Board adapter | WorkTodo adapter |
| --- | --- | --- |
| Progress add/edit/delete | `board_*_task_progress_note` | `worktodo_add_task_progress_note`, `worktodo_edit_task_progress_note`, `worktodo_delete_task_progress_note` on `engineering_activity_log` |
| General attachment delete | Existing `board_request/finalize/cancel_delete_task_attachment` | Existing WorkTodo controlled attachment request/finalize path |
| Progress attachment delete | New controlled `board_request/finalize/cancel_delete_progress_attachment` | Existing WorkTodo progress-scope attachment path, selected by capability mapping |
| Agreement schedule | Capability absent; no domain fields | `worktodo_set_agreement_schedule`, with explicit `single` / `period` mode |
| Checklist | Existing Board controlled checklist RPCs | Existing WorkTodo controlled checklist RPCs |
| Read-back | Shared Drawer reload | Shared Drawer reload |

## Guard conditions

- The Shared Drawer is the only formal C renderer.
- No formal WorkTodo route may load or call `worklog-app.js` to repair an
  action.
- Progress attachment scope must select the progress action contract before the
  general attachment contract.
- `due_date` is never read or written as Agreement Schedule data.
- Shared action execution owns confirm/busy/error/read-back/refresh behavior;
  adapters provide only domain operations and data mapping.

## Remediation audit and After mapping

The formal runtime now constructs one cached `ZhugeSharedTaskActionContract`
per consumer/task context. The contract owns in-flight de-duplication and the
post-write lifecycle; the adapter supplies only the operation for the active
domain. A `null` task action is resolved from the formal route's
`applicationScope`, so WorkTodo workspace/task creation cannot accidentally
fall through to the AI Board adapter.

| Template C action | Shared UI / contract | AI Board adapter | WorkTodo adapter | Result |
| --- | --- | --- | --- | --- |
| Create | Shared create form -> `createTask` / `createWorkspace` | Board controlled create RPC | WorkTodo controlled create RPC | PASS: same action and lifecycle, different domain operation |
| Edit | Shared inline editor -> `updateTitle` / `updateContent` | Board controlled update RPC | WorkTodo controlled update RPC | PASS |
| Delete | Shared confirmation/action contract | Board controlled delete path | WorkTodo controlled delete path | PASS: no UI-side direct table mutation |
| Progress Add / Edit / Delete | Shared timeline/composer -> `addProgressNote` / `editProgressNote` / `deleteProgressNote` | Board progress RPCs | `worktodo_*_task_progress_note` on `engineering_activity_log` | PASS: WorkTodo no longer calls `work_journal_entries` |
| General Attachment Add / Delete | Shared attachment zone -> `addGeneralAttachment` / `deleteAttachment(scope=task)` | Existing Board request -> Storage remove -> finalize/cancel | Existing WorkTodo controlled attachment service | PASS |
| Progress Attachment Add / Delete | Shared activity attachment UI -> `addProgressAttachment` / `deleteAttachment(scope=progress_note)` | Dedicated progress-scope request/finalize/cancel RPC set | WorkTodo progress attachment service | PASS: progress cannot enter general TASK RPC |
| Checklist | Shared checklist contract -> `addChecklist` / `updateChecklist` / `deleteChecklist` | Board checklist operations | WorkTodo checklist operations | PASS |
| Drawer Action / Confirm | Shared Drawer owns markup, confirmation, busy state, and action dispatch | Domain mapping only | Domain mapping only | PASS for formal routes |
| Error Handling | Shared contract propagates one controlled operation result; Drawer maps it to the shared banner/error surface | Domain error only | Domain error only | PASS: no adapter-owned presentation error path in formal route |
| Read-back / Refresh | Shared contract default read-back -> Board refresh -> Drawer reopen | Read-only Board mapping | Read-only WorkTodo mapping | PASS |
| Workspace interaction | Shared add/rename/reorder/move interaction | Board workspace/task RPC mapping | WorkTodo workspace/task RPC mapping | PASS |

### Formal-route conformance guards

- `app/Board/ai/index.html` and `app/Board/worktodo/index.html` load the same
  Shared Action Contract, Shared Action Adapters, Shared Activity Renderer,
  Shared Card Summary, Golden Master, Drawer, and Board modules.
- Neither formal route loads `modules/worklog/worklog-app.js`.
- `golden-master-runtime.js` contains no formal WorkTodo Drawer renderer
  bypass, `DataService.deleteWorkJournalEntry`, or legacy journal read
  fallback.
- Attachment buttons expose one canonical
  `data-shared-attachment-delete` action plus an explicit
  `data-shared-attachment-scope`; the shared handler selects the scope before
  dispatching to an adapter.
- Agreement Schedule is read only from `agreement_mode`,
  `agreement_start_date`, and `agreement_end_date`. `due_date` is not a
  fallback and is not backfilled.

## Controlled change inventory

| Layer | Change | Cloud execution in this Candidate |
| --- | --- | --- |
| Shared Presentation | 8px activity gap, 16px card padding, safe activity URL renderer, compact Agreement Schedule editor, canonical card summary | Source only |
| Shared Interaction Contract | One action dispatcher, cached in-flight lifecycle, scope-aware attachment dispatch, shared progress/workspace/checklist actions | Source only |
| Domain Adapter | AI Board and WorkTodo action/data/RPC mapping; no Drawer renderer ownership in formal route | Source only |
| WorkTodo Domain Data | Agreement fields and WorkTodo progress revision/tombstone contract | Migration/RPC source only; not applied |
| AI Board Domain Data | Progress Attachment controlled request/finalize/cancel contract | Migration/RPC source only; not applied |

No Cloud DDL, RPC, migration, Storage, RLS, Auth, or data operation is
executed while building this Candidate. PM must review and apply the SQL
through the existing controlled Supabase release process.
