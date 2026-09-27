# Shared Identity

`ZhugeIdentity` is the canonical cross-module identity contract.

It converts the existing Google, Email/Password, or other Supabase Auth
session shape into an immutable, provider-neutral object containing only:

- authenticated Supabase Auth UUID;
- display name;
- email;
- avatar URL;
- provider label;
- authentication state.

It never exposes an access token, refresh token, provider token, OAuth method,
or storage key. A module must use `ModuleContext.identity` instead of reading
Supabase Auth or browser storage.
