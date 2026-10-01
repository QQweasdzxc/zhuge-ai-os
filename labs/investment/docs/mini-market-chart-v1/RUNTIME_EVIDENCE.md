# Mini Market Chart Runtime Evidence

Build: `20261002-0050`  
Baseline HEAD: `53f7607bb232f0ae44eee8b820bfb351cac828ca` on local `main`  
Browser evidence run: `2026-10-01T17:00:30.539Z` (2026-10-02 01:00:30 Asia/Taipei)  
Environment: local static preview harness, Google Chrome / Playwright.

## Results

- Lab syntax check: PASS.
- Lab unit tests: `34 PASS / 0 FAIL / 0 skipped`.
- Lab browser E2E: `14 PASS / 0 FAIL`; no page errors or uncategorized console errors.
- Browser regression: `18 browser tests + 5 standalone journeys PASS / 0 FAIL / 0 skipped`.
- Full regression with installed Chrome: `853 PASS / 0 FAIL / 0 skipped`.
- Desktop fixture viewport: `1440×900`, document width `1425` (no horizontal overflow).
- Mobile fixture viewport: `375×812`, document width `375` (no horizontal overflow).
- The browser E2E checks the three live research cards use the shared research-mode renderer, the watchlist research pool reuses the same renderer, research cards do not show cost overlays, and both modes preserve explicit no-history states.
- The marked visual fixture exercises 20-bar 0050 and 2330 research/portfolio cards, actual fixture volume values, Taiwan up/down/flat tones, portfolio-only cost lines, and 6488 `NOT_CONNECTED`.

## Evidence limitation

This browser run had no authenticated Zhuge session. The formal Portfolio area correctly stayed at `SESSION_REQUIRED`; observed Portfolio REST reads were `0`. Therefore the screenshots showing holdings and candlesticks are explicitly watermarked **synthetic QA fixture** evidence for layout/rendering only. They do not prove the PM's real holdings, real authenticated portfolio values, or real-time provider availability.

The static browser run observed 56 provider-boundary CORS/network notices across existing public-provider journeys. They were classified by the harness; there were no uncaught page errors, same-origin HTTP failures, or uncategorized console failures. No provider data was substituted to make the chart pass.

## Screenshots

All holding/chart values in the following visual-fixture screenshots are synthetic and visibly labeled as test-only:

- [0050 research card — Desktop 1440](screenshots/research-0050-chart-desktop-1440.png)
- [0050 holding card with average-cost line — Desktop 1440](screenshots/portfolio-0050-cost-line-desktop-1440.png)
- [2330 research card — Desktop 1440](screenshots/research-2330-chart-desktop-1440.png)
- [2330 holding card with average-cost line — Desktop 1440](screenshots/portfolio-2330-cost-line-desktop-1440.png)
- [6488 no-history state — Desktop 1440](screenshots/no-history-card-desktop-1440.png)
- [0050 holding card with average-cost line — Mobile 375](screenshots/portfolio-0050-cost-line-mobile-375.png)
- [2330 research card — Mobile 375](screenshots/research-2330-chart-mobile-375.png)
- [Machine-readable browser results](screenshots/browser-result.json)
