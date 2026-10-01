# Data Truth and Evidence Contract

## Required fields

Every provider observation is represented by `src/lib/contract.mjs` and carries:

`status`, `dataTruth`, `provider`, `source[]`, `dataTimestamp`, `publishedAt`, `fetchedAt`, `stale`, `delayed`, `fallback`, `attribution`, `license`, `note`, `errorCode`, and normalized `data` or `null`.

## Status semantics

- `AVAILABLE`: normalized data was returned for this request.
- `PARTIAL`: only some expected fields/rows were available; absent values remain null.
- `NOT_APPLICABLE`: the data does not apply to the instrument (e.g. issuer financial statements for ETF 0050).
- `NOT_CONNECTED`: no validated provider path; no number is fabricated.
- `PROVIDER_REVIEW_REQUIRED`: source automation/reuse rights or authority are unresolved; source is not queried.
- `UNAVAILABLE`: the real provider could not return usable data; sanitized error code is retained.

## Truth labels

`OFFICIAL`, `REAL`, `DELAYED`, `FALLBACK`, `NOT_CONNECTED`, `UNAVAILABLE`, `KEY_REQUIRED`, `PLAN_REQUIRED`, `FINMIND`, `YAHOO`, and `SIMULATED` are distinct labels. Runtime Sandbox does not call Yahoo or FinMind. `SIMULATED` is permitted only in explicitly test-only vectors and cannot become runtime evidence. Same-source cached data is labelled fallback and keeps the retrieval/error evidence; another provider is never silently substituted.

## Time and interpretation

- `dataTimestamp` describes the source observation/report period.
- `fetchedAt` records retrieval time, not market observation time.
- Daily official closes are delayed; no UI copy calls them live/intraday prices.
- World Bank prices are monthly averages.
- Company financial statements retain their source period/scope; YTD income and period-end balance are not conflated.
- Indicator calculations use only the displayed symbol's returned historical OHLCV. Missing history means no indicator, not a generated series.
- Price radar availability does not imply the covered company has revenue/cost exposure to that commodity.

## API and security

Only allowlisted symbols and read-only GET endpoints exist. Errors are reduced to sanitized categories; provider response bodies and credentials are not returned. Test fixtures are isolated under `test/` and named as test-only data.
