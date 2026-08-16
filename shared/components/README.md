# Shared Components

Shared UI and module contracts:

- `index.js` — reusable presentation adapters
- `task-drawer.js` — domain-neutral responsive Task Drawer shell; consumers supply mapped content and retain domain/write logic
- `workspaces.js` — Dashboard/module registry (legacy internal identifier retained for compatibility)

Module-specific UI and domain adapters remain inside the owning module. The
shared Task Drawer does not read Cloud data, call RPCs, or own authorization.
