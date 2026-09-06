# Shared Security

Shared Security implements ADR-013 without creating a second OAuth flow.

- `permission-service.js` evaluates named application capabilities.
- `security-gate.js` evaluates Shared Session validity, canonical module level,
  lock state, assurance level, and required capability.

The gate returns `STEP_UP_REQUIRED` when higher assurance is needed. It does
not start MFA, OAuth, timers, or database requests. The root application owns
those actions. Database RLS remains the authoritative data boundary and cannot
be replaced by a client-side gate.

