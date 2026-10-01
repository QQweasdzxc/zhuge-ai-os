# Runtime Evidence｜Portfolio Mini Sparkline v1

## Run identity

- Date: 2026-10-02 (Asia/Taipei)
- Candidate Build: `20261002-0015`
- Branch: `main`
- Base HEAD: `014d3f8ca8e644e4bf4cf6048fed66c9af8ddf3d`
- Runtime: temporary same-origin static preview served by the browser test; no Cloud or authenticated session.
- Machine browser: Google Chrome, headless Chromium automation.

## Authenticated Portfolio boundary

The browser exercised Lab Center → Lab_投資 with no signed-in Zhuge session. The UI presented `SESSION_REQUIRED`; the gate ran before the owner-scoped Portfolio read. Observed Portfolio REST read requests: **0**. No authentication was fabricated and no real holding values were read. Thus authenticated actual-holdings display is **NOT VERIFIED** and remains for GPT/PM review with a legitimate session.

## Sparkline visual/behavior evidence

The visual fixture is labeled `QA VISUAL FIXTURE — synthetic, not portfolio data` and `DEVELOPER QA ONLY`. Its values exist solely to test geometry, cost-line omission/presence, trend direction and empty state; they are not provider or Portfolio evidence.

| Screenshot | Viewport | What it demonstrates |
|---|---:|---|
| [All holding cards](./screenshots/my-holdings-desktop-1440.png) | 1440×900 | Four visual fixtures, cost-line and no-history states; synthetic-data watermark visible |
| [0050 card](./screenshots/0050-card-desktop-1440.png) | card capture | 20-point path, latest point, canonical-cost fixture reference, history metadata |
| [Average-cost reference card](./screenshots/average-cost-reference-card-desktop-1440.png) | card capture | Cost line and currency label |
| [No-history card](./screenshots/no-history-card-desktop-1440.png) | card capture | `NOT_CONNECTED`, no SVG/fake path, card's other fixture fields remain visible |
| [Mobile holding cards](./screenshots/my-holdings-mobile-375.png) | 375×812 | Responsive cards, no horizontal overflow, synthetic-data watermark visible |
| [Actual anonymous session gate](./screenshots/my-holdings-session-gate-desktop-1440.png) | 1440×900 | Real runtime boundary: session required, no actual holdings rendered |
| [Actual mobile session gate](./screenshots/my-holdings-session-gate-mobile-375.png) | 375×812 | Same fail-closed session boundary on mobile |

Machine-readable browser result: [browser-result.json](./screenshots/browser-result.json)

## Browser observations

- Lab sparkline E2E: 14 PASS / 0 FAIL; 0 page errors; 0 console errors; no skipped checks.
- Desktop fixture width: 1440 CSS px; document scroll width 1425 px (no overflow).
- Mobile fixture width: 375 CSS px; document scroll width 375 px (no overflow).
- Research-route smoke: `2330.TW`, `0050.TW`, `6488.TWO`; AAPL and NVDA retain explicit `NOT_CONNECTED` state where unsupported.
- Provider CORS/error boundary observations are reported separately; no fabricated values are used to turn provider access into PASS.

