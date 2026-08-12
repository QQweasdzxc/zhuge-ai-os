# WorkLog Auth Session Refresh Patch

- Version: `0.9.0-alpha.9.2`
- Build: `20260802-2126`
- Scope: WorkLog / Shared Auth bug fix only

## Root cause

The canonical refreshed access token was written to `AUTH_SESSION_KEY`, but
`currentAccessToken()` preferred the older token cached in the root UI session.
After a successful refresh, REST retries could therefore resend the expired JWT.
Concurrent cloud calls could also attempt to rotate the same refresh token more
than once.

## Fix

- Treat the stored Auth session as the canonical rotating-token source.
- Synchronize refreshed token fields back to the root session snapshot.
- Collapse concurrent refresh attempts into one in-flight request.
- Stop REST/Storage retries when refresh fails; return a clear re-login message.
- Preserve OAuth, Shared Session, module boundaries, schema, and WorkLog runtime.
