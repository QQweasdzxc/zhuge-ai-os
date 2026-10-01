# Mini Market Chart QA Summary

Status: **Developer QA PASS — GPT / PM Review pending**  
Build: `20261002-0050`

## Acceptance

- Research and portfolio cards now call the same `MiniMarketChart` authority.
- Research mode: up to 20 provider-supplied OHLC candles and supplied volume.
- Portfolio mode: same chart plus a read-only, optional average-cost line.
- Close-only evidence is rendered as a thin line with `PARTIAL_HISTORY`; missing evidence is `NOT_CONNECTED`; provider failure is `UNAVAILABLE`.
- Missing OHLC and volume are never fabricated; missing average cost never creates a line.
- 0050 / 2330 research and portfolio presentations, 6488 no-history, Desktop, and 375px Mobile rendering were checked in the clearly labeled synthetic visual fixture.
- Existing provider history cache and alias/deduplication behavior are reused; the chart itself makes no requests.

## Gates

| Gate | Result |
|---|---:|
| `npm run check` | PASS |
| Lab unit tests | 34 PASS / 0 FAIL / 0 skipped |
| Lab Playwright E2E | 14 PASS / 0 FAIL |
| Browser Regression | 18 browser tests + 5 standalone journeys PASS / 0 FAIL / 0 skipped |
| Full Regression with Chrome | 853 PASS / 0 FAIL / 0 skipped |
| Desktop 1440×900 / Mobile 375×812 overflow check | PASS / PASS |
| `git diff --check` | PASS |
| `modules/investment/` source diff | 0 |

## Boundaries and pending evidence

- Formal Investment files, formal portfolio business logic, Cloud/Product Data, and GitHub Remote were not changed.
- No commit, push, PR, deployment, or data mutation was performed.
- Real authenticated holdings were not available in this browser run. The authenticated Portfolio gate correctly returned `SESSION_REQUIRED` before reading Portfolio (`0` Portfolio REST reads). Screenshots of holdings are synthetic visual fixtures, not account/runtime evidence.
- Public provider requests that hit browser CORS boundaries remain governed by their existing provider status; no fake history was added. This task did not certify a new live-provider source.
