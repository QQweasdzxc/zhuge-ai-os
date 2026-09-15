# Module Specification

## Required module shape

```text
modules/<module>/
├── pages/
├── components/
├── services/
├── models/
├── config/
├── assets/
└── index.html
```

## Rules

- A module owns only its business logic and presentation.
- A module can depend on `shared/*` only.
- A module must not import another module.
- A module must read the shared identity/session and never start OAuth itself.
- A module receives identity, session, and authorization only through its
  root-created `ModuleContext`.
- A module must not import Supabase Auth, decode/store tokens, or read auth
  browser-storage keys.
- A module must use shared services for persistence and integrations.
- A disabled module is represented by a launcher state, not a fake feature.

## Current modules

| Module | State | Purpose |
| --- | --- | --- |
| Module A | Active | Navigation / App Shell |
| Module B | Active | Workspace / Composition |
| Module C | Active | Board / Golden Master / shared Board capability |
| WorkLog | Active | 工作、工時、Knowledge 與 WorkLog domain |
| Investment Domain | Active / SIT | 市場資訊與投資分析 |
| Travel | DEV-ONLY | 旅遊規劃與景點資訊，尚非正式 Production entry |
| HR | DEV-ONLY | 人員與工作協作，尚非正式 Production entry |
| Knowledge | Active shared capability | Mr. KM 的知識來源 |

## Module C shared contract

Module C is the single shared Board capability/runtime boundary. Its formal
Runtime set is C Mother, AI Board, WorkTodo, GAS／庶務行政, and Investment／投資
戰情板. C Mother is the canonical Template C / Golden Master reference; it is
not a second Consumer data store.

| Shared capability | Canonical source/authority | Consumer-owned boundary |
|---|---|---|
| Board, Card, Workspace, Drawer, Checklist, Attachment, Activity, dates, persistence | Shared C Runtime and controlled Board contracts | Data, content, and domain configuration |
| Movement / completion decision | `board_c_reconcile_workspace_decision_v2` | Consumer Workflow Definition and designation |
| Completion / Archive lifecycle | `module-c-lifecycle-acceptance-v2` and C lifecycle RPCs | Completion/Archive may be N/A when capability is absent |
| Current lifecycle policy | `private.module_c_completion_archive_policies` | No Consumer-local interval or archive calculation |
| Parent Task Delete | `board_instance_delete_task` | Immutable manifest and `task_deleted` activity are evidence storage only |
| Release / Adoption identity | Published Cloud `module_releases` | Adoption records contain server-derived Published source identity |

All formal C Consumers use the same shared capability and authority contracts
while retaining independent Board Instance, Workspace, Card, Workflow
Definition, and domain data. Investment's read-only boundary is an explicit
capability difference, not a missing shared implementation.

Workflow is optional: `Published`, `NOT_CONFIGURED`, `N/A`, and `UNKNOWN` are
valid states according to the Consumer contract. A Consumer with no Workflow
does not fail merely because no Workflow is configured.

## Current C entries

| Entry | Route | Role |
|---|---|---|
| C Mother | `/app/Board/template-preview/` | Template C / Golden Master reference |
| AI Board | `/app/Board/ai/` | C Consumer with its own workflow/domain data |
| WorkTodo | `/app/Board/worktodo/` | C Consumer using the formal WorkTodo Board data |
| GAS／庶務行政 | `/app/Board/procurement/` | C Consumer with GAS domain extension |
| Investment／投資組合 | Domain `/modules/investment/`; C Board `/app/Board/investment/` | C Consumer with Investment read-only boundary |

Legacy or compatibility symbols may remain for historical evidence, but they
are not current C authority unless an explicit current contract says so.
