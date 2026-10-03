# UI Guideline v1.0

## Visual language

- Use the shared card, border, radius, spacing, typography, and status tokens.
- Status colors are consistent: green = healthy, amber = attention, red = error.
- Keep one product brand source: `Zhuge AI OS / by Mr. KM`.
- Module screens show the breadcrumb `Zhuge AI OS › Module`.

## Portal hierarchy

```text
Identity
  ↓
AI Daily Brief
  ↓
待辦事項與最近工作
  ↓
工作模組入口
  ↓
通知與 AI 建議
  ↓
系統狀態
```

## Accessibility

Every actionable card has a keyboard-accessible control, visible state text,
and a meaningful label. Color is supplementary; status text is always present.

## Shared Board actions and workspace lifecycle

SharedShell renders the Header; Golden Master renders its actions and responsive
geometry. Mobile (390×844) uses ＋新增 for 新增卡片 / 新增工作區 and ⋯ for
secondary tools. Desktop keeps direct create controls. The compact Header is
at most 116px on Mobile; controls and menu items remain at least 44×44px.
Mother-template adoption status is informational. 重新整理 explicitly reloads
Board data; opening its tools/status menu does not synchronize data.

Empty workspaces use the existing soft-deactivate delete contract. Workspaces
with retained history and no current cards can be archived; current work must
be handled first. Workspace archives have their own management surface, separate
from card history. Restoring updates the same Workspace UUID, never recreates
it or moves tasks. Names and ordering are validated on restore.

Module C Workspace lifecycle RPCs preserve Task/Activity/Attachment ownership
and immutable workflow evidence. For a Published Workflow they delegate active
Workspace binding changes to saveDraft → validate → publish atomically.
Pending drafts fail closed. Restore creates no automatic edges. Required
Workspace lifecycle migration is source-only until separately authorized;
Completion countdown correctness remains a different migration/authority.

The existing WorkTodo workspace guard permits only Workspace-scoped lifecycle
updates through the authenticated C RPCs. Empty deletion still soft-deactivates;
populated deletion remains fail-closed. Ordering protections and UUID, scope,
owner and creation identity are preserved. Historical delete protection does
not prevent reversible archive; the canonical Completion Workspace is retained.
