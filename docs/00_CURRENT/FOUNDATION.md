# Zhuge AI OS Foundation

## Product boundary

Zhuge AI OS is the product. WorkLog is the first module. A module may own its
business rules, but identity, session, navigation, services, theme, AI, and
cross-module contracts belong to the Foundation.

## Permanent rules

1. One Identity — Google Identity and the Supabase session are established once.
2. One Dashboard — the root entry is the AI OS Portal.
3. One Shared Runtime — modules consume `shared/*` and never copy platform code.
4. Independent Modules — modules never import one another.
5. One Source of Truth — cloud services remain the source for persisted data.
6. Product locale — `zh-TW`, `Asia/Taipei`, Gregorian `yyyy/MM/dd`, `TWD`.

## Layers

```text
app/              Shell, layout, Dashboard Portal, root routing
shared/identity/  Canonical Auth UUID and public identity normalization
shared/auth/      Validated auth runtime and redacted session adapter
shared/security/  Permission and ADR-013 Security Gate
shared/core/      Compatibility facades, navigation, workspace contracts
shared/services/  ModuleContext and Shared Platform composition boundary
shared/ai/        Mr. KM capability boundary
shared/theme/     Design tokens and shared styles
shared/assets/    Product brand assets
modules/          Independent business modules
```

The existing WorkLog runtime remains a compatibility implementation. The
Foundation contracts are introduced first so future migrations can be staged
without changing validated behavior.

## Module identity boundary

New modules receive a `ModuleContext` from the root-owned Shared Platform.
They do not receive Supabase Auth, OAuth methods, tokens, or storage access.
The context exposes only redacted identity/session snapshots and centralized
security decisions.
