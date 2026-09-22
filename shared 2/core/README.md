# Shared Core

`shared/core/` contains compatibility names for Foundation contracts:

- `IdentityManager` — facade over `shared/identity/`.
- `SessionManager` — facade over the redacted adapter in `shared/auth/`.
- `WorkspaceManager` — active module, recent modules, and favourites.
- `PermissionManager` — facade over `shared/security/`.
- `NavigationManager` — module route contracts.

New modules do not assemble these facades themselves. The root shell creates
one `ZhugeSharedPlatform` and passes each module a `ModuleContext`. These files
do not replace the validated runtime services and do not add a second login
flow.
