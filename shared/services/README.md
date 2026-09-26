# Shared Services

Shared service boundaries are the only data and integration boundary available
to modules.

Current implementations remain under `shared/api/`, `shared/auth/`,
`shared/google/`, and `shared/supabase/` for compatibility. New services should
be added here first and exposed through a single service contract rather than
called directly from a module view.

```text
Module → shared service → Supabase / Google / API
```

## Module platform contract

The root shell creates one platform instance:

```text
ZhugeSharedPlatform.createSharedPlatform(root adapters)
  ↓
platform.forModule("investment")
  ↓
ModuleContext
  ├─ identity.getCurrent() / getUserId()
  ├─ session.getSnapshot() / subscribe()
  └─ security.can() / require()
```

The context does not contain OAuth methods, Supabase Auth, storage keys, or raw
tokens. This is the only identity/session/permission API available to a new
module.

Classic-script load order for the future root composition point:

```text
shared/identity/identity-service.js
shared/auth/session-service.js
shared/security/permission-service.js
shared/security/security-gate.js
shared/services/module-context.js
shared/services/shared-platform.js
```
