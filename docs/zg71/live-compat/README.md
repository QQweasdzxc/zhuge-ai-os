# ZG-71 live-compatible gate variants

Production `zhuge-skyeye-read` and `workspace-email-notification` were older than main on 2026-11-09.
Deploying the main-based gate would ship unrelated main changes (weather cache; cc/bcc, card_url, From name).
These variants add only the app-access gate to the captured LIVE sources (`*.live.ts`, editor text read on 2026-11-09 07:04 CST).
Each also needs `supabase/functions/_shared/app-access.ts` (sha256 in tests). `tests/zg71-live-compat-gates.test.js` enforces:
live -> gated differs only by the allowed added gate lines, and the files match SHA256SUMS.
`*.live.ts` are provenance of what was live; they are not meant to replace main sources.

## investment-intelligence-read (import-only repack)

The Supabase dashboard bundler cannot resolve `../../../labs/...` imports (Module not found, 2026-11-09 07:18, live unchanged), so the function could not be redeployed from the editor at all.
Files here: `*.live.ts` (live editor text), `*.gated.ts` (live + 3 gate lines, nothing else; live used the "Tron OS" brand strings and keeps them),
`*.gated-repack.ts` (gated with only the 4 `../../../labs/` specifiers rewritten to `../_shared/labs/`).
Editor entries were hashed against the repo (`investment-live-entry-hashes.txt`): 17 of 18 labs/_shared entries are byte-identical to the repo;
`_shared/yahoo-us-market.mjs` differs only by the user-agent brand string ("Tron Investment ..." live vs "TRQN Investment ..." repo), so the live text is kept.
The three `_shared` files that import labs (fred-global-fx-context, us-treasury-market-context, world-bank-commodity-radar) get `./labs/...` specifiers; the ten labs files move unchanged to `../_shared/labs/investment/src/...`.
`investment-repack-check.sh` (needs deno 2.x) compares the Deno module graphs of the repo layout and the repacked layout: same 20 local modules, identical content after specifier normalisation, same 2 remote deps, no errors.
