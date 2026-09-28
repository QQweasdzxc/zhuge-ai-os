# TASK-097 / TASK-098 Developer Acceptance

## Canonical path

`zhuge-investment-context-pack-v1` → `zhuge-investment-analysis-v1` → `InvestmentStrategyScanner` → `InvestmentHomeworkPack` → existing Investment Analysis UI.

The scanner and homework pack are read-only projections. They do not create a Strategy Decision Record, task, order, score, or second holdings/P&L source. A missing section remains `INSUFFICIENT_EVIDENCE`; the UI receives the missing evidence and a plain-language next step.

## Deterministic developer vectors

| Vector | Evidence exercised | Expected result |
|---|---|---|
| `2330.TW` | TWSE quote, OHLC, fundamental, industry | Technical and fundamental `AVAILABLE`; two selected strategies `READY`; no invented price zone |
| `0050.TW` | TWSE quote/OHLC, 51-component relationship, industry exposure, related symbol | Relationship `AVAILABLE`; fundamental `INSUFFICIENT_EVIDENCE`; growth strategy remains insufficient |
| `AAPL.US` | latest quote, OHLC, SEC fundamental/company profile | Technical and fundamental `AVAILABLE`; two selected strategies `READY`; US relationship evidence may remain insufficient |

The vectors are test fixtures only. They are not product data and are not loaded by the browser runtime. No external AI score is canonical; the only status is derived from section availability and traceable Evidence metadata.

## Acceptance evidence

- `tests/investment-strategy-homework-vectors.test.js`
- `tests/investment-strategy-scanner.test.js`
- `tests/investment-homework-pack.test.js`
- `tests/investment-intelligence-providers.test.js`

Human-only gates remain provider activation, production deployment, and live Runtime QA. None is required to execute the deterministic developer contract.
