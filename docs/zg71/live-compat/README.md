# ZG-71 live-compatible gate variants

Production `zhuge-skyeye-read` and `workspace-email-notification` were older than main on 2026-11-09.
Deploying the main-based gate would ship unrelated main changes (weather cache; cc/bcc, card_url, From name).
These variants add only the app-access gate to the captured LIVE sources (`*.live.ts`, editor text read on 2026-11-09 07:04 CST).
Each also needs `supabase/functions/_shared/app-access.ts` (sha256 in tests). `tests/zg71-live-compat-gates.test.js` enforces:
live -> gated differs only by the allowed added gate lines, and the files match SHA256SUMS.
`*.live.ts` are provenance of what was live; they are not meant to replace main sources.
