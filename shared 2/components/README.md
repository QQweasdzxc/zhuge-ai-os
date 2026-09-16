# Shared Components

Shared UI and module contracts:

- `index.js` — reusable presentation adapters
- `golden-master.js` — the only Empty Golden Master composition for shared Shell, Header, Toolbar, Board, Card, and Drawer contracts
- `task-card.js` — domain-neutral Task Card shell; consumers provide mapped display values and actions
- `task-drawer.js` — domain-neutral responsive Task Drawer shell; consumers supply mapped content and retain domain/write logic
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

## Empty Golden Master

`golden-master.js` is the single shared presentation source. Its default model
is intentionally empty: it contains no AI Board rows, WorkTodo rows, TASK or
WLTK values, fixed workspace names, fixtures, or Cloud access. AI Board and
WorkTodo call the same board/card/drawer composition with their own adapters and
normalized domain data. Workspace and column names remain consumer-provided
data; the shared capability is the add/edit/delete/reorder/move-task contract,
not a fixed four-column or six-column template.
