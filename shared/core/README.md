# Shared Core

`shared/core/` defines the application-level contracts that every module may
use:

- `IdentityManager` — normalized Google/Supabase identity data.
- `SessionManager` — read-only access to the existing authenticated session.
- `WorkspaceManager` — active module, recent modules, and favourites.
- `PermissionManager` — capability checks without triggering OAuth.
- `NavigationManager` — module route contracts.

These contracts do not replace the validated runtime services and do not add a
second login flow. They are the stable seam for future modules.
