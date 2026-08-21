# Shared Components

Shared UI and module contracts:

- `index.js` — reusable presentation adapters
- `task-card.js` — domain-neutral Task Card shell; consumers provide mapped display values and actions
- `task-drawer.js` — domain-neutral responsive Task Drawer shell; consumers supply mapped content and retain domain/write logic
- `golden-master-fixture.js` — immutable Template-only presentation QA fixture; never reads or writes domain data
- `golden-master-preview.js` — shared read-only Golden Master surface that composes Shell, Toolbar, Board, Card, and Drawer
- `workspaces.js` — Dashboard/module registry (legacy internal identifier retained for compatibility)
- `system-template-catalog.js` — read-only catalog contract for the single AI Board Golden Master and future template lifecycle controls

Module-specific UI and domain adapters remain inside the owning module. The
shared Task Drawer does not read Cloud data, call RPCs, or own authorization.

## Shared Task UX Framework v1

The shared Drawer presents one work mental model without merging domain data:

1. Header and `properties` — title plus Planner-style task properties such as
   location, readable status, owner, priority, and mode.
2. Work body — adapter-owned task content, usage context, optional shared
   checklist, PM action, and optional attachments.
3. Activity — Trello-style progress workspace for human progress notes and
   visually distinct System Activity rows.
4. Progressive disclosure — adapter-owned secondary actions can open
   engineering, governance, audit, or other domain evidence without placing
   those records in the PM-facing work body.

Adapters may provide `properties` (or the legacy-compatible `meta`),
`sections`, `activity.composerHtml`, `activity.notesHtml`, `activity.html`,
and `footerHtml`. The shared component treats all values as presentation
markup; adapters retain their own canonical data mapping, controlled writes,
authorization, and domain semantics. WorkLog may implement a future adapter
without changing this component or the AI Board / WorkLog data models.

## Golden Master Preview v1

`golden-master-fixture.js` is intentionally not a third domain source. It
contains only deterministic sample states for visual and interaction QA. The
`golden-master-preview.js` renderer uses the same shared Shell, Task Board,
Task Card, and Task Drawer contracts as the consumers, while keeping the
fixture read-only. Workspace and column names remain consumer-provided data;
the shared capability is the add/edit/delete/reorder/move-task contract, not a
fixed four-column or six-column template.
