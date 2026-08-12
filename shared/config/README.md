# Shared Configuration

`shared/config/` is the future-facing configuration boundary:

- `environment.js` — non-secret deployment metadata.
- `oauth.js` — provider and scope metadata; no login side effects.
- `supabase.js` — adapter to the existing runtime config.
- `version.js` — release identity.
- `feature-flags.js` — module availability flags.

The validated WorkLog entry still loads `shared/app-config.js` for backwards
compatibility. Do not duplicate secrets or create a second Supabase client.
