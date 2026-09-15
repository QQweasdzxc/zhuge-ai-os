# Zhuge AI OS Foundation

## Product boundary

Zhuge AI OS is the product. WorkLog is an active domain module, while Modules
A, B, and C provide the shared navigation, workspace composition, and Board
capability foundation. A module or Consumer may own its domain rules, data,
workflow definition, and configuration, but identity, session, navigation,
shared services, theme, AI, and cross-module contracts belong to the
Foundation.

## Permanent rules

1. One Identity — Google Identity and the Supabase session are established once.
2. One Dashboard — the root entry is the AI OS Portal.
3. One Shared Runtime — modules consume `shared/*` and never copy platform code.
4. Independent Modules — modules never import one another.
5. One Source of Truth — cloud services remain the source for persisted data.
6. Product locale — `zh-TW`, `Asia/Taipei`, Gregorian `yyyy/MM/dd`, `TWD`.
7. One C Runtime — C Consumers use the shared Board/Card/Workspace/Movement
   contracts; they do not create parallel shared engines or writers.
8. Separate Consumer Data — C Consumers keep independent Board Instances,
   Workspaces, Cards, and domain data while sharing C capability and authority.
9. Optional Workflow — a Consumer may be `NOT_CONFIGURED` / `N/A`; that is a
   legal capability state, not a failure by itself.
10. Canonical Completion Lifecycle — applicable Consumers use the C lifecycle
    contract; the current policy is Completion entry plus `86400` seconds / 24
    hours, with no creation-time or last-edit-time fallback.

## Layers

```text
app/              Shell, layout, Dashboard Portal, root routing
shared/identity/  Canonical Auth UUID and public identity normalization
shared/auth/      Validated auth runtime and redacted session adapter
shared/security/  Permission and ADR-013 Security Gate
shared/core/      Compatibility facades, navigation, workspace contracts
shared/board/      Canonical Board read/runtime contract
shared/services/  ModuleContext and Shared Platform composition boundary
shared/ai/        Mr. KM capability boundary
shared/theme/     Design tokens and shared styles
shared/assets/    Product brand assets
modules/          Independent business modules
```

The WorkLog domain retains its own approved domain data and compatibility
boundaries. Formal Board Consumers mount the Shared C Runtime and controlled
Cloud contracts; Foundation documentation does not create a second runtime or
merge Consumer data.

## Module identity boundary

New modules receive a `ModuleContext` from the root-owned Shared Platform.
They do not receive Supabase Auth, OAuth methods, tokens, or storage access.
The context exposes only redacted identity/session snapshots and centralized
security decisions.

## Current C Consumer boundary

The current C Runtime set is:

| Consumer | Runtime boundary | Consumer-owned boundary |
|---|---|---|
| C Mother | Canonical Template C / Golden Master reference | Mother reference data |
| AI Board | Shared C Board Runtime | AI Board domain, workflow, and data |
| WorkTodo | Shared C Board Runtime at `/app/Board/worktodo/` | Formal WorkTodo Board data and configuration |
| GAS / 庶務行政 | Shared C Board Runtime | GAS domain extensions and data |
| Investment / 投資戰情板 | Shared C Board Runtime where applicable | Investment domain data; read-only capability boundary |

Consumer differences in data, workspace names/IDs, workflow definition, domain
content, or capability availability do not create a second C engine. The
canonical C authority remains responsible for shared movement, lifecycle,
archive, deletion evidence, and controlled persistence.

## Evidence and identity boundary

Task deletion uses the C canonical delete contract: the deletion transaction
records an immutable deletion manifest and a `task_deleted` activity snapshot
before the parent/cascade delete. Evidence storage is not a second authority.

Published and Development identities are separate. Published C source identity
comes from Cloud `module_releases`; Consumer Adoption source identity is
server-derived from that Published Release. Version/Build alone is not source
identity, and an older adoption record without source fields is not silently
rewritten.
