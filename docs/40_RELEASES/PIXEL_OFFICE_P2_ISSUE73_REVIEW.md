# P2 Issue #73｜Weather and Day/Night Candidate Review

## Candidate identity

- Baseline: `0.9.0-alpha.9.82` / `20261019-1520` / `3ff6183180519fbd1bac7ffa4124969d24ae423e` (#72 candidate)
- Candidate: `0.9.0-alpha.9.83` / `20261019-1707`
- Branch: `review/p2-issue-73-weather-20261019`
- Release scope: P2 weather data contract and Pixel Office overlay only. No formal deployment or DB migration.

## Implementation

- Reuses the existing authenticated, read-only `zhuge-skyeye-read` Supabase Edge Function and its existing server-side `CWA_API_KEY`; the browser never receives the key.
- Adds city observation, rainfall, official typhoon-warning, and official land strong-wind reads. Taipei is the default; a fixed Taiwan city list is manually selectable and does not use GPS.
- Exposes `zhuge-weather-v1` and `zhuge-weather-visual-v1`, with source URLs, observation/fetch times, freshness, status, and explicit unknown states. Observation freshness is capped at 90 minutes; the Edge response cache is five minutes and the client request interval is five minutes.
- Day/night uses an explicitly disclosed solar-position approximation in `Asia/Taipei`, not a claim that CWA supplied sunrise/sunset.
- The Habblaud page uses the existing same-origin `ZhugeSupabaseGateway` if the host provides it. It never reads or accepts a token directly. The public static P2 entry currently does not load that gateway, and the Edge Function requires a valid Zhuge session; therefore this candidate's static-page runtime intentionally displays “尚無可驗證” until an authorized host gateway is present.
- CWA source schemas and authenticated live responses could not be verified in this isolated environment. Unsupported alert shapes, missing credentials, stale/malformed observations, and unauthenticated access fail closed to unknown; no warning is inferred from rain.

## QA evidence

- CWA weather contract fixtures: 5/5 PASS (condition mapping, independent rainfall, stale/malformed, official warning provenance, city allowlist).
- P2/P1 Habblaud contract regression: 20/20 PASS.
- Product browser regression: 75/75 tests PASS, plus all 16 Investment browser capability checks PASS; zero skipped.
- Pinned upstream Habblaud commit `faa1a012b5fbf632c66dc6801c5383e53a542406` build: PASS.
- Habblaud targeted Vitest, including weather adapter: 8 files / 85 tests PASS.
- Habblaud TypeScript: PASS.
- Chromium Canvas smoke, desktop and mobile viewports: PASS for Taipei default, honest unknown state without a gateway, city selection, and panel bounds. This is Chromium viewport coverage, not real iPhone Safari.
- Frozen vendor: no tracked changes under `third_party/multica`.
- Official CWA endpoints: source URLs are fixed to CWA Open Data; direct unauthenticated endpoint read returned HTTP 403, so no live payload/schema claim is made.

## Remaining gate

- Live weather data and official alert status remain **NOT VERIFIED / BLOCKED** until an authorized same-origin host supplies the existing authenticated gateway and the deployed Edge Function/CWA credential path is tested. No public unauthenticated route was added.
- No Production, Supabase, main, or Render changes were made.
- Rollback: revert the Issue #73 candidate commit; no DB state was added.
