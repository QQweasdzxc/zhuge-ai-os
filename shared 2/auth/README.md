# Shared Auth

The validated Google OAuth/PKCE implementation remains in `auth-service.js`.
WorkLog continues to load that file unchanged.

`session-service.js` is a separate, read-only adapter used by the Shared
Platform composition root. It accepts an injected root session reader and
returns a redacted snapshot. It cannot sign in, sign out, refresh, persist, or
expose tokens. Product modules do not maintain their own auth implementation.
