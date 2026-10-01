# Portfolio Read-only Runtime Evidence

## Candidate

- Build: `20261001-2324`
- Test surface: local static-file preview of the Candidate source using Google Chrome
- No deployment, Cloud mutation, portfolio mutation, or GitHub Remote mutation occurred.

## Verified

- Desktop 1440px Lab Center → same-origin `/labs/investment/`: PASS; no popup, `.app`, Terminal, or localhost-link requirement.
- Anonymous portfolio path: `SESSION_REQUIRED` before owner mapping or portfolio REST read; holding-card count `0`; observed portfolio REST reads `0`.
- 0050 research journey: PASS with available Taiwan-provider evidence; no portfolio context was available in the anonymous local runtime.
- AAPL and NVDA research routes: PASS as `NOT_CONNECTED`, null provider data, and no mock quote.
- Mobile 375×812: PASS, no horizontal overflow; minimum measured navigation target 44px.
- Uncaught JavaScript errors: 0. Browser console errors: 0. Expected provider CORS/network-boundary observations are recorded separately; they do not become fabricated evidence.
- Lab Browser E2E: 12 PASS / 0 FAIL.

## Not verified — required authenticated gate

The available Zhuge login session belongs to the published-site origin. The local Candidate preview is a different origin and has no authenticated session. Session/token copying or a fabricated login was not used. Therefore this run did **not** read real holdings and did not validate actual rows for `0050`, a held Taiwan ETF, a held Taiwan stock, `AAPL`, or `NVDA`. It also did not click “查看研究” from an actual portfolio row.

Status: **PARTIAL — AUTHENTICATED_RUNTIME_REQUIRED**. Complete these checks only when the Candidate is served through an authorized authenticated Zhuge runtime:

1. Verify current holdings are read from the canonical portfolio projection and match the formal Investment UI without recording values in logs.
2. Verify `0050`, one actually held Taiwan ETF, and one actually held Taiwan stock when those positions exist. Do not create positions to satisfy coverage.
3. For `AAPL` and `NVDA`, show a holding only if actually held; research stays `NOT_CONNECTED` unless an approved provider is available.
4. Click a real holding’s “查看研究”; verify route contains ticker only and research page shows read-only holding context.
5. Read back portfolio values and confirm unchanged.

## Screenshot inventory

Screenshots are local-only, outside the repository, and contain no authenticated portfolio values:

- `screenshots/my-holdings-session-gate-desktop-1440.png` — unauthenticated holdings gate, not a holdings screenshot.
- `screenshots/my-holdings-session-gate-mobile-375.png` — unauthenticated holdings gate, not a holdings screenshot.
- `screenshots/investment-0050-desktop-1440.png` — 0050 research UI, no portfolio context.
- `screenshots/investment-AAPL-research-not-connected-desktop-1440.png` — AAPL research UI, explicit provider gap.
- `screenshots/investment-home-desktop-1440.png`, `screenshots/investment-home-mobile-375.png` — Lab home previews.
- `screenshots/browser-result.json` — sanitized local browser check names/results and screenshot paths; no holdings values or tokens.

The requested **authenticated holdings Desktop/Mobile** and **Portfolio → Research** screenshots are intentionally not represented by these anonymous previews. They remain part of the authenticated runtime gate above.
