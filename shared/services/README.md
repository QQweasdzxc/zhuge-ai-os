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
