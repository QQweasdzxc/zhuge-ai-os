# Full Site UX Polish — Candidate QA

## Scope

This candidate contains the approved UX polish for:

- WorkLog quick-add actions and generic 工作建議 copy.
- Dashboard compact WorkLog overview and compact task/continue areas.
- Shared hamburger visibility rules across expanded, collapsed, tablet, and mobile shells.
- Control Console secondary tabs for system status and engineering destinations.

Business logic, authentication, OAuth, Supabase schema, RLS, identity, and existing workflow contracts are unchanged.

## Build identity

- Product Version: `v0.9.0-alpha.9.12`
- Runtime Build: `20260811-1517`
- Candidate package time: `2026-08-11 15:17 Asia/Taipei`

The Runtime Build and the final package timestamp must be updated together at packaging time.

## Developer QA

- Automated suite: `70 passed, 0 failed, 0 skipped`
- Browser suite: executed with macOS Chrome via `CHROME_PATH=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`
- JavaScript syntax checks: PASS
- Inline script checks: PASS
- `git diff --check`: PASS
- Dashboard visual audit: 1600×900 and 390×844, no horizontal overflow, no console errors.
- Shared hamburger audit: hidden on expanded desktop; visible when collapsed/tablet/mobile navigation must be reopened.
- Construction placeholders: not rendered in the shared navigation.

## Live QA boundary

The local browser session was unauthenticated, so an authenticated WorkLog live workflow was not claimed as PASS. QJC should verify the signed-in WorkLog quick-add flow, Dashboard WorkLog overview values, and cross-workspace navigation on the supplied Candidate.

## Security and delivery checks

- No Auth/OAuth changes.
- No Supabase schema, RLS, or database changes.
- No Service Role key, private JWK, actor token, `.env`, `.pem`, or `.key` files are included.
- Production deploy, GitHub Pages deploy, merge, and release are not performed by this handoff.
